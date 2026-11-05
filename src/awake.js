'use strict';
const { spawn } = require('node:child_process');
const { killTree } = require('./process');

const SCRIPT = `
Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);' -Name Power -Namespace Win
while (Get-Process -Id $env:STACKIA_PARENT -ErrorAction SilentlyContinue) {
  [Win.Power]::SetThreadExecutionState(0x80000001) | Out-Null
  Start-Sleep -Seconds 30
}`;

/**
 * Keeps Windows from sleeping while agents work overnight. Returns a function that releases it.
 * The helper exits by itself if this process dies, so the lock never outlives the server.
 */
function startAwake() {
  if (process.platform !== 'win32') return () => {};
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SCRIPT], {
    env: { ...process.env, STACKIA_PARENT: String(process.pid) },
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  return () => killTree(child);
}

module.exports = { startAwake };
