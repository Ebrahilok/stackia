'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gitOps = require('./git');
const { run } = require('./process');
const { startAwake } = require('./awake');
const { now } = require('./office');
const { OWNER_COPY } = require('./runner');

const MAX_BATCH = 20;
const MAX_HOURS = 16;
const FAILURE_LIMIT = 3;
const CHECK_TIMEOUT_MS = 5 * 60000;
const FAILED = ['failed', 'check_failed', 'empty'];
const DONE = [...FAILED, 'pushed', 'rejected'];

const splitCommand = (line) => line.trim().split(/\s+/);

/**
 * Runs an owner-approved batch of tasks unattended. It only works on tasks the owner picked,
 * checks each result, and publishes each task's own branch. It never touches main.
 */
class Autopilot {
  constructor({ office, runner, project, approve, tickMs = 10000 }) {
    Object.assign(this, { office, runner, project, approve, tickMs });
    this.busy = false;
    this.generation = 0;
    this.timer = null;
    this.release = null;
  }

  get state() { return this.office.store.readJson('autopilot.json', { active: false }); }
  save(changes) {
    const next = { ...this.state, ...changes };
    this.office.store.writeJson('autopilot.json', next);
    return next;
  }

  summary() {
    const { active, until, startedAt, finishedAt, stopReason, push } = this.state;
    return { active: Boolean(active), until, startedAt, finishedAt, stopReason, push };
  }

  start({ batch, until, push }) {
    if (this.state.active) throw new Error('Ya hay una noche en marcha.');
    if (!Array.isArray(batch) || !batch.length || batch.length > MAX_BATCH) throw new Error(`Elige entre 1 y ${MAX_BATCH} tareas.`);
    const ids = [...new Set(batch)];
    for (const id of ids) {
      if (this.office.task(id)?.status !== 'proposed') throw new Error(`La tarea ${id} no está pendiente de aprobar.`);
    }
    const end = new Date(until).getTime();
    if (!Number.isFinite(end) || end < Date.now() + 60000 || end > Date.now() + MAX_HOURS * 3600000) {
      throw new Error(`La hora límite debe estar dentro de las próximas ${MAX_HOURS} horas.`);
    }
    this.runner.violations.length = 0;
    this.save({
      active: true, batch: ids, until: new Date(end).toISOString(), push: push !== false, startedAt: now(), finishedAt: null,
      stopReason: null, failures: 0, counted: [], checked: [],
    });
    this.office.log('night_started', { batch: ids, until: new Date(end).toISOString(), push: push !== false });
    this.arm();
    this.tick();
  }

  arm() {
    this.release ??= startAwake();
    this.timer ??= setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }

  /** After a restart, picks the night up again and re-sends work that was cut off. */
  resume() {
    if (!this.state.active) return;
    this.arm();
    for (const id of this.state.batch) {
      const task = this.office.task(id);
      if (!['approved', 'running'].includes(task?.status)) continue;
      const thread = this.office.thread(task.agent, id.toLowerCase());
      if (!thread || this.runner.isBusy(task.agent, thread.id)) continue;
      this.runner.send(task.agent, thread.id, 'The previous session was interrupted by a restart. Continue the task from where it stopped.');
    }
  }

  drain() {
    if (this.state.active) this.save({ until: now() });
  }

  stop(reason) {
    if (this.state.active) this.finish(reason);
  }

  finish(reason) {
    this.generation += 1;
    clearInterval(this.timer);
    this.timer = null;
    this.release?.();
    this.release = null;
    this.save({ active: false, stopReason: reason, finishedAt: now() });
    this.office.log('night_finished', { reason });
    const report = this.report();
    this.office.store.writeText(`reports/night-${report.startedAt.replace(/[:.]/g, '-')}.md`, markdown(report));
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.step();
    } catch (err) {
      this.office.log('night_error', { error: err.message });
    } finally {
      this.busy = false;
    }
  }

  async step() {
    let state = this.state;
    if (!state.active) return;
    const task = (id) => this.office.task(id);

    // Only a change to the owner's own working copy stops the whole night. A task that wrote
    // outside its folder is already marked failed by the runner and the others carry on.
    const intrusion = this.runner.violations.find((v) => v.kind === OWNER_COPY);
    if (intrusion) return this.finish(`un agente cambió tu copia de trabajo: ${intrusion.detail}`);

    for (const id of state.batch) {
      if (task(id).status === 'review' && !state.checked.includes(id)) {
        state = this.save({ checked: [...state.checked, id] });
        await this.verify(task(id), state);
      }
    }

    let { failures } = state;
    const counted = [...state.counted];
    for (const id of state.batch) {
      const t = task(id);
      if (counted.includes(id)) continue;
      if (FAILED.includes(t.status)) {
        failures += 1;
        counted.push(id);
      } else if (t.status === 'pushed' || t.verified) {
        failures = 0;
        counted.push(id);
      }
    }
    state = this.save({ failures, counted });

    if (failures >= FAILURE_LIMIT) return this.finish(`${FAILURE_LIMIT} fallos seguidos`);

    const inFlight = () => this.runner.running.size + this.runner.queue.length;
    const draining = Date.now() >= new Date(state.until).getTime();
    if (!draining) {
      const generation = this.generation;
      for (const id of state.batch) {
        if (inFlight() >= this.runner.maxConcurrent) break;
        if (task(id).status !== 'proposed') continue;
        try {
          await this.approve(id);
        } catch (err) {
          this.office.updateTask(id, { status: 'failed', error: err.message });
        }
        // The night may have been stopped while this task was being prepared; do not let it run on.
        if (generation !== this.generation) return this.cancel(id);
      }
    }

    const finished = (id) => {
      const t = task(id);
      return DONE.includes(t.status) || (t.status === 'review' && this.state.checked.includes(id));
    };
    if (state.batch.every(finished)) return this.finish('lote completado');
    if (draining && !inFlight()) this.finish('hora límite');
  }

  cancel(taskId) {
    const thread = taskId.toLowerCase();
    const jobs = [...[...this.runner.running.values()].map((e) => e.job), ...this.runner.queue].filter((j) => j.thread === thread);
    jobs.forEach((job) => this.runner.stop(job.id));
  }

  async verify(task, state) {
    const { office } = this;
    const files = await gitOps.changedFiles(task.worktree);
    if (!files.length) {
      office.updateTask(task.id, { status: 'empty', error: 'El agente no cambió ningún archivo.' });
      return;
    }
    const problem = await this.checks(task);
    if (problem) {
      office.updateTask(task.id, { status: 'check_failed', error: problem });
      office.log('night_check_failed', { task: task.id, error: problem });
      return;
    }
    office.updateTask(task.id, { verified: true });
    if (!state.push) return;
    try {
      const commit = await gitOps.commitAndPush(this.project, task);
      office.log('task_pushed', { task: task.id, branch: task.branch, commit, auto: true });
      office.updateTask(task.id, { status: 'pushed', commit, pushedFiles: files, changed: [], diff: '', pushError: null });
    } catch (err) {
      office.log('night_push_failed', { task: task.id, error: err.message });
      office.updateTask(task.id, { pushError: err.message });
    }
  }

  /** Returns a description of the first failing check, or null when everything passes. */
  async checks(task) {
    const out = path.join(os.tmpdir(), `stackia-${task.id}.rbxl`);
    const steps = [
      ['git', ['add', '-A', '--intent-to-add']],
      ['git', ['diff', '--check']],
      ...(this.project.checks || []).map((line) => {
        const [cmd, ...args] = splitCommand(line).map((part) => part.replace('{tmp}', out));
        return [cmd, args];
      }),
    ];
    try {
      for (const [cmd, args] of steps) {
        const result = await run(cmd, args, { cwd: task.worktree, timeoutMs: CHECK_TIMEOUT_MS });
        if (result.code !== 0 || result.timedOut || result.spawnError) {
          const detail = (result.spawnError || result.stderr || result.stdout || (result.timedOut ? 'tiempo agotado' : 'sin salida')).trim().slice(-400);
          return `${path.basename(cmd)} ${args[0] || ''}: ${detail}`;
        }
      }
      return null;
    } finally {
      fs.rmSync(out, { force: true });
    }
  }

  report() {
    const state = this.state;
    if (!state.startedAt) return null;
    const entries = this.office.journal(1000000).filter((e) => e.at >= state.startedAt);
    const tokens = (match) => entries.filter((e) => e.type === 'run' && match(e))
      .reduce((sum, e) => sum + (e.usage?.input || 0) + (e.usage?.output || 0), 0);
    const byProvider = {};
    for (const e of entries.filter((x) => x.type === 'run')) {
      byProvider[e.provider] = (byProvider[e.provider] || 0) + (e.usage?.input || 0) + (e.usage?.output || 0);
    }
    return {
      startedAt: state.startedAt, until: state.until, finishedAt: state.finishedAt, active: state.active, stopReason: state.stopReason,
      push: state.push,
      tasks: state.batch.map((id) => {
        const t = this.office.task(id);
        return {
          id, title: t.title, agent: t.agent, status: t.status, branch: t.branch, commit: t.commit, error: t.error, pushError: t.pushError,
          files: t.pushedFiles || t.changed || [], next: t.handoff?.next_action, pending: t.handoff?.pending || [],
          tokens: tokens((e) => e.task === id),
        };
      }),
      tokensByProvider: byProvider,
      limits: entries.filter((e) => e.type === 'provider_limited').map((e) => ({ at: e.at, provider: e.provider, until: e.until })),
      violations: this.runner.violations,
    };
  }
}

const STATUS_TEXT = {
  pushed: 'subida', failed: 'falló', check_failed: 'no pasó las comprobaciones', empty: 'sin cambios', review: 'lista', proposed: 'no empezó',
  approved: 'en espera', running: 'en curso', rejected: 'rechazada',
};

function markdown(report) {
  const lines = [`# Informe de la noche`, '', `Empezó ${report.startedAt}. Terminó ${report.finishedAt || 'en curso'}. Motivo: ${report.stopReason || 'en curso'}.`, ''];
  for (const t of report.tasks) {
    lines.push(`- **${t.id}** ${t.title} (${t.agent}): ${STATUS_TEXT[t.status] || t.status}, ${t.tokens} tokens.`);
    if (t.branch) lines.push(`  - Rama: ${t.branch}${t.commit ? `, commit ${t.commit}` : ''}`);
    if (t.error) lines.push(`  - Problema: ${t.error}`);
    if (t.pushError) lines.push(`  - No se pudo subir: ${t.pushError}`);
    if (t.next) lines.push(`  - Siguiente paso: ${t.next}`);
  }
  lines.push('', '## Tokens por proveedor', ...Object.entries(report.tokensByProvider).map(([p, n]) => `- ${p}: ${n}`));
  if (report.limits.length) lines.push('', '## Límites de uso', ...report.limits.map((l) => `- ${l.provider} a las ${l.at}, reintento ${l.until}`));
  if (report.violations.length) lines.push('', '## Escrituras fuera de la rama', ...report.violations.map((v) => `- ${v.agent}: ${v.kind}: ${v.detail}`));
  return lines.join('\n') + '\n';
}

module.exports = { Autopilot, markdown };
