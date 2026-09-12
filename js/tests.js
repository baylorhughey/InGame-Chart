/*
 * tests.js — runs in node (`node js/tests.js`) and in the browser
 * (open tests.html). Every expected number below is hand-checked against the
 * field-position formulas, not read off the implementation.
 */
;(function (global, factory) {
  var deps;
  if (typeof module === 'object' && module.exports) {
    deps = { Engine: require('./engine.js'), Model: require('./model.js') };
    module.exports = factory(deps);
    if (require.main === module) module.exports.run(function (line) { console.log(line); });
  } else {
    global.FB = global.FB || {};
    global.FB.Tests = factory({ Engine: global.FB.Engine, Model: global.FB.Model });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';
  var E = deps.Engine, M = deps.Model;

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function fail(msg) { throw new Error(msg); }
  function eq(actual, expected, what) {
    if (actual !== expected) fail((what || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
  function near(actual, expected, what) {
    if (Math.abs(Number(actual) - Number(expected)) > 1e-6) {
      fail((what || 'value') + ': expected ' + expected + ', got ' + actual);
    }
  }
  function ok(cond, what) { if (!cond) fail(what || 'expected true'); }

  /* ----- tiny game builder ------------------------------------------ */

  function Builder() {
    this.game = M.makeGame({ name: 'Test', opponent: 'Test' });
    this.drive = null;
  }
  Builder.prototype.startDrive = function (spot) {
    this.drive = M.makeDrive({ gameId: this.game.id, startSpot: spot });
    this.game.drives.push(this.drive);
    return this;
  };
  Builder.prototype.endDrive = function (reason) {
    this.drive.manualEnd = { reason: reason, at: M.nowIso() };
    return this;
  };
  Builder.prototype.play = function (attrs) {
    attrs.gameId = this.game.id;
    attrs.driveId = this.drive.id;
    var p = M.makePlay(attrs);
    this.game.plays.push(p);
    return p;
  };
  Builder.prototype.pat = function (good) {
    var p = M.makePat({ gameId: this.game.id, driveId: this.drive.id, good: good });
    this.game.plays.push(p);
    return p;
  };
  Builder.prototype.compute = function () { return E.computeGame(this.game); };

  function dd(row) { return E.formatDownDistance(row.down, row.distance, row.goalToGo); }

  /* ----- field position --------------------------------------------- */

  test('fieldPos matches the paper convention', function () {
    eq(E.fieldPos(-13), 13, 'our own 13');
    eq(E.fieldPos(35), 65, 'their 35');
    eq(E.fieldPos(-50), 50, 'midfield');
    eq(E.fieldPos(50), 50, 'midfield from the other sign');
    eq(E.fieldPos(-1), 1, 'our 1');
    eq(E.fieldPos(1), 99, 'their 1');
  });

  test('toSigned round-trips', function () {
    eq(E.toSigned(13), -13);
    eq(E.toSigned(65), 35);
    eq(E.toSigned(50), -50);
    eq(E.formatSpot(-13), '-13');
    eq(E.formatSpot(35), '+35');
    eq(E.formatSpot(-50), '50');
  });

  test('parseSpot accepts coach shorthand and refuses ambiguity', function () {
    eq(E.parseSpot('-13').value, -13);
    eq(E.parseSpot('+35').value, 35);
    eq(E.parseSpot('o13').value, -13);
    eq(E.parseSpot('opp35').value, 35);
    eq(E.parseSpot('35+').value, 35);
    eq(E.parseSpot('50').value, -50);
    eq(E.parseSpot('35').ok, false, 'bare number is ambiguous');
    eq(E.parseSpot('').ok, false);
    eq(E.parseSpot('+51').ok, false, 'past midfield on the wrong side');
  });

  /* ----- penalty half-the-distance ----------------------------------- */

  test('half the distance to the goal is enforced automatically', function () {
    // Our own 6 (fp 6), 10-yard foul on us: remaining 6, half 3 -> 3 yards.
    var a = E.penaltyDelta(6, 'us', 10);
    near(a.delta, -3, 'capped to half the distance');
    eq(a.halved, true);
    // Their 8 (fp 92), 15-yard foul on them: remaining 8, half 4 -> 4 yards.
    var b = E.penaltyDelta(92, 'them', 15);
    near(b.delta, 4);
    eq(b.halved, true);
    // Normal case, no cap.
    var c = E.penaltyDelta(40, 'us', 10);
    near(c.delta, -10);
    eq(c.halved, false);
  });

  /* ----- the hand-checked drive -------------------------------------- *
   * Ball on our own 25. Every number below was worked out on paper first.
   * -------------------------------------------------------------------- */

  test('full drive: run, pass, penalty, incomplete, sack, pass, TD, PAT', function () {
    var b = new Builder();
    b.startDrive(-25);                                   // 1st & 10 at -25 (fp 25, LTG 35)
    b.play({ spot: -25, playType: 'run', carrier: '22', formation: 'Trips Rt' });
    b.play({ spot: -31, playType: 'pass', passOutcome: 'complete', qb: '12', receiver: '80' });
    b.play({ spot: -45, playType: 'penalty', penalty: { on: 'us', yards: 10 } });
    b.play({ spot: -35, playType: 'pass', passOutcome: 'incomplete', qb: '12' });
    b.play({ spot: -35, playType: 'sack', qb: '12' });
    b.play({ spot: -28, playType: 'pass', passOutcome: 'complete', qb: '12', receiver: '11' });
    b.play({ spot: 40, playType: 'run', carrier: '22', td: true });
    b.pat(true);

    var g = b.compute();
    var d = g.drives[0];
    var r = d.rows;
    eq(r.length, 7, 'seven live plays (the PAT is not one)');

    // 1) run from -25, next snap -31 -> fp 31-25 = +6. 1st & 10.
    eq(dd(r[0]), '1st & 10'); near(r[0].yards, 6, 'run yards');
    // 2) pass from -31 (2nd & 4), next snap -45 -> fp 45-31 = +14 -> first down.
    eq(dd(r[1]), '2nd & 4'); near(r[1].yards, 14); eq(r[1].firstDown, true);
    // 3) holding on us at -45 (1st & 10): 10 back to -35, down REPEATS.
    eq(dd(r[2]), '1st & 10'); near(r[2].yards, -10); eq(r[2].firstDown, false);
    // 4) incomplete at -35: LTG is still fp 55, so 55-35 = 20 to go on 1st.
    eq(dd(r[3]), '1st & 20'); near(r[3].yards, 0);
    // 5) sack at -35 on 2nd & 20, next snap -28 -> 28-35 = -7.
    eq(dd(r[4]), '2nd & 20'); near(r[4].yards, -7);
    // 6) pass at -28 on 3rd: 55-28 = 27 to go. Next snap +40 -> 60-28 = +32.
    eq(dd(r[5]), '3rd & 27'); near(r[5].yards, 32); eq(r[5].firstDown, true);
    // 7) TD run from +40 (fp 60) -> 100-60 = 40 yards, drive over.
    eq(dd(r[6]), '1st & 10'); near(r[6].yards, 40); eq(r[6].driveEnd, 'td');

    eq(d.ended, 'td');
    eq(d.points, 7, 'TD plus a good PAT');
    eq(g.score, 7);
    near(d.netYards, 6 + 14 - 10 + 0 - 7 + 32 + 40, 'net drive yardage');

    // Box score, hand-tallied.
    var box = g.box;
    eq(box.rushing['22'].carries, 2); near(box.rushing['22'].yards, 46); eq(box.rushing['22'].td, 1);
    eq(box.rushing['12'].carries, 1, 'the sack is a QB rush attempt');
    near(box.rushing['12'].yards, -7);
    eq(box.passing['12'].att, 3, 'two completions and an incompletion');
    eq(box.passing['12'].comp, 2);
    near(box.passing['12'].yards, 46);
    eq(box.passing['12'].sacks, 1);
    eq(box.passing['12'].td, 0, 'the TD was a run');
    eq(box.receiving['80'].rec, 1); near(box.receiving['80'].yards, 14);
    eq(box.receiving['11'].rec, 1); near(box.receiving['11'].yards, 32);
    eq(g.totals.firstDowns, 2);
  });

  /* ----- down & distance edge cases ---------------------------------- */

  test('goal to go caps the distance at the goal line', function () {
    var b = new Builder();
    b.startDrive(8);                         // their 8: fp 92, marker capped at 100
    b.play({ spot: 8, playType: 'run', carrier: '5' });
    b.play({ spot: 3, playType: 'run', carrier: '5' });
    b.play({ spot: 1, playType: 'run', carrier: '5', td: true });
    var d = b.compute().drives[0];
    eq(d.rows[0].goalToGo, true);
    eq(dd(d.rows[0]), '1st & Goal');
    near(d.rows[0].distance, 8, 'eight to the end zone, not ten');
    near(d.rows[0].yards, 5);
    eq(dd(d.rows[1]), '2nd & Goal');
    near(d.rows[1].distance, 3);
    eq(dd(d.rows[2]), '3rd & Goal');
    near(d.rows[2].yards, 1, 'TD from their 1 is worth exactly one yard');
  });

  test('outside the 10 a first down is still ten yards, not goal to go', function () {
    var b = new Builder();
    b.startDrive(12);                        // their 12: fp 88, marker at their 2
    b.play({ spot: 12, playType: 'run', carrier: '5' });
    b.play({ spot: 3, playType: 'run', carrier: '5' });
    b.play({ spot: 2, playType: 'run', carrier: '5' });
    b.play({ spot: 2, playType: 'run', carrier: '5', td: true });
    var d = b.compute().drives[0];
    eq(d.rows[0].goalToGo, false);
    eq(dd(d.rows[0]), '1st & 10', 'the marker is their 2, so ten to go');
    near(d.rows[0].yards, 9);
    eq(dd(d.rows[1]), '2nd & 1', 'nine yards is not a first down here');
    near(d.rows[1].yards, 1);
    eq(d.rows[1].firstDown, true, 'the 2-yard line is the line to gain');
    eq(dd(d.rows[2]), '1st & Goal', 'a new set inside the 10 is goal to go');
    near(d.rows[2].distance, 2);
  });

  test('a new first down inside the 10 is goal to go', function () {
    var b = new Builder();
    b.startDrive(20);                         // fp 80, LTG 90
    b.play({ spot: 20, playType: 'run', carrier: '5' });   // to their 6 -> fp 94
    b.play({ spot: 6, playType: 'run', carrier: '5' });
    var d = b.compute().drives[0];
    eq(d.rows[0].firstDown, true);
    eq(dd(d.rows[1]), '1st & Goal');
    near(d.rows[1].distance, 6);
  });

  test('a standalone penalty repeats the down, an automatic first resets it', function () {
    var b = new Builder();
    b.startDrive(-20);
    b.play({ spot: -20, playType: 'run', carrier: '3' });             // to -24: +4, 2nd & 6
    b.play({ spot: -24, playType: 'penalty', penalty: { on: 'us', yards: 5 } });
    b.play({ spot: -19, playType: 'penalty', penalty: { on: 'them', yards: 5, autoFirst: true } });
    b.play({ spot: -24, playType: 'run', carrier: '3' });
    var d = b.compute().drives[0];
    eq(dd(d.rows[1]), '2nd & 6', 'penalty is charted on the down it happened');
    eq(dd(d.rows[2]), '2nd & 11', 'still 2nd down after a 5-yard foul on us');
    eq(dd(d.rows[3]), '1st & 10', 'automatic first down');
    near(d.rows[3].distance, 10);
  });

  test('a defensive penalty past the marker is a first down', function () {
    var b = new Builder();
    b.startDrive(-20);                                   // LTG fp 30
    b.play({ spot: -20, playType: 'run', carrier: '3' }); // to -28: +8 -> 2nd & 2
    b.play({ spot: -28, playType: 'penalty', penalty: { on: 'them', yards: 5 } });
    b.play({ spot: -33, playType: 'run', carrier: '3' });
    var d = b.compute().drives[0];
    eq(dd(d.rows[1]), '2nd & 2');
    eq(d.rows[1].firstDown, true, 'the 5 yards got past the line to gain');
    eq(dd(d.rows[2]), '1st & 10');
  });

  test('turnover on downs is detected, never selected', function () {
    var b = new Builder();
    b.startDrive(-30);
    b.play({ spot: -30, playType: 'run', carrier: '3' });      // +1 -> 2nd & 9
    b.play({ spot: -31, playType: 'run', carrier: '3' });      // +1 -> 3rd & 8
    b.play({ spot: -32, playType: 'pass', passOutcome: 'incomplete', qb: '12' }); // 4th & 8
    b.play({ spot: -32, playType: 'run', carrier: '3' });      // +2, short
    b.play({ spot: -34, playType: 'run', carrier: '3' });      // next drive's spot never comes
    var g = b.compute();
    var d = g.drives[0];
    eq(dd(d.rows[3]), '4th & 8');
    eq(d.rows[3].driveEnd, 'downs');
    eq(d.ended, 'downs');
  });

  test('a pending play stops the chain until it resolves', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'run', carrier: '3' });
    var g = b.compute();
    eq(g.drives[0].rows[0].pending, true);
    eq(g.drives[0].rows[0].yards, null);
    eq(g.current.pending, true);
    eq(g.current.nextSpot, null, 'no auto-fill while the ball is unresolved');
    eq(g.box.rushing['3'], undefined, 'pending plays credit nothing yet');
  });

  test('resolve-last-play with a final spot closes out the drive', function () {
    var b = new Builder();
    b.startDrive(-25);
    var p = b.play({ spot: -25, playType: 'run', carrier: '3' });
    p.endSpot = -34;                                   // resolved by hand
    b.endDrive('punt');
    var g = b.compute();
    near(g.drives[0].rows[0].yards, 9);
    eq(g.drives[0].ended, 'punt');
    eq(g.box.rushing['3'].carries, 1);
    near(g.box.rushing['3'].yards, 9);
  });

  test('an incomplete pass leaves the ball where it was', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'pass', passOutcome: 'incomplete', qb: '12' });
    var g = b.compute();
    near(g.drives[0].rows[0].yards, 0);
    eq(g.current.nextSpot, -25, 'next snap auto-fills with the same spot');
    eq(g.current.pending, false);
    eq(E.formatDownDistance(g.current.down, g.current.distance, g.current.goalToGo), '2nd & 10');
  });

  /* ----- play types and the box score --------------------------------- */

  test('a scramble is a rush for the QB, not a pass attempt', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'pass', passOutcome: 'scramble', qb: '12' });
    b.play({ spot: -33, playType: 'run', carrier: '3' });
    var g = b.compute();
    near(g.drives[0].rows[0].yards, 8);
    eq(g.box.passing['12'], undefined, 'no pass attempt charged');
    eq(g.box.rushing['12'].carries, 1);
    near(g.box.rushing['12'].yards, 8);
  });

  test('a sack (and intentional grounding charted as one) is a QB rush plus a sack', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'sack', qb: '12' });
    b.play({ spot: -18, playType: 'run', carrier: '3' });
    var g = b.compute();
    near(g.drives[0].rows[0].yards, -7);
    eq(g.box.passing['12'].att, 0, 'a sack is not a pass attempt');
    eq(g.box.passing['12'].sacks, 1);
    eq(g.box.rushing['12'].carries, 1);
    near(g.box.rushing['12'].yards, -7);
  });

  test('a line-of-scrimmage penalty wipes the play stats', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({
      spot: -25, playType: 'penalty', carrier: '3',
      penalty: { on: 'us', yards: 10, beyondLOS: false }
    });
    b.play({ spot: -15, playType: 'run', carrier: '3' });
    b.play({ spot: -20, playType: 'run', carrier: '3' });
    var g = b.compute();
    eq(g.box.rushing['3'].carries, 1, 'only the resolved run counts, not the wiped play');
    near(g.box.rushing['3'].yards, 5);
    near(g.drives[0].rows[0].yards, -10, 'the ball still moves');
    eq(g.drives[0].rows[0].statYards, 0, 'nobody is credited');
  });

  test('a beyond-the-LOS penalty keeps the play stats and moves the ball on top', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({
      spot: -25, playType: 'penalty', qb: '12', receiver: '80',
      penalty: {
        on: 'us', yards: 10, beyondLOS: true,
        underlyingType: 'pass', creditedYards: 15
      }
    });
    var g = b.compute();
    var row = g.drives[0].rows[0];
    near(row.statYards, 15, 'the catch is credited in full');
    near(row.yards, 5, '+15 to fp 40, then 10 back to fp 30');
    eq(g.box.passing['12'].comp, 1);
    near(g.box.passing['12'].yards, 15);
    eq(g.box.receiving['80'].rec, 1);
    eq(E.formatDownDistance(g.current.down, g.current.distance, g.current.goalToGo), '2nd & 5',
      'the underlying play consumed the down');
  });

  test('turnovers end the drive', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'pass', passOutcome: 'intercepted', qb: '12', turnover: 'interception' });
    var g = b.compute();
    near(g.drives[0].rows[0].yards, 0, 'no yardage on a pick, by convention');
    eq(g.drives[0].ended, 'interception');
    eq(g.box.passing['12'].att, 1);
    eq(g.box.passing['12'].comp, 0);
    eq(g.box.passing['12'].int, 1);
    eq(g.current.needsDrive, true);
  });

  test('a lost fumble keeps the real stats and then ends the drive', function () {
    var b = new Builder();
    b.startDrive(-25);
    var p = b.play({ spot: -25, playType: 'run', carrier: '22', turnover: 'fumble' });
    p.endSpot = -33;
    var g = b.compute();
    near(g.box.rushing['22'].yards, 8, 'the 8 yards still happened');
    eq(g.box.rushing['22'].carries, 1);
    eq(g.drives[0].ended, 'fumble');
  });

  test('a safety ends the drive from our own end zone', function () {
    var b = new Builder();
    b.startDrive(-4);
    b.play({ spot: -3, playType: 'safety', carrier: '22' });
    var g = b.compute();
    near(g.drives[0].rows[0].yards, -3);
    eq(g.drives[0].ended, 'safety');
  });

  test('a spike is an incompletion, a kneel resolves like a run', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'pass', passOutcome: 'incomplete', qb: '12', isSpike: true });
    b.play({ spot: -25, playType: 'run', carrier: '12', isKneel: true });
    var last = b.play({ spot: -23, playType: 'run', carrier: '12', isKneel: true });
    last.endSpot = -21;                      // resolved by hand: the game ended here
    b.endDrive('game');
    var g = b.compute();
    eq(g.box.passing['12'].att, 1, 'the spike is a pass attempt');
    eq(g.box.passing['12'].comp, 0);
    near(g.drives[0].rows[1].yards, -2, 'kneel loss comes from the next spot');
    near(g.drives[0].rows[2].yards, -2, 'and the last one from the resolve flow');
    eq(g.box.rushing['12'].carries, 2, 'both kneels are rush attempts');
    near(g.box.rushing['12'].yards, -4);
    eq(g.drives[0].ended, 'game');
  });

  /* ----- conversions and scoring -------------------------------------- */

  test('a 2-point try scores but never touches the box score', function () {
    var b = new Builder();
    b.startDrive(3);
    b.play({ spot: 3, playType: 'run', carrier: '22', td: true });
    b.play({ spot: 3, playType: 'run', carrier: '22', td: true, isTwoPoint: true });
    var g = b.compute();
    eq(g.score, 8, 'six plus two');
    eq(g.box.rushing['22'].carries, 1, 'the try is not a carry');
    near(g.box.rushing['22'].yards, 3);
    eq(g.box.rushing['22'].td, 1);
    eq(g.drives[0].conversion.type, 'two');
    eq(g.drives[0].conversion.good, true);
  });

  test('a missed PAT and a failed try add nothing', function () {
    var b = new Builder();
    b.startDrive(3);
    b.play({ spot: 3, playType: 'run', carrier: '22', td: true });
    b.pat(false);
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'run', carrier: '22', td: false });
    var g = b.compute();
    eq(g.score, 6);
  });

  test('score adds up across drives', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'run', carrier: '22', td: true });
    b.pat(true);
    b.startDrive(-40);
    b.play({ spot: -40, playType: 'pass', passOutcome: 'complete', qb: '12', receiver: '80', td: true });
    b.pat(true);
    b.startDrive(-20);
    b.play({ spot: -20, playType: 'run', carrier: '22' });
    b.endDrive('punt');
    var g = b.compute();
    eq(g.score, 14);
    eq(g.box.passing['12'].td, 1);
    eq(g.box.receiving['80'].td, 1);
    near(g.box.receiving['80'].yards, 60);
  });

  /* ----- editing and recalculation ------------------------------------ */

  test('editing a snap spot ripples forward through the drive', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'run', carrier: '3' });
    var second = b.play({ spot: -31, playType: 'run', carrier: '3' });
    b.play({ spot: -40, playType: 'run', carrier: '3' });
    var g1 = b.compute();
    near(g1.drives[0].rows[0].yards, 6);
    eq(dd(g1.drives[0].rows[1]), '2nd & 4');

    second.spot = -29;                       // the coach fixes a mis-keyed spot
    var g2 = b.compute();
    near(g2.drives[0].rows[0].yards, 4, 'the first play re-resolves');
    eq(dd(g2.drives[0].rows[1]), '2nd & 6', 'down & distance follow');
    near(g2.drives[0].rows[1].yards, 11);
    eq(g2.drives[0].rows[2].firstDown, false);
    eq(dd(g2.drives[0].rows[2]), '1st & 10');
  });

  test('recalculation never crosses a drive boundary', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'run', carrier: '3', td: false, turnover: 'fumble', endSpot: -30 });
    b.startDrive(-40);
    b.play({ spot: -40, playType: 'run', carrier: '3' });
    var g = b.compute();
    eq(g.drives[1].rows[0].pending, true, 'the next drive does not resolve the last one');
    eq(dd(g.drives[1].rows[0]), '1st & 10');
    near(g.drives[0].rows[0].yards, 5);
  });

  test('a hand-corrected play is respected and the chain picks up after it', function () {
    var b = new Builder();
    b.startDrive(-25);
    b.play({ spot: -25, playType: 'run', carrier: '3' });
    var fixed = b.play({ spot: -31, playType: 'run', carrier: '3' });
    b.play({ spot: -35, playType: 'run', carrier: '3' });
    b.play({ spot: -39, playType: 'run', carrier: '3' });

    fixed.overrides = { yards: 4, down: 2, distance: 4 };
    fixed.edited = true;
    var g = b.compute();
    var r = g.drives[0].rows;
    eq(dd(r[1]), '2nd & 4', 'the typed down & distance win');
    near(r[1].yards, 4);
    eq(r[1].firstDown, true, '4 yards reached the 4 to go');
    eq(dd(r[2]), '1st & 10', 'auto-logic resumes from the corrected state');
    near(r[2].yards, 4);
    eq(dd(r[3]), '2nd & 6');

    // The typed yardage outranks the next snap spot: moving that spot no
    // longer changes the play the coach corrected by hand.
    b.game.plays[2].spot = -33;
    var r2 = b.compute().drives[0].rows;
    near(r2[1].yards, 4, 'the hand-corrected yardage is not silently overwritten');
    near(r2[0].yards, 6, 'plays before the correction still auto-resolve');
  });

  test('an override survives on the play it was typed on', function () {
    var b = new Builder();
    b.startDrive(-25);
    var p = b.play({ spot: -25, playType: 'run', carrier: '3' });
    p.overrides = { yards: 12 };
    var g = b.compute();
    near(g.drives[0].rows[0].yards, 12);
    eq(g.drives[0].rows[0].firstDown, true);
    near(g.box.rushing['3'].yards, 12);
  });

  /* ----- persistence shape -------------------------------------------- */

  test('normalizeDb fills in a hand-edited or older file', function () {
    var db = M.normalizeDb({ games: [{ id: 'g1', plays: [{ id: 'p1', spot: -25 }], drives: [{ id: 'd1', startSpot: -25 }] }] });
    eq(db.games.length, 1);
    eq(db.activeGameId, 'g1');
    eq(db.games[0].plays[0].formation, '');
    eq(db.games[0].plays[0].playType, 'run');
    eq(db.games[0].plays[0].kind, 'snap');
    eq(db.games[0].drives[0].gameId, 'g1');
  });

  test('a play record carries plain strings for the Phase 2 fields', function () {
    var p = M.makePlay({ formation: 'Trips Rt', backfield: 'Pistol', motion: 'Z jet', playCall: 'Power' });
    eq(typeof p.formation, 'string');
    eq(typeof p.backfield, 'string');
    eq(typeof p.motion, 'string');
    eq(typeof p.playCall, 'string');
  });

  /* ----- runner -------------------------------------------------------- */

  function run(log) {
    var passed = 0, failed = 0, results = [];
    tests.forEach(function (t) {
      try {
        t.fn();
        passed++;
        results.push({ name: t.name, ok: true });
        if (log) log('  PASS  ' + t.name);
      } catch (err) {
        failed++;
        results.push({ name: t.name, ok: false, error: err.message });
        if (log) log('  FAIL  ' + t.name + '\n          ' + err.message);
      }
    });
    if (log) log('\n' + passed + ' passed, ' + failed + ' failed, ' + tests.length + ' total');
    if (failed && typeof process !== 'undefined' && process.exitCode !== undefined) process.exitCode = 1;
    return { passed: passed, failed: failed, results: results };
  }

  return { run: run, tests: tests };
});
