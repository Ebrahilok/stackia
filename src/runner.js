'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { adapters } = require('./adapters');
const { buildPackage, parseHandoff } = require('./context');
const { run, killTree } = require('./process');
const gitOps = require('./git');
const { now } = require('./office');

const fs = require('node:fs');

const AUTO_CLEAN_RATIO = 0.6;
const DEFAULT_LIMIT_BACKOFF_MS = 30 * 60000;
const LIMIT_ERROR = /rate.?limit|usage limit|limit reached|quota|too many requests|resource.?exhausted|\b429\b|overloaded|try again (in|later)/i;
const TASK_DIR = /^T-\d+$/;
const normalize = (file) => file.replace(/\\/g, '/').replace(/^\.\//, '');

/** Queues agent runs, keeps context alive across sessions, and records everything. */
class Runner {
  constructor({ office, cli, maxConcurrent, timeoutMs, mcpServers = {}, limitBackoffMs = DEFAULT_LIMIT_BACKOFF_MS }) {
    Object.assign(this, { office, cli, maxConcurrent, timeoutMs, mcpServers, limitBackoffMs });
    this.queue = [];
    this.running = new Map();
    this.paused = false;
    this.limits = new Map();
    this.violations = [];
    this.wake = null;
  }

  /** Until when a provider is paused because it reported a usage limit (0 if it is not). */
  limitedUntil(provider) {
    const until = this.limits.get(provider) || 0;
    return until > Date.now() ? until : 0;
  }

  status() {
    return {
      paused: this.paused,
      limits: [...this.limits].filter(([, until]) => until > Date.now()).map(([provider, until]) => ({ provider, until })),
      running: [...this.running.values()].map(({ job }) => summary(job)),
      queued: this.queue.map(summary),
    };
  }

  isBusy(agentId, threadId) {
    return [...this.running.values()].some(({ job }) => job.agent === agentId && job.thread === threadId)
      || this.queue.some((j) => j.agent === agentId && j.thread === threadId);
  }

  /** The instruction is saved before anything runs, so it survives a crash or a cleanup. */
  send(agentId, threadId, text) {
    const thread = this.office.thread(agentId, threadId);
    if (!thread) throw new Error('Unknown thread.');
    if (this.isBusy(agentId, threadId)) throw new Error('This agent is still working on this conversation.');
    thread.messages.push({ role: 'owner', text, at: now() });
    this.office.saveThread(thread);
    this.office.log('instruction', { agent: agentId, thread: threadId, task: thread.taskId, text });
    const job = { id: crypto.randomBytes(4).toString('hex'), agent: agentId, thread: threadId, text };
    this.queue.push(job);
    this.pump();
    return job;
  }

  pump() {
    let index = 0;
    while (!this.paused && this.running.size < this.maxConcurrent && index < this.queue.length) {
      const job = this.queue[index];
      const provider = this.office.agent(job.agent)?.provider;
      if (this.limitedUntil(provider)) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      const entry = { job, child: null, stopped: false, violations: [] };
      this.running.set(job.id, entry);
      this.execute(entry)
        .catch((err) => this.recordFailure(job, err.message))
        .finally(() => {
          this.running.delete(job.id);
          this.pump();
        });
    }
    this.scheduleWake();
  }

  /** Jobs held back by a provider limit start again by themselves once the pause ends. */
  scheduleWake() {
    clearTimeout(this.wake);
    const until = this.queue
      .map((job) => this.limitedUntil(this.office.agent(job.agent)?.provider))
      .filter(Boolean);
    if (!until.length) return;
    this.wake = setTimeout(() => this.pump(), Math.max(50, Math.min(...until) - Date.now() + 50));
    this.wake.unref();
  }

  /** Puts the job back at the front of the queue and pauses its provider. The task is not marked as failed. */
  hitLimit(job, agent, message) {
    const until = Date.now() + this.limitBackoffMs;
    this.limits.set(agent.provider, until);
    this.office.log('provider_limited', { provider: agent.provider, agent: agent.id, job: job.id, until: new Date(until).toISOString(), error: message.slice(0, 300) });
    const thread = this.office.thread(job.agent, job.thread);
    const time = new Date(until).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    thread.messages.push({ role: 'system', text: `Límite de uso de ${agent.provider}. Reintento automático a las ${time}.`, at: now() });
    this.office.saveThread(thread);
    if (thread.taskId) this.office.updateTask(thread.taskId, { status: 'approved' });
    this.queue.unshift(job);
  }

  /** Looks for writes outside the task's own branch folder, which agents must never make. */
  async snapshot() {
    const root = this.office.project.worktrees;
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { /* the folder does not exist yet */ }
    const status = await run('git', ['status', '--porcelain'], { cwd: this.office.project.repo, timeoutMs: 60000 });
    return { entries: new Set(entries), status: new Set(status.stdout.split('\n').filter(Boolean)) };
  }

  async findViolations(before, job) {
    const after = await this.snapshot();
    const found = [];
    for (const name of after.entries) {
      if (!before.entries.has(name) && !TASK_DIR.test(name)) found.push({ kind: 'carpeta fuera de su rama', detail: name });
    }
    for (const line of after.status) {
      if (!before.status.has(line)) found.push({ kind: 'tu copia de trabajo cambió', detail: line.trim() });
    }
    for (const item of found) {
      const record = { at: now(), job: job.id, agent: job.agent, ...item };
      this.violations.push(record);
      this.office.log('violation', record);
    }
    return found;
  }

  async execute(entry) {
    const { job } = entry;
    const { office } = this;
    const agent = office.agent(job.agent);
    const thread = office.thread(job.agent, job.thread);
    const task = thread.taskId ? office.task(thread.taskId) : null;
    const write = Boolean(task && agent.canWrite);
    const pack = buildPackage({ office, agent, thread, text: job.text });
    const adapter = adapters[agent.provider];
    if (!adapter) throw new Error(`Unknown provider: ${agent.provider}`);
    if (task) office.updateTask(task.id, { status: 'running' });

    const request = {
      prompt: pack.prompt,
      model: agent.model,
      effort: agent.effort,
      write,
      cwd: task?.worktree || office.project.repo,
      sessionId: thread.session?.id || null,
      commands: agent.commands || [],
      mcp: agent.mcp || [],
      mcpConfig: this.mcpConfigFile(agent),
    };
    office.store.writeText(`runs/${job.id}.prompt.txt`, pack.prompt);
    const { cmd, args, stdin } = adapter.command(request, this.cli);
    const before = await this.snapshot();
    const started = Date.now();
    const result = await run(cmd, args, {
      cwd: request.cwd,
      stdin,
      timeoutMs: this.timeoutMs,
      onStart: (child) => { entry.child = child; },
    });
    entry.violations = await this.findViolations(before, job);
    if (entry.stopped) return this.recordFailure(job, 'Stopped by the owner.');
    if (result.timedOut) return this.recordFailure(job, 'Timed out.');
    if (result.spawnError) return this.recordFailure(job, `Could not start ${agent.provider}: ${result.spawnError}`);

    const parsed = adapter.parse(result);
    if (parsed.error) {
      return LIMIT_ERROR.test(parsed.error) ? this.hitLimit(job, agent, parsed.error) : this.recordFailure(job, parsed.error);
    }
    if (pack.usedNotes) office.archiveNotes(agent.id);
    await this.recordSuccess({ job, agent, task, parsed, pack, violations: entry.violations, seconds: (Date.now() - started) / 1000 });
  }

  async recordSuccess({ job, agent, task, parsed, pack, violations = [], seconds }) {
    const { office } = this;
    const thread = office.thread(job.agent, job.thread);
    const { text, handoff } = parseHandoff(parsed.text);
    const changed = task ? await gitOps.changedFiles(task.worktree) : [];
    const unconfirmed = handoff
      ? handoff.files_changed.map(normalize).filter((f) => task && !changed.map(normalize).includes(f))
      : [];

    thread.messages.push({
      role: 'agent', text, at: now(), usage: parsed.usage, seconds,
      warnings: [
        ...(handoff ? [] : ['Sin handoff: la próxima sesión retoma desde tu instrucción.']),
        ...(unconfirmed.length ? [`Dijo haber cambiado archivos que git no ve: ${unconfirmed.join(', ')}`] : []),
        ...violations.map((v) => `Escribió fuera de su rama (${v.kind}): ${v.detail}`),
      ],
    });
    thread.session = { provider: agent.provider, id: parsed.sessionId, tokens: parsed.contextTokens || 0 };
    if (handoff) thread.lastHandoff = handoff;
    office.saveThread(thread);

    for (const fact of handoff?.memory || []) office.propose(agent.id, fact, job.thread);
    office.log('run', {
      job: job.id, agent: agent.id, provider: agent.provider, thread: job.thread, task: task?.id, model: agent.model, sentTokens: pack.tokens,
      resumed: pack.resumed, usage: parsed.usage, seconds, next_action: handoff?.next_action,
    });
    if (task) {
      office.updateTask(task.id, {
        status: 'review', handoff: handoff || task.handoff || null, changed, diff: await gitOps.diffStat(task.worktree),
      });
    }
    const limit = (agent.contextLimit || 60000) * AUTO_CLEAN_RATIO;
    if (thread.session.tokens >= limit) this.clean(agent.id, job.thread, 'limit');
  }

  recordFailure(job, message) {
    const { office } = this;
    const thread = office.thread(job.agent, job.thread);
    if (!thread) return;
    thread.messages.push({ role: 'system', text: `Error: ${message}`, at: now() });
    office.saveThread(thread);
    office.log('run_failed', { job: job.id, agent: job.agent, thread: job.thread, error: message });
    if (thread.taskId) office.updateTask(thread.taskId, { status: 'failed' });
  }

  /** Ends the live session. The handoff stays, so the next message starts small but informed. */
  clean(agentId, threadId, reason) {
    const thread = this.office.thread(agentId, threadId);
    if (!thread?.session) return false;
    const tokens = thread.session.tokens;
    thread.session = null;
    thread.messages.push({ role: 'system', text: `Contexto limpiado (${reason}, ${tokens} tokens).`, at: now() });
    this.office.saveThread(thread);
    this.office.log('cleanup', { agent: agentId, thread: threadId, reason, tokens });
    return true;
  }

  /** Stops one queued or running job. Returns false if it is already gone. */
  stop(jobId) {
    const queued = this.queue.findIndex((j) => j.id === jobId);
    if (queued >= 0) {
      this.recordFailure(this.queue.splice(queued, 1)[0], 'Stopped by the owner.');
      return true;
    }
    const entry = this.running.get(jobId);
    if (!entry) return false;
    entry.stopped = true;
    if (entry.child) killTree(entry.child);
    return true;
  }

  stopAll() {
    this.queue.splice(0).forEach((job) => this.recordFailure(job, 'Stopped by the owner.'));
    for (const entry of this.running.values()) {
      entry.stopped = true;
      if (entry.child) killTree(entry.child);
    }
    this.office.log('emergency_stop');
  }

  mcpConfigFile(agent) {
    if (!agent.mcp?.length) return null;
    const chosen = Object.fromEntries(agent.mcp.filter((n) => this.mcpServers[n]).map((n) => [n, this.mcpServers[n]]));
    const rel = `runs/mcp-${agent.id}.json`;
    this.office.store.writeJson(rel, { mcpServers: chosen });
    return path.resolve(this.office.store.resolve(rel));
  }
}

const summary = (job) => ({ id: job.id, agent: job.agent, thread: job.thread });

module.exports = { Runner };
