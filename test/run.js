/*
 * Everything, in order of how much it would hurt to get wrong.
 *
 *   selftest  the engine's own tests, which ship inside index.html
 *   fuzz      invented games checked against an independent referee
 *   mutate    what a change does NOT touch
 *   totals    the team line against the box score it has to agree with
 *
 * Needs Playwright and a Chromium. Set CHROME to the binary if it is not
 * where Playwright normally puts it.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  ['selftest', []],
  ['fuzz', [process.env.FUZZ_GAMES || '400']],
  ['mutate', [process.env.MUTATE_GAMES || '100']],
  ['totals', [process.env.TOTALS_GAMES || '150']],
  ['ui', []]
];

let failed = 0;
for (const [name, args] of suites) {
  process.stdout.write('\n=== ' + name + ' ===\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.js'), ...args], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; process.stdout.write('--- ' + name + ' FAILED ---\n'); }
}
process.stdout.write('\n' + (failed ? failed + ' suite(s) failed.\n' : 'All suites passed.\n'));
process.exit(failed ? 1 : 0);
