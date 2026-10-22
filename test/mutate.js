/*
 * The promises the README makes about going back and fixing something:
 *
 *   "Editing recalculates downstream, never crosses a drive boundary."
 *   "Undo last play" puts things back.
 *   Deleting a play leaves every other drive alone.
 *
 * None of that is checkable by knowing the right answer for a game -- it is a
 * claim about what a change does NOT touch. So: chart a game, snapshot it,
 * change one play, and check that everything outside that drive is identical
 * to the byte.
 */
const { chromium } = require('playwright');
const APP_URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const { simulate } = require('./reference.js');

const GAMES = Number(process.argv[2] || 150);
const found = [];
const seen = new Set();
function fail(seed, what, detail) {
  const key = what + '|' + detail;
  if (seen.has(key)) { found.find(f => f.key === key).count += 1; return; }
  seen.add(key);
  found.push({ key, count: 1, seed, what, detail });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const pageErrs = [];
  page.on('pageerror', e => pageErrs.push('' + e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrs.push(m.text()); });
  await page.goto(APP_URL);

  let edits = 0, deletes = 0, undos = 0;
  for (let seed = 1; seed <= GAMES; seed++) {
    const sim = simulate(seed, { minDrives: 3, maxDrives: 6 });
    const res = await page.evaluate(({ plays, drives, seed }) => {
      const M = FB.Model, E = FB.Engine;
      function build() {
        const game = M.makeGame({ name: 'Mut', opponent: 'X' });
        game.id = 'g';
        game.drives = drives.map(d => {
          const dr = M.makeDrive({ gameId: 'g', startSpot: d.startSpot });
          dr.id = d.id; dr.manualEnd = d.manualEnd; return dr;
        });
        game.plays = plays.map(p => {
          const made = p.kind === 'pat'
            ? M.makePat({ gameId: 'g', driveId: p.driveId, good: p.patGood })
            : M.makePlay(p);
          made.id = p.id; return made;
        });
        return game;
      }
      // One drive's worth of computed output, as a string to compare exactly.
      function driveSig(c, i) {
        const d = c.drives[i];
        if (!d) return 'missing';
        return JSON.stringify({
          ended: d.ended, points: d.points,
          rows: d.rows.map(r => [r.id, r.down, r.distance, r.goalToGo, r.yards,
            r.statYards, r.firstDown, r.driveEnd, r.pending])
        });
      }
      function sigs(c) { return c.drives.map((_, i) => driveSig(c, i)); }

      const out = { editProblems: [], deleteProblems: [], undoProblems: [], edits: 0, deletes: 0, undos: 0 };
      let rng = seed * 2654435761 % 2147483647;
      const next = () => (rng = rng * 48271 % 2147483647) / 2147483647;

      // ---------- editing one play ----------
      for (let t = 0; t < 4; t++) {
        const game = build();
        const before = E.computeGame(game);
        const live = game.plays.filter(p => p.kind !== 'pat');
        if (!live.length) break;
        const target = live[Math.floor(next() * live.length) % live.length];
        const driveIdx = game.drives.findIndex(d => d.id === target.driveId);

        // A plausible edit: change who carried it, or pin a yardage by hand.
        const mode = next();
        if (mode < 0.34) target.carrier = '99';
        else if (mode < 0.67) { target.overrides = Object.assign({}, target.overrides, { yards: 4 }); }
        else { target.playCall = 'Edited'; }

        const after = E.computeGame(game);
        out.edits++;
        const b = sigs(before), a = sigs(after);
        if (b.length !== a.length) out.editProblems.push('drive count changed: ' + b.length + ' -> ' + a.length);
        for (let i = 0; i < Math.min(b.length, a.length); i++) {
          if (i !== driveIdx && b[i] !== a[i]) {
            out.editProblems.push('editing a play in drive ' + (driveIdx + 1) +
              ' changed drive ' + (i + 1));
          }
        }
      }

      // ---------- deleting one play ----------
      for (let t = 0; t < 3; t++) {
        const game = build();
        const before = E.computeGame(game);
        const live = game.plays.filter(p => p.kind !== 'pat');
        if (!live.length) break;
        const target = live[Math.floor(next() * live.length) % live.length];
        const driveIdx = game.drives.findIndex(d => d.id === target.driveId);
        game.plays = game.plays.filter(p => p.id !== target.id);
        const after = E.computeGame(game);
        out.deletes++;
        const b = sigs(before), a = sigs(after);
        for (let i = 0; i < Math.min(b.length, a.length); i++) {
          if (i !== driveIdx && b[i] !== a[i]) {
            out.deleteProblems.push('deleting a play in drive ' + (driveIdx + 1) +
              ' changed drive ' + (i + 1));
          }
        }
      }

      // ---------- add a play, then take it back ----------
      {
        const game = build();
        const beforeAll = JSON.stringify(sigs(E.computeGame(game)));
        const lastDrive = game.drives[game.drives.length - 1];
        const extra = M.makePlay({
          gameId: 'g', driveId: lastDrive.id, spot: -40, playType: 'run', carrier: '3'
        });
        game.plays.push(extra);
        E.computeGame(game);
        game.plays.pop();
        const afterAll = JSON.stringify(sigs(E.computeGame(game)));
        out.undos++;
        if (beforeAll !== afterAll) out.undoProblems.push('adding a play and removing it again did not restore the game');
      }

      return out;
    }, { plays: sim.plays, drives: sim.drives, seed });

    edits += res.edits; deletes += res.deletes; undos += res.undos;
    res.editProblems.forEach(d => fail(seed, 'an edit leaked across a drive boundary', d));
    res.deleteProblems.forEach(d => fail(seed, 'a delete leaked across a drive boundary', d));
    res.undoProblems.forEach(d => fail(seed, 'add-then-remove did not restore the game', d));
  }

  console.log(GAMES + ' games: ' + edits + ' edits, ' + deletes + ' deletes, ' + undos + ' add/removes.');
  if (pageErrs.length) console.log('PAGE ERRORS: ' + [...new Set(pageErrs)].join(' | '));
  if (!found.length) console.log('Every change stayed inside its own drive.');
  else {
    console.log('\n' + found.length + ' distinct problem(s):\n');
    found.forEach(f => console.log('  ' + f.what + '\n      ' + f.detail +
      '\n      first at seed ' + f.seed + ', hit ' + f.count + ' time(s)\n'));
  }
  await browser.close();
  process.exit(found.length || pageErrs.length ? 1 : 0);
})();
