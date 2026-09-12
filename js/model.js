/*
 * model.js — record shapes and factories.
 *
 * Records are deliberately flat and boring: formation / backfield / motion /
 * playCall are plain strings so Phase 2 can hang an autocomplete library off
 * the same field without migrating a single stored game.
 */
;(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) { global.FB = global.FB || {}; global.FB.Model = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var seq = 0;

  function uid(prefix) {
    seq += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function nowIso() { return new Date().toISOString(); }

  function makeGame(attrs) {
    attrs = attrs || {};
    return {
      id: attrs.id || uid('g'),
      name: attrs.name || '',
      opponent: attrs.opponent || '',
      date: attrs.date || nowIso().slice(0, 10),
      createdAt: attrs.createdAt || nowIso(),
      drives: [],
      plays: []
    };
  }

  function makeDrive(attrs) {
    attrs = attrs || {};
    return {
      id: attrs.id || uid('d'),
      gameId: attrs.gameId || null,
      startSpot: attrs.startSpot,
      startedAt: attrs.startedAt || nowIso(),
      note: attrs.note || '',
      manualEnd: attrs.manualEnd || null   // {reason:'punt'|'missed-fg'|'half'|'game'|'other', at}
    };
  }

  /*
   * One charted snap. `kind` is 'snap' for everything a play clock runs on,
   * and 'pat' for a kicked extra point (Good / No Good is the whole entry).
   * A 2-point try is a normal snap record with isTwoPoint set: charted the
   * same way, excluded from down & distance and from the box score.
   */
  function makePlay(attrs) {
    attrs = attrs || {};
    var p = {
      id: attrs.id || uid('p'),
      gameId: attrs.gameId || null,
      driveId: attrs.driveId || null,
      kind: attrs.kind || 'snap',
      ts: attrs.ts || nowIso(),

      spot: attrs.spot == null ? null : Number(attrs.spot),

      formation: attrs.formation || '',
      backfield: attrs.backfield || '',
      motion: attrs.motion || '',
      playCall: attrs.playCall || '',

      playType: attrs.playType || 'run',     // run | pass | sack | penalty | safety
      passOutcome: attrs.passOutcome || null,// complete | incomplete | scramble | intercepted

      carrier: attrs.carrier == null ? '' : String(attrs.carrier),
      qb: attrs.qb == null ? '' : String(attrs.qb),
      receiver: attrs.receiver == null ? '' : String(attrs.receiver),

      td: !!attrs.td,
      turnover: attrs.turnover || null,      // null | 'fumble' | 'interception'
      isKneel: !!attrs.isKneel,
      isSpike: !!attrs.isSpike,
      isTwoPoint: !!attrs.isTwoPoint,

      penalty: attrs.penalty ? makePenalty(attrs.penalty) : null,

      endSpot: attrs.endSpot == null ? null : Number(attrs.endSpot),
      overrides: attrs.overrides || {},
      edited: !!attrs.edited,

      // Snapshots written back by the engine so exports carry them. The play
      // log is still the source of truth - these are never read back in.
      down: attrs.down == null ? null : attrs.down,
      distance: attrs.distance == null ? null : attrs.distance,
      yards: attrs.yards == null ? null : attrs.yards,

      patGood: !!attrs.patGood
    };
    return p;
  }

  function makePenalty(attrs) {
    attrs = attrs || {};
    return {
      on: attrs.on === 'them' ? 'them' : 'us',
      yards: Number(attrs.yards) || 0,
      autoFirst: !!attrs.autoFirst,
      beyondLOS: !!attrs.beyondLOS,
      underlyingType: attrs.underlyingType || 'none',  // none | run | pass
      creditedYards: Number(attrs.creditedYards) || 0
    };
  }

  function makePat(attrs) {
    attrs = attrs || {};
    return makePlay({
      id: attrs.id,
      gameId: attrs.gameId,
      driveId: attrs.driveId,
      kind: 'pat',
      patGood: !!attrs.good,
      playType: 'pat'
    });
  }

  function emptyDb() {
    return { version: SCHEMA_VERSION, activeGameId: null, games: [] };
  }

  // Accepts anything that looks like our export and fills in missing fields,
  // so an older or hand-edited file still imports.
  function normalizeDb(raw) {
    var db = emptyDb();
    if (!raw || typeof raw !== 'object') return db;
    db.version = SCHEMA_VERSION;
    db.activeGameId = raw.activeGameId || null;
    var games = Array.isArray(raw.games) ? raw.games : [];
    db.games = games.map(function (g) {
      var game = makeGame(g);
      game.drives = (g.drives || []).map(function (d) {
        var drive = makeDrive(d);
        drive.gameId = game.id;
        return drive;
      });
      game.plays = (g.plays || []).map(function (p) {
        var play = makePlay(p);
        play.gameId = game.id;
        return play;
      });
      return game;
    });
    if (!db.games.some(function (g) { return g.id === db.activeGameId; })) {
      db.activeGameId = db.games.length ? db.games[db.games.length - 1].id : null;
    }
    return db;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    uid: uid,
    nowIso: nowIso,
    makeGame: makeGame,
    makeDrive: makeDrive,
    makePlay: makePlay,
    makePenalty: makePenalty,
    makePat: makePat,
    emptyDb: emptyDb,
    normalizeDb: normalizeDb
  };
});
