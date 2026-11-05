'use strict';
const $ = (id) => document.getElementById(id);
const STATUS = {
  proposed: 'Pendiente de aprobar', approved: 'Aprobada', running: 'En curso', review: 'Para revisar',
  failed: 'Falló', pushed: 'Subida a GitHub', rejected: 'Rechazada',
};
const LAYERS = {
  charter: 'Prompt del agente', project: 'Proyecto', memory: 'Memoria', notes: 'Notas', task: 'Tarea',
  previous: 'Sesión anterior', cited: 'Tareas citadas', message: 'Tu mensaje', format: 'Formato de respuesta',
};
const POLL_MS = 2000;
const ui = { project: null, agent: null, thread: null, state: null, formAgent: null, lastLog: '' };

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
  toast.timer = setTimeout(() => { box.hidden = true; }, 5000);
}
const guarded = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message);
  }
};
function button(label, onClick, className) {
  const b = el('button', className, label);
  b.onclick = guarded(onClick);
  return b;
}

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
  const select = $('project');
  select.replaceChildren(...projects.map((p) => new Option(p.name, p.id)));
  ui.project = projects[0].id;
  await refresh();
  clearInterval(ui.timer);
  ui.timer = setInterval(guarded(refresh), POLL_MS);
}

async function refresh() {
  ui.state = await api(`/api/state?${query({})}`);
  const { agents } = ui.state;
  if (!agents.some((a) => a.id === ui.agent)) ui.agent = agents[0]?.id;
  const agent = agents.find((a) => a.id === ui.agent);
  if (!agent) return;
  if (!agent.threads.some((t) => t.id === ui.thread)) ui.thread = agent.threads[0].id;
  drawAgents();
  drawThreads(agent);
  drawTasks();
  drawInbox();
  drawForm(agent);
  drawStatus();
  await drawThread();
}

function drawStatus() {
  const { running, queued } = ui.state.runner;
  $('status').textContent = running.length ? `${running.length} trabajando · ${queued.length} en cola` : 'Sin trabajo en curso';
}

function drawAgents() {
  const busy = new Set(ui.state.runner.running.map((j) => j.agent));
  $('agents').replaceChildren(...ui.state.agents.map((a) => {
    const b = el('button', `agent${a.id === ui.agent ? ' on' : ''}`);
    b.append(el('b', '', a.tag));
    const name = el('span', '', a.name);
    name.append(el('small', '', a.model));
    b.append(name);
    if (busy.has(a.id)) b.append(el('span', 'dot'));
    b.onclick = guarded(async () => {
      ui.agent = a.id;
      ui.thread = null;
      await refresh();
    });
    return b;
  }));
}

function drawThreads(agent) {
  const select = $('thread');
  select.replaceChildren(...agent.threads.map((t) => new Option(t.title, t.id)));
  select.value = ui.thread;
  const current = agent.threads.find((t) => t.id === ui.thread);
  const limit = (agent.contextLimit || 60000) * 0.6;
  const ratio = Math.min(1, current.tokens / limit);
  $('meter-label').textContent = `Contexto ${Math.round(current.tokens / 100) / 10}k / ${Math.round(limit / 1000)}k`;
  $('meter-fill').style.width = `${ratio * 100}%`;
  $('meter-fill').classList.toggle('high', ratio > 0.8);
}

async function drawThread() {
  const thread = await api(`/api/thread?${query({ agent: ui.agent, thread: ui.thread })}`);
  $('send').disabled = thread.busy;
  const signature = JSON.stringify([thread.id, thread.messages.length, thread.busy]);
  if (signature === ui.lastLog) return;
  ui.lastLog = signature;
  const log = $('log');
  const nodes = thread.messages.map((m) => {
    const box = el('div', `msg ${m.role}`, m.text);
    if (m.usage) box.append(el('span', 'meta', `${m.usage.input} entrada · ${m.usage.output} salida · ${Math.round(m.seconds)} s`));
    (m.warnings || []).forEach((w) => box.append(el('span', 'warn', `⚠ ${w}`)));
    return box;
  });
  if (thread.busy) nodes.push(el('div', 'msg system', 'El agente está trabajando…'));
  if (!nodes.length) nodes.push(el('p', 'empty', 'Aún no hay mensajes en esta conversación.'));
  log.replaceChildren(...nodes);
  log.scrollTop = log.scrollHeight;
}

function drawTasks() {
  const tasks = [...ui.state.tasks].reverse();
  const box = $('tab-tasks');
  if (!tasks.length) {
    box.replaceChildren(el('p', 'hint', 'No hay tareas. Escribe algo y pulsa «Convertir en tarea».'));
    return;
  }
  box.replaceChildren(...tasks.map((t) => {
    const card = el('div', 'card');
    card.append(el('h3', '', `#${t.id} · ${t.title}`));
    card.append(el('span', 'pill', `${STATUS[t.status] || t.status} · ${t.agent.toUpperCase()}`));
    if (t.handoff?.next_action) card.append(el('p', '', `Siguiente: ${t.handoff.next_action}`));
    if (t.diff) card.append(el('pre', '', t.diff));
    if (t.commit) card.append(el('p', '', `Rama ${t.branch} · commit ${t.commit}`));
    const row = el('div', 'row');
    if (t.status === 'proposed') {
      row.append(button('Aprobar y ejecutar', () => act('/api/task/approve', { id: t.id }), 'primary'));
      row.append(button('Rechazar', () => act('/api/task/reject', { id: t.id })));
    }
    if (t.status === 'review') {
      row.append(button('Subir rama a GitHub', () => pushTask(t), 'primary'));
    }
    if (t.branch) {
      row.append(button('Abrir chat', async () => {
        ui.agent = t.agent;
        ui.thread = t.id.toLowerCase();
        await refresh();
      }));
    }
    card.append(row);
    return card;
  }));
}

async function pushTask(task) {
  const files = task.changed?.length ? `\n\nArchivos:\n${task.changed.join('\n')}` : '';
  if (!window.confirm(`Se hará commit y se subirá la rama ${task.branch} a GitHub. main no se toca.${files}`)) return;
  await act('/api/task/push', { id: task.id, confirm: task.branch });
  toast(`Rama ${task.branch} subida`);
}

function drawInbox() {
  const { inbox } = ui.state;
  $('inbox-count').textContent = inbox.length || '';
  const box = $('tab-inbox');
  if (!inbox.length) {
    box.replaceChildren(el('p', 'hint', 'Nada que aprobar.'));
    return;
  }
  box.replaceChildren(...inbox.map((item) => {
    const card = el('div', 'card');
    card.append(el('span', 'pill', `Memoria de ${item.agent.toUpperCase()}`), el('p', '', item.text));
    const row = el('div', 'row');
    row.append(button('Aprobar', () => act('/api/inbox/decide', { id: item.id, accept: true }), 'primary'));
    row.append(button('Descartar', () => act('/api/inbox/decide', { id: item.id, accept: false })));
    card.append(row);
    return card;
  }));
}

function fillModels(provider, model, effort) {
  const { catalog } = ui.state;
  const entry = catalog[provider];
  const modelSelect = $('f-model');
  modelSelect.replaceChildren(...entry.models.map((m) => new Option(m.id, m.id)));
  modelSelect.value = entry.models.some((m) => m.id === model) ? model : entry.models[0].id;
  const efforts = entry.models.find((m) => m.id === modelSelect.value).efforts;
  const effortSelect = $('f-effort');
  effortSelect.replaceChildren(...efforts.map((e) => new Option(e, e)));
  effortSelect.value = efforts.includes(effort) ? effort : efforts[0];
}

function drawForm(agent) {
  if (ui.formAgent === agent.id) return;
  ui.formAgent = agent.id;
  const { catalog } = ui.state;
  $('f-provider').replaceChildren(...Object.entries(catalog).map(([id, c]) => new Option(c.label, id)));
  $('f-provider').value = agent.provider;
  fillModels(agent.provider, agent.model, agent.effort);
  $('f-charter').value = agent.charter;
  $('f-memory').value = agent.memory;
  $('f-result').textContent = '';
}

async function act(path, body) {
  await post(path, body);
  await refresh();
}

function typed(required = true) {
  const text = $('input').value.trim();
  if (!text && required) throw new Error('Escribe algo en el cuadro primero.');
  return text;
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
$('thread').onchange = guarded(async (e) => {
  ui.thread = e.target.value;
  await refresh();
});
$('clean').onclick = guarded(async () => {
  const { cleaned } = await post('/api/clean', { agent: ui.agent, thread: ui.thread });
  toast(cleaned ? 'Contexto limpiado. El handoff se conserva.' : 'No hay sesión activa que limpiar.');
  await refresh();
});
$('to-task').onclick = guarded(async () => {
  const text = typed();
  await post('/api/task', { agent: ui.agent, title: text.split('\n')[0].slice(0, 80), instruction: text });
  $('input').value = '';
  toast('Tarea creada: apruébala en la pestaña Tareas.');
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
  toast('Propuesta enviada a la bandeja.');
  await refresh();
});
$('stop').onclick = guarded(async () => {
  await post('/api/stop');
  toast('Todo detenido.');
  await refresh();
});
$('project').onchange = guarded(async (e) => {
  Object.assign(ui, { project: e.target.value, agent: null, thread: null, formAgent: null });
  await refresh();
});

document.querySelectorAll('.tabs button').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((t) => t.classList.toggle('on', t === tab));
    document.querySelectorAll('.tab').forEach((p) => p.classList.toggle('on', p.id === `tab-${tab.dataset.tab}`));
    if (tab.dataset.tab === 'context') guarded(drawPreview)();
  };
});
$('f-provider').onchange = (e) => fillModels(e.target.value);
$('f-model').onchange = () => fillModels($('f-provider').value, $('f-model').value, $('f-effort').value);
$('f-save').onclick = guarded(async () => {
  await post('/api/agent', {
    id: ui.agent, provider: $('f-provider').value, model: $('f-model').value, effort: $('f-effort').value,
    charter: $('f-charter').value, memory: $('f-memory').value,
  });
  $('f-result').textContent = 'Guardado. Se aplica en la próxima sesión.';
  await refresh();
});

async function drawPreview() {
  const pack = await api(`/api/preview?${query({ agent: ui.agent, thread: ui.thread, text: $('input').value })}`);
  const rows = pack.layers.map((l) => {
    const row = el('div', 'layer');
    row.append(el('span', '', LAYERS[l.name] || l.name), el('span', '', `${l.tokens} tok`));
    return row;
  });
  const total = el('div', 'layer');
  total.append(el('b', '', pack.resumed ? 'Total (sesión activa)' : 'Total (sesión nueva)'), el('b', '', `≈${pack.tokens} tok`));
  $('layers').replaceChildren(...rows, total);
}
$('preview').onclick = guarded(drawPreview);

start().catch(showLogin);
