/*
 * An independent model of a charted game.
 *
 * Written from the rules of football and the stat conventions in README.md --
 * deliberately NOT from the engine. Every bug the coach has found so far got
 * past a test whose expected answer I had read off the code I was testing.
 * This simulates a game, keeps its own truth as it goes, and emits the play
 * list a coach would have typed to describe it. The engine then has to
 * rediscover that truth from the play list alone.
 */

function makeRnd(seed) {
  var s = seed >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

var NUMS = ['3', '12', '22', '80', '11', '7'];

function round1(n) { return Math.round(n * 10) / 10; }
function toSigned(fp) { return fp <= 50 ? -fp : (100 - fp); }
function clampFp(fp) { return fp < 0 ? 0 : (fp > 100 ? 100 : round1(fp)); }
/*
 * Where a ball can be downed and then snapped again. Nobody snaps from their
 * own goal line -- a ball downed there is a safety, and the end zone is a
 * touchdown -- so a play that merely continues the drive ends between the
 * one-yard lines.
 */
function liveFp(fp) { var c = clampFp(fp); return c < 1 ? 1 : (c > 99 ? 99 : c); }

function blankPass() { return { att: 0, comp: 0, yards: 0, td: 0, int: 0, sacks: 0 }; }
function blankRush() { return { carries: 0, yards: 0, td: 0 }; }
function blankRec() { return { rec: 0, yards: 0, td: 0 }; }
function slot(map, key, blank) {
  if (!key) return null;
  if (!map[key]) map[key] = blank();
  return map[key];
}

/*
 * Simulate one game and return both halves of the problem:
 *   charted - what the coach typed, which is all the engine ever sees
 *   truth   - what actually happened, kept as the game was invented
 */
function simulate(seed, opts) {
  opts = opts || {};
  var rnd = makeRnd(seed);
  function pick(list) { return list[Math.floor(rnd() * list.length) % list.length]; }
  function between(lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }

  var plays = [];          // charted
  var drives = [];         // charted
  var truth = {
    rows: [],              // one per live play, in order
    drives: [],
    box: { passing: {}, rushing: {}, receiving: {} },
    firstDowns: 0,
    points: 0,
    thirdAtt: 0, thirdConv: 0,
    fourthAtt: 0, fourthConv: 0,
    turnoverOnDowns: 0,
    plays: 0, yards: 0
  };
  var pid = 0;
  var driveCount = between(opts.minDrives || 4, opts.maxDrives || 9);

  for (var di = 0; di < driveCount; di++) {
    var startFp = between(2, 92);
    var driveId = 'd' + di;
    drives.push({ id: driveId, startSpot: toSigned(startFp), manualEnd: null });

    var down = 1;
    var ltg = Math.min(startFp + 10, 100);
    var ball = startFp;
    var ended = null;
    var driveRows = [];
    var drivePlays = [];
    var points = 0;

    for (var n = 0; n < 14 && !ended; n++) {
      var snapFp = ball;
      var row = {
        down: down,
        distance: round1(Math.max(0, ltg - snapFp)),
        goalToGo: ltg >= 100,
        snapFp: snapFp,
        firstDown: false,
        driveEnd: null
      };

      // ---- choose what happened -------------------------------------
      var kind = chooseKind(rnd, snapFp, down, n);
      var play = { id: 'p' + (pid++), gameId: 'g', driveId: driveId };
      var endFp, statYards, wiped = false, autoFirst = false, replays = false;

      if (kind === 'td') {
        endFp = 100;
        statYards = round1(100 - snapFp);
        play.td = true;
        var tdType = pick(['run', 'pass']);
        if (tdType === 'run') { play.playType = 'run'; play.carrier = pick(NUMS); }
        else { play.playType = 'pass'; play.passOutcome = 'complete'; play.qb = '12'; play.receiver = pick(NUMS); }
      } else if (kind === 'safety') {
        endFp = 0;
        statYards = round1(0 - snapFp);
        play.playType = 'safety';
        play.carrier = pick(NUMS);
      } else if (kind === 'incomplete') {
        endFp = snapFp;
        statYards = 0;
        play.playType = 'pass'; play.passOutcome = 'incomplete'; play.qb = '12';
      } else if (kind === 'interception') {
        endFp = snapFp;
        statYards = 0;
        play.playType = 'pass'; play.passOutcome = 'intercepted'; play.qb = '12';
        play.turnover = 'interception';
      } else if (kind === 'fumble') {
        endFp = liveFp(snapFp + between(-3, 14));
        statYards = round1(endFp - snapFp);
        play.playType = 'run'; play.carrier = pick(NUMS); play.turnover = 'fumble';
      } else if (kind === 'sack') {
        endFp = liveFp(snapFp - between(1, 9));
        statYards = round1(endFp - snapFp);
        play.playType = 'sack'; play.qb = '12';
      } else if (kind === 'scramble') {
        endFp = liveFp(snapFp + between(-2, 16));
        statYards = round1(endFp - snapFp);
        play.playType = 'pass'; play.passOutcome = 'scramble'; play.qb = '12';
      } else if (kind === 'penalty') {
        wiped = true;
        var on = rnd() < 0.5 ? 'us' : 'them';
        // The officials put the ball somewhere; the chart only learns where.
        endFp = on === 'us'
          ? liveFp(snapFp - between(1, Math.max(1, Math.min(15, Math.round(snapFp / 2)))))
          : liveFp(snapFp + between(1, Math.max(1, Math.min(15, Math.round((100 - snapFp) / 2)))));
        statYards = 0;
        autoFirst = on === 'them' && rnd() < 0.3;
        replays = true;
        play.playType = 'penalty';
        play.penalty = { on: on, autoFirst: autoFirst, beyondLOS: false, underlyingType: 'none', creditedYards: 0, endedAt: null, yards: null };
      } else if (kind === 'penalty-stood') {
        // A dead-ball foul: the play counted, the flag went on top of it.
        var under = pick(['run', 'pass']);
        statYards = between(-2, 18);
        endFp = liveFp(snapFp + between(-12, 12));
        play.playType = 'penalty';
        play.penalty = {
          on: pick(['us', 'them']), autoFirst: false, beyondLOS: true,
          underlyingType: under, creditedYards: statYards, endedAt: null, yards: null
        };
        if (under === 'run') play.carrier = pick(NUMS);
        else { play.passOutcome = 'complete'; play.qb = '12'; play.receiver = pick(NUMS); }
      } else if (kind === 'complete') {
        endFp = liveFp(snapFp + between(-2, 24));
        statYards = round1(endFp - snapFp);
        play.playType = 'pass'; play.passOutcome = 'complete'; play.qb = '12'; play.receiver = pick(NUMS);
      } else { // run
        endFp = liveFp(snapFp + between(-4, 18));
        statYards = round1(endFp - snapFp);
        play.playType = 'run'; play.carrier = pick(NUMS);
      }

      play.spot = toSigned(snapFp);
      row.endFp = endFp;
      row.yards = round1(endFp - snapFp);
      row.statYards = statYards;
      row.kind = kind;

      // ---- the rules ------------------------------------------------
      // A play that ends the drive ends it. A touchdown reaches the end zone,
      // which is at or past the marker every time, so it earned a first down;
      // a turnover did not, whatever the yardage.
      if (kind === 'td') { row.driveEnd = 'td'; ended = 'td'; row.firstDown = true; points += 6; }
      else if (kind === 'safety') { row.driveEnd = 'safety'; ended = 'safety'; }
      else if (kind === 'fumble') { row.driveEnd = 'fumble'; ended = 'fumble'; }
      else if (kind === 'interception') { row.driveEnd = 'interception'; ended = 'interception'; }
      else {
        ball = endFp;
        if (autoFirst || endFp >= ltg) {
          row.firstDown = true;
          down = 1;
          ltg = Math.min(endFp + 10, 100);
        } else if (replays) {
          // An accepted penalty replays the down. The marker does not move.
        } else {
          down += 1;
          if (down > 4) { row.driveEnd = 'downs'; ended = 'downs'; down = 4; }
        }
      }
      if (kind === 'td' || kind === 'safety' || kind === 'fumble' || kind === 'interception') ball = endFp;

      // ---- the numbers this play is worth ---------------------------
      if (row.firstDown) truth.firstDowns += 1;
      truth.plays += 1;
      truth.yards = round1(truth.yards + row.yards);
      if (!wiped) creditReference(truth.box, play, statYards);

      // A standalone penalty replays the down, so it was never an attempt.
      if (!wiped) {
        var converted = row.firstDown || kind === 'td';
        if (row.down === 3) { truth.thirdAtt += 1; if (converted) truth.thirdConv += 1; }
        if (row.down === 4) { truth.fourthAtt += 1; if (converted) truth.fourthConv += 1; }
      }

      driveRows.push(row);
      drivePlays.push(play);
      plays.push(play);
      truth.rows.push(row);
    }

    // The last play of a drive has no next snap to measure it against, so the
    // coach states where the ball finished -- except a touchdown, whose
    // endpoint is the end zone and needs no stating.
    var lastPlay = drivePlays[drivePlays.length - 1];
    var lastRow = driveRows[driveRows.length - 1];
    if (lastPlay && !lastPlay.td) lastPlay.endSpot = toSigned(lastRow.endFp);

    // Nothing ended it on its own: the coach says how it ended.
    if (!ended) {
      var manual = pick(['punt', 'punt', 'missed-fg', 'fg-good', 'half']);
      drives[drives.length - 1].manualEnd = { reason: manual, at: '2026-01-01T00:00:00.000Z' };
      ended = manual;
      if (manual === 'fg-good') points += 3;
    }
    if (ended === 'downs') truth.turnoverOnDowns += 1;

    // The try, after a touchdown.
    if (ended === 'td') {
      var good = rnd() < 0.85;
      plays.push({ id: 'p' + (pid++), gameId: 'g', driveId: driveId, kind: 'pat', playType: 'pat', patGood: good });
      if (good) points += 1;
    }

    truth.points += points;
    truth.drives.push({ ended: ended, rows: driveRows, points: points });
  }

  return { plays: plays, drives: drives, truth: truth };
}

function chooseKind(rnd, snapFp, down, n) {
  var r = rnd();
  // Near the goal line a score is live; deep in our own end a safety is.
  if (snapFp >= 88 && r < 0.3) return 'td';
  if (snapFp <= 4 && r < 0.06) return 'safety';
  if (r < 0.30) return 'run';
  if (r < 0.46) return 'complete';
  if (r < 0.58) return 'incomplete';
  if (r < 0.65) return 'sack';
  if (r < 0.71) return 'scramble';
  if (r < 0.83) return 'penalty';
  if (r < 0.87) return 'penalty-stood';
  if (r < 0.91) return 'fumble';
  if (r < 0.95) return 'interception';
  return 'td';
}

/*
 * The stat conventions, from README.md:
 *   a sack is a QB rush attempt at a loss plus a sack in the passing line,
 *   never a pass attempt; a scramble is a rush, never a pass attempt;
 *   an interception is an attempt with no completion and no yardage;
 *   a wiped penalty credits nobody.
 */
function creditReference(box, p, yards) {
  var pen = p.penalty || null;
  var type = p.playType;
  var outcome = p.passOutcome;

  if (pen) {
    if (!pen.beyondLOS) return;
    type = pen.underlyingType === 'pass' ? 'pass' : (pen.underlyingType === 'run' ? 'run' : null);
    if (!type) return;
    if (type === 'pass' && !outcome) outcome = 'complete';
  }

  if (type === 'safety') {
    var sc = slot(box.rushing, p.carrier, blankRush);
    if (sc) { sc.carries += 1; sc.yards = round1(sc.yards + yards); }
    return;
  }
  if (type === 'run') {
    var r = slot(box.rushing, p.carrier, blankRush);
    if (r) { r.carries += 1; r.yards = round1(r.yards + yards); if (p.td) r.td += 1; }
    return;
  }
  if (type === 'sack') {
    var sq = slot(box.passing, p.qb, blankPass);
    if (sq) sq.sacks += 1;
    var sr = slot(box.rushing, p.qb, blankRush);
    if (sr) { sr.carries += 1; sr.yards = round1(sr.yards + yards); }
    return;
  }
  if (type === 'pass') {
    if (outcome === 'scramble') {
      var s2 = slot(box.rushing, p.qb, blankRush);
      if (s2) { s2.carries += 1; s2.yards = round1(s2.yards + yards); if (p.td) s2.td += 1; }
      return;
    }
    var q = slot(box.passing, p.qb, blankPass);
    if (q) {
      q.att += 1;
      if (outcome === 'complete') {
        q.comp += 1;
        q.yards = round1(q.yards + yards);
        if (p.td) q.td += 1;
      }
      if (outcome === 'intercepted') q.int += 1;
    }
    if (outcome === 'complete') {
      var rc = slot(box.receiving, p.receiver, blankRec);
      if (rc) { rc.rec += 1; rc.yards = round1(rc.yards + yards); if (p.td) rc.td += 1; }
    }
  }
}

module.exports = { simulate: simulate, makeRnd: makeRnd, toSigned: toSigned };
