/*
 * The screens. The other suites prove the arithmetic; this one proves the app
 * still renders it, which is the half that goes missing when something is
 * taken out rather than changed.
 */
const { chromium } = require('playwright');
const APP_URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');

let fails = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { fails++; console.log('  FAIL  ' + label + '\n          expected ' + e + ', got ' + a); }
  else console.log('  ok    ' + label + ' = ' + a);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(APP_URL);

  const spot = '#entry-mount .spot-field input';
  const log = () => page.click('#entry-mount .pf-submit .btn-primary');
  const tab = async name => { await page.click('[data-tab="' + name + '"]'); await page.waitForTimeout(120); };

  console.log('--- chart enough to fill every page ---');
  // Note: Escape is bound to clearing the form, so it is not a way to shut the
  // autocomplete. Filling the next field is.
  await page.fill('#drive-spot', '-25'); await page.press('#drive-spot', 'Enter');
  async function play(at, call, type, num, opts) {
    opts = opts || {};
    await page.fill('#entry-mount input[placeholder="Trips Rt"]', opts.formation || 'Trips Rt');
    await page.fill('#entry-mount input[placeholder="Power R"]', call);
    await page.fill(spot, at);
    await page.selectOption('#entry-mount select', type);
    if (type === 'run') await page.fill('#entry-mount input[placeholder="22"]', num);
    else {
      await page.fill('#entry-mount input[placeholder="12"]', '12');
      if (opts.incomplete) await page.click('#entry-mount .seg-sub [data-value="incomplete"]');
      else await page.fill('#entry-mount input[placeholder="80"]', num);
    }
    await log(); await page.waitForTimeout(60);
  }
  // A drive that actually reaches third down, so the audit list has something
  // in it, with two different calls and two formations.
  await play('-25', 'Power R', 'run', '22');                              // 1st & 10
  await play('-27', 'Power R', 'run', '22', { formation: 'Trey Lt' });    // 2nd & 8
  await play('-29', '50 Y Stick', 'pass', '80', { incomplete: true });    // 3rd & 6
  await play('-29', 'Power R', 'run', '22');                              // 4th & 6
  await play('-40', '50 Y Stick', 'pass', '80');                          // converted
  await page.evaluate(() => FB.App.resolveLast('spot', -48));
  await page.waitForTimeout(80);
  check('five plays charted', await page.evaluate(() => FB.App.activeGame().plays.length), 5);
  check('the drive reached third down', await page.evaluate(() =>
    FB.App.computed.report.downChances.length > 0), true);

  console.log('--- every tab renders ---');
  for (const name of ['drive', 'plays', 'box', 'report', 'tend', 'games']) {
    await tab(name);
    const filled = await page.evaluate(n => {
      const el = document.querySelector('#tab-' + n);
      return !!(el && !el.hidden && el.children.length > 0);
    }, name);
    check(name + ' tab has content', filled, true);
  }

  console.log('--- season goals are gone ---');
  await tab('report');
  check('no goals block on the report', await page.evaluate(() =>
    !!document.querySelector('#tab-report .goals')), false);
  check('no "vs goals" heading anywhere', await page.evaluate(() =>
    /vs goals|against your goals/i.test(document.body.textContent)), false);
  check('no goals dialog in the document', await page.evaluate(() =>
    !!document.querySelector('#goals-dialog')), false);
  check('report still has the situational table', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tab-report h2')).some(h => /Situational/.test(h.textContent))), true);
  check('and still lists every third and fourth down', await page.evaluate(() =>
    !!document.querySelector('#tab-report table.chances')), true);
  await tab('games');
  check('no "Season goals" button', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tab-games button')).some(b => /Season goals/i.test(b.textContent))), false);

  console.log('--- tendencies: the split only where it means something ---');
  await tab('tend');
  const tables = await page.evaluate(() => Array.from(document.querySelectorAll('#tab-tend .statblock')).map(b => ({
    title: b.querySelector('h2').textContent,
    cols: Array.from(b.querySelectorAll('thead th')).map(th => th.textContent),
    hasSplitBar: !!b.querySelector('.split')
  })));
  const byCall = tables.find(t => /each call/i.test(t.title));
  const byForm = tables.find(t => /formation/i.test(t.title));
  check('the play-call table is no longer called a tendency', !!byCall, true);
  check('no "By play call" heading', tables.some(t => t.title === 'By play call'), false);
  check('its columns are what the call produced', byCall && byCall.cols, ['Play', 'Called', 'Avg', 'Success', 'TD']);
  check('and it has no run/pass bar', byCall && byCall.hasSplitBar, false);
  check('formation keeps the split', byForm && byForm.hasSplitBar, true);
  check('formation keeps its columns', byForm && byForm.cols,
    ['Formation', 'Plays', 'Run / Pass', 'R / P', 'Avg', 'Success', 'TD']);
  check('Power R is in there three times', await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('#tab-tend .statblock'))
      .find(b => /each call/i.test(b.querySelector('h2').textContent));
    const row = Array.from(t.querySelectorAll('tbody tr')).find(r => /Power R/.test(r.children[0].textContent));
    return row && row.children[1].textContent;
  }), '3');

  console.log('--- the end-of-game page ---');
  await page.evaluate(() => { FB.App.endDrive('punt'); FB.App.finishGame(); });
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#tab-games') && null);
  await tab('games');
  await page.click('#tab-games button:has-text("Game summary")');
  await page.waitForTimeout(150);
  check('the summary opens', await page.evaluate(() => document.querySelector('#summary-dialog').open), true);
  check('with no goals block', await page.evaluate(() =>
    !!document.querySelector('#summary-body .goals')), false);
  check('and still has the box score', await page.evaluate(() =>
    !!document.querySelector('#summary-body table.stats')), true);
  await page.evaluate(() => document.querySelector('#summary-dialog').close());

  console.log('--- a saved game from before goals were removed still loads ---');
  const migrated = await page.evaluate(() => {
    const raw = { team: { name: 'Sipsey Valley', short: 'SV' },
      goals: { firstDowns: 10, rushYards: 125, explosiveRun: 15 },
      games: [{ id: 'old', name: 'Old', opponent: 'Y', drives: [], plays: [] }],
      activeGameId: 'old' };
    const db = FB.Model.normalizeDb(raw);
    return { games: db.games.length, keptGoals: 'goals' in db, team: db.team.short };
  });
  check('an old database still normalises', migrated.games, 1);
  check('and the goals key is dropped, not carried', migrated.keptGoals, false);
  check('everything else survives', migrated.team, 'SV');

  check('no page errors anywhere', errs, []);
  await browser.close();
  console.log(fails ? '\n>>> ' + fails + ' FAILED' : '\nall good');
  process.exit(fails ? 1 : 0);
})();
