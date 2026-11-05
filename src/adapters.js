'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_ARG_PROMPT = 28000; // Windows caps a command line at about 32k characters.
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const WRITE_TOOLS = [...READ_TOOLS, 'Edit', 'Write'];
// On Windows agy runs commands through the shell itself, so the only safe read-only mode is
// "no commands at all": its own file tools need no permission.
const AGY_READ_COMMANDS = process.platform === 'win32' ? [] : ['grep', 'ls', 'cat', 'find'];

const fail = (error) => ({ text: '', error });

/** Usage adds up every model call in a run; the context size is roughly one call's worth. */
const perCall = (total, calls) => Math.round(total / Math.max(1, calls || 1));

function lastLines(text, count = 6) {
  return text.trim().split('\n').slice(-count).join('\n').slice(0, 800);
}

/**
 * Each adapter turns one request into a command and its output into
 * { text, sessionId, contextTokens, usage, error }.
 */
const claude = {
  command(req, cli) {
    // --tools keeps unused tool definitions out of the prompt: about 21k tokens saved per call.
    const available = [...(req.write ? WRITE_TOOLS : READ_TOOLS)];
    const tools = [...available];
    const args = ['-p', '--output-format', 'json', '--model', req.model, '--effort', req.effort];
    if (req.write) {
      args.push('--permission-mode', 'acceptEdits');
      if (req.commands.length) available.push('Bash');
      for (const c of req.commands) tools.push(`Bash(${c}:*)`);
    }
    args.push('--tools', available.join(','));
    if (req.mcpConfig) {
      args.push('--mcp-config', req.mcpConfig);
      for (const name of req.mcp) tools.push(`mcp__${name}`);
    }
    args.push('--strict-mcp-config', '--allowedTools', tools.join(','));
    if (req.sessionId) args.push('--resume', req.sessionId);
    return { cmd: cli.claude, args, stdin: req.prompt };
  },
  parse(result) {
    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      return fail(lastLines(result.stderr || result.stdout) || 'Claude returned no JSON.');
    }
    if (data.is_error) return fail(String(data.result || data.subtype || 'Claude reported an error.'));
    const u = data.usage || {};
    const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    return {
      text: data.result || '',
      sessionId: data.session_id,
      contextTokens: perCall(input, data.num_turns) + (u.output_tokens || 0),
      usage: { input, output: u.output_tokens || 0 },
    };
  },
};

const codex = {
  command(req, cli) {
    const options = ['--json', '-m', req.model, '-c', `model_reasoning_effort="${req.effort}"`, '--skip-git-repo-check'];
    const sandbox = `sandbox_mode="${req.write ? 'workspace-write' : 'read-only'}"`;
    const args = req.sessionId
      ? ['exec', 'resume', req.sessionId, ...options, '-c', sandbox, '-']
      : ['exec', ...options, '-c', sandbox, '-C', req.cwd, '-'];
    return launchCodex(cli.codex, args, req.prompt);
  },
  parse(result) {
    const out = { text: '', usage: { input: 0, output: 0 } };
    const errors = [];
    let toolCalls = 0;
    for (const line of result.stdout.split('\n')) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'thread.started') out.sessionId = event.thread_id;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') out.text = event.item.text;
      else if (event.type === 'item.completed') toolCalls += 1;
      if (event.type === 'turn.completed' && event.usage) {
        out.usage = { input: event.usage.input_tokens || 0, output: event.usage.output_tokens || 0 };
      }
      if (event.type === 'error' || event.type === 'turn.failed') errors.push(event.message || event.error?.message || line);
    }
    out.contextTokens = perCall(out.usage.input, toolCalls + 1) + out.usage.output;
    if (!out.text) return fail(errors.join('\n') || lastLines(result.stderr) || 'Codex returned no reply.');
    return out;
  },
};

/** npm installs Codex as a .cmd on Windows, which Node cannot spawn without a shell. */
function launchCodex(configured, args, stdin) {
  if (configured.endsWith('.js')) return { cmd: process.execPath, args: [configured, ...args], stdin };
  return { cmd: configured, args, stdin };
}

const agy = {
  command(req, cli) {
    if (req.prompt.length > MAX_ARG_PROMPT) throw new Error('Prompt too long for agy.');
    const allow = AGY_READ_COMMANDS.concat(req.write ? req.commands : []).map((c) => `command(${c})`);
    const args = ['-p', req.prompt, '--model', `${req.model}-${req.effort}`, '--output-format', 'json',
      '--settings', JSON.stringify({ permissions: { allow } })];
    if (req.sessionId) args.push('--conversation', req.sessionId);
    return { cmd: cli.agy, args };
  },
  parse(result) {
    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      return fail(lastLines(result.stderr || result.stdout) || 'agy returned no JSON.');
    }
    const denied = data.denied_actions?.length ? `Denied: ${JSON.stringify(data.denied_actions).slice(0, 300)}` : '';
    if (data.status !== 'SUCCESS') return fail(String(data.error || data.status || 'agy failed.'));
    if (!data.response) return fail(denied || 'agy returned an empty reply.');
    const u = data.usage || {};
    return {
      text: data.response,
      sessionId: data.conversation_id,
      contextTokens: perCall(u.input_tokens || 0, data.num_turns) + (u.output_tokens || 0),
      usage: { input: u.input_tokens || 0, output: u.output_tokens || 0 },
    };
  },
};

/** Stand-in CLI for tests and for trying the app without spending quota. */
const mock = {
  command(req) {
    const script = path.join(__dirname, '..', 'test', 'fake-cli.js');
    return { cmd: process.execPath, args: [script, req.sessionId || ''], stdin: req.prompt };
  },
  parse(result) {
    try {
      return JSON.parse(result.stdout);
    } catch {
      return fail(lastLines(result.stderr || result.stdout) || 'Mock failed.');
    }
  },
};

const adapters = { claude, codex, agy, mock };

/** Fills in CLI paths for this machine, preferring what the config says. */
function resolveCli(configured = {}) {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = {
    claude: [path.join(home, '.local', 'bin', 'claude.exe')],
    codex: [path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')],
    agy: [path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe')],
  };
  const cli = {};
  for (const name of Object.keys(candidates)) {
    const custom = configured[name];
    const isPath = custom && custom !== name;
    cli[name] = isPath ? custom : candidates[name].find((p) => fs.existsSync(p)) || name;
  }
  return cli;
}

module.exports = { adapters, resolveCli };
