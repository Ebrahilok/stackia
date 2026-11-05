'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createApp } = require('../src/server');
const { parseHandoff } = require('../src/context');
const { adapters } = require('../src/adapters');

let root; let base; let cookie; let server; let token; let bare; let repo; let app;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-stackia': '1', ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null), res };
}

async function until(check, ms = 15000, label = '') {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) {
      const { runner } = (await call('GET', '/api/state?project=demo')).data;
      const tail = app.projects.get('demo').office.journal(12).map((e) => `${e.type}${e.error ? `(${e.error})` : ''}`).join(',');
      let procs = '';
      if (process.platform === 'win32') {
        try {
          procs = execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'fake-cli' } | ForEach-Object { $_.ProcessId }) -join ','"], { encoding: 'utf8' }).trim();
        } catch { procs = 'unknown'; }
      }
      throw new Error(`Timed out waiting ${label} :: running=${JSON.stringify(runner.running)} queued=${JSON.stringify(runner.queued)} journal=${tail} fakeCli=${procs}`);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
}

const thread = async (agent, id) => (await call('GET', `/api/thread?project=demo&agent=${agent}&thread=${id}`)).data;
const stateNow = async () => (await call('GET', '/api/state?project=demo')).data;
async function freeThread() {
  return (await stateNow()).agents.find((a) => a.id === 'arq').threads[0].id;
}
async function say(id, text) {
  const r = await call('POST', '/api/message', { project: 'demo', agent: 'arq', thread: id, text });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return until(async () => {
    const t = await thread('arq', id);
    return !t.busy && t;
  });
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackia-'));
  bare = path.join(root, 'origin.git');
  repo = path.join(root, 'repo');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', 'origin', 'main');

  process.env.STACKIA_TEST_FLAG = path.join(root, 'limit.flag');
  process.env.STACKIA_TEST_REPO = repo;
  const brief = path.join(root, 'brief.md');
  fs.writeFileSync(brief, 'PROJECT BRIEF TEXT');
  app = createApp({
    host: '127.0.0.1', port: 0, dataDir: path.join(root, 'data'), maxConcurrent: 2, jobTimeoutMinutes: 1, enableMock: true,
    autopilotTickMs: 40, limitBackoffMs: 400,
    projects: [{ id: 'demo', name: 'Demo', repo, base: 'main', remote: 'origin', worktrees: path.join(root, 'work'), template: 'roblox-rojo', brief }],
  });
  ({ server, token } = app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const office = app.projects.get('demo').office;
  for (const a of office.agents()) office.saveAgent({ ...a, provider: 'mock', model: 'mock', effort: 'low' });
});

after(() => {
  server.close();
  server.closeAllConnections();
  fs.rmSync(root, { recursive: true, force: true });
});

test('requires login, a valid host and the custom header', async () => {
  assert.equal((await call('GET', '/api/projects')).status, 401);
  assert.equal((await call('POST', '/api/login', { token: 'wrong' })).status, 401);
  const noHeader = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ token }) });
  assert.equal(noHeader.status, 403);
  const ok = await call('POST', '/api/login', { token });
  assert.equal(ok.status, 200);
  cookie = ok.res.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/projects')).status, 200);
  const http = require('node:http');
  const status = await new Promise((resolve) => {
    http.get({ port: server.address().port, host: '127.0.0.1', path: '/', headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode); });
  });
  assert.equal(status, 403);
});

test('serves the office art', async () => {
  const res = await fetch(`${base}/office.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok((await res.arrayBuffer()).byteLength > 1000);
});

test('first message carries the full package, the second resumes small', async () => {
  const id = await freeThread();
  const t1 = await say(id, 'hola');
  assert.equal(t1.messages.at(-1).text, 'fake reply');
  assert.equal(t1.lastHandoff.next_action, 'next step from fake');
  const office = app.projects.get('demo').office;
  const prompts = () => office.store.list('runs').filter((f) => f.endsWith('.prompt.txt'))
    .map((f) => office.store.readText(`runs/${f}`));
  assert.ok(prompts().some((p) => p.includes('PROJECT BRIEF TEXT') && p.includes('YOUR ROLE')));
  const before = prompts();
  await say(id, 'seguimos');
  const fresh = prompts().filter((p) => !before.includes(p));
  assert.equal(fresh.length, 1);
  assert.ok(!fresh[0].includes('PROJECT BRIEF TEXT'));
});

test('talking never changes the charter', async () => {
  const office = app.projects.get('demo').office;
  const charter = office.charter('arq');
  await say(await freeThread(), 'cambia tu forma de ser');
  assert.equal(office.charter('arq'), charter);
});

test('manual clean restarts with the handoff, and survives without a live session', async () => {
  const id = await freeThread();
  await say(id, 'antes de limpiar');
  await call('POST', '/api/clean', { project: 'demo', agent: 'arq', thread: id });
  const preview = (await call('GET', `/api/preview?project=demo&agent=arq&thread=${id}&text=x`)).data;
  assert.equal(preview.resumed, false);
  assert.ok(preview.layers.some((l) => l.name === 'previous'));
});

test('auto clean fires at the context limit', async () => {
  const id = await freeThread();
  const t = await say(id, 'BIGCONTEXT');
  assert.equal(t.session, null);
  assert.match(t.messages.at(-1).text, /limpiado \(limit/);
});

test('instruction survives a failed run', async () => {
  const id = await freeThread();
  const t = await say(id, 'CRASH instrucción importante');
  assert.ok(t.messages.some((m) => m.role === 'owner' && m.text.includes('instrucción importante')));
  assert.equal(t.messages.at(-1).role, 'system');
  const journal = (await call('GET', '/api/journal?project=demo')).data.entries;
  assert.ok(journal.some((e) => e.type === 'instruction' && e.text.includes('instrucción importante')));
});

test('missing handoff warns; memory goes to the inbox, not straight to memory', async () => {
  const id = await freeThread();
  const t = await say(id, 'NOHANDOFF');
  assert.equal(t.messages.at(-1).warnings.length, 1);
  await say(id, 'REMEMBER this');
  const state = await stateNow();
  const item = state.inbox.find((i) => i.text === 'a durable fact');
  assert.ok(item);
  assert.equal(state.agents.find((a) => a.id === 'arq').memory, '');
  await call('POST', '/api/inbox/decide', { project: 'demo', id: item.id, accept: true });
  assert.match((await stateNow()).agents.find((a) => a.id === 'arq').memory, /a durable fact/);
});

test('notes are used once', async () => {
  const id = await freeThread();
  await call('POST', '/api/clean', { project: 'demo', agent: 'arq', thread: id });
  await call('POST', '/api/note', { project: 'demo', agent: 'arq', text: 'NOTE-ONCE' });
  await say(id, 'con nota');
  assert.equal((await stateNow()).agents.find((a) => a.id === 'arq').notes.length, 0);
});

test('task runs in its own worktree, needs approval and pushes only its branch', async () => {
  const created = (await call('POST', '/api/task', { project: 'demo', agent: 'arq', title: 'Write', instruction: 'WRITEFILE please' })).data;
  assert.equal(created.status, 'proposed');
  assert.equal((await call('POST', '/api/task/push', { project: 'demo', id: created.id, confirm: 'x' })).status, 409);

  const approved = await call('POST', '/api/task/approve', { project: 'demo', id: created.id });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const done = await until(async () => {
    const task = (await stateNow()).tasks.find((t) => t.id === created.id);
    return task.status === 'review' && task;
  });
  assert.deepEqual(done.changed, ['agent-output.txt']);
  assert.ok(!fs.existsSync(path.join(repo, 'agent-output.txt')), 'owner copy must stay untouched');
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');

  assert.equal((await call('POST', '/api/task/push', { project: 'demo', id: created.id, confirm: 'wrong' })).status, 400);
  const pushed = await call('POST', '/api/task/push', { project: 'demo', id: created.id, confirm: done.branch });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.data));
  const refs = git(bare, 'for-each-ref', '--format=%(refname)');
  assert.match(refs, /refs\/heads\/stackia\/T-1/);
  assert.equal(git(bare, 'log', '--format=%s', 'main').trim(), 'init', 'main must not move');
});

test('a claimed file that git does not see is flagged', async () => {
  const task = (await call('POST', '/api/task', { project: 'demo', agent: 'arq', title: 'Lie', instruction: 'LIE about it' })).data;
  await call('POST', '/api/task/approve', { project: 'demo', id: task.id });
  await until(async () => (await stateNow()).tasks.find((t) => t.id === task.id).status === 'review');
  const t = await thread('arq', task.id.toLowerCase());
  assert.ok(t.messages.at(-1).warnings.some((w) => w.includes('ghost.txt')));
});

test('emergency stop ends a running job', async () => {
  const id = await freeThread();
  await call('POST', '/api/message', { project: 'demo', agent: 'arq', thread: id, text: 'SLEEP' });
  await until(async () => (await stateNow()).runner.running.length === 1);
  await call('POST', '/api/stop', { project: 'demo' });
  const t = await until(async () => {
    const value = await thread('arq', id);
    return !value.busy && value;
  });
  assert.match(t.messages.at(-1).text, /Stopped/);
});

test('one job can be stopped alone, and settings and agent fields apply', async () => {
  const id = await freeThread();
  const { data } = await call('POST', '/api/message', { project: 'demo', agent: 'arq', thread: id, text: 'SLEEP' });
  await until(async () => (await stateNow()).runner.running.length === 1);
  assert.equal((await call('POST', '/api/stop', { project: 'demo', job: data.job })).data.stopped, true);
  await until(async () => !(await thread('arq', id)).busy);

  assert.equal((await call('POST', '/api/settings', { project: 'demo', maxConcurrent: 3 })).status, 200);
  assert.equal((await stateNow()).maxConcurrent, 3);
  assert.equal((await call('POST', '/api/settings', { project: 'demo', maxConcurrent: 99 })).status, 400);

  const base2 = { project: 'demo', id: 'qa', provider: 'mock', model: 'mock', effort: 'low' };
  assert.equal((await call('POST', '/api/agent', { ...base2, contextLimit: 20000, canWrite: true, commands: ['rojo build'] })).status, 200);
  const qa = (await stateNow()).agents.find((a) => a.id === 'qa');
  assert.deepEqual([qa.contextLimit, qa.canWrite, qa.commands], [20000, true, ['rojo build']]);
  assert.equal((await call('POST', '/api/agent', { ...base2, commands: ['rm -rf /; x'] })).status, 400);
  assert.equal((await call('POST', '/api/agent', { ...base2, commands: ['a && b'] })).status, 400);
  assert.equal((await call('POST', '/api/agent', { ...base2, commands: ['node C:/tools/verify.js'] })).status, 200);
  assert.equal((await call('POST', '/api/agent', { ...base2, mcp: ['unknown'] })).status, 400);

  assert.equal((await call('POST', '/api/brief', { project: 'demo', text: 'NEW BRIEF' })).status, 200);
  assert.equal((await stateNow()).project.brief, 'NEW BRIEF');
  assert.ok((await stateNow()).usage.mock.runs > 0);
});

test('rejects bad ids and bad model choices', async () => {
  assert.notEqual((await call('GET', '/api/thread?project=demo&agent=arq&thread=../../secret')).status, 200);
  const bad = await call('POST', '/api/agent', { project: 'demo', id: 'arq', provider: 'claude', model: 'nope', effort: 'low' });
  assert.equal(bad.status, 400);
});

test('parseHandoff tolerates broken blocks', () => {
  assert.equal(parseHandoff('hi\n```stackia-handoff\n{broken\n```').handoff, null);
  assert.equal(parseHandoff('hi').text, 'hi');
});

test('adapters read real output shapes', () => {
  const c = adapters.claude.parse({ stdout: JSON.stringify({ result: 'hi', session_id: 's', usage: { input_tokens: 3, cache_read_input_tokens: 7, output_tokens: 2 } }) });
  assert.deepEqual([c.text, c.sessionId, c.contextTokens], ['hi', 's', 12]);
  const x = adapters.codex.parse({ stdout: '{"type":"thread.started","thread_id":"t"}\n{"type":"item.completed","item":{"type":"agent_message","text":"yo"}}\n{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":1}}\n', stderr: '' });
  assert.deepEqual([x.text, x.sessionId, x.contextTokens], ['yo', 't', 6]);
  const multi = adapters.claude.parse({ stdout: JSON.stringify({ result: 'hi', num_turns: 4, usage: { input_tokens: 400, output_tokens: 10 } }) });
  assert.equal(multi.contextTokens, 110, 'context is one call, not the sum of all calls');
  const read = adapters.claude.command({ prompt: 'p', model: 'haiku', effort: 'low', write: false, commands: ['rojo build'], mcp: [] }, { claude: 'claude' });
  assert.equal(read.args[read.args.indexOf('--tools') + 1], 'Read,Grep,Glob');
  assert.ok(!read.args.join(' ').includes('Bash'), 'read mode gets no shell');
  const write = adapters.claude.command({ prompt: 'p', model: 'haiku', effort: 'low', write: true, commands: ['rojo build'], mcp: [] }, { claude: 'claude' });
  assert.match(write.args[write.args.indexOf('--allowedTools') + 1], /Bash\(rojo build:\*\)/);
  const denied = adapters.agy.parse({ stdout: JSON.stringify({ status: 'SUCCESS', response: '', denied_actions: ['grep'] }) });
  assert.match(denied.error, /Denied/);
});

/* ---------- overnight autopilot ---------- */
const soon = () => new Date(Date.now() + 3600000).toISOString();
const makeTask = async (instruction) => (await call('POST', '/api/task', { project: 'demo', agent: 'arq', title: instruction.slice(0, 30), instruction })).data.id;
const night = (batch, extra = {}) => call('POST', '/api/night/start', { project: 'demo', batch, until: soon(), push: true, ...extra });
const finishedNight = async () => {
  const done = await until(async () => {
    const { data } = await call('GET', '/api/night?project=demo');
    return !data.night.active && data;
  }, 25000, 'night to finish');
  await until(async () => {
    const { runner } = await stateNow();
    return !runner.running.length && !runner.queued.length;
  }, 25000, 'jobs to settle');
  return done;
};
const taskOf = async (id) => (await stateNow()).tasks.find((t) => t.id === id);

test('night: runs the approved batch, checks it and pushes only task branches', async () => {
  const ids = [await makeTask('WRITEFILE one'), await makeTask('WRITEFILE two')];
  assert.equal((await night(ids)).status, 200);
  const done = await finishedNight();
  assert.equal(done.night.stopReason, 'lote completado');
  for (const id of ids) assert.equal((await taskOf(id)).status, 'pushed');
  const refs = git(bare, 'for-each-ref', '--format=%(refname)');
  for (const id of ids) assert.match(refs, new RegExp(`refs/heads/stackia/${id}\\b`));
  assert.equal(git(bare, 'log', '--format=%s', 'main').trim(), 'init', 'main must not move');
  assert.ok(done.report.tasks.every((t) => t.tokens > 0 && t.commit));
  assert.ok(app.projects.get('demo').office.store.list('reports').length >= 1);
});

test('night: a provider limit pauses the work and it resumes by itself', async () => {
  const id = await makeTask('WRITEFILE LIMITONCE');
  assert.equal((await night([id])).status, 200);
  const done = await finishedNight();
  assert.equal((await taskOf(id)).status, 'pushed');
  assert.equal(done.report.limits.length, 1);
  assert.equal(done.report.limits[0].provider, 'mock');
});

test('night: three failures in a row stop everything', async () => {
  await call('POST', '/api/settings', { project: 'demo', maxConcurrent: 1 });
  try {
    const ids = [await makeTask('CRASH a'), await makeTask('CRASH b'), await makeTask('CRASH c'), await makeTask('WRITEFILE late')];
    assert.equal((await night(ids)).status, 200);
    const done = await finishedNight();
    assert.match(done.night.stopReason, /3 fallos/);
    assert.equal((await taskOf(ids[3])).status, 'proposed', 'later tasks must not start');
  } finally {
    await call('POST', '/api/settings', { project: 'demo', maxConcurrent: 3 });
  }
});

test('night: a failing check is reported and nothing is pushed', async () => {
  const project = app.projects.get('demo').project;
  project.checks = ['node -e process.exit(1)'];
  try {
    const id = await makeTask('WRITEFILE broken');
    await night([id]);
    await finishedNight();
    const task = await taskOf(id);
    assert.equal(task.status, 'check_failed');
    assert.ok(!git(bare, 'for-each-ref', '--format=%(refname)').includes(`stackia/${id}`));
  } finally {
    project.checks = [];
  }
});

test('night: a Luau syntax error is caught even when the build passes', async () => {
  const project = app.projects.get('demo').project;
  project.luauAnalyze = [process.execPath, path.join(__dirname, 'fake-analyzer.js')];
  try {
    const bad = await makeTask('BADSYNTAX please');
    const good = await makeTask('GOODLUAU please');
    await call('POST', '/api/settings', { project: 'demo', maxConcurrent: 1 });
    await night([bad, good]);
    await finishedNight();
    assert.equal((await taskOf(bad)).status, 'check_failed');
    assert.match((await taskOf(bad)).error, /sintaxis/);
    assert.equal((await taskOf(good)).status, 'pushed');
  } finally {
    project.luauAnalyze = '';
    await call('POST', '/api/settings', { project: 'demo', maxConcurrent: 3 });
  }
});

test('night: a task that writes outside its folder fails alone, and the others carry on', async () => {
  const bad = await makeTask('WRITEFILE ESCAPE');
  const good = await makeTask('WRITEFILE fine');
  await call('POST', '/api/settings', { project: 'demo', maxConcurrent: 1 });
  try {
    await night([bad, good]);
    const done = await finishedNight();
    assert.equal(done.night.stopReason, 'lote completado');
    assert.equal((await taskOf(bad)).status, 'failed');
    assert.match((await taskOf(bad)).error, /fuera de su rama/);
    assert.equal((await taskOf(good)).status, 'pushed');
    assert.ok(done.report.violations.length >= 1);
    assert.ok(!git(bare, 'for-each-ref', '--format=%(refname)').includes(`stackia/${bad}`));
  } finally {
    await call('POST', '/api/settings', { project: 'demo', maxConcurrent: 3 });
    fs.rmSync(path.join(root, 'work', 'escaped.txt'), { force: true });
  }
});

test('night: changing the owner copy stops everything', async () => {
  const id = await makeTask('WRITEFILE TOUCHOWNER');
  await night([id]);
  const done = await finishedNight();
  assert.match(done.night.stopReason, /tu copia de trabajo/);
  fs.rmSync(path.join(repo, 'owner-touch.txt'), { force: true });
});

test('night: stopping while a task is still being prepared does not let it run', async () => {
  const id = await makeTask('SLEEP while preparing');
  assert.equal((await night([id])).status, 200);
  await call('POST', '/api/stop', { project: 'demo' });
  const done = await finishedNight();
  assert.equal(done.night.stopReason, 'parada de emergencia');
  const t = await thread('arq', id.toLowerCase());
  assert.ok(!t || !t.busy, 'the job must not be left running');
});

test('night: emergency stop ends it, and bad requests are refused', async () => {
  const id = await makeTask('SLEEP');
  assert.equal((await night([id], { until: new Date(Date.now() - 1000).toISOString() })).status, 400);
  assert.equal((await night(['T-9999'])).status, 400);
  assert.equal((await night([id])).status, 200);
  assert.equal((await night([id])).status, 400, 'a second night cannot start');
  await until(async () => (await stateNow()).runner.running.some((j) => j.thread === id.toLowerCase()), 15000, 'night job to start');
  await call('POST', '/api/stop', { project: 'demo' });
  const done = await finishedNight();
  assert.equal(done.night.stopReason, 'parada de emergencia');
  await until(async () => (await stateNow()).runner.running.length === 0, 15000, 'killed job to exit');
});
