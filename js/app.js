/*
 * app.js — state and actions.
 *
 * This is the whole application as far as behaviour is concerned. The desktop
 * keyboard layer and the phone touch layer are both just input surfaces that
 * call these actions and re-render from `App.computed`; neither holds state of
 * its own.
 */
;(function (global, factory) {
  var api = factory(global);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) { global.FB = global.FB || {}; global.FB.App = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
  'use strict';

  var FB = global.FB || {};
  var E = FB.Engine || require('./engine.js');
  var M = FB.Model || require('./model.js');
  var Store = FB.Store || require('./store.js');
  var IO = FB.IO || require('./io.js');

  var listeners = [];
  var App = {
    db: M.emptyDb(),
    computed: null,
    notice: null            // {kind:'info'|'warn'|'error', text}
  };

  /* ---------------- lifecycle ---------------- */

  App.init = function () {
    App.db = Store.load();
    if (!App.db.games.length) {
      var g = M.makeGame({ name: 'Game 1' });
      App.db.games.push(g);
      App.db.activeGameId = g.id;
    }
    App.recompute();
    return App;
  };

  App.subscribe = function (fn) { listeners.push(fn); return fn; };

  App.notify = function () {
    listeners.forEach(function (fn) { try { fn(App); } catch (err) { console.error(err); } });
  };

  // Single path for "something changed": recompute everything from the play
  // log, write the derived numbers back onto the records so exports carry
  // them, persist, redraw.
  App.commit = function () {
    App.recompute();
    Store.save(App.db);
    App.notify();
  };

  App.recompute = function () {
    var game = App.activeGame();
    App.computed = game ? E.computeGame(game) : null;
    if (game && App.computed) syncSnapshots(game, App.computed);
  };

  function syncSnapshots(game, computed) {
    (game.plays || []).forEach(function (p) {
      var row = computed.rows[p.id];
      if (!row) { p.down = null; p.distance = null; p.yards = null; return; }
      p.down = row.down;
      p.distance = row.distance;
      p.yards = row.pending ? null : row.yards;
    });
  }

  /* ---------------- games ---------------- */

  App.activeGame = function () {
    var id = App.db.activeGameId;
    for (var i = 0; i < App.db.games.length; i++) {
      if (App.db.games[i].id === id) return App.db.games[i];
    }
    return App.db.games.length ? App.db.games[App.db.games.length - 1] : null;
  };

  // A new game never touches the old one: the season stays browsable.
  App.newGame = function (attrs) {
    var g = M.makeGame(attrs || {});
    if (!g.name) g.name = 'Game ' + (App.db.games.length + 1);
    App.db.games.push(g);
    App.db.activeGameId = g.id;
    App.commit();
    return g;
  };

  App.selectGame = function (id) {
    if (!App.db.games.some(function (g) { return g.id === id; })) return;
    App.db.activeGameId = id;
    App.commit();
  };

  App.updateGame = function (patch) {
    var g = App.activeGame();
    if (!g) return;
    ['name', 'opponent', 'date'].forEach(function (k) {
      if (patch[k] != null) g[k] = patch[k];
    });
    App.commit();
  };

  App.deleteGame = function (id) {
    App.db.games = App.db.games.filter(function (g) { return g.id !== id; });
    if (!App.db.games.length) {
      var g = M.makeGame({ name: 'Game 1' });
      App.db.games.push(g);
    }
    if (!App.db.games.some(function (g) { return g.id === App.db.activeGameId; })) {
      App.db.activeGameId = App.db.games[App.db.games.length - 1].id;
    }
    App.commit();
  };

  /* ---------------- drives ---------------- */

  App.startDrive = function (spot) {
    var g = App.activeGame();
    if (!g) return null;
    var d = M.makeDrive({ gameId: g.id, startSpot: Number(spot) });
    g.drives.push(d);
    App.commit();
    return d;
  };

  App.currentDrive = function () {
    var g = App.activeGame();
    if (!g || !g.drives.length) return null;
    return g.drives[g.drives.length - 1];
  };

  // Punt / missed FG / end of half / end of game: one tap, no form.
  App.endDrive = function (reason) {
    var d = App.currentDrive();
    if (!d) return;
    d.manualEnd = { reason: reason, at: M.nowIso() };
    App.commit();
  };

  App.reopenDrive = function () {
    var d = App.currentDrive();
    if (!d) return;
    d.manualEnd = null;
    App.commit();
  };

  App.updateDrive = function (id, patch) {
    var g = App.activeGame();
    if (!g) return;
    g.drives.forEach(function (d) {
      if (d.id !== id) return;
      if (patch.startSpot != null) d.startSpot = Number(patch.startSpot);
      if (patch.manualEnd !== undefined) d.manualEnd = patch.manualEnd;
      if (patch.note != null) d.note = patch.note;
    });
    App.commit();
  };

  /* ---------------- plays ---------------- */

  App.logPlay = function (attrs) {
    var g = App.activeGame();
    var d = App.currentDrive();
    if (!g || !d) throw new Error('Start a drive first.');
    attrs = attrs || {};
    attrs.gameId = g.id;
    attrs.driveId = attrs.driveId || d.id;
    var p = M.makePlay(attrs);
    g.plays.push(p);
    App.commit();
    return p;
  };

  App.addPat = function (good) {
    var g = App.activeGame();
    var d = App.currentDrive();
    if (!g || !d) return null;
    var p = M.makePat({ gameId: g.id, driveId: d.id, good: good });
    g.plays.push(p);
    App.commit();
    return p;
  };

  // A 2-point try is charted like any snap; isTwoPoint keeps it out of down &
  // distance and out of the box score.
  App.addTwoPoint = function (attrs) {
    attrs = attrs || {};
    attrs.isTwoPoint = true;
    return App.logPlay(attrs);
  };

  App.getPlay = function (id) {
    var g = App.activeGame();
    if (!g) return null;
    for (var i = 0; i < g.plays.length; i++) if (g.plays[i].id === id) return g.plays[i];
    return null;
  };

  /*
   * Every field on a logged play is editable. Down / distance / yards are
   * derived, so typing one of those stores an override: the recalculation
   * respects it and picks the chain back up afterwards.
   */
  App.updatePlay = function (id, patch) {
    var p = App.getPlay(id);
    if (!p) return null;
    Object.keys(patch).forEach(function (k) {
      if (k === 'overrides') return;
      p[k] = patch[k];
    });
    if (patch.overrides) {
      p.overrides = {};
      ['yards', 'down', 'distance'].forEach(function (k) {
        var v = patch.overrides[k];
        if (v != null && v !== '') p.overrides[k] = Number(v);
      });
    }
    p.edited = true;
    App.commit();
    return p;
  };

  App.deletePlay = function (id) {
    var g = App.activeGame();
    if (!g) return;
    g.plays = g.plays.filter(function (p) { return p.id !== id; });
    App.commit();
  };

  App.lastPlay = function (opts) {
    var g = App.activeGame();
    if (!g || !g.plays.length) return null;
    for (var i = g.plays.length - 1; i >= 0; i--) {
      var p = g.plays[i];
      if (opts && opts.liveOnly && !E.isLive(p)) continue;
      return p;
    }
    return null;
  };

  App.pendingPlay = function () {
    if (!App.computed) return null;
    for (var i = App.computed.drives.length - 1; i >= 0; i--) {
      var d = App.computed.drives[i];
      for (var j = d.rows.length - 1; j >= 0; j--) {
        if (d.rows[j].pending) return App.getPlay(d.rows[j].id);
      }
    }
    return null;
  };

  /*
   * Resolve the last play when there is no next snap to measure against:
   * turnover, end of half, end of game, a kneel to finish it.
   *   mode 'spot' - final yard line
   *   mode 'td'   - it scored
   *   mode 'zero' - no yards credited
   */
  App.resolveLast = function (mode, spot) {
    var p = App.pendingPlay();
    if (!p) return null;
    if (mode === 'td') { p.td = true; p.endSpot = null; }
    else if (mode === 'zero') { p.endSpot = p.spot; p.td = false; }
    else { p.endSpot = Number(spot); p.td = false; }
    App.commit();
    return p;
  };

  App.undoLastPlay = function () {
    var g = App.activeGame();
    if (!g || !g.plays.length) return null;
    var p = g.plays.pop();
    App.commit();
    return p;
  };

  /* ---------------- season roll-up ---------------- */

  function blank(kind) {
    if (kind === 'passing') return { att: 0, comp: 0, yards: 0, td: 0, int: 0, sacks: 0 };
    if (kind === 'rushing') return { carries: 0, yards: 0, td: 0 };
    return { rec: 0, yards: 0, td: 0 };
  }

  function mergeInto(target, src, kind) {
    Object.keys(src).forEach(function (num) {
      if (!target[num]) target[num] = blank(kind);
      Object.keys(src[num]).forEach(function (k) {
        target[num][k] = E.round1(target[num][k] + src[num][k]);
      });
    });
  }

  App.seasonSummary = function () {
    var box = { passing: {}, rushing: {}, receiving: {} };
    var games = [];
    var totals = { plays: 0, yards: 0, firstDowns: 0, drives: 0, touchdowns: 0, points: 0 };
    App.db.games.forEach(function (g) {
      var c = E.computeGame(g);
      mergeInto(box.passing, c.box.passing, 'passing');
      mergeInto(box.rushing, c.box.rushing, 'rushing');
      mergeInto(box.receiving, c.box.receiving, 'receiving');
      totals.plays += c.totals.plays;
      totals.yards = E.round1(totals.yards + c.totals.yards);
      totals.firstDowns += c.totals.firstDowns;
      totals.drives += c.totals.drives;
      totals.touchdowns += c.totals.touchdowns;
      totals.points += c.score;
      games.push({ game: g, computed: c });
    });
    return { box: box, totals: totals, games: games };
  };

  /* ---------------- import / export ---------------- */

  App.exportData = function () {
    Store.flush(App.db);
    return IO.saveFile(IO.filename('data'), IO.exportJson(App.db), 'application/json');
  };

  App.exportPlaysCsv = function () {
    var g = App.activeGame();
    return IO.saveFile(IO.filename('plays', g), IO.playsCsv(g, App.computed), 'text/csv');
  };

  App.exportBoxCsv = function () {
    var g = App.activeGame();
    return IO.saveFile(IO.filename('boxscore', g), IO.boxCsv(g, App.computed), 'text/csv');
  };

  App.importData = function (text, mode) {
    var res = IO.importJson(App.db, text, mode);
    App.db = res.db;
    App.commit();
    return res;
  };

  App.storeState = Store.state;

  return App;
});
