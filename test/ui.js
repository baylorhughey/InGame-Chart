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

  console.log('--- the game is graded, the season is not ---');
  await tab('report');
  check('this game is graded against the goals', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tab-report h2')).some(h => /This game vs goals/.test(h.textContent))), true);
  check('with a goals block to show it', await page.evaluate(() =>
    !!document.querySelector('#tab-report .goals')), true);
  check('and every row of the sheet in it', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tab-report .goals .goal-row > div:first-child'))
      .map(d => d.textContent)),
    ['First downs', 'Rushing yards', 'Passing yards', 'Runs of 15+', 'Passes of 25+',
     'Turnovers', 'TFL of 5+ yards', '3rd down', 'Points', 'Win']);
  check('nothing grades a season', await page.evaluate(() =>
    /season vs goals/i.test(document.body.textContent)), false);
  check('the editor is still there, and is about a game', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tab-report button')).some(b => b.textContent === 'Edit goals')), true);
  check('report still has the situational table', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tab-report h2')).some(h => /Situational/.test(h.textContent))), true);
  check('and still lists every third and fourth down', await page.evaluate(() =>
    !!document.querySelector('#tab-report table.chances')), true);
  await tab('games');
  check('the games tab calls them game goals', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tab-games button')).map(b => b.textContent).filter(t => /goals/i.test(t))),
    ['Game goals']);
  await page.click('#tab-games button:has-text("Game goals")');
  await page.waitForTimeout(150);
  check('the editor opens', await page.evaluate(() => document.querySelector('#goals-dialog').open), true);
  check('titled for one game', await page.evaluate(() =>
    document.querySelector('#goals-dialog h2').textContent), 'Game goals');
  check('loaded with the sheet', await page.evaluate(() =>
    document.querySelectorAll('#goals-body input').length), 12);
  await page.evaluate(() => document.querySelector('#goals-dialog').close());

  console.log('--- a season of games shows numbers, not grades ---');
  await page.evaluate(() => {
    FB.App.newGame({ opponent: 'Second', date: '2026-10-09', site: 'away' });
    FB.App.startDrive(-20);
    FB.App.logPlay({ spot: -20, playType: 'run', carrier: '22' });
    FB.App.resolveLast('spot', -28);
    FB.App.endDrive('punt');
  });
  await page.waitForTimeout(120);
  await tab('report');
  check('two games charted', await page.evaluate(() => FB.App.db.games.length), 2);
  check('the season gets a situational table', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tab-report h2')).some(h => /Situational — season/.test(h.textContent))), true);
  // Every rate on the season report has to be recomputed from the season's
  // own numerator and denominator -- an average of averages is not one.
  check('and every rate on it is filled in', await page.evaluate(() => {
    const r = FB.App.seasonSummary().report;
    return ['thirdDownPct', 'fourthDownPct', 'redZoneTdPct', 'yardsPerPlay']
      .filter(k => r[k] === undefined);
  }), []);
  check('and still no season grading', await page.evaluate(() =>
    document.querySelectorAll('#tab-report .goals').length), 1);

  // Back to the charted game; the second one exists only to make a season.
  await page.evaluate(() => FB.App.selectGame(FB.App.db.games[0].id));
  await page.waitForTimeout(120);

  console.log('--- targets: thrown to him, caught or not ---');
  const recvLabel = () => page.evaluate(() => {
    const i = document.querySelector('#entry-mount input[placeholder="80"]');
    if (!i || !i.offsetParent) return 'hidden';
    return i.closest('.field').querySelector('.lbl').textContent;
  });
  await page.fill(spot, '-48');
  await page.selectOption('#entry-mount select', 'pass');
  await page.waitForTimeout(60);
  check('a catch asks for the receiver', await recvLabel(), 'Receiver #');
  await page.click('#entry-mount .seg-sub [data-value="incomplete"]'); await page.waitForTimeout(60);
  check('an incompletion asks who it was thrown at', await recvLabel(), 'Targeted #');
  await page.click('#entry-mount .seg-sub [data-value="scramble"]'); await page.waitForTimeout(60);
  check('a scramble was never thrown, so it asks nobody', await recvLabel(), 'hidden');
  await page.click('#entry-mount .seg-sub [data-value="incomplete"]'); await page.waitForTimeout(60);

  await page.fill('#entry-mount input[placeholder="12"]', '12');
  await page.fill('#entry-mount input[placeholder="80"]', '80');
  await log(); await page.waitForTimeout(80);
  check('the incompletion counted as a target', await page.evaluate(() =>
    FB.App.computed.box.receiving['80'].tgt), 2);
  check('but not as a catch', await page.evaluate(() =>
    FB.App.computed.box.receiving['80'].rec), 1);
  // Three attempts by now: the fixture threw two before this one, and the
  // first of those was charted with nobody noted, so it is not a target.
  check('and the QB wears the attempt', await page.evaluate(() =>
    [FB.App.computed.box.passing['12'].att, FB.App.computed.box.passing['12'].comp]), [3, 1]);
  await tab('box');
  check('the box score has a targets column', await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('#tab-box .statblock'))
      .find(x => /Receiving/.test(x.querySelector('h2').textContent));
    return Array.from(t.querySelectorAll('thead th')).map(h => h.textContent);
  }), ['#', 'Tgt', 'Rec', 'Yds', 'TD', 'Avg']);
  check('the exported chart carries them too', await page.evaluate(() =>
    FB.IO.boxCsv(FB.App.activeGame(), FB.App.computed, FB.App.db.team)
      .split(/\r?\n/).find(l => /^RECEIVING/.test(l))),
    'RECEIVING,Tgt,Rec,Yards,TD,Avg');

  console.log('--- a flag reads the same everywhere it appears ---');
  // It carries no yardage any more, so nothing may print one. The play log
  // used to say "0 yd" beside a yards column reading +15.
  await page.evaluate(() => {
    FB.App.startDrive(-25);
    FB.App.logPlay({ spot: -25, playType: 'penalty',
      penalty: { on: 'them', autoFirst: false, beyondLOS: false,
        underlyingType: 'none', creditedYards: 0, endedAt: null, yards: null } });
    FB.App.logPlay({ spot: -40, playType: 'run', carrier: '22' });
  });
  await page.waitForTimeout(120);
  await tab('drive');
  const flagRow = await page.evaluate(() => {
    const r = document.querySelector('.playlist .play.is-penalty');
    return r ? Array.from(r.children).map(c => c.innerText.replace(/\n/g, ' ')) : null;
  });
  check('the flag says who it was on and no yardage', flagRow && flagRow[3], 'Penalty on them');
  check('and the yards column carries the movement', flagRow && flagRow[4], '+15');
  check('no stray zero or null anywhere on the row', /0 yd|null|undefined|NaN/.test((flagRow || []).join(' ')), false);
  check('the exported chart says the same', await page.evaluate(() => {
    const line = FB.IO.playsCsv(FB.App.activeGame(), FB.App.computed)
      .split('\n').find(l => /penalty/.test(l));
    return /null|undefined|NaN/.test(line) ? line : 'clean';
  }), 'clean');

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
  check('the game is graded there too', await page.evaluate(() =>
    !!document.querySelector('#summary-body .goals')), true);
  check('and still has the box score', await page.evaluate(() =>
    !!document.querySelector('#summary-body table.stats')), true);
  await page.evaluate(() => document.querySelector('#summary-dialog').close());

  console.log('--- a saved database still loads, goals and all ---');
  const migrated = await page.evaluate(() => {
    const raw = { team: { name: 'Sipsey Valley', short: 'SV' },
      goals: { firstDowns: 10, rushYards: 125, explosiveRun: 15 },
      games: [{ id: 'old', name: 'Old', opponent: 'Y', drives: [], plays: [] }],
      activeGameId: 'old' };
    const db = FB.Model.normalizeDb(raw);
    return { games: db.games.length, keptGoals: 'goals' in db, team: db.team.short,
      firstDowns: db.goals.firstDowns, points: db.goals.points };
  });
  check('an old database still normalises', migrated.games, 1);
  check('and its goals come with it', migrated.keptGoals, true);
  check('a target that was set is kept', migrated.firstDowns, 10);
  check('one that was not falls back to the sheet', migrated.points, 21);
  check('everything else survives', migrated.team, 'SV');

  check('no page errors anywhere', errs, []);
  await browser.close();
  console.log(fails ? '\n>>> ' + fails + ' FAILED' : '\nall good');
  process.exit(fails ? 1 : 0);
})();
