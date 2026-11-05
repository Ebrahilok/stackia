'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { run } = require('./process');

const BRANCH = /^stackia\/T-\d+$/;

async function git(cwd, args) {
  const result = await run('git', args, { cwd, timeoutMs: 120000 });
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim().slice(0, 500));
  return result.stdout;
}

const branchFor = (taskId) => `stackia/${taskId}`;

/** Each task gets its own branch and folder, so it never touches the owner's working copy. */
async function createWorktree(project, taskId) {
  const worktree = path.resolve(project.worktrees, taskId);
  const branch = branchFor(taskId);
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  await git(project.repo, ['worktree', 'add', '-b', branch, worktree, project.base]);
  return { worktree, branch };
}

async function changedFiles(worktree) {
  const out = await git(worktree, ['status', '--porcelain', '--untracked-files=all']);
  return out.split('\n').filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, ''));
}

async function diffStat(worktree) {
  await git(worktree, ['add', '-A', '--intent-to-add']);
  return (await git(worktree, ['diff', '--stat'])).trim();
}

/** Commits the task and pushes only its own branch. Refuses anything else. */
async function commitAndPush(project, task) {
  if (!BRANCH.test(task.branch)) throw new Error(`Refusing to push branch: ${task.branch}`);
  const current = (await git(task.worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (current !== task.branch) throw new Error(`Worktree is on ${current}, expected ${task.branch}`);
  if ((await changedFiles(task.worktree)).length) {
    await git(task.worktree, ['add', '-A']);
    await git(task.worktree, ['commit', '-m', `${task.id}: ${task.title}`]);
  }
  await git(task.worktree, ['push', project.remote, `${task.branch}:refs/heads/${task.branch}`]);
  return (await git(task.worktree, ['rev-parse', '--short', 'HEAD'])).trim();
}

module.exports = { createWorktree, changedFiles, diffStat, commitAndPush, branchFor };
