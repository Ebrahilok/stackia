'use strict';
// Stand-in for an agent CLI. Reacts to keywords in the prompt.
const fs = require('node:fs');

const prompt = fs.readFileSync(0, 'utf8');
const message = prompt.split("## OWNER'S MESSAGE")[1] || prompt;
const session = process.argv[2] || 'fake-session';
const has = (word) => message.includes(word);

if (has('LIMITONCE') && process.env.STACKIA_TEST_FLAG && !fs.existsSync(process.env.STACKIA_TEST_FLAG)) {
  fs.writeFileSync(process.env.STACKIA_TEST_FLAG, 'x');
  console.log(JSON.stringify({ text: '', error: 'usage limit reached, try again later' }));
  process.exit(0);
}
if (has('ESCAPE')) fs.writeFileSync('../escaped.txt', 'x');
if (has('TOUCHOWNER') && process.env.STACKIA_TEST_REPO) fs.writeFileSync(`${process.env.STACKIA_TEST_REPO}/owner-touch.txt`, 'x');
if (has('CRASH')) {
  console.error('boom');
  process.exit(3);
}
if (has('SLEEP')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
if (has('WRITEFILE')) fs.writeFileSync('agent-output.txt', 'hello\n');

const handoff = {
  done: ['replied'], decisions: [], pending: [], next_action: 'next step from fake',
  files_changed: has('WRITEFILE') ? ['agent-output.txt'] : has('LIE') ? ['ghost.txt'] : [],
  memory: has('REMEMBER') ? ['a durable fact'] : [], ideas: [],
};
const block = has('NOHANDOFF') ? '' : '\n```stackia-handoff\n' + JSON.stringify(handoff) + '\n```';
console.log(JSON.stringify({
  text: `fake reply${block}`,
  sessionId: session,
  contextTokens: has('BIGCONTEXT') ? 999999 : prompt.length,
  usage: { input: 10, output: 5 },
}));
