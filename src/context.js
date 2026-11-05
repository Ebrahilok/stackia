'use strict';

const HANDOFF_FENCE = 'stackia-handoff';

const HANDOFF_INSTRUCTIONS = `End your reply with this block, filled in with what is true right now:
\`\`\`${HANDOFF_FENCE}
{"done":[],"decisions":[],"pending":[],"next_action":"","files_changed":[],"memory":[],"ideas":[]}
\`\`\`
"memory" holds only durable facts worth keeping across tasks. "next_action" is the single next step.`;

const estimateTokens = (text) => Math.ceil(text.length / 4);

function citedTaskIds(text) {
  return [...new Set(text.match(/#T-\d+/g) || [])].map((ref) => ref.slice(1));
}

function formatHandoff(handoff) {
  if (!handoff) return '';
  const lines = [];
  for (const key of ['done', 'decisions', 'pending']) {
    if (handoff[key]?.length) lines.push(`${key}: ${handoff[key].join('; ')}`);
  }
  if (handoff.next_action) lines.push(`next action: ${handoff.next_action}`);
  return lines.join('\n');
}

function citedLayer(office, text, ownTaskId) {
  const parts = [];
  for (const id of citedTaskIds(text)) {
    if (id === ownTaskId) continue;
    const task = office.task(id);
    if (task) parts.push(`${id} (${task.title})\n${formatHandoff(task.handoff) || 'No handoff yet.'}`);
  }
  return parts.join('\n\n');
}

/**
 * Builds the exact text sent to the agent, split into layers so the UI can show the cost of each.
 * A resumed session already holds the fixed layers, so it only receives what is new.
 */
function buildPackage({ office, agent, thread, text }) {
  const task = thread.taskId ? office.task(thread.taskId) : null;
  const resumed = Boolean(thread.session);
  const layers = [];
  const add = (name, body) => {
    if (body && body.trim()) layers.push({ name, text: body.trim() });
  };

  if (!resumed) {
    add('charter', office.charter(agent.id));
    add('project', office.brief());
    add('memory', office.memory(agent.id));
    add('notes', office.notes(agent.id).map((n) => `- ${n.text}`).join('\n'));
    if (task) add('task', `Task ${task.id}: ${task.title}\n${task.instruction}`);
    add('previous', formatHandoff(thread.lastHandoff));
  }
  add('cited', citedLayer(office, text, thread.taskId));
  add('message', text);
  add('format', HANDOFF_INSTRUCTIONS);

  const labels = {
    charter: 'YOUR ROLE', project: 'PROJECT', memory: 'YOUR MEMORY', notes: 'ONE-TIME NOTES',
    task: 'CURRENT TASK', previous: 'WHERE THE LAST SESSION STOPPED', cited: 'CITED TASKS',
    message: "OWNER'S MESSAGE", format: 'REPLY FORMAT',
  };
  const prompt = layers.map((l) => `## ${labels[l.name]}\n${l.text}`).join('\n\n');
  return {
    prompt,
    resumed,
    usedNotes: layers.some((l) => l.name === 'notes'),
    layers: layers.map((l) => ({ name: l.name, tokens: estimateTokens(l.text) })),
    tokens: estimateTokens(prompt),
  };
}

/** Splits a reply into visible text and its handoff. A missing or broken block yields null. */
function parseHandoff(reply) {
  const pattern = new RegExp('```' + HANDOFF_FENCE + '\\s*([\\s\\S]*?)```', 'g');
  const matches = [...reply.matchAll(pattern)];
  const visible = reply.replace(pattern, '').trim();
  if (!matches.length) return { text: visible, handoff: null };
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1]);
    const list = (v) => (Array.isArray(v) ? v.map(String) : []);
    return {
      text: visible,
      handoff: {
        done: list(parsed.done),
        decisions: list(parsed.decisions),
        pending: list(parsed.pending),
        next_action: typeof parsed.next_action === 'string' ? parsed.next_action : '',
        files_changed: list(parsed.files_changed),
        memory: list(parsed.memory),
        ideas: list(parsed.ideas),
      },
    };
  } catch {
    return { text: visible, handoff: null };
  }
}

module.exports = { buildPackage, parseHandoff, citedTaskIds, estimateTokens, formatHandoff, HANDOFF_INSTRUCTIONS };
