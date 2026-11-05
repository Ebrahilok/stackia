'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Office } = require('./office');
const { Runner } = require('./runner');
const { resolveCli } = require('./adapters');
const { catalog, isValidChoice } = require('./catalog');
const { buildPackage } = require('./context');
const gitOps = require('./git');

const MAX_BODY = 256 * 1024;
const MAX_LOGIN_FAILURES = 5;
const LOCK_MS = 60000;
const PUBLIC = path.join(__dirname, '..', 'public');
const STATIC = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const sha = (text) => crypto.createHash('sha256').update(text).digest();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function loadConfig(file) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = path.dirname(path.resolve(file));
  config.dataDir = path.resolve(base, config.dataDir);
  for (const p of config.projects) {
    p.worktrees = path.resolve(base, p.worktrees);
    if (p.brief) p.brief = path.resolve(base, p.brief);
  }
  return config;
}

function ownerToken(dataDir) {
  const file = path.join(dataDir, 'owner.token');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(24).toString('base64url') + '\n', { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

function createApp(config) {
  const cat = catalog(config.enableMock);
  const token = ownerToken(config.dataDir);
  const cookieValue = crypto.createHmac('sha256', token).update('stackia-session').digest('base64url');
  const cli = resolveCli(config.cli);
  const projects = new Map(config.projects.map((p) => {
    const office = new Office(config.dataDir, p);
    const runner = new Runner({
      office, cli, maxConcurrent: config.maxConcurrent || 2,
      timeoutMs: (config.jobTimeoutMinutes || 20) * 60000, mcpServers: config.mcpServers,
    });
    return [p.id, { office, runner, project: p }];
  }));
  const allowedHosts = new Set(['localhost', '127.0.0.1', config.host, ...(config.allowedHosts || [])]);
  const login = { failures: 0, lockedUntil: 0 };

  const isOwner = (req) => {
    const match = /(?:^|;\s*)stackia=([^;]+)/.exec(req.headers.cookie || '');
    return Boolean(match) && crypto.timingSafeEqual(sha(match[1]), sha(cookieValue));
  };

  const pick = (body) => {
    const entry = projects.get(body.project);
    if (!entry) throw new HttpError(404, 'Proyecto desconocido.');
    return entry;
  };
  const text = (value, name, max = 20000) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `Falta ${name}.`);
    return value.trim();
  };
  const agentOf = (office, id) => {
    const agent = office.agent(id);
    if (!agent) throw new HttpError(404, 'Agente desconocido.');
    return agent;
  };

  function freeChat(office, agentId) {
    return office.threads(agentId).find((t) => !t.taskId) || office.createThread(agentId, 'Charla libre');
  }

  function state({ office, runner, project }) {
    const agents = office.agents().map((a) => ({
      ...a,
      charter: office.charter(a.id),
      memory: office.memory(a.id),
      notes: office.notes(a.id),
      threads: [freeChat(office, a.id), ...office.threads(a.id).filter((t) => t.taskId)].filter(
        (t, i, all) => all.findIndex((o) => o.id === t.id) === i,
      ).map((t) => ({ id: t.id, title: t.title, taskId: t.taskId, tokens: t.session?.tokens || 0 })),
    }));
    return {
      project: { id: project.id, name: project.name, base: project.base },
      agents,
      tasks: office.tasks(),
      inbox: office.inbox(),
      runner: runner.status(),
      catalog: cat,
    };
  }

  const routes = {
    'GET /api/projects': () => ({ projects: config.projects.map(({ id, name }) => ({ id, name })) }),

    'GET /api/state': (q) => state(pick(q)),

    'GET /api/thread': (q) => {
      const { office, runner } = pick(q);
      const thread = office.thread(q.agent, q.thread);
      if (!thread) throw new HttpError(404, 'Conversación desconocida.');
      return { ...thread, busy: runner.isBusy(q.agent, q.thread) };
    },

    'GET /api/preview': (q) => {
      const { office } = pick(q);
      const agent = agentOf(office, q.agent);
      const thread = office.thread(q.agent, q.thread);
      if (!thread) throw new HttpError(404, 'Conversación desconocida.');
      return buildPackage({ office, agent, thread, text: q.text || '' });
    },

    'GET /api/journal': (q) => ({ entries: pick(q).office.journal(100) }),

    'POST /api/message': (b) => {
      const { runner, office } = pick(b);
      agentOf(office, b.agent);
      try {
        return { job: runner.send(b.agent, b.thread, text(b.text, 'el mensaje')).id };
      } catch (err) {
        throw err instanceof HttpError ? err : new HttpError(409, err.message);
      }
    },

    'POST /api/clean': (b) => ({ cleaned: pick(b).runner.clean(b.agent, b.thread, 'manual') }),

    'POST /api/note': (b) => {
      const { office } = pick(b);
      agentOf(office, b.agent);
      office.addNote(b.agent, text(b.text, 'la nota'));
      return { ok: true };
    },

    'POST /api/memory/propose': (b) => {
      const { office } = pick(b);
      agentOf(office, b.agent);
      return office.propose(b.agent, text(b.text, 'el texto'), 'owner');
    },

    'POST /api/inbox/decide': (b) => {
      pick(b).office.decide(b.id, b.accept === true);
      return { ok: true };
    },

    'POST /api/task': (b) => {
      const { office } = pick(b);
      agentOf(office, b.agent);
      return office.createTask({
        agent: b.agent, title: text(b.title, 'el título', 120), instruction: text(b.instruction, 'la instrucción'),
      });
    },

    'POST /api/task/approve': async (b) => {
      const { office, runner, project } = pick(b);
      const task = office.task(b.id);
      if (!task || task.status !== 'proposed') throw new HttpError(409, 'La tarea no está pendiente de aprobar.');
      const { worktree, branch } = await gitOps.createWorktree(project, task.id);
      office.updateTask(task.id, { status: 'approved', worktree, branch });
      office.log('task_approved', { task: task.id });
      const thread = office.createThread(task.agent, `#${task.id} · ${task.title}`, task.id);
      runner.send(task.agent, thread.id, task.instruction);
      return office.task(task.id);
    },

    'POST /api/task/reject': (b) => {
      const { office } = pick(b);
      const task = office.task(b.id);
      if (!task || task.status !== 'proposed') throw new HttpError(409, 'Solo se rechazan tareas pendientes.');
      office.log('task_rejected', { task: task.id });
      return office.updateTask(task.id, { status: 'rejected' });
    },

    'POST /api/task/push': async (b) => {
      const { office, project } = pick(b);
      const task = office.task(b.id);
      if (!task || !['review', 'pushed'].includes(task.status)) throw new HttpError(409, 'La tarea no está lista para subir.');
      if (b.confirm !== task.branch) throw new HttpError(400, 'Confirma el nombre de la rama.');
      const commit = await gitOps.commitAndPush(project, task);
      office.log('task_pushed', { task: task.id, branch: task.branch, commit });
      return office.updateTask(task.id, { status: 'pushed', commit, changed: [], diff: '' });
    },

    'POST /api/agent': (b) => {
      const { office } = pick(b);
      const agent = agentOf(office, b.id);
      if (!isValidChoice(cat, b.provider, b.model, b.effort)) throw new HttpError(400, 'Combinación de modelo no válida.');
      office.saveAgent({ ...agent, provider: b.provider, model: b.model, effort: b.effort });
      if (typeof b.charter === 'string') office.saveCharter(agent.id, b.charter);
      if (typeof b.memory === 'string') office.saveMemory(agent.id, b.memory);
      return { ok: true };
    },

    'POST /api/stop': (b) => {
      pick(b).runner.stopAll();
      return { ok: true };
    },
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const hostname = (req.headers.host || '').replace(/:\d+$/, '');
    if (!allowedHosts.has(hostname)) throw new HttpError(403, 'Host no permitido.');

    const asset = req.method === 'GET' && STATIC[url.pathname];
    if (asset) {
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
      return res.end(fs.readFileSync(path.join(PUBLIC, asset[0])));
    }

    const body = req.method === 'POST' ? await readBody(req) : null;
    if (req.method === 'POST' && req.headers['x-stackia'] !== '1') throw new HttpError(403, 'Petición no permitida.');

    if (req.method === 'POST' && url.pathname === '/api/login') return handleLogin(body, res);
    if (!isOwner(req)) throw new HttpError(401, 'Inicia sesión.');

    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw new HttpError(404, 'No encontrado.');
    const result = await route(body ?? Object.fromEntries(url.searchParams));
    return json(res, 200, result);
  }

  function handleLogin(body, res) {
    if (Date.now() < login.lockedUntil) throw new HttpError(429, 'Demasiados intentos. Espera un minuto.');
    const ok = typeof body.token === 'string' && crypto.timingSafeEqual(sha(body.token), sha(token));
    if (!ok) {
      if (++login.failures >= MAX_LOGIN_FAILURES) {
        login.lockedUntil = Date.now() + LOCK_MS;
        login.failures = 0;
      }
      throw new HttpError(401, 'Clave incorrecta.');
    }
    login.failures = 0;
    res.setHeader('Set-Cookie', `stackia=${cookieValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
    return json(res, 200, { ok: true });
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    handle(req, res).catch((err) => json(res, err.status || 500, { error: err.message }));
  });
  return { server, projects, token };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Mensaje demasiado grande.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'JSON no válido.'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, value) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  return res.end(JSON.stringify(value));
}

if (require.main === module) {
  const file = process.env.STACKIA_CONFIG || path.join(__dirname, '..', 'stackia.config.json');
  const config = loadConfig(file);
  const { server } = createApp(config);
  server.listen(config.port, config.host, () => {
    console.log(`Stack IA on http://${config.host}:${config.port} (key in ${path.join(config.dataDir, 'owner.token')})`);
  });
}

module.exports = { createApp, loadConfig };
