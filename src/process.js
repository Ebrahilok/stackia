'use strict';
const { spawn, execFile } = require('node:child_process');

/** Runs a program without a shell, so nothing in a prompt can become a command. */
function run(cmd, args, { cwd, stdin, timeoutMs, onStart } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, ...result });
    };
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish({ code: -1, spawnError: err.message }));
    child.on('close', (code) => finish({ code }));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
    onStart?.(child);
  });
}

/** Kills a process and its children. onError hears about a kill that did not work. */
function killTree(child, onError = () => {}) {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], (err, stdout, stderr) => {
      if (err) onError(`${err.message} ${stderr}`.trim().slice(0, 300));
    });
  } else {
    child.kill('SIGKILL');
  }
}

module.exports = { run, killTree };
