'use strict';
// Stand-in for luau-analyze: reports a syntax error for any file that contains BROKEN.
const fs = require('node:fs');
for (const file of process.argv.slice(2)) {
  if (fs.readFileSync(file, 'utf8').includes('BROKEN')) console.error(`${file}(1,1): SyntaxError: unexpected symbol`);
}
