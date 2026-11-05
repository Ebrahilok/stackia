'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./store');

const ID = /^[a-z0-9-]{1,40}$/;
const assertId = (id) => {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
};

/** The office data of one project: agents, tasks, threads, journal and inbox. */
class Office {
  constructor(dataDir, project) {
    this.project = project;
    this.store = new Store(path.join(dataDir, 'projects', assertId(project.id)));
    this.seed();
  }

  seed() {
    const dir = path.join(__dirname, '..', 'templates', this.project.template || 'roblox-rojo');
    const template = JSON.parse(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8'));
    for (const agent of template) {
      const { charter, ...settings } = agent;
      if (this.store.exists(`agents/${agent.id}/agent.json`)) continue;
      this.store.writeJson(`agents/${agent.id}/agent.json`, settings);
      this.store.writeText(`agents/${agent.id}/charter.md`, charter + '\n');
      this.store.writeText(`agents/${agent.id}/memory.md`, '');
    }
    if (!this.store.exists('project.md') && this.project.brief) {
      this.store.writeText('project.md', fs.readFileSync(this.project.brief, 'utf8'));
    }
  }

  brief() { return this.store.readText('project.md'); }
  saveBrief(text) { this.store.writeText('project.md', text); }

  agents() {
    return this.store.list('agents').filter((id) => this.store.exists(`agents/${id}/agent.json`)).map((id) => this.agent(id));
  }
  agent(id) { return this.store.readJson(`agents/${assertId(id)}/agent.json`, null); }
  saveAgent(agent) { this.store.writeJson(`agents/${assertId(agent.id)}/agent.json`, agent); }

  charter(id) { return this.store.readText(`agents/${assertId(id)}/charter.md`); }
  saveCharter(id, text) {
    const previous = this.charter(id);
    if (previous === text) return;
    this.store.writeText(`agents/${id}/history/charter-${Date.now()}.md`, previous);
    this.store.writeText(`agents/${id}/charter.md`, text);
    this.log('charter_changed', { agent: id });
  }

  memory(id) { return this.store.readText(`agents/${assertId(id)}/memory.md`); }
  saveMemory(id, text) { this.store.writeText(`agents/${assertId(id)}/memory.md`, text); }

  notes(id) { return this.store.readJson(`agents/${assertId(id)}/notes.json`, []); }
  addNote(id, text) {
    this.store.writeJson(`agents/${id}/notes.json`, [...this.notes(id), { text, at: now() }]);
    this.log('note_added', { agent: id, text });
  }
  archiveNotes(id) {
    const notes = this.notes(id);
    if (!notes.length) return;
    this.store.writeJson(`agents/${id}/notes.json`, []);
    this.log('notes_used', { agent: id, notes });
  }

  tasks() { return this.store.readJson('tasks.json', []); }
  task(id) { return this.tasks().find((t) => t.id === id) || null; }
  createTask(fields) {
    const tasks = this.tasks();
    const next = tasks.reduce((max, t) => Math.max(max, Number(t.id.slice(2))), 0) + 1;
    const task = { id: `T-${next}`, status: 'proposed', createdAt: now(), ...fields };
    this.store.writeJson('tasks.json', [...tasks, task]);
    this.log('task_created', { task: task.id, agent: task.agent, title: task.title, instruction: task.instruction });
    return task;
  }
  updateTask(id, changes) {
    const tasks = this.tasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    Object.assign(task, changes);
    this.store.writeJson('tasks.json', tasks);
    return task;
  }

  threads(agentId) {
    return this.store.list(`threads/${assertId(agentId)}`)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.thread(agentId, f.slice(0, -5)));
  }
  thread(agentId, id) { return this.store.readJson(`threads/${assertId(agentId)}/${assertId(id)}.json`, null); }
  saveThread(thread) { this.store.writeJson(`threads/${assertId(thread.agent)}/${assertId(thread.id)}.json`, thread); }
  createThread(agentId, title, taskId = null) {
    const id = taskId ? taskId.toLowerCase() : `chat-${crypto.randomBytes(4).toString('hex')}`;
    const thread = { id, agent: agentId, title, taskId, session: null, lastHandoff: null, messages: [], createdAt: now() };
    this.saveThread(thread);
    return thread;
  }

  inbox() { return this.store.readJson('inbox.json', []); }
  propose(agentId, text, source) {
    const item = { id: crypto.randomBytes(4).toString('hex'), agent: agentId, text, source, at: now() };
    this.store.writeJson('inbox.json', [...this.inbox(), item]);
    return item;
  }
  decide(id, accept) {
    const items = this.inbox();
    const item = items.find((i) => i.id === id);
    if (!item) throw new Error(`Unknown proposal: ${id}`);
    this.store.writeJson('inbox.json', items.filter((i) => i.id !== id));
    if (accept) {
      const current = this.memory(item.agent).trimEnd();
      this.saveMemory(item.agent, `${current ? current + '\n' : ''}- ${item.text}\n`);
    }
    this.log('memory_decision', { agent: item.agent, text: item.text, accepted: accept });
  }

  settings() { return this.store.readJson('settings.json', {}); }
  saveSettings(changes) { this.store.writeJson('settings.json', { ...this.settings(), ...changes }); }

  /** Tokens per provider, from the journal. */
  usage() {
    const today = now().slice(0, 10);
    const totals = {};
    for (const line of this.store.readText('journal.jsonl').split('\n')) {
      if (!line.includes('"type":"run"')) continue;
      const entry = JSON.parse(line);
      const provider = entry.provider || this.agent(entry.agent)?.provider || 'unknown';
      const tokens = (entry.usage?.input || 0) + (entry.usage?.output || 0);
      totals[provider] ??= { today: 0, total: 0, runs: 0 };
      totals[provider].total += tokens;
      totals[provider].runs += 1;
      if (entry.at.startsWith(today)) totals[provider].today += tokens;
    }
    return totals;
  }

  log(type, data = {}) { this.store.append('journal.jsonl', JSON.stringify({ at: now(), type, ...data })); }
  runPrompt(job) { return this.store.readText(`runs/${assertId(job)}.prompt.txt`); }

  journal(limit = 50) {
    const lines = this.store.readText('journal.jsonl').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l));
  }
}

const now = () => new Date().toISOString();

module.exports = { Office, assertId, now };
