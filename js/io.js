/*
 * io.js — export and import.
 *
 * Export is one click and goes through a real "Save As" dialog wherever the
 * browser offers one, so the file can land on the same USB drive the app is
 * running from. Import reads a file the coach picks - no server anywhere.
 */
;(function (global, factory) {
  var api = factory(global);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) { global.FB = global.FB || {}; global.FB.IO = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
  'use strict';

  var E = global && global.FB ? global.FB.Engine : require('./engine.js');
  var M = global && global.FB ? global.FB.Model : require('./model.js');

  function stamp(d) {
    d = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '_' + p(d.getHours()) + p(d.getMinutes());
  }

  function slug(s) {
    return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '').slice(0, 40);
  }

  /* ---------------- JSON ---------------- */

  function exportJson(db) {
    return JSON.stringify({
      app: 'ingame-chart',
      version: M.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      activeGameId: db.activeGameId,
      games: db.games
    }, null, 2);
  }

  /*
   * mode 'merge'  - games in the file replace same-id games, new ones are added
   * mode 'replace'- the file becomes the whole database
   */
  function importJson(currentDb, text, mode) {
    var parsed = JSON.parse(text);
    var incoming = M.normalizeDb(parsed);
    if (!incoming.games.length) throw new Error('No games found in that file.');
    if (mode === 'replace') return { db: incoming, added: incoming.games.length, updated: 0 };

    var db = M.normalizeDb(currentDb);
    var byId = {};
    db.games.forEach(function (g, i) { byId[g.id] = i; });
    var added = 0, updated = 0;
    incoming.games.forEach(function (g) {
      if (byId[g.id] != null) { db.games[byId[g.id]] = g; updated++; }
      else { db.games.push(g); added++; }
    });
    db.activeGameId = incoming.activeGameId || db.activeGameId;
    if (!db.games.some(function (g) { return g.id === db.activeGameId; })) {
      db.activeGameId = db.games[db.games.length - 1].id;
    }
    return { db: db, added: added, updated: updated };
  }

  /* ---------------- CSV ---------------- */

  function csvCell(v) {
    var s = (v == null) ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvRows(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function detailOf(p) {
    var bits = [];
    if (p.kind === 'pat') return p.patGood ? 'PAT good' : 'PAT no good';
    if (p.playType === 'pass' && p.passOutcome) bits.push(p.passOutcome);
    if (p.isSpike) bits.push('spike');
    if (p.isKneel) bits.push('kneel');
    var pen = E.penaltyOf(p);
    if (pen) {
      bits.push('on ' + (pen.on === 'us' ? 'us' : 'them') + ' ' + pen.yards + 'yd');
      if (pen.autoFirst) bits.push('auto 1st');
      if (pen.beyondLOS) bits.push('beyond LOS (' + pen.underlyingType + ', ' + pen.creditedYards + 'yd credited)');
    }
    if (p.turnover) bits.push(p.turnover);
    if (p.isTwoPoint) bits.push('2-pt try');
    return bits.join('; ');
  }

  // The paper chart's columns, plus what the engine derived.
  function playsCsv(game, computed) {
    var head = ['Drive', 'Play #', 'Down', 'Dist', 'Yard Line', 'Formation', 'Backfield',
      'Motion', 'Play', 'Type', 'Detail', 'Carrier', 'QB', 'Receiver', 'Yards', 'TD',
      'Result', 'Timestamp'];
    var rows = [head];
    var driveNo = {};
    (game.drives || []).forEach(function (d, i) { driveNo[d.id] = i + 1; });
    var counter = 0;
    (game.plays || []).forEach(function (p) {
      var row = computed.rows[p.id];
      if (p.kind !== 'pat') counter++;
      rows.push([
        driveNo[p.driveId] || '',
        p.kind === 'pat' ? '' : counter,
        row ? row.down : '',
        row ? (row.goalToGo ? 'Goal' : E.num(row.distance)) : '',
        p.kind === 'pat' ? '' : E.formatSpot(p.spot),
        p.formation, p.backfield, p.motion, p.playCall,
        p.kind === 'pat' ? 'PAT' : p.playType,
        detailOf(p),
        p.carrier, p.qb, p.receiver,
        row ? (row.pending ? 'pending' : E.num(row.yards)) : '',
        p.td ? 'TD' : '',
        row && row.driveEnd ? row.driveEnd : '',
        p.ts
      ]);
    });
    return csvRows(rows);
  }

  function boxCsv(game, computed) {
    var rows = [];
    var box = computed.box;
    rows.push(['Game', game.name || '(unnamed)', 'vs', game.opponent || '', game.date]);
    rows.push(['Our score', computed.score]);
    rows.push([]);
    rows.push(['PASSING', 'Comp', 'Att', 'Yards', 'TD', 'INT', 'Sacks']);
    Object.keys(box.passing).sort(byNumber).forEach(function (n) {
      var s = box.passing[n];
      rows.push(['#' + n, s.comp, s.att, E.num(s.yards), s.td, s.int, s.sacks]);
    });
    rows.push([]);
    rows.push(['RUSHING', 'Carries', 'Yards', 'TD', 'Avg']);
    Object.keys(box.rushing).sort(byNumber).forEach(function (n) {
      var s = box.rushing[n];
      rows.push(['#' + n, s.carries, E.num(s.yards), s.td, s.carries ? E.num(s.yards / s.carries) : '']);
    });
    rows.push([]);
    rows.push(['RECEIVING', 'Rec', 'Yards', 'TD', 'Avg']);
    Object.keys(box.receiving).sort(byNumber).forEach(function (n) {
      var s = box.receiving[n];
      rows.push(['#' + n, s.rec, E.num(s.yards), s.td, s.rec ? E.num(s.yards / s.rec) : '']);
    });
    rows.push([]);
    rows.push(['TEAM', 'Plays', 'Yards', 'First downs', 'Drives', 'TDs']);
    rows.push(['', computed.totals.plays, E.num(computed.totals.yards), computed.totals.firstDowns,
      computed.totals.drives, computed.totals.touchdowns]);
    return csvRows(rows);
  }

  function filename(kind, game) {
    var base = 'ingame-chart';
    if (game) {
      var s = slug(game.name || game.opponent);
      if (s) base += '_' + s;
    }
    return base + '_' + kind + '_' + stamp() + (kind === 'data' ? '.json' : '.csv');
  }

  /* ---------------- saving a file ---------------- */

  /*
   * Prefer the real Save As dialog (File System Access API). Browsers that
   * don't offer it - or block it for file:// pages - fall back to a download,
   * which still lands in the browser's save flow.
   */
  function saveFile(name, text, mime, opts) {
    opts = opts || {};
    var types = [{
      description: mime === 'application/json' ? 'JSON file' : 'CSV file',
      accept: {}
    }];
    types[0].accept[mime] = [name.slice(name.lastIndexOf('.'))];

    if (global.showSaveFilePicker && !opts.forceDownload) {
      return global.showSaveFilePicker({ suggestedName: name, types: types })
        .then(function (handle) { return handle.createWritable(); })
        .then(function (w) { return w.write(text).then(function () { return w.close(); }); })
        .then(function () { return { ok: true, how: 'picker', name: name }; })
        .catch(function (err) {
          // Only a cancelled dialog reports AbortError. Anything else means
          // this browser won't do Save As here, so fall back rather than
          // leave the coach with no file.
          if (err && err.name === 'AbortError') {
            return { ok: false, cancelled: true, name: name, text: text, mime: mime };
          }
          return download(name, text, mime);
        });
    }
    return Promise.resolve(download(name, text, mime));
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = global.document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    global.document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      global.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    return { ok: true, how: 'download', name: name };
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error('Could not read that file.')); };
      fr.readAsText(file);
    });
  }

  function byNumber(a, b) {
    var na = parseInt(a, 10), nb = parseInt(b, 10);
    if (isNaN(na) || isNaN(nb)) return String(a).localeCompare(String(b));
    return na - nb;
  }

  return {
    exportJson: exportJson,
    importJson: importJson,
    playsCsv: playsCsv,
    boxCsv: boxCsv,
    filename: filename,
    saveFile: saveFile,
    download: download,
    readFile: readFile,
    detailOf: detailOf,
    byNumber: byNumber
  };
});
