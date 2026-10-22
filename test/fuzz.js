/*
 * Feed the engine thousands of invented games and make it rediscover what
 * the generator already knows. Any disagreement is a bug in one of the two,
 * and the generator is the one written from the rules.
 */
const { chromium } = require('playwright');
const APP_URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const { simulate } = require('./reference.js');

const GAMES = Number(process.argv[2] || 400);
const APP = APP_URL;

const found = [];       // one entry per distinct complaint
const seen = new Set();
function fail(seed, what, expected, actual, where) {
  const key = what + '|' + where;
  if (seen.has(key)) { found.find(f => f.key === key).count += 1; return; }
  seen.add(key);
  found.push({ key, count: 1, seed, what, expected, actual, where });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const pageErrs = [];
  page.on('pageerror', e => pageErrs.push('' + e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrs.push(m.text()); });
  await page.goto(APP);

  let checks = 0;
  for (let seed = 1; seed <= GAMES; seed++) {
    const sim = simulate(seed);
    const out = await page.evaluate(({ plays, drives }) => {
      const M = FB.Model, E = FB.Engine;
      const game = M.makeGame({ name: 'Fuzz', opponent: 'X' });
      game.id = 'g';
      game.drives = drives.map(d => {
        const dr = M.makeDrive({ gameId: 'g', startSpot: d.startSpot });
        dr.id = d.id;
        dr.manualEnd = d.manualEnd;
        return dr;
      });
      game.plays = plays.map(p => {
        const made = p.kind === 'pat'
          ? M.makePat({ gameId: 'g', driveId: p.driveId, good: p.patGood })
          : M.makePlay(p);
        made.id = p.id;
        return made;
      });
      const c = E.computeGame(game);

      // Computing the same game twice must give the same answer.
      const again = E.computeGame(game);

      // Export and import again: the round trip must not move a number.
      const json = FB.IO.exportJson({ games: [game], activeGameId: 'g' });
      let rt = null, rtErr = null;
      try {
        const back = FB.IO.importJson({ games: [], activeGameId: null }, json, 'replace');
        rt = E.computeGame(back.db.games[0]);
      } catch (e) { rtErr = '' + e.message; }

      function slim(x) {
        return {
          drives: x.drives.map(d => ({
            ended: d.ended, points: d.points,
            rows: d.rows.map(r => ({ id: r.id, down: r.down, distance: r.distance,
              goalToGo: r.goalToGo, yards: r.yards, statYards: r.statYards,
              firstDown: r.firstDown, driveEnd: r.driveEnd, pending: r.pending }))
          })),
          box: x.box, score: x.score, totals: x.totals,
          report: { thirdDownAtt: x.report.thirdDownAtt, thirdDownConv: x.report.thirdDownConv,
            fourthDownAtt: x.report.fourthDownAtt, fourthDownConv: x.report.fourthDownConv,
            turnoverOnDowns: x.report.turnoverOnDowns, firstDowns: x.report.firstDowns }
        };
      }
      return {
        c: slim(c),
        stable: JSON.stringify(slim(c)) === JSON.stringify(slim(again)),
        roundTrip: rt ? (JSON.stringify(slim(c)) === JSON.stringify(slim(rt))) : ('import failed: ' + rtErr)
      };
    }, { plays: sim.plays, drives: sim.drives });

    const t = sim.truth, c = out.c;

    if (!out.stable) fail(seed, 'computing the same game twice gave two answers', true, false, 'determinism');
    if (out.roundTrip !== true) fail(seed, 'export then import changed the numbers', true, out.roundTrip, 'round trip');

    // --- the chain, row by row ---
    let ri = 0;
    for (let di = 0; di < t.drives.length; di++) {
      const td = t.drives[di], cd = c.drives[di];
      if (!cd) { fail(seed, 'a drive went missing', t.drives.length, c.drives.length, 'drive count'); break; }
      if (cd.ended !== td.ended) fail(seed, 'drive ended differently', td.ended, cd.ended, 'drive ' + (di + 1) + ' result');
      if (cd.points !== td.points) fail(seed, 'drive points differ', td.points, cd.points, 'drive ' + (di + 1) + ' points');
      for (let k = 0; k < td.rows.length; k++) {
        const tr = td.rows[k], cr = cd.rows[k];
        checks++;
        if (!cr) { fail(seed, 'a play went missing from a drive', td.rows.length, cd.rows.length, 'drive ' + (di + 1) + ' rows'); break; }
        const at = 'drive ' + (di + 1) + ' play ' + (k + 1) + ' (' + tr.kind + ')';
        if (cr.pending) fail(seed, 'a play stayed pending that should have resolved', false, true, at + ' pending');
        if (cr.down !== tr.down) fail(seed, 'wrong down', tr.down, cr.down, at + ' down');
        if (Math.abs(cr.distance - tr.distance) > 0.05) fail(seed, 'wrong distance', tr.distance, cr.distance, at + ' distance');
        if (cr.goalToGo !== tr.goalToGo) fail(seed, 'wrong goal-to-go', tr.goalToGo, cr.goalToGo, at + ' goalToGo');
        if (Math.abs((cr.yards || 0) - tr.yards) > 0.05) fail(seed, 'wrong yardage', tr.yards, cr.yards, at + ' yards');
        if (Math.abs((cr.statYards || 0) - tr.statYards) > 0.05) fail(seed, 'wrong credited yardage', tr.statYards, cr.statYards, at + ' statYards');
        if (!!cr.firstDown !== !!tr.firstDown) fail(seed, 'first down disagreement', tr.firstDown, cr.firstDown, at + ' firstDown');
        if ((cr.driveEnd || null) !== (tr.driveEnd || null)) fail(seed, 'drive-ending play disagreement', tr.driveEnd, cr.driveEnd, at + ' driveEnd');
        if (cr.down < 1 || cr.down > 4) fail(seed, 'down outside 1-4', '1..4', cr.down, at + ' down range');
        if (cr.distance < 0) fail(seed, 'negative distance', '>= 0', cr.distance, at + ' distance sign');
        ri++;
      }
    }

    // --- the totals ---
    if (c.totals.firstDowns !== t.firstDowns) fail(seed, 'team first downs', t.firstDowns, c.totals.firstDowns, 'totals.firstDowns');
    if (c.score !== t.points) fail(seed, 'score', t.points, c.score, 'score');
    if (c.report.thirdDownAtt !== t.thirdAtt) fail(seed, 'third-down attempts', t.thirdAtt, c.report.thirdDownAtt, 'thirdDownAtt');
    if (c.report.thirdDownConv !== t.thirdConv) fail(seed, 'third-down conversions', t.thirdConv, c.report.thirdDownConv, 'thirdDownConv');
    if (c.report.fourthDownAtt !== t.fourthAtt) fail(seed, 'fourth-down attempts', t.fourthAtt, c.report.fourthDownAtt, 'fourthDownAtt');
    if (c.report.fourthDownConv !== t.fourthConv) fail(seed, 'fourth-down conversions', t.fourthConv, c.report.fourthDownConv, 'fourthDownConv');
    if (c.report.turnoverOnDowns !== t.turnoverOnDowns) fail(seed, 'turnovers on downs', t.turnoverOnDowns, c.report.turnoverOnDowns, 'turnoverOnDowns');

    // --- the box score ---
    ['passing', 'rushing', 'receiving'].forEach(section => {
      const keys = new Set([...Object.keys(t.box[section]), ...Object.keys(c.box[section])]);
      keys.forEach(num => {
        const a = t.box[section][num], b = c.box[section][num];
        if (!a || !b) { fail(seed, 'a player appears in one box score and not the other', !!a, !!b, section + ' #' + num); return; }
        Object.keys(a).forEach(stat => {
          if (Math.abs(a[stat] - b[stat]) > 0.05) fail(seed, section + ' ' + stat, a[stat], b[stat], section + ' #' + num + '.' + stat);
        });
      });
    });
  }

  console.log(GAMES + ' games, ' + checks + ' plays checked.');
  if (pageErrs.length) console.log('PAGE ERRORS: ' + [...new Set(pageErrs)].join(' | '));
  if (!found.length) console.log('No disagreements.');
  else {
    console.log('\n' + found.length + ' distinct disagreement(s):\n');
    found.forEach(f => {
      console.log('  ' + f.where + ' -- ' + f.what);
      console.log('      reference says ' + JSON.stringify(f.expected) + ', engine says ' + JSON.stringify(f.actual));
      console.log('      first seen at seed ' + f.seed + ', hit ' + f.count + ' time(s)\n');
    });
  }
  await browser.close();
  process.exit(found.length || pageErrs.length ? 1 : 0);
})();
