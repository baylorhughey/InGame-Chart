/*
 * Total offence is rushing yards plus passing yards. Penalty yardage is not
 * offence and a penalty is not a play from scrimmage -- that is how every
 * official box score in football is kept, and it is the line that goes to
 * the paper. Check the team line against the box score it should agree with.
 */
const { chromium } = require('playwright');
const APP_URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const { simulate } = require('./reference.js');
const GAMES = Number(process.argv[2] || 200);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  await page.goto(APP_URL);

  let bad = 0, worstY = 0, worstP = 0, sample = null, total = 0;
  for (let seed = 1; seed <= GAMES; seed++) {
    const sim = simulate(seed);
    const r = await page.evaluate(({ plays, drives }) => {
      const M = FB.Model, E = FB.Engine;
      const game = M.makeGame({ name: 'T', opponent: 'X' }); game.id = 'g';
      game.drives = drives.map(d => { const x = M.makeDrive({ gameId: 'g', startSpot: d.startSpot }); x.id = d.id; x.manualEnd = d.manualEnd; return x; });
      game.plays = plays.map(p => { const m = p.kind === 'pat' ? M.makePat({ gameId: 'g', driveId: p.driveId, good: p.patGood }) : M.makePlay(p); m.id = p.id; return m; });
      const c = E.computeGame(game);
      let rush = 0, pass = 0;
      Object.keys(c.box.rushing).forEach(n => rush += c.box.rushing[n].yards);
      Object.keys(c.box.passing).forEach(n => pass += c.box.passing[n].yards);
      // Plays from scrimmage: a flag that wiped the play is not one of them.
      const scrimmage = game.plays.filter(p => {
        const row = c.rows[p.id];
        if (!row || p.kind === 'pat' || p.isTwoPoint) return false;
        return !(p.playType === 'penalty' && p.penalty && !p.penalty.beyondLOS);
      }).length;
      const flags = game.plays.filter(p => p.playType === 'penalty' && p.penalty && !p.penalty.beyondLOS).length;
      return {
        teamPlays: c.totals.plays, teamYards: Math.round(c.totals.yards * 10) / 10,
        boxOffense: Math.round((rush + pass) * 10) / 10,
        scrimmage, flags, ypp: c.report.yardsPerPlay
      };
    }, { plays: sim.plays, drives: sim.drives });

    total++;
    const dy = Math.round((r.teamYards - r.boxOffense) * 10) / 10;
    const dp = r.teamPlays - r.scrimmage;
    if (dy !== 0 || dp !== 0) {
      bad++;
      if (Math.abs(dy) > Math.abs(worstY)) { worstY = dy; sample = { seed, ...r, dy, dp }; }
      if (Math.abs(dp) > Math.abs(worstP)) worstP = dp;
    }
  }
  console.log(total + ' games.');
  console.log('games where the team line disagrees with its own box score: ' + bad + '/' + total);
  console.log('worst yardage gap: ' + worstY + ' yards   worst play-count gap: ' + worstP + ' plays');
  if (sample) {
    console.log('\nworst game (seed ' + sample.seed + '):');
    console.log('  team line says      ' + sample.teamPlays + ' plays, ' + sample.teamYards + ' yards  (' + sample.ypp + ' per play)');
    console.log('  its own box score   ' + sample.scrimmage + ' plays, ' + sample.boxOffense + ' yards  (' +
      (Math.round(sample.boxOffense / sample.scrimmage * 10) / 10) + ' per play)');
    console.log('  flags in that game: ' + sample.flags);
  }
  await browser.close();
})();
