/*
 * engine.js — pure logic for the offensive chart.
 *
 * No DOM, no storage, no globals beyond FB.Engine. Everything the app shows
 * (down, distance, yards, box score, team score) is DERIVED from the play log
 * by the functions in this file, so a correction anywhere ripples forward for
 * free. Loaded as a classic script (no modules) so index.html works from
 * file:// on a USB drive; also loadable in node for the test suite.
 */
;(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) { global.FB = global.FB || {}; global.FB.Engine = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- *
   * Field position
   *
   * The coach writes a signed yard line, exactly like the paper chart:
   *   -13  = our own 13        (negative: our side, from OUR goal line)
   *   +35  = their 35          (positive: their side, from THEIR goal line)
   * Internally everything is a single 0-100 scale measuring how far the ball
   * has travelled from our own goal line, so yardage is plain subtraction.
   * ---------------------------------------------------------------- */

  function fieldPos(v) { return v < 0 ? -v : (100 - v); }

  // Inverse of fieldPos. 50 comes back as -50 (midfield, displayed as "50").
  function toSigned(fp) { return fp <= 50 ? -fp : (100 - fp); }

  function round1(n) { return Math.round(n * 10) / 10; }

  function num(n) {
    var r = round1(n);
    return (Math.abs(r % 1) < 1e-9) ? String(Math.round(r)) : String(r);
  }

  // Display form of a signed yard line: "-13", "+35", "50", "GL", "END ZONE".
  function formatSpot(v) {
    if (v == null || isNaN(v)) return '--';
    var fp = fieldPos(v);
    if (fp >= 100) return 'THEIR GL';
    if (fp <= 0) return 'OUR GL';
    if (Math.abs(v) === 50) return '50';
    return (v < 0 ? '-' : '+') + num(Math.abs(v));
  }

  /*
   * Accepts what a coach would actually type:
   *   -13  13-  o13  own13   -> our side
   *   +35  35+  t35  opp35   -> their side
   *   50                     -> midfield
   * A bare number other than 50 is rejected on purpose: guessing the side
   * would silently corrupt every yardage number downstream.
   */
  function parseSpot(text) {
    if (text == null) return { ok: false, error: 'Enter a yard line' };
    var s = String(text).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return { ok: false, error: 'Enter a yard line' };

    var side = 0; // -1 ours, +1 theirs
    var m;
    if ((m = s.match(/^(?:-|own|o)(\d+(?:\.\d+)?)$/))) { side = -1; s = m[1]; }
    else if ((m = s.match(/^(?:\+|opp|their|them|t)(\d+(?:\.\d+)?)$/))) { side = 1; s = m[1]; }
    else if ((m = s.match(/^(\d+(?:\.\d+)?)-$/))) { side = -1; s = m[1]; }
    else if ((m = s.match(/^(\d+(?:\.\d+)?)\+$/))) { side = 1; s = m[1]; }
    else if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) { s = m[1]; }
    else return { ok: false, error: 'Use -13 (ours) or +35 (theirs)' };

    var n = parseFloat(s);
    if (isNaN(n)) return { ok: false, error: 'Use -13 (ours) or +35 (theirs)' };
    if (n < 0 || n > 50) return { ok: false, error: 'Yard line must be 0-50' };
    if (side === 0) {
      if (n === 50) return { ok: true, value: -50 };
      return { ok: false, error: 'Add - (ours) or + (theirs)' };
    }
    return { ok: true, value: side * n };
  }

  /* ---------------------------------------------------------------- *
   * Penalties: half the distance to the goal, enforced automatically.
   * ---------------------------------------------------------------- */

  // enfFp: field position the penalty is walked off from.
  // on: 'us' (ball moves toward our goal) | 'them' (toward their goal).
  function penaltyDelta(enfFp, on, yards) {
    var y = Math.abs(Number(yards) || 0);
    var toward = (on === 'us') ? -1 : 1;
    var remaining = (on === 'us') ? enfFp : (100 - enfFp);
    var half = remaining / 2;
    var capped = y > half ? half : y;
    return { delta: round1(toward * capped), yards: round1(capped), halved: y > half };
  }

  /* ---------------------------------------------------------------- *
   * Play helpers
   * ---------------------------------------------------------------- */

  function isConversion(p) { return p.kind === 'pat' || p.isTwoPoint === true; }
  function isSnap(p) { return p.kind !== 'pat'; }

  // Plays that count toward down & distance and the box score.
  function isLive(p) { return isSnap(p) && !p.isTwoPoint; }

  function penaltyOf(p) { return (p.playType === 'penalty' && p.penalty) ? p.penalty : null; }

  // A standalone (line-of-scrimmage) penalty wipes the play and repeats the
  // down. A "beyond the line of scrimmage" penalty has a real play under it,
  // so that play consumed the down and kept its stats.
  function isStandalonePenalty(p) {
    var pen = penaltyOf(p);
    return !!pen && !pen.beyondLOS;
  }

  function endsDriveReason(p) {
    if (p.playType === 'safety') return 'safety';
    if (p.turnover === 'fumble') return 'fumble';
    if (p.turnover === 'interception') return 'interception';
    if (p.td) return 'td';
    return null;
  }

  /*
   * Resolve one play's yardage.
   *
   * Order of precedence:
   *   1. overrides.yards   - the coach typed a yardage by hand; never clobbered
   *   2. endSpot           - "resolve last play" with a final yard line
   *   3. TD                - endpoint is known: 100 - fieldPos(snap)
   *   4. immediate zeros   - incomplete / spike / interception
   *   5. penalty math      - self-resolving from the stated yardage
   *   6. next play's snap spot in this drive
   *   7. pending
   */
  function resolvePlay(p, nextPlay) {
    var snapFp = fieldPos(p.spot);
    var ov = p.overrides || {};
    var pen = penaltyOf(p);
    var out = {
      snapFp: snapFp, endFp: null, yards: null, statYards: 0,
      pending: false, halved: false, penaltyYards: 0
    };

    var ovYards = optNum(ov.yards);
    if (ovYards != null) {
      out.yards = round1(ovYards);
      out.endFp = clampFp(snapFp + out.yards);
      out.statYards = pen ? (pen.beyondLOS ? creditedYards(p) : 0) : out.yards;
      return out;
    }

    if (pen) {
      // Beyond the LOS: the underlying play happened, so credited yards move
      // the ball first and the flag is walked off from there.
      var credited = pen.beyondLOS ? creditedYards(p) : 0;
      var enfFp = clampFp(snapFp + credited);
      var d = penaltyDelta(enfFp, pen.on, pen.yards);
      out.penaltyYards = d.delta;
      out.halved = d.halved;
      out.endFp = clampFp(enfFp + d.delta);
      out.yards = round1(out.endFp - snapFp);
      out.statYards = pen.beyondLOS ? credited : 0;
      return out;
    }

    if (p.playType === 'safety') {
      out.endFp = 0;
      out.yards = round1(0 - snapFp);
      out.statYards = out.yards;
      return out;
    }

    if (p.td) {
      out.endFp = 100;
      out.yards = round1(100 - snapFp);
      out.statYards = out.yards;
      return out;
    }

    if (p.endSpot != null) {
      out.endFp = clampFp(fieldPos(p.endSpot));
      out.yards = round1(out.endFp - snapFp);
      out.statYards = out.yards;
      return out;
    }

    if (p.playType === 'pass' &&
        (p.passOutcome === 'incomplete' || p.passOutcome === 'intercepted')) {
      out.endFp = snapFp;
      out.yards = 0;
      return out;
    }

    // Run / complete pass / scramble / sack / kneel: pending until the next
    // snap spot in this drive tells us where the ball ended up.
    if (nextPlay) {
      out.endFp = clampFp(fieldPos(nextPlay.spot));
      out.yards = round1(out.endFp - snapFp);
      out.statYards = out.yards;
      return out;
    }

    out.pending = true;
    return out;
  }

  // Overrides can arrive from an imported or hand-edited file, where a junk
  // value would otherwise turn every number after it into NaN.
  function optNum(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function creditedYards(p) {
    var pen = penaltyOf(p);
    if (!pen) return 0;
    var v = Number(pen.creditedYards);
    return isNaN(v) ? 0 : round1(v);
  }

  function clampFp(fp) { return fp < 0 ? 0 : (fp > 100 ? 100 : round1(fp)); }

  /* ---------------------------------------------------------------- *
   * Drive walk: down & distance, drive result.
   * ---------------------------------------------------------------- */

  /*
   * plays: every play charted in this drive, in order (PATs and 2-point
   * tries are filtered out here - they never touch down & distance).
   *
   * lineToGain is carried as a field position and capped at 100, which is all
   * goal-to-go is: the marker can't be past the goal line.
   */
  function computeDrive(drive, allPlays) {
    var plays = allPlays.filter(isLive);
    var startFp = clampFp(fieldPos(drive.startSpot));
    var down = 1;
    var ltg = Math.min(startFp + 10, 100);
    var ballFp = startFp;
    var ended = null;      // reason the drive ended
    var endedByPlayId = null;
    var pending = false;
    var rows = [];

    for (var i = 0; i < plays.length; i++) {
      var p = plays[i];
      var next = plays[i + 1] || null;
      var ov = p.overrides || {};
      var snapFp = clampFp(fieldPos(p.spot));

      // Hand-corrected down/distance are respected, and the auto-logic picks
      // back up from whatever the coach entered.
      var ovDown = optNum(ov.down);
      var ovDist = optNum(ov.distance);
      if (ovDown != null) down = Math.max(1, Math.min(4, ovDown));
      if (ovDist != null) ltg = Math.min(snapFp + ovDist, 100);

      var dist = round1(ltg - snapFp);
      if (dist < 0) dist = 0;
      var goalToGo = ltg >= 100;

      var r = resolvePlay(p, next);
      var row = {
        id: p.id,
        index: i,
        down: down,
        distance: dist,
        goalToGo: goalToGo,
        spot: p.spot,
        snapFp: snapFp,
        endFp: r.endFp,
        yards: r.yards,
        statYards: r.statYards,
        pending: r.pending,
        halved: r.halved,
        penaltyYards: r.penaltyYards,
        firstDown: false,
        driveEnd: null
      };

      if (r.pending) {
        pending = true;
        rows.push(row);
        ballFp = snapFp;
        break; // nothing downstream can be known yet
      }

      ballFp = r.endFp;
      var reason = endsDriveReason(p);

      if (reason) {
        row.driveEnd = reason;
        if (!ended) { ended = reason; endedByPlayId = p.id; }
      } else {
        var pen = penaltyOf(p);
        var autoFirst = !!(pen && pen.autoFirst);
        if (autoFirst || ballFp >= ltg) {
          row.firstDown = true;
          down = 1;
          ltg = Math.min(ballFp + 10, 100);
        } else if (isStandalonePenalty(p)) {
          // Repeats the down. The marker doesn't move - only the ball does.
        } else {
          down += 1;
          if (down > 4) {
            row.driveEnd = 'downs';
            if (!ended) { ended = 'downs'; endedByPlayId = p.id; }
            down = 4;
          }
        }
      }

      rows.push(row);
    }

    // A manual end (punt, missed FG, clock) only counts if no play already
    // ended the drive.
    if (!ended && drive.manualEnd) ended = drive.manualEnd.reason;

    // Only the last conversion on a drive counts. Entering one again corrects
    // the first rather than scoring twice.
    var conversions = allPlays.filter(isConversion);
    var points = 0;
    var conv = null;
    if (conversions.length) {
      var cp = conversions[conversions.length - 1];
      if (cp.kind === 'pat') { conv = { type: 'kick', good: !!cp.patGood, id: cp.id }; if (cp.patGood) points += 1; }
      else { conv = { type: 'two', good: !!cp.td, id: cp.id }; if (cp.td) points += 2; }
    }
    if (ended === 'td') points += 6;

    var net = 0, live = 0;
    for (var k = 0; k < rows.length; k++) {
      if (rows[k].yards != null) net = round1(net + rows[k].yards);
      live++;
    }

    return {
      drive: drive,
      rows: rows,
      startFp: startFp,
      ballFp: ballFp,
      down: down,
      lineToGain: ltg,
      distance: Math.max(0, round1(ltg - ballFp)),
      goalToGo: ltg >= 100,
      pending: pending,
      ended: ended,
      endedByPlayId: endedByPlayId,
      // A scored TD whose extra point was never recorded. Stays true after a
      // skip so the drive review can still offer it - a point that never got
      // entered is otherwise lost for good.
      needsConversion: ended === 'td' && !conv,
      conversionSkipped: !!drive.conversionSkipped,
      conversion: conv,
      points: points,
      netYards: net,
      playCount: live
    };
  }

  /* ---------------------------------------------------------------- *
   * Box score
   * ---------------------------------------------------------------- */

  function blankPass() { return { att: 0, comp: 0, yards: 0, td: 0, int: 0, sacks: 0 }; }
  function blankRush() { return { carries: 0, yards: 0, td: 0 }; }
  function blankRec() { return { rec: 0, yards: 0, td: 0 }; }

  function bucket(map, numText, blank) {
    var key = String(numText == null ? '' : numText).trim();
    if (!key) return null;           // no jersey number, nobody to credit
    if (!map[key]) map[key] = blank();
    return map[key];
  }

  /*
   * Credits one resolved play to the right players.
   *
   * Conventions (high-school / NCAA style, which is what a sideline chart
   * is keeping):
   *  - a sack is a rush attempt for the QB at a loss, plus a sack in the
   *    passing line; it is NOT a pass attempt. Intentional grounding is
   *    charted as a sack for exactly this reason.
   *  - a scramble counts as a rush for the QB, not a pass attempt.
   *  - a play wiped by a line-of-scrimmage penalty credits nobody.
   *  - a 2-point try never touches the box score.
   */
  function creditPlay(box, p, row) {
    if (!isLive(p) || !row || row.pending) return;
    var pen = penaltyOf(p);
    if (pen && !pen.beyondLOS) return;            // stats wiped

    var yards = row.statYards || 0;
    var td = !!p.td;
    var type = p.playType;
    var outcome = p.passOutcome;

    if (pen) {                                     // beyond the LOS
      type = (pen.underlyingType === 'pass') ? 'pass' : (pen.underlyingType === 'run' ? 'run' : null);
      if (!type) return;
      if (type === 'pass' && !outcome) outcome = 'complete';
    }

    if (type === 'safety') {
      var sc = bucket(box.rushing, p.carrier, blankRush);
      if (sc) { sc.carries += 1; sc.yards = round1(sc.yards + yards); }
      return;
    }

    if (type === 'run') {
      var r = bucket(box.rushing, p.carrier, blankRush);
      if (r) { r.carries += 1; r.yards = round1(r.yards + yards); if (td) r.td += 1; }
      return;
    }

    if (type === 'sack') {
      var sq = bucket(box.passing, p.qb, blankPass);
      if (sq) sq.sacks += 1;
      var sr = bucket(box.rushing, p.qb, blankRush);
      if (sr) { sr.carries += 1; sr.yards = round1(sr.yards + yards); }
      return;
    }

    if (type === 'pass') {
      if (outcome === 'scramble') {
        var sc2 = bucket(box.rushing, p.qb, blankRush);
        if (sc2) { sc2.carries += 1; sc2.yards = round1(sc2.yards + yards); if (td) sc2.td += 1; }
        return;
      }
      var q = bucket(box.passing, p.qb, blankPass);
      if (q) {
        q.att += 1;
        if (outcome === 'complete') {
          q.comp += 1;
          q.yards = round1(q.yards + yards);
          if (td) q.td += 1;
        } else if (outcome === 'intercepted') {
          q.int += 1;
        }
      }
      if (outcome === 'complete') {
        var w = bucket(box.receiving, p.receiver, blankRec);
        if (w) { w.rec += 1; w.yards = round1(w.yards + yards); if (td) w.td += 1; }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Whole-game computation - the one function the UI calls.
   * ---------------------------------------------------------------- */

  function computeGame(game) {
    var drives = [];
    var rowsById = {};
    var box = { passing: {}, rushing: {}, receiving: {} };
    var score = 0;
    var playsByDrive = {};

    (game.plays || []).forEach(function (p) {
      (playsByDrive[p.driveId] = playsByDrive[p.driveId] || []).push(p);
    });

    (game.drives || []).forEach(function (drive) {
      var d = computeDrive(drive, playsByDrive[drive.id] || []);
      d.rows.forEach(function (row) { rowsById[row.id] = row; });
      score += d.points;
      drives.push(d);
    });

    (game.plays || []).forEach(function (p) { creditPlay(box, p, rowsById[p.id]); });

    var last = drives.length ? drives[drives.length - 1] : null;
    var current = {
      driveIndex: drives.length - 1,
      drive: last ? last.drive : null,
      down: last ? last.down : 1,
      distance: last ? last.distance : 10,
      goalToGo: last ? last.goalToGo : false,
      ballFp: last ? last.ballFp : null,
      ballSpot: last ? toSigned(last.ballFp) : null,
      pending: last ? last.pending : false,
      driveEnded: last ? last.ended : null,
      needsDrive: !last || !!last.ended,
      needsConversion: last ? (last.needsConversion && !last.conversionSkipped) : false,
      // What the next snap spot almost certainly is. Blank while pending.
      nextSpot: (last && !last.pending && !last.ended) ? toSigned(last.ballFp) : null
    };

    return {
      drives: drives,
      rows: rowsById,
      box: box,
      score: score,
      current: current,
      totals: totals(game, rowsById, drives)
    };
  }

  function totals(game, rows, drives) {
    var t = { plays: 0, yards: 0, firstDowns: 0, drives: drives.length, touchdowns: 0 };
    (game.plays || []).forEach(function (p) {
      var row = rows[p.id];
      if (!row || !isLive(p)) return;
      t.plays += 1;
      if (row.yards != null) t.yards = round1(t.yards + row.yards);
      if (row.firstDown) t.firstDowns += 1;
      if (p.td) t.touchdowns += 1;
    });
    return t;
  }

  function formatDownDistance(down, distance, goalToGo) {
    var ord = ['', '1st', '2nd', '3rd', '4th'][down] || String(down);
    if (goalToGo) return ord + ' & Goal';
    return ord + ' & ' + num(distance);
  }

  return {
    fieldPos: fieldPos,
    toSigned: toSigned,
    formatSpot: formatSpot,
    parseSpot: parseSpot,
    penaltyDelta: penaltyDelta,
    resolvePlay: resolvePlay,
    computeDrive: computeDrive,
    computeGame: computeGame,
    creditPlay: creditPlay,
    formatDownDistance: formatDownDistance,
    isLive: isLive,
    isConversion: isConversion,
    penaltyOf: penaltyOf,
    num: num,
    round1: round1
  };
});
