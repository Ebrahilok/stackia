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

async function until(check, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out waiting');
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

  const brief = path.join(root, 'brief.md');
  fs.writeFileSync(brief, 'PROJECT BRIEF TEXT');
  app = createApp({
    host: '127.0.0.1', port: 0, dataDir: path.join(root, 'data'), maxConcurrent: 2, jobTimeoutMinutes: 1, enableMock: true,
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
