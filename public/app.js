'use strict';
const $ = (id) => document.getElementById(id);
const $$ = (s) => [...document.querySelectorAll(s)];
const STATUS_COLUMNS = [
  ['PROPUESTAS (tú apruebas)', ['proposed']],
  ['EN CURSO', ['approved', 'running']],
  ['REVISIÓN', ['review', 'failed', 'check_failed', 'empty']],
  ['SUBIDAS / REVISADAS', ['pushed', 'done']],
];
const LAYERS = {
  charter: 'prompt', project: 'proyecto', memory: 'memoria', notes: 'notas', task: 'tarea',
  previous: 'sesión anterior', cited: 'citadas', message: 'mensaje', format: 'formato',
};
const TASK_STATUS = {
  proposed: 'pendiente', approved: 'en espera', running: 'en curso', review: 'lista', pushed: 'subida', failed: 'falló',
  check_failed: 'no pasó las comprobaciones', empty: 'sin cambios', rejected: 'rechazada', done: 'revisada',
};
const POLL_MS = 2000;
const AUTO_CLEAN_RATIO = 0.6;

/* World: the map is 480x272 pixels, drawn at 5x. */
const U = 5;
const WW = 2400;
const WH = 1360;
const ROOMS = {
  A: [28, 24, 172, 120, 'ARQUITECTO', '#e0785a'], B: [176, 24, 316, 120, 'TALLER', '#3ca8a0'], C: [320, 24, 452, 120, 'BIBLIOTECA', '#7a6ed2'],
  D: [28, 124, 172, 234, 'QA', '#e3a92c'], E: [176, 124, 360, 234, 'SALA COMÚN', '#d46f55', 212], F: [364, 124, 452, 234, 'RED · INVITADOS', '#5a96d2'],
};
// Order matches tools/make_office_art.py. Positions are the character's feet on the 480x272 map.
const SPRITE_ROWS = ['arq', 'cod', 'qa', 'bib', 'mun', 'ui', 'rev', 'owner'];
const SPOTS = {
  arq: { desk: [64, 70], lounge: [254, 190], room: 'A' },
  cod: { desk: [220, 72], lounge: [318, 190], room: 'B' },
  qa: { desk: [72, 176], lounge: [286, 190], room: 'D' },
  bib: { desk: [392, 66], lounge: [220, 194], room: 'C' },
  mun: { desk: [292, 62], lounge: [298, 164], room: 'B', onDemand: true },
  ui: { desk: [304, 108], lounge: [336, 164], room: 'B', onDemand: true },
  rev: { desk: [352, 100], lounge: [352, 200], room: 'C' },
};
const WAITING = ['proposed', 'review'];
const OWNER_STEP = 3;
const OWNER_BOUNDS = [30, 30, 450, 232];

const ui = { project: null, agent: null, thread: null, state: null, formAgent: null, lastLog: '', journal: [], view: 'agentes' };

/* ---------- helpers ---------- */
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'x-stackia': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith('/login')) showLogin();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const post = (path, body = {}) => api(path, { project: ui.project, ...body });
const query = (params) => new URLSearchParams({ project: ui.project, ...params }).toString();
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const hhmm = (iso) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(text) {
  const box = $('toast');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 6000);
}
const guarded = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message);
  }
};
function button(label, onClick, className = 'btn') {
  const b = el('button', className, label);
  b.onclick = guarded(onClick);
  return b;
}
function row(cells, header) {
  const tr = el('tr');
  cells.forEach((c) => {
    const td = el(header ? 'th' : 'td');
    td.append(c instanceof Node ? c : String(c));
    tr.append(td);
  });
  return tr;
}
const agentTag = (id) => ui.state.agents.find((a) => a.id === id)?.tag || id.toUpperCase();

/* ---------- login ---------- */
function showLogin() {
  $('app').hidden = true;
  $('login').hidden = false;
  clearInterval(ui.timer);
}
$('login').onsubmit = async (event) => {
  event.preventDefault();
  try {
    await api('/api/login', { token: $('token').value });
    $('token').value = '';
    $('login-error').textContent = '';
    await start();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
};

async function start() {
  const { projects } = await api('/api/projects');
  $('login').hidden = true;
  $('app').hidden = false;
  $('project').replaceChildren(...projects.map((p) => new Option(p.name, p.id)));
  ui.project = projects[0].id;
  buildMap();
  await refresh();
  fit();
  clearInterval(ui.timer);
  ui.timer = setInterval(guarded(refresh), POLL_MS);
  setTimeout(() => { first = false; document.body.classList.remove('boot'); }, 150);
}

async function refresh() {
  [ui.state, { entries: ui.journal }] = await Promise.all([
    api(`/api/state?${query({})}`), api(`/api/journal?${query({})}`),
  ]);
  const { agents } = ui.state;
  if (!agents.some((a) => a.id === ui.agent)) ui.agent = agents[0]?.id;
  const agent = agents.find((a) => a.id === ui.agent);
  if (!agent) return;
  if (!agent.threads.some((t) => t.id === ui.thread)) ui.thread = agent.threads[0].id;
  drawTop();
  drawPeople();
  drawBoard();
  drawChips();
  drawThreads(agent);
  drawForm(agent);
  drawCleanups();
  drawRuns();
  drawMemory();
  drawUsage();
  drawProject();
  if (ui.view === 'noche') await drawNight();
  await drawThread();
}

/* ---------- top bar ---------- */
function drawTop() {
  const { usage, catalog, runner, server } = ui.state;
  $('meters').replaceChildren(...Object.entries(catalog).map(([id, c]) => {
    const m = el('div', 'm', `${c.label} · hoy `);
    m.append(el('b', '', fmt(usage[id]?.today || 0)));
    return m;
  }));
  const { night } = ui.state;
  const label = runner.running.length ? `${runner.running.length} trabajando` : `${server.host}`;
  $('netlabel').textContent = night.active ? `🌙 hasta las ${hhmm(night.until)} · ${label}` : label;
}

/* ---------- map: pan and zoom ---------- */
const stage = $('stage');
const world = $('world');
let k = 1;
let tx = 0;
let ty = 0;
let first = true;

function apply(animate = true) {
  world.classList.toggle('nodrag', !animate || first);
  world.style.setProperty('--k', k);
  world.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
}
const kFit = () => Math.min(stage.clientWidth / WW, stage.clientHeight / WH);
function fit() {
  k = kFit();
  tx = (stage.clientWidth - WW * k) / 2;
  ty = (stage.clientHeight - WH * k) / 2;
  apply();
  mark('all');
}
function zoomBox(x0, y0, x1, y1, pad = 0.92) {
  const w = (x1 - x0) * U;
  const h = (y1 - y0) * U;
  k = Math.min((stage.clientWidth * pad) / w, (stage.clientHeight * pad) / h, 2.4);
  tx = stage.clientWidth / 2 - ((x0 + x1) / 2) * U * k;
  ty = stage.clientHeight / 2 - ((y0 + y1) / 2) * U * k;
  apply();
}
function mark(key) { $$('#rooms button').forEach((b) => b.classList.toggle('on', b.dataset.r === key)); }
function goRoom(key) {
  const r = ROOMS[key];
  zoomBox(r[0], r[1], r[2], r[3]);
  mark(key);
}
function zoomBy(f, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
  const nk = Math.max(kFit() * 0.9, Math.min(3, k * f));
  const ratio = nk / k;
  tx = cx - (cx - tx) * ratio;
  ty = cy - (cy - ty) * ratio;
  k = nk;
  apply();
  mark(null);
}
let drag = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.click,.hot')) return;
  drag = { x: e.clientX, y: e.clientY, tx, ty };
  stage.classList.add('drag');
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  tx = drag.tx + e.clientX - drag.x;
  ty = drag.ty + e.clientY - drag.y;
  apply(false);
  mark(null);
});
stage.addEventListener('pointerup', () => {
  drag = null;
  stage.classList.remove('drag');
});
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const b = stage.getBoundingClientRect();
  zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - b.left, e.clientY - b.top);
}, { passive: false });
$('zin').onclick = () => zoomBy(1.35);
$('zout').onclick = () => zoomBy(1 / 1.35);
$('zfit').onclick = fit;
window.addEventListener('resize', fit);

function buildMap() {
  if (ui.mapBuilt) return;
  ui.mapBuilt = true;
  const rooms = $('rooms');
  const all = el('button', '', 'VER TODO');
  all.dataset.r = 'all';
  rooms.append(all);
  for (const [key, r] of Object.entries(ROOMS)) {
    const b = el('button', '', r[4]);
    b.dataset.r = key;
    rooms.append(b);
    const label = el('div', 'lab click room', r[4]);
    label.style.left = `${(r[2] - 3) * U}px`;
    label.style.top = `${(r[6] ?? r[1] + 3) * U}px`;
    label.style.borderColor = r[5];
    label.onclick = () => goRoom(key);
    world.append(label);
  }
  rooms.onclick = (e) => {
    const b = e.target.closest('button');
    if (b) (b.dataset.r === 'all' ? fit() : goRoom(b.dataset.r));
  };
}

/* ---------- people ---------- */
function presence(agent) {
  const { running, queued } = ui.state.runner;
  const spot = SPOTS[agent.id] || SPOTS.arq;
  const tokens = Math.max(0, ...agent.threads.map((t) => t.tokens));
  const limit = agent.contextLimit || 60000;
  const ctx = `${fmt(tokens)} / ${fmt(limit)}`;
  const desk = (icon, tone) => ({ at: spot.desk, icon, tone, ctx });
  if (running.some((j) => j.agent === agent.id)) return desk('⚙');
  if (queued.some((j) => j.agent === agent.id)) return desk('···');
  const tasks = ui.state.tasks.filter((t) => t.agent === agent.id);
  if (tasks.some((t) => t.status === 'failed')) return desk('!', 'bad');
  if (tasks.some((t) => WAITING.includes(t.status))) return desk('?', 'wait');
  if (spot.onDemand) return { at: spot.lounge, icon: 'zZ', ctx: 'dormido' };
  return { at: spot.lounge, icon: '♪ ♫', dance: true, ctx: 'libre', tone: 'free' };
}

function personNode(id, tag) {
  let node = world.querySelector(`[data-person="${id}"]`);
  if (node) return node;
  node = el('div', 'who');
  node.dataset.person = id;
  const sprite = el('button', 'sprite hot');
  sprite.setAttribute('aria-label', tag);
  sprite.style.backgroundPositionY = `-${Math.max(0, SPRITE_ROWS.indexOf(id)) * 120}px`;
  node.append(sprite, el('div', 'lab bub'), el('div', 'lab ctx'));
  world.append(node);
  return node;
}
function moveNode(node, [x, y]) {
  node.style.left = `${x * U}px`;
  node.style.top = `${y * U}px`;
  node.style.zIndex = String(Math.round(y));
}
function drawPeople() {
  for (const agent of ui.state.agents) {
    const s = presence(agent);
    const node = personNode(agent.id, agent.tag);
    moveNode(node, s.at);
    node.classList.toggle('dance', Boolean(s.dance));
    const bub = node.querySelector('.bub');
    bub.classList.toggle('dance', Boolean(s.dance));
    const tag = el('b', '', agent.tag);
    const icon = el('span', 'ic', s.icon);
    bub.replaceChildren(tag, icon);
    const ctx = node.querySelector('.ctx');
    ctx.textContent = s.ctx;
    ctx.className = `lab ctx ${s.tone || ''}`;
    const sprite = node.querySelector('.sprite');
    sprite.classList.toggle('sel', agent.id === ui.agent);
    sprite.onclick = guarded(async () => {
      await selectAgent(agent.id);
      showTab('chat');
      openPanel(true);
    });
  }
  const me = personNode('owner', 'Tú');
  me.classList.add('me');
  me.querySelector('.sprite').classList.remove('hot');
  me.querySelector('.bub').textContent = 'TÚ';
  me.querySelector('.ctx').hidden = true;
  moveNode(me, ownerSpot());
}
function ownerSpot() {
  try {
    const saved = JSON.parse(localStorage.getItem('stackia-owner'));
    if (Array.isArray(saved) && saved.length === 2) return saved;
  } catch { /* fall through to the default */ }
  return [266, 156];
}
const MOVES = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === 'Tab' && !typing) {
    e.preventDefault();
    openPanel();
    return;
  }
  const move = MOVES[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!move || typing || $('app').hidden) return;
  e.preventDefault();
  const [x, y] = ownerSpot();
  const [x0, y0, x1, y1] = OWNER_BOUNDS;
  const next = [Math.min(x1, Math.max(x0, x + move[0] * OWNER_STEP)), Math.min(y1, Math.max(y0, y + move[1] * OWNER_STEP))];
  localStorage.setItem('stackia-owner', JSON.stringify(next));
  moveNode(world.querySelector('[data-person="owner"]'), next);
});

/* ---------- board ---------- */
function drawBoard() {
  const { tasks } = ui.state;
  $('traycounts').textContent = STATUS_COLUMNS
    .map(([name, statuses]) => `${tasks.filter((t) => statuses.includes(t.status)).length} ${name.split(' ')[0].toLowerCase()}`).join(' · ');
  $('kanban').replaceChildren(...STATUS_COLUMNS.map(([name, statuses]) => {
    const col = el('div', 'col');
    col.append(el('h4', '', name));
    tasks.filter((t) => statuses.includes(t.status)).reverse().forEach((t) => col.append(taskCard(t)));
    return col;
  }));
}
function taskCard(t) {
  const card = el('div', 'card');
  const index = ui.state.agents.findIndex((a) => a.id === t.agent);
  card.append(el('b', '', `#${t.id} `), t.title, el('br'), el('span', `tag t${index % 6}`, agentTag(t.agent)));
  if (TASK_STATUS[t.status] && ['failed', 'check_failed', 'empty'].includes(t.status)) card.append(' ', el('span', 'stat', TASK_STATUS[t.status]));
  if (t.error) card.append(el('div', 'stat', t.error));
  if (t.pushError) card.append(el('div', 'stat', `No se pudo subir: ${t.pushError}`));
  if (t.handoff?.next_action) card.append(el('div', 'stat', `Siguiente: ${t.handoff.next_action}`));
  if (t.diff) card.append(el('pre', 'diff', t.diff));
  if (t.commit) card.append(el('div', 'stat', `${t.branch} · ${t.commit}`));
  if (t.status === 'proposed') {
    card.append(button('Aprobar y ejecutar', () => act('/api/task/approve', { id: t.id }), 'btn pri'));
    card.append(button('Rechazar', () => act('/api/task/reject', { id: t.id })));
  }
  if (t.status === 'review') card.append(button('Subir rama a GitHub', () => pushTask(t), 'btn pri'));
  if (t.branch) {
    card.append(button('Abrir chat', async () => {
      await selectAgent(t.agent, t.id.toLowerCase());
      showTab('chat');
      openPanel(true);
    }));
  }
  return card;
}
async function pushTask(task) {
  const files = task.changed?.length ? `\n\nArchivos:\n${task.changed.join('\n')}` : '';
  if (!window.confirm(`Se hará commit y se subirá la rama ${task.branch} a GitHub. main no se toca.${files}`)) return;
  await act('/api/task/push', { id: task.id, confirm: task.branch });
  toast(`Rama ${task.branch} subida`);
}
$('trayhead').onclick = () => {
  const open = $('tray').classList.toggle('open');
  $('trayarrow').textContent = open ? '▼' : '▲';
};

/* ---------- panel ---------- */
function openPanel(value) {
  const panel = $('panel');
  panel.classList.toggle('open', value === undefined ? !panel.classList.contains('open') : value);
  document.querySelector('.stagewrap').classList.toggle('panelopen', panel.classList.contains('open'));
}
$('openpanel').onclick = () => openPanel();
$('close').onclick = () => openPanel(false);
function showTab(view) {
  ui.view = view;
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.v === view));
  $$('.view').forEach((x) => x.classList.toggle('on', x.id === `v-${view}`));
  if (view === 'contexto') guarded(drawPreview)();
  if (view === 'noche') guarded(drawNight)();
}
$$('.tab').forEach((t) => { t.onclick = () => showTab(t.dataset.v); });

async function selectAgent(id, thread = null) {
  ui.agent = id;
  ui.thread = thread;
  await refresh();
  if (ui.view === 'contexto') await drawPreview();
}
function drawChips() {
  for (const box of [$('chatchips'), $('agchips')]) {
    box.replaceChildren(...ui.state.agents.map((a) => {
      const chip = el('button', `chip${a.id === ui.agent ? ' on' : ''}`, `${a.tag} · ${a.name}`);
      chip.onclick = guarded(() => selectAgent(a.id));
      return chip;
    }));
  }
}

/* chat */
function drawThreads(agent) {
  const select = $('thread');
  select.replaceChildren(...agent.threads.map((t) => new Option(t.title, t.id)));
  select.value = ui.thread;
  const current = agent.threads.find((t) => t.id === ui.thread);
  $('meter').textContent = `Contexto ${fmt(current.tokens)} / ${fmt((agent.contextLimit || 60000) * AUTO_CLEAN_RATIO)}`;
}
async function drawThread() {
  const thread = await api(`/api/thread?${query({ agent: ui.agent, thread: ui.thread })}`);
  $('send').disabled = thread.busy;
  const signature = JSON.stringify([thread.id, thread.messages.length, thread.busy]);
  if (signature === ui.lastLog) return;
  ui.lastLog = signature;
  const nodes = thread.messages.map((m) => {
    const box = el('div', `msg ${m.role}`, m.text);
    if (m.usage) box.append(el('span', 'meta', `${fmt(m.usage.input)} entrada · ${fmt(m.usage.output)} salida · ${Math.round(m.seconds)} s`));
    (m.warnings || []).forEach((w) => box.append(el('span', 'warnline', `⚠ ${w}`)));
    return box;
  });
  if (thread.busy) nodes.push(el('div', 'msg system', 'El agente está trabajando…'));
  if (!nodes.length) nodes.push(el('div', 'msg system', 'Aún no hay mensajes en esta conversación.'));
  $('log').replaceChildren(...nodes);
  $('log').scrollTop = $('log').scrollHeight;
}
function typed() {
  const text = $('input').value.trim();
  if (!text) throw new Error('Escribe algo en el cuadro primero.');
  return text;
}
async function act(path, body) {
  await post(path, body);
  await refresh();
}
async function send() {
  const text = typed();
  await post('/api/message', { agent: ui.agent, thread: ui.thread, text });
  $('input').value = '';
  await refresh();
}
$('send').onclick = guarded(send);
$('input').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !$('send').disabled) {
    e.preventDefault();
    guarded(send)();
  }
};
$('thread').onchange = guarded((e) => selectAgent(ui.agent, e.target.value));
$('clean').onclick = guarded(async () => {
  const { cleaned } = await post('/api/clean', { agent: ui.agent, thread: ui.thread });
  toast(cleaned ? 'Contexto limpiado. El handoff se conserva.' : 'No hay sesión activa que limpiar.');
  await refresh();
});
$('to-task').onclick = guarded(async () => {
  const text = typed();
  await post('/api/task', { agent: ui.agent, title: text.split('\n')[0].slice(0, 80), instruction: text });
  $('input').value = '';
  $('tray').classList.add('open');
  $('trayarrow').textContent = '▼';
  toast('Tarea creada: apruébala en el tablero.');
  await refresh();
});
$('to-note').onclick = guarded(async () => {
  await post('/api/note', { agent: ui.agent, text: typed() });
  $('input').value = '';
  toast('Nota guardada: se usará una vez.');
});
$('to-memory').onclick = guarded(async () => {
  await post('/api/memory/propose', { agent: ui.agent, text: typed() });
  $('input').value = '';
  toast('Propuesta enviada a la pestaña Memoria.');
  await refresh();
});

/* agent form */
function fillModels(provider, model, effort) {
  const entry = ui.state.catalog[provider];
  const modelSelect = $('f-model');
  modelSelect.replaceChildren(...entry.models.map((m) => new Option(m.id, m.id)));
  modelSelect.value = entry.models.some((m) => m.id === model) ? model : entry.models[0].id;
  const efforts = entry.models.find((m) => m.id === modelSelect.value).efforts;
  $('f-effort').replaceChildren(...efforts.map((e) => new Option(e, e)));
  $('f-effort').value = efforts.includes(effort) ? effort : efforts[0];
}
function drawForm(agent) {
  if (ui.formAgent === agent.id) return;
  ui.formAgent = agent.id;
  const { catalog, server } = ui.state;
  $('f-provider').replaceChildren(...Object.entries(catalog).map(([id, c]) => new Option(c.label, id)));
  $('f-provider').value = agent.provider;
  fillModels(agent.provider, agent.model, agent.effort);
  $('f-limit').value = agent.contextLimit || 60000;
  $('f-write').checked = Boolean(agent.canWrite);
  $('f-charter').value = agent.charter;
  $('f-memory').value = agent.memory;
  $('f-memtok').textContent = `memoria: ≈${Math.ceil(agent.memory.length / 4)} tokens`;
  $('f-commands').value = (agent.commands || []).join(', ');
  $('f-result').textContent = '';
  const list = server.mcpServers.map((name) => {
    const line = el('label', 'file');
    const box = el('input');
    box.type = 'checkbox';
    box.value = name;
    box.checked = (agent.mcp || []).includes(name);
    line.append(box, ` ${name}`);
    return line;
  });
  $('f-mcp').replaceChildren(...(list.length ? list : [el('div', 'note', 'No hay servidores MCP configurados.')]));
}
$('f-provider').onchange = (e) => fillModels(e.target.value);
$('f-model').onchange = () => fillModels($('f-provider').value, $('f-model').value, $('f-effort').value);
$('f-save').onclick = guarded(async () => {
  await post('/api/agent', {
    id: ui.agent, provider: $('f-provider').value, model: $('f-model').value, effort: $('f-effort').value,
    contextLimit: Number($('f-limit').value), canWrite: $('f-write').checked,
    commands: $('f-commands').value.split(',').map((c) => c.trim()).filter(Boolean),
    mcp: $$('#f-mcp input:checked').map((b) => b.value),
    charter: $('f-charter').value, memory: $('f-memory').value,
  });
  ui.formAgent = null;
  await refresh();
  $('f-result').textContent = 'Guardado.';
});

/* context */
async function drawPreview() {
  const pack = await api(`/api/preview?${query({ agent: ui.agent, thread: ui.thread, text: $('input').value })}`);
  const total = pack.layers.reduce((sum, l) => sum + l.tokens, 0) || 1;
  $('c-name').textContent = agentTag(ui.agent);
  $('c-bar').replaceChildren(...pack.layers.map((l) => {
    const part = el('i', `c-${l.name}`);
    part.style.width = `${(l.tokens / total) * 100}%`;
    return part;
  }));
  $('c-legend').replaceChildren(...pack.layers.map((l) => {
    const item = el('span');
    item.append(el('b', `c-${l.name}`), `${LAYERS[l.name] || l.name} ${l.tokens}`);
    return item;
  }), el('span', '', `· total ≈${pack.tokens} tok${pack.resumed ? ' (sesión activa)' : ' (sesión nueva)'}`));
  $('c-text').textContent = pack.prompt;
}
$('preview').onclick = guarded(drawPreview);

/* cleanups */
function drawCleanups() {
  const rows = ui.state.agents.map((a) => {
    const biggest = [...a.threads].sort((x, y) => y.tokens - x.tokens)[0];
    const limit = a.contextLimit || 60000;
    const fill = el('div', 'fill');
    const bar = el('i');
    bar.style.width = `${Math.min(100, (biggest.tokens / limit) * 100)}%`;
    bar.style.background = '#6bbf86';
    const mark60 = el('u');
    mark60.style.left = '60%';
    fill.append(bar, mark60);
    const cell = el('div');
    cell.append(fill, `${fmt(biggest.tokens)} / ${fmt(limit)}`);
    return row([a.tag, biggest.title, cell, button('Limpiar', () => cleanThread(a.id, biggest.id), 'btn warn')]);
  });
  $('clean-table').replaceChildren(row(['Agente', 'Conversación', 'Contexto / tope', ''], true), ...rows);
  const events = ui.journal.filter((e) => e.type === 'cleanup').reverse().slice(0, 20);
  $('clean-log').replaceChildren(...(events.length ? events.map((e) => {
    const ev = el('div', `ev${e.reason === 'limit' ? ' l' : ''}`);
    ev.append(el('b', '', hhmm(e.at)), ` ${agentTag(e.agent)} · ${e.reason === 'limit' ? 'tope alcanzado' : 'manual'}`, el('br'), el('small', '', `sesión previa ${fmt(e.tokens)} tok`));
    return ev;
  }) : [el('div', 'note', 'Aún no hay limpiezas.')]));
}
async function cleanThread(agent, thread) {
  const { cleaned } = await post('/api/clean', { agent, thread });
  toast(cleaned ? `${agentTag(agent)} limpio.` : 'No tenía sesión activa.');
  await refresh();
}
$('clean-all').onclick = guarded(async () => {
  for (const a of ui.state.agents) {
    for (const t of a.threads) await post('/api/clean', { agent: a.id, thread: t.id });
  }
  toast('Contextos limpiados.');
  await refresh();
});

/* runs */
function drawRuns() {
  const { running, queued } = ui.state.runner;
  const line = (job, state) => row([agentTag(job.agent), job.thread, state, button('■ Parar', () => act('/api/stop', { job: job.id }), 'btn warn')]);
  $('run-now').replaceChildren(row(['Agente', 'Conversación', 'Estado', ''], true),
    ...running.map((j) => line(j, 'trabajando')), ...queued.map((j) => line(j, 'en cola')));
  const history = ui.journal.filter((e) => e.type === 'run' || e.type === 'run_failed').reverse().slice(0, 30);
  $('run-history').replaceChildren(row(['Hora', 'Agente', 'Modelo', 'Tokens', 'Resultado'], true), ...history.map((e) => {
    const failed = e.type === 'run_failed';
    const tr = row([hhmm(e.at), agentTag(e.agent), e.model || '-', failed ? '-' : fmt(e.usage.input + e.usage.output), failed ? e.error.slice(0, 60) : `ok · ${Math.round(e.seconds)} s`]);
    if (e.job) {
      tr.className = 'click';
      tr.onclick = guarded(async () => {
        const { prompt } = await api(`/api/run?${query({ job: e.job })}`);
        $('run-prompt').textContent = prompt || 'No se guardó el prompt de esta ejecución.';
        $('run-prompt').hidden = false;
      });
    }
    return tr;
  }));
}

/* memory and journal */
function drawMemory() {
  const { inbox } = ui.state;
  const count = $('inbox-count');
  count.textContent = inbox.length;
  count.hidden = !inbox.length;
  $('inbox').replaceChildren(...(inbox.length ? inbox.map((item) => {
    const card = el('div', 'card');
    card.append(el('b', '', agentTag(item.agent)), ' quiere recordar:', el('br'), item.text);
    const actions = el('div', 'row');
    actions.append(button('Aprobar', () => act('/api/inbox/decide', { id: item.id, accept: true }), 'btn pri'));
    actions.append(button('Descartar', () => act('/api/inbox/decide', { id: item.id, accept: false })));
    card.append(actions);
    return card;
  }) : [el('div', 'note', 'Nada que aprobar.')]));
  drawJournal();
}
function drawJournal() {
  const needle = $('j-search').value.trim().toLowerCase();
  const entries = ui.journal.filter((e) => !needle || JSON.stringify(e).toLowerCase().includes(needle)).reverse().slice(0, 60);
  $('journal').replaceChildren(...entries.map((e) => {
    const ev = el('div', `ev${e.type === 'run_failed' ? ' e' : ''}`);
    const detail = e.text || e.title || e.next_action || e.error || e.reason || '';
    ev.append(el('b', '', hhmm(e.at)), ` ${e.agent ? `${agentTag(e.agent)} · ` : ''}${e.type}`, el('br'), el('small', '', String(detail).slice(0, 140)));
    return ev;
  }));
}
$('j-search').oninput = drawJournal;

/* usage, network, project */
function drawUsage() {
  const { usage, catalog, maxConcurrent, server } = ui.state;
  $('usage').replaceChildren(row(['Proveedor', 'Hoy', 'Total', 'Ejecuciones'], true), ...Object.entries(catalog).map(([id, c]) => {
    const u = usage[id] || { today: 0, total: 0, runs: 0 };
    return row([c.label, fmt(u.today), fmt(u.total), u.runs]);
  }));
  const select = $('max-runs');
  if (select.options.length === 0) select.replaceChildren(...[1, 2, 3, 4].map((n) => new Option(n, n)));
  if (document.activeElement !== select) select.value = maxConcurrent;
  $('net-info').textContent = `Servidor en ${server.host}:${server.port}, solo dentro de Tailscale.`;
}
$('max-runs').onchange = guarded((e) => act('/api/settings', { maxConcurrent: Number(e.target.value) }));

function drawProject() {
  const { project, tasks } = ui.state;
  $('proj-info').replaceChildren(
    row(['Repo', project.repo]), row(['Rama base', project.base]), row(['Ramas de tareas', project.worktrees]), row(['Plantilla', project.template]),
  );
  if (ui.briefFor !== project.id) {
    ui.briefFor = project.id;
    $('brief').value = project.brief;
  }
  const branches = tasks.filter((t) => t.branch).map((t) => `${t.branch} (${agentTag(t.agent)})`);
  $('branches').textContent = branches.join(' · ') || 'No hay ramas de tareas.';
}
$('brief-save').onclick = guarded(async () => {
  await post('/api/brief', { text: $('brief').value });
  toast('Brief guardado. Se aplica en las sesiones nuevas.');
});

/* night */
ui.pick = new Set();
function nextTime(value) {
  const [h, m] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() < Date.now() + 60000) d.setDate(d.getDate() + 1);
  return d;
}
async function drawNight() {
  const { night, report } = await api(`/api/night?${query({})}`);
  const { tasks, agents } = ui.state;
  const status = $('n-status');
  status.className = night.active ? 'warnbox' : 'okbox';
  status.textContent = night.active
    ? `🌙 Noche en marcha hasta las ${hhmm(night.until)}. ${night.push ? 'Cada rama se sube a GitHub al pasar las comprobaciones.' : 'Las ramas se quedan en el portátil.'}`
    : night.stopReason ? `Última noche terminó: ${night.stopReason}.` : 'No hay ninguna noche en marcha.';
  $('n-start').disabled = night.active;
  $('n-drain').disabled = !night.active;

  const pending = tasks.filter((t) => t.status === 'proposed');
  [...ui.pick].forEach((id) => { if (!pending.some((t) => t.id === id)) ui.pick.delete(id); });
  $('n-list').replaceChildren(...(pending.length ? pending.map((t) => {
    const line = el('label', 'file');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = ui.pick.has(t.id);
    box.onchange = () => { (box.checked ? ui.pick.add(t.id) : ui.pick.delete(t.id)); };
    line.append(box, ` #${t.id} ${t.title} `, el('span', 't', agentTag(t.agent)));
    return line;
  }) : [el('div', 'note', 'No hay tareas pendientes. Añade alguna abajo o desde el chat con «Convertir en tarea».')]));
  if ($('n-agent').options.length === 0) $('n-agent').replaceChildren(...agents.map((a) => new Option(`${a.tag} · ${a.name}`, a.id)));

  const body = [];
  if (report) {
    body.push(el('div', 'note', `Empezó ${hhmm(report.startedAt)}${report.finishedAt ? `, terminó ${hhmm(report.finishedAt)}` : ', en curso'}.`));
    body.push(table(['Tarea', 'Agente', 'Estado', 'Tokens', 'Rama / problema'], report.tasks.map((t) => [
      `#${t.id} ${t.title}`, agentTag(t.agent), TASK_STATUS[t.status] || t.status, fmt(t.tokens),
      t.error || (t.pushError ? `No se pudo subir: ${t.pushError}` : t.branch ? `${t.branch}${t.commit ? ` · ${t.commit}` : ''}` : '-'),
    ])));
    const providers = Object.entries(report.tokensByProvider).map(([p, n]) => `${p} ${fmt(n)}`).join(' · ');
    body.push(el('div', 'note', `Tokens: ${providers || 'ninguno'}`));
    report.limits.forEach((l) => body.push(el('div', 'note', `Límite de ${l.provider} a las ${hhmm(l.at)}; reintento a las ${hhmm(l.until)}.`)));
    report.violations.forEach((v) => body.push(el('div', 'warnbox', `${agentTag(v.agent)} escribió fuera de su rama (${v.kind}): ${v.detail}`)));
  } else {
    body.push(el('div', 'note', 'Aún no ha habido ninguna noche.'));
  }
  $('n-report').replaceChildren(...body);
}
function table(head, rows) {
  const t = el('table');
  t.append(row(head, true), ...rows.map((r) => row(r)));
  return t;
}
$('n-start').onclick = guarded(async () => {
  const batch = [...ui.pick];
  if (!batch.length) throw new Error('Marca al menos una tarea.');
  const until = nextTime($('n-until').value);
  const push = $('n-push').checked;
  const ok = window.confirm(
    `Se aprobarán ${batch.length} tareas y los agentes trabajarán sin ti hasta las ${hhmm(until.toISOString())}.\n\n`
    + `${push ? 'Cada rama stackia/T-n se subirá a GitHub al pasar las comprobaciones. main no se toca.' : 'Nada se sube a GitHub.'}\n`
    + 'No hay tope de tokens: siguen hasta que termine el lote, llegue la hora o el proveedor los pare.',
  );
  if (!ok) return;
  await post('/api/night/start', { batch, until: until.toISOString(), push });
  ui.pick.clear();
  toast('Noche en marcha.');
  await refresh();
});
$('n-drain').onclick = guarded(async () => {
  await post('/api/night/drain');
  toast('Terminará cuando acaben las tareas en curso.');
  await refresh();
});
$('n-add').onclick = guarded(async () => {
  const title = $('n-title').value.trim();
  const instruction = $('n-instruction').value.trim();
  if (!title || !instruction) throw new Error('Pon un título y una instrucción.');
  await post('/api/task', { agent: $('n-agent').value, title, instruction });
  $('n-title').value = '';
  $('n-instruction').value = '';
  await refresh();
});

/* settings */
$('s-motion').checked = localStorage.getItem('stackia-nomotion') === '1';
document.body.classList.toggle('nomotion', $('s-motion').checked);
$('s-motion').onchange = (e) => {
  localStorage.setItem('stackia-nomotion', e.target.checked ? '1' : '0');
  document.body.classList.toggle('nomotion', e.target.checked);
};
$('s-logout').onclick = guarded(async () => {
  await api('/api/logout', {});
  showLogin();
});

$('stop').onclick = guarded(async () => {
  await post('/api/stop');
  toast('Todo detenido.');
  await refresh();
});
$('project').onchange = guarded(async (e) => {
  Object.assign(ui, { project: e.target.value, agent: null, thread: null, formAgent: null, lastLog: '' });
  await refresh();
});

start().catch(showLogin);
