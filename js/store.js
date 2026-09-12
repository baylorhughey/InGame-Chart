/*
 * store.js — local persistence.
 *
 * localStorage only: no network, no accounts, nothing to install. When the
 * app runs from a USB drive the browser still keeps this data per-machine,
 * which is exactly why Export/Import exists - see io.js.
 *
 * Some browsers refuse storage for file:// pages. That is not fatal here: the
 * app keeps running from memory and the UI shows a warning telling the coach
 * to export before closing the tab.
 */
;(function (global, factory) {
  var api = factory(global);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) { global.FB = global.FB || {}; global.FB.Store = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (global) {
  'use strict';

  var KEY = 'ingame-chart.db.v1';
  var Model = global && global.FB ? global.FB.Model : require('./model.js');

  var state = { persistent: true, lastError: null };
  var memory = null;
  var saveTimer = null;

  function backend() {
    try {
      if (!global.localStorage) return null;
      // Probe: Safari in private mode throws only on write.
      global.localStorage.setItem(KEY + '.probe', '1');
      global.localStorage.removeItem(KEY + '.probe');
      return global.localStorage;
    } catch (err) {
      state.persistent = false;
      state.lastError = err && err.message ? err.message : String(err);
      return null;
    }
  }

  function load() {
    var ls = backend();
    if (!ls) return memory || (memory = Model.emptyDb());
    var raw = null;
    try { raw = ls.getItem(KEY); } catch (err) { state.persistent = false; }
    if (!raw) return Model.emptyDb();
    try {
      return Model.normalizeDb(JSON.parse(raw));
    } catch (err) {
      // Never lose a game to a parse error: keep the bad text aside so it can
      // still be recovered by hand, and start clean.
      try { ls.setItem(KEY + '.corrupt.' + Date.now(), raw); } catch (e) {}
      state.lastError = 'Saved data was unreadable and has been set aside.';
      return Model.emptyDb();
    }
  }

  function saveNow(db) {
    memory = db;
    var ls = backend();
    if (!ls) return false;
    try {
      ls.setItem(KEY, JSON.stringify(db));
      state.persistent = true;
      return true;
    } catch (err) {
      state.persistent = false;
      state.lastError = (err && err.name === 'QuotaExceededError')
        ? 'Storage is full. Export your data.'
        : 'This browser will not save data for a local file. Export before closing.';
      return false;
    }
  }

  // Logging a play should never wait on a disk write.
  function save(db) {
    memory = db;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; saveNow(db); }, 120);
  }

  function flush(db) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return saveNow(db || memory);
  }

  return { KEY: KEY, load: load, save: save, flush: flush, saveNow: saveNow, state: state };
});
