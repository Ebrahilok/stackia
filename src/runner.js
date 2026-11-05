'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { adapters } = require('./adapters');
const { buildPackage, parseHandoff } = require('./context');
const { run, killTree } = require('./process');
const gitOps = require('./git');
const { now } = require('./office');

const AUTO_CLEAN_RATIO = 0.6;
const normalize = (file) => file.replace(/\\/g, '/').replace(/^\.\//, '');

/** Queues agent runs, keeps context alive across sessions, and records everything. */
class Runner {
  constructor({ office, cli, maxConcurrent, timeoutMs, mcpServers = {} }) {
    Object.assign(this, { office, cli, maxConcurrent, timeoutMs, mcpServers });
    this.queue = [];
    this.running = new Map();
    this.paused = false;
  }

  status() {
    return {
      paused: this.paused,
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
    while (!this.paused && this.running.size < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      const entry = { job, child: null, stopped: false };
      this.running.set(job.id, entry);
      this.execute(entry)
        .catch((err) => this.recordFailure(job, err.message))
        .finally(() => {
          this.running.delete(job.id);
          this.pump();
        });
    }
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
    const started = Date.now();
    const result = await run(cmd, args, {
      cwd: request.cwd,
      stdin,
      timeoutMs: this.timeoutMs,
      onStart: (child) => { entry.child = child; },
    });
    if (entry.stopped) return this.recordFailure(job, 'Stopped by the owner.');
    if (result.timedOut) return this.recordFailure(job, 'Timed out.');
    if (result.spawnError) return this.recordFailure(job, `Could not start ${agent.provider}: ${result.spawnError}`);

    const parsed = adapter.parse(result);
    if (parsed.error) return this.recordFailure(job, parsed.error);
    if (pack.usedNotes) office.archiveNotes(agent.id);
    await this.recordSuccess({ job, agent, task, parsed, pack, seconds: (Date.now() - started) / 1000 });
  }

  async recordSuccess({ job, agent, task, parsed, pack, seconds }) {
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
      ],
    });
    thread.session = { provider: agent.provider, id: parsed.sessionId, tokens: parsed.contextTokens || 0 };
    if (handoff) thread.lastHandoff = handoff;
    office.saveThread(thread);

    for (const fact of handoff?.memory || []) office.propose(agent.id, fact, job.thread);
    office.log('run', {
      agent: agent.id, thread: job.thread, task: task?.id, model: agent.model, sentTokens: pack.tokens,
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
    thread.messages.push({ role: 'system', text: `Error: ${message}`, at: now() });
    office.saveThread(thread);
    office.log('run_failed', { agent: job.agent, thread: job.thread, error: message });
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
