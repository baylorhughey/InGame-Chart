/*
 * ui.js — both input surfaces.
 *
 * There is one DOM and one set of actions. `body.mode-desktop` is the
 * keyboard rhythm (Tab down the form, Enter logs, never touch the mouse);
 * `body.mode-touch` is the same form with big targets and a sticky TD /
 * Resolve / Log bar. Neither one holds state: they render from App.computed
 * and call App actions.
 */
;(function (global) {
  'use strict';
  var FB = global.FB;
  var D = FB.dom, E = FB.Engine, App = FB.App, IO = FB.IO;
  var el = D.el, qs = D.qs;

  var ui = {
    tab: 'drive',
    driveView: null,        // which drive the "This drive" tab is showing
    chartingTwoPoint: false,
    editingId: null,
    importMode: 'merge',
    editingDriveId: null,
    twoPointDriveId: null,
    gameDialogMode: 'new',
    notice: null
  };

  var entryForm, editForm;

  /* ================= boot ================= */

  function boot() {
    App.init();

    entryForm = FB.PlayForm.create({
      mode: 'entry',
      onSubmit: onLogPlay,
      shouldAutoFocus: function () { return !isTouch(); },
      onLockedClick: function () {
        var spot = qs('#drive-spot');
        if (spot) { spot.focus(); spot.scrollIntoView({ block: 'center' }); }
      }
    });
    var mount = qs('#entry-mount');
    D.clear(mount);                       // drops the did-not-start fallback
    mount.appendChild(entryForm.root);

    editForm = FB.PlayForm.create({
      mode: 'edit',
      onSubmit: onSaveEdit,
      onDelete: onDeleteEdit
    });
    qs('#edit-mount').appendChild(editForm.root);

    wireChrome();
    wireDriveForm();
    wireQuickActions();
    wireTabs();
    wireDialogs();
    wireTouchBar();
    wireGlobalKeys();
    applyMode(localStorage_get('ingame-chart.mode') || 'auto');

    App.subscribe(render);
    render();
    focusForEntry();
  }

  function localStorage_get(k) {
    try { return global.localStorage.getItem(k); } catch (err) { return null; }
  }
  function localStorage_set(k, v) {
    try { global.localStorage.setItem(k, v); } catch (err) {}
  }

  /* ================= layout mode ================= */

  function applyMode(mode) {
    qs('#mode-select').value = mode;
    localStorage_set('ingame-chart.mode', mode);
    var touch = mode === 'touch' || (mode === 'auto' && autoTouch());
    document.body.classList.toggle('mode-touch', touch);
    document.body.classList.toggle('mode-desktop', !touch);
  }

  function autoTouch() {
    try {
      return global.matchMedia('(pointer: coarse)').matches || global.innerWidth < 820;
    } catch (err) {
      return global.innerWidth < 820;
    }
  }

  function isTouch() { return document.body.classList.contains('mode-touch'); }

  /* ================= actions ================= */

  function onLogPlay(attrs) {
    // Clear the 2-point flag before logging: the log triggers a render, and
    // it has to draw the form as it will be, not as it was.
    var wasTwoPoint = ui.chartingTwoPoint;
    ui.chartingTwoPoint = false;
    try {
      if (wasTwoPoint) {
        attrs.isTwoPoint = true;
        entryForm.setTwoPoint(false);
        App.addTwoPoint(attrs, ui.twoPointDriveId);
        ui.twoPointDriveId = null;
      } else {
        App.logPlay(attrs);
      }
    } catch (err) {
      ui.chartingTwoPoint = wasTwoPoint;
      entryForm.showError(err.message);
      return;
    }
    afterLog();
  }

  // Back to the top of the form, text fields cleared, next snap spot filled
  // in whenever the chart already knows where the ball is.
  function afterLog() {
    entryForm.reset({ keepSpot: false });
    entryForm.setSpot(App.computed.current.nextSpot);
    render();
    focusForEntry();
  }

  function focusForEntry() {
    if (isTouch()) return;                        // don't pop the soft keyboard
    if (!App.computed) return;
    if (App.computed.current.needsDrive && !ui.chartingTwoPoint) {
      var spot = qs('#drive-spot');
      if (spot && !qs('#drive-panel').hidden) spot.focus();
      return;
    }
    entryForm.focusFirst();
  }

  function endDrive(reason) {
    App.endDrive(reason);
    if (App.pendingPlay()) openResolve();
  }

  // The quick buttons need a spot: whatever is typed, else where the chart
  // already says the ball is.
  function quickSpot() {
    var typed = E.parseSpot(entryForm.getSpotText());
    if (typed.ok) return typed.value;
    var next = App.computed.current.nextSpot;
    if (next != null) return next;
    return null;
  }

  function quickPlay(attrs, label) {
    if (App.computed.current.needsDrive) { notice('warn', 'Start a drive first.'); return; }
    var spot = quickSpot();
    if (spot == null) {
      notice('warn', 'Type the snap spot for the ' + label + ' first.');
      entryForm.focusSpot();
      return;
    }
    attrs.spot = spot;
    App.logPlay(attrs);
    afterLog();
  }

  function notice(kind, text, action) {
    ui.notice = { kind: kind, text: text, action: action || null };
    render();
    if (ui.noticeTimer) clearTimeout(ui.noticeTimer);
    ui.noticeTimer = setTimeout(function () { ui.notice = null; render(); }, action ? 20000 : 6000);
  }

  /* ================= chrome wiring ================= */

  function wireChrome() {
    // The game selector's handler is (re)attached in renderGameSelect, which
    // is what knows about the "+ New game" entry.
    qs('#mode-select').addEventListener('change', function (ev) { applyMode(ev.target.value); });
    qs('#btn-export').addEventListener('click', function () { qs('#export-dialog').showModal(); });
    qs('#btn-import').addEventListener('click', function () { qs('#import-dialog').showModal(); });
    qs('#btn-help').addEventListener('click', openHelp);

    global.addEventListener('resize', function () {
      if (qs('#mode-select').value === 'auto') applyMode('auto');
    });
    // A half-charted game should survive closing the laptop lid.
    global.addEventListener('beforeunload', function () { FB.Store.flush(App.db); });
  }

  function wireDriveForm() {
    qs('#drive-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var parsed = E.parseSpot(qs('#drive-spot').value);
      var err = qs('#drive-spot-err');
      if (!parsed.ok) {
        err.textContent = parsed.error;
        err.hidden = false;
        return;
      }
      err.hidden = true;
      qs('#drive-spot').value = '';
      App.startDrive(parsed.value);
      entryForm.setSpot(App.computed.current.nextSpot);
      focusForEntry();
    });

    qs('#btn-pat-good').addEventListener('click', function () { App.addPat(true); focusForEntry(); });
    qs('#btn-pat-bad').addEventListener('click', function () { App.addPat(false); focusForEntry(); });
    qs('#btn-skip-conv').addEventListener('click', function () {
      ui.chartingTwoPoint = false;
      App.skipConversion();
      focusForEntry();
    });
    qs('#btn-two-point').addEventListener('click', function () {
      ui.chartingTwoPoint = true;
      ui.twoPointDriveId = null;
      entryForm.reset({});
      entryForm.setTwoPoint(true);
      // A try is snapped from a fixed spot, not from where the TD ended.
      entryForm.setSpot(2);
      render();
      if (!isTouch()) entryForm.focusFirst();
    });
  }

  function wireQuickActions() {
    D.qsa('#quick-actions [data-end]').forEach(function (btn) {
      btn.addEventListener('click', function () { endDrive(btn.dataset.end); });
    });
    qs('#btn-kneel').addEventListener('click', function () {
      quickPlay({ playType: 'run', isKneel: true, carrier: entryForm.elements.qb.value.trim(), playCall: 'Kneel' }, 'kneel');
    });
    qs('#btn-spike').addEventListener('click', function () {
      quickPlay({
        playType: 'pass', passOutcome: 'incomplete', isSpike: true,
        qb: entryForm.elements.qb.value.trim(), playCall: 'Spike'
      }, 'spike');
    });
    qs('#btn-undo').addEventListener('click', function () {
      var undone = App.undoLast();
      if (undone) {
        notice('info', undone.kind === 'drive'
          ? 'Removed the drive that had not started yet.'
          : 'Removed the last entry.');
      }
      focusForEntry();
    });
  }

  function wireTabs() {
    D.qsa('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        ui.tab = tab.dataset.tab;
        render();
      });
    });
  }

  function wireTouchBar() {
    qs('#tb-td').addEventListener('click', function () {
      var on = entryForm.toggleTd();
      qs('#tb-td').classList.toggle('on', on);
    });
    qs('#tb-log').addEventListener('click', function () { entryForm.submit(); });
    qs('#tb-resolve').addEventListener('click', openResolve);
  }

  /*
   * Global keys. Everything that matters during a snap is reachable by Tab
   * and Enter; these are for the between-plays actions. accesskey covers the
   * buttons themselves (Alt+P to punt, and so on) - this adds the two that
   * have no button of their own.
   */
  function wireGlobalKeys() {
    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey) return;
      if (ev.key === 'Escape' && !document.querySelector('dialog[open]')) {
        entryForm.reset({ keepSpot: true });
        focusForEntry();
        return;
      }
      if (!ev.altKey) return;
      var k = ev.key.toLowerCase();
      if (k === 'r') { ev.preventDefault(); openResolve(); }
      else if (k === 't') { ev.preventDefault(); entryForm.toggleTd(); }
    });
  }

  /* ================= dialogs ================= */

  function wireDialogs() {
    // Resolve last play
    qs('#resolve-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var parsed = E.parseSpot(qs('#resolve-spot').value);
      var err = qs('#resolve-err');
      if (!parsed.ok) { err.textContent = parsed.error; err.hidden = false; return; }
      err.hidden = true;
      App.resolveLast('spot', parsed.value);
      qs('#resolve-dialog').close();
      focusForEntry();
    });
    qs('#btn-resolve-td').addEventListener('click', function () {
      App.resolveLast('td');
      qs('#resolve-dialog').close();
      focusForEntry();
    });
    qs('#btn-resolve-zero').addEventListener('click', function () {
      App.resolveLast('zero');
      qs('#resolve-dialog').close();
      focusForEntry();
    });

    // Export
    qs('#btn-export-json').addEventListener('click', function () { runExport(App.exportData()); });
    qs('#btn-export-plays').addEventListener('click', function () { runExport(App.exportPlaysCsv()); });
    qs('#btn-export-box').addEventListener('click', function () { runExport(App.exportBoxCsv()); });

    // Import
    qs('#btn-import-merge').addEventListener('click', function () { pickImport('merge'); });
    qs('#btn-import-replace').addEventListener('click', function () { pickImport('replace'); });
    qs('#import-file').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      IO.readFile(file).then(function (text) {
        var res = App.importData(text, ui.importMode);
        ui.driveView = null;
        notice('info', 'Imported ' + res.added + ' new game(s), updated ' + res.updated + '.');
      }).catch(function (err) {
        notice('error', 'Import failed: ' + err.message);
      });
    });

    qs('#drive-edit-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var parsed = E.parseSpot(qs('#drive-edit-spot').value);
      var err = qs('#drive-edit-err');
      if (!parsed.ok) { err.textContent = parsed.error; err.hidden = false; return; }
      App.updateDrive(ui.editingDriveId, { startSpot: parsed.value });
      qs('#drive-edit-dialog').close();
      focusForEntry();
    });

    // Game details
    qs('#game-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var attrs = {
        name: qs('#game-name').value.trim(),
        opponent: qs('#game-opponent').value.trim(),
        date: qs('#game-date').value
      };
      if (ui.gameDialogMode === 'new') App.newGame(attrs);
      else App.updateGame(attrs);
      qs('#game-dialog').close();
      ui.driveView = null;
    });
  }

  function runExport(promise) {
    qs('#export-dialog').close();
    Promise.resolve(promise).then(function (res) {
      if (!res) return;
      if (res.cancelled) {
        // Never let an export end in silence - this is the only thing
        // standing between the coach and a lost game.
        notice('warn', 'Nothing was saved.', {
          label: 'Save as a download instead',
          fn: function () {
            var out = IO.download(res.name, res.text, res.mime);
            notice('info', 'Saved ' + out.name + ' to your downloads.');
          }
        });
        return;
      }
      notice('info', 'Saved ' + res.name + (res.how === 'download' ? ' to your downloads.' : '.'));
    }).catch(function (err) {
      notice('error', 'Export failed: ' + err.message);
    });
  }

  function pickImport(mode) {
    ui.importMode = mode;
    qs('#import-dialog').close();
    qs('#import-file').click();
  }

  function openResolve() {
    var p = App.pendingPlay();
    var dlg = qs('#resolve-dialog');
    if (!p) { notice('info', 'Nothing is waiting to be resolved.'); return; }
    qs('#resolve-hint').textContent =
      'Last play: ' + describe(p).title + ' from ' + E.formatSpot(p.spot) +
      '. Where did the ball end up?';
    qs('#resolve-spot').value = '';
    qs('#resolve-err').hidden = true;
    dlg.showModal();
    qs('#resolve-spot').focus();
  }

  function openEdit(id) {
    var p = App.getPlay(id);
    if (!p) return;
    ui.editingId = id;
    if (p.kind === 'pat') {
      // A kicked PAT is two states; no point opening the whole form for it.
      App.updatePlay(id, { patGood: !p.patGood });
      notice('info', 'PAT is now ' + (App.getPlay(id).patGood ? 'good' : 'no good') + '.');
      return;
    }
    editForm.setValues(p);
    qs('#edit-title').textContent = 'Edit play' + (p.isTwoPoint ? ' (2-point try)' : '');
    qs('#edit-dialog').showModal();
  }

  function onSaveEdit(attrs) {
    if (!ui.editingId) return;
    App.updatePlay(ui.editingId, attrs);
    qs('#edit-dialog').close();
    ui.editingId = null;
    focusForEntry();
  }

  function onDeleteEdit() {
    if (!ui.editingId) return;
    App.deletePlay(ui.editingId);
    qs('#edit-dialog').close();
    ui.editingId = null;
    focusForEntry();
  }

  // The drive's starting spot is the one field position the coach types that
  // isn't a play, so it needs to be correctable like everything else.
  function openDriveEdit(drive) {
    ui.editingDriveId = drive.id;
    qs('#drive-edit-spot').value = E.formatSpot(drive.startSpot);
    qs('#drive-edit-err').hidden = true;
    qs('#drive-edit-dialog').showModal();
    qs('#drive-edit-spot').select();
  }

  function openGameDialog(mode) {
    ui.gameDialogMode = mode;
    var g = App.activeGame();
    qs('#game-dialog-title').textContent = mode === 'new' ? 'New game' : 'Game details';
    qs('#game-name').value = mode === 'new' ? '' : (g.name || '');
    qs('#game-opponent').value = mode === 'new' ? '' : (g.opponent || '');
    qs('#game-date').value = mode === 'new' ? new Date().toISOString().slice(0, 10) : (g.date || '');
    qs('#game-dialog').showModal();
    qs('#game-name').focus();
  }

  /* ================= render ================= */

  function render() {
    var c = App.computed;
    var game = App.activeGame();
    if (!c || !game) return;

    renderGameSelect(game);
    renderBanners(c);
    renderStatus(c);
    renderPanels(c);
    renderTabs();
    renderActiveTab(game, c);
  }

  function renderGameSelect(game) {
    var sel = qs('#game-select');
    D.clear(sel);
    App.db.games.forEach(function (g) {
      sel.appendChild(el('option', {
        value: g.id,
        selected: g.id === game.id,
        text: (g.name || 'Untitled') + (g.opponent ? ' vs ' + g.opponent : '')
      }));
    });
    sel.appendChild(el('option', { value: '__new', text: '+ New game...' }));
    sel.onchange = function (ev) {
      if (ev.target.value === '__new') { ev.target.value = game.id; openGameDialog('new'); }
      else { App.selectGame(ev.target.value); ui.driveView = null; }
    };
    qs('#our-score').textContent = App.computed.score;
  }

  function renderBanners(c) {
    var box = qs('#banners');
    D.clear(box);

    if (!FB.Store.state.persistent) {
      box.appendChild(el('div', { class: 'banner error' }, [
        el('span', { text: FB.Store.state.lastError || 'This browser will not save data here. Export before you close the tab.' })
      ]));
    }
    if (c.current.pending) {
      var p = App.pendingPlay();
      box.appendChild(el('div', { class: 'banner pending' }, [
        el('span', { text: 'Last play is waiting on the next snap spot' + (p ? ' (' + describe(p).title + ')' : '') + '.' }),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: openResolve }, ['Resolve it now'])
      ]));
    }
    if (ui.notice) {
      box.appendChild(el('div', { class: 'banner ' + ui.notice.kind }, [
        el('span', { text: ui.notice.text }),
        ui.notice.action ? el('button', {
          type: 'button', class: 'btn btn-sm',
          onclick: function () { ui.notice.action.fn(); }
        }, [ui.notice.action.label]) : null
      ]));
    }
  }

  function renderStatus(c) {
    var cur = c.current;
    var last = c.drives.length ? c.drives[c.drives.length - 1] : null;
    qs('#dd').textContent = (!last || cur.needsDrive)
      ? '--'
      : E.formatDownDistance(cur.down, cur.distance, cur.goalToGo);
    qs('#ball-on').textContent = (!last || cur.ballFp == null || cur.needsDrive)
      ? '—'
      : E.formatSpot(cur.ballSpot);
    qs('#drive-no').textContent = c.drives.length || '—';
    qs('#drive-plays').textContent = last ? last.playCount : 0;
    qs('#drive-net').textContent = last ? E.num(last.netYards) : 0;

    var tag = qs('#drive-state');
    if (!last) { tag.textContent = 'No drive yet'; tag.className = 'tag'; }
    else if (last.ended) { tag.textContent = endLabel(last.ended); tag.className = 'tag ' + endClass(last.ended); }
    else if (last.pending) { tag.textContent = 'Pending'; tag.className = 'tag warn'; }
    else { tag.textContent = 'Live'; tag.className = 'tag accent'; }
  }

  function renderPanels(c) {
    var cur = c.current;
    var last = c.drives.length ? c.drives[c.drives.length - 1] : null;
    var needConv = cur.needsConversion;

    D.show(qs('#conversion-panel'), needConv && !ui.chartingTwoPoint);
    D.show(qs('#drive-panel'), cur.needsDrive && !ui.chartingTwoPoint && !needConv);

    // The form is always on screen. Hiding it outright made a first load look
    // like the app had failed to build it.
    var canLog = !cur.needsDrive || ui.chartingTwoPoint;
    D.show(qs('#entry-panel'), true);
    entryForm.setEnabled(canLog);

    qs('#entry-title').textContent = ui.chartingTwoPoint ? '2-point try' : 'Log a play';
    qs('#drive-panel-title').textContent = c.drives.length ? 'Start of drive ' + (c.drives.length + 1) : 'Start of drive';
    qs('#drive-panel-hint').textContent = last && last.ended
      ? 'Previous drive ended: ' + endLabel(last.ended).toLowerCase() + '. Enter the new starting yard line.'
      : 'Enter the starting yard line. That is the only spot you ever type by hand.';

    entryForm.setNote(noteForSpot(cur));
    if (!cur.needsDrive && !entryForm.getSpotText() && cur.nextSpot != null) {
      entryForm.setSpot(cur.nextSpot);
    }

    var pending = !!App.pendingPlay();
    qs('#tb-resolve').disabled = !pending;
    qs('#btn-undo').disabled = !(App.activeGame().plays || []).length && !c.drives.length;
  }

  function noteForSpot(cur) {
    if (cur.needsDrive) return null;
    if (cur.pending) return 'The last play is still open — this spot resolves it.';
    if (cur.nextSpot != null) return 'Ball is on ' + E.formatSpot(cur.nextSpot) + '. Change it if the spot moved.';
    return null;
  }

  function renderTabs() {
    D.qsa('.tab').forEach(function (tab) {
      tab.setAttribute('aria-selected', tab.dataset.tab === ui.tab ? 'true' : 'false');
    });
    D.qsa('.tabpanel').forEach(function (panel) {
      panel.hidden = panel.id !== 'tab-' + ui.tab;
    });
  }

  function renderActiveTab(game, c) {
    if (ui.tab === 'drive') renderDriveTab(game, c);
    else if (ui.tab === 'plays') renderPlaysTab(game, c);
    else if (ui.tab === 'box') renderBoxTab(game, c);
    else renderGamesTab();
  }

  /* ---------------- play rows ---------------- */

  function describe(p) {
    if (p.kind === 'pat') {
      return { title: 'PAT kick — ' + (p.patGood ? 'GOOD' : 'no good'), sub: '', cls: 'is-conv' };
    }
    var bits = [];
    var cls = '';
    var title = p.playCall || '';

    if (p.playType === 'run') { bits.push(p.isKneel ? 'Kneel' : 'Run'); if (p.carrier) bits.push('#' + p.carrier); }
    else if (p.playType === 'pass') {
      if (p.passOutcome === 'scramble') bits.push('Scramble');
      else if (p.passOutcome === 'intercepted') bits.push('Pass intercepted');
      else if (p.isSpike) bits.push('Spike');
      else bits.push('Pass ' + (p.passOutcome || ''));
      if (p.qb) bits.push('QB #' + p.qb);
      if (p.receiver) bits.push('to #' + p.receiver);
    } else if (p.playType === 'sack') { bits.push('Sack'); if (p.qb) bits.push('QB #' + p.qb); }
    else if (p.playType === 'safety') { bits.push('Safety'); if (p.carrier) bits.push('#' + p.carrier); }
    else if (p.playType === 'penalty') {
      var pen = p.penalty || {};
      bits.push('Penalty on ' + (pen.on === 'us' ? 'us' : 'them') + ' — ' + E.num(pen.yards) + ' yd');
      if (pen.autoFirst) bits.push('auto 1st');
      if (pen.beyondLOS) bits.push('beyond LOS');
      cls = 'is-penalty';
    }
    if (p.turnover === 'fumble') { bits.push('FUMBLE LOST'); cls = 'is-turnover'; }
    if (p.turnover === 'interception') cls = 'is-turnover';
    if (p.isTwoPoint) { bits.push('2-pt try'); cls = 'is-conv'; }

    if (!title) title = bits.shift() || 'Play';
    var look = [p.formation, p.backfield, p.motion].filter(Boolean).join(' · ');
    return {
      title: title,
      sub: [look, bits.join(' · ')].filter(Boolean).join('  —  '),
      cls: cls
    };
  }

  function playRow(p, row, number) {
    var d = describe(p);
    var cls = ['play', d.cls];
    if (row && row.pending) cls.push('is-pending');
    if (p.td) cls.push('is-td');
    else if (row && row.firstDown) cls.push('is-first');

    var yards = el('div', { class: 'p-yds' });
    if (p.kind === 'pat') yards.textContent = '';
    else if (!row) yards.textContent = '';
    else if (row.pending) { yards.textContent = 'pending'; yards.className = 'p-yds pend'; }
    else {
      yards.textContent = (row.yards > 0 ? '+' : '') + E.num(row.yards);
      if (row.yards < 0) yards.className = 'p-yds neg';
    }

    var flags = [];
    if (p.td) flags.push('TD');
    else if (row && row.firstDown) flags.push('1ST');
    if (row && row.halved) flags.push('½');

    return el('button', {
      type: 'button', class: cls.join(' '), dataset: { id: p.id },
      onclick: function () { openEdit(p.id); }
    }, [
      el('div', { class: 'p-no', text: number == null ? '' : String(number) }),
      el('div', {
        class: 'p-dd',
        text: (p.kind === 'pat' || p.isTwoPoint || !row) ? '' :
          E.formatDownDistance(row.down, row.distance, row.goalToGo)
      }),
      el('div', { class: 'p-spot', text: p.kind === 'pat' ? '' : E.formatSpot(p.spot) }),
      el('div', { class: 'p-desc' }, [
        el('div', { class: 'call', text: d.title }),
        d.sub ? el('div', { class: 'sub', text: d.sub }) : null
      ]),
      yards,
      el('div', { class: 'p-flags', text: flags.join(' ') })
    ]);
  }

  function convButton(label, fn) {
    return el('button', { type: 'button', class: 'btn btn-sm', onclick: fn }, [label]);
  }

  function endLabel(reason) {
    return ({
      td: 'Touchdown', downs: 'Turnover on downs', fumble: 'Fumble lost',
      interception: 'Interception', safety: 'Safety', punt: 'Punt',
      'missed-fg': 'Missed FG', half: 'End of half', game: 'End of game'
    })[reason] || reason;
  }

  function endClass(reason) {
    if (reason === 'td') return 'good';
    if (reason === 'fumble' || reason === 'interception' || reason === 'downs' || reason === 'safety') return 'bad';
    return '';
  }

  function playsOfDrive(game, driveId) {
    return (game.plays || []).filter(function (p) { return p.driveId === driveId; });
  }

  function driveBlock(game, c, driveComputed, driveIndex, opts) {
    opts = opts || {};
    var drive = driveComputed.drive;
    var frag = document.createDocumentFragment();

    var head = el('div', { class: 'drive-head' }, [
      el('h3', { text: 'Drive ' + (driveIndex + 1) }),
      el('button', {
        type: 'button', class: 'btn btn-sm', title: 'Correct the starting spot',
        onclick: function () { openDriveEdit(drive); }
      }, ['from ' + E.formatSpot(drive.startSpot)]),
      el('span', { class: 'meta', text: driveComputed.playCount + ' plays' }),
      el('span', { class: 'meta', text: E.num(driveComputed.netYards) + ' yds' }),
      driveComputed.ended
        ? el('span', { class: 'tag ' + endClass(driveComputed.ended), text: endLabel(driveComputed.ended) })
        : el('span', { class: 'tag accent', text: 'In progress' }),
      driveComputed.points ? el('span', { class: 'tag good', text: driveComputed.points + ' pts' }) : null
    ]);
    if (opts.controls) head.appendChild(opts.controls);
    frag.appendChild(head);

    // A touchdown whose extra point never got entered would otherwise leave
    // the score short for the rest of the game, with no way back to it.
    if (driveComputed.needsConversion) {
      frag.appendChild(el('div', { class: 'conv-row' }, [
        el('span', { class: 'meta', text: 'No extra point recorded for this touchdown:' }),
        convButton('PAT good', function () { App.addPat(true, drive.id); }),
        convButton('PAT no good', function () { App.addPat(false, drive.id); }),
        convButton('2-pt good', function () { App.addTwoPointResult(true, drive.id); }),
        convButton('2-pt failed', function () { App.addTwoPointResult(false, drive.id); })
      ]));
    }

    var list = el('div', { class: 'playlist' });
    var plays = playsOfDrive(game, drive.id);
    var n = 0;
    plays.forEach(function (p) {
      var row = c.rows[p.id];
      if (E.isLive(p)) n++;
      list.appendChild(playRow(p, row, E.isLive(p) ? n : null));
    });
    if (!plays.length) {
      list.appendChild(el('div', { class: 'empty', text: 'No plays charted on this drive yet.' }));
    }
    frag.appendChild(list);
    if (driveComputed.ended) {
      frag.appendChild(el('div', { class: 'drive-end', text: '— ' + endLabel(driveComputed.ended) + ' —' }));
    }
    return frag;
  }

  function renderDriveTab(game, c) {
    var host = qs('#tab-drive');
    D.clear(host);
    if (!c.drives.length) {
      host.appendChild(el('div', { class: 'empty', text: 'Start a drive to begin charting.' }));
      return;
    }
    var idx = ui.driveView == null ? c.drives.length - 1 : Math.min(ui.driveView, c.drives.length - 1);

    var controls = el('div', { class: 'row', style: 'margin-left:auto' }, [
      el('button', {
        type: 'button', class: 'btn btn-sm', disabled: idx <= 0,
        onclick: function () { ui.driveView = idx - 1; render(); }
      }, ['‹ Prev']),
      el('button', {
        type: 'button', class: 'btn btn-sm', disabled: idx >= c.drives.length - 1,
        onclick: function () { ui.driveView = idx + 1; render(); }
      }, ['Next ›'])
    ]);

    host.appendChild(driveBlock(game, c, c.drives[idx], idx, { controls: controls }));

    var d = c.drives[idx];
    if (d.drive.manualEnd) {
      host.appendChild(el('div', { class: 'row gap-top' }, [
        el('button', {
          type: 'button', class: 'btn btn-sm',
          onclick: function () { App.reopenDrive(); }
        }, ['Undo "' + endLabel(d.drive.manualEnd.reason) + '"'])
      ]));
    }
  }

  function renderPlaysTab(game, c) {
    var host = qs('#tab-plays');
    D.clear(host);
    if (!c.drives.length) {
      host.appendChild(el('div', { class: 'empty', text: 'Nothing charted yet.' }));
      return;
    }
    c.drives.forEach(function (dc, i) { host.appendChild(driveBlock(game, c, dc, i)); });
  }

  /* ---------------- box score ---------------- */

  function statTable(title, headers, keys, data) {
    var nums = Object.keys(data).sort(IO.byNumber);
    var body = el('tbody');
    var totalsRow = {};
    nums.forEach(function (n) {
      var s = data[n];
      var cells = [el('td', { text: '#' + n })];
      keys.forEach(function (k) {
        var v = typeof k === 'function' ? k(s) : s[k];
        if (typeof k === 'string') totalsRow[k] = E.round1((totalsRow[k] || 0) + s[k]);
        cells.push(el('td', { text: typeof v === 'number' ? E.num(v) : v }));
      });
      body.appendChild(el('tr', {}, cells));
    });
    if (!nums.length) {
      body.appendChild(el('tr', {}, [el('td', { colspan: headers.length + 1, text: 'None' })]));
    }
    var foot = null;
    if (nums.length > 1) {
      var fcells = [el('td', { text: 'Team' })];
      keys.forEach(function (k) {
        var v = typeof k === 'function' ? k(totalsRow) : totalsRow[k];
        fcells.push(el('td', { text: v == null || (typeof v === 'number' && isNaN(v)) ? '' : (typeof v === 'number' ? E.num(v) : v) }));
      });
      foot = el('tfoot', {}, [el('tr', {}, fcells)]);
    }
    return el('div', { class: 'statblock' }, [
      el('h2', { text: title }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'stats' }, [
          el('thead', {}, [el('tr', {}, [el('th', { text: '#' })].concat(headers.map(function (h) {
            return el('th', { text: h });
          })))]),
          body,
          foot
        ])
      ])
    ]);
  }

  function boxTables(box) {
    var frag = document.createDocumentFragment();
    frag.appendChild(statTable('Passing', ['Comp', 'Att', 'Yds', 'TD', 'INT', 'Sk'],
      ['comp', 'att', 'yards', 'td', 'int', 'sacks'], box.passing));
    frag.appendChild(statTable('Rushing', ['Car', 'Yds', 'TD', 'Avg'],
      ['carries', 'yards', 'td', function (s) { return s.carries ? E.round1(s.yards / s.carries) : ''; }],
      box.rushing));
    frag.appendChild(statTable('Receiving', ['Rec', 'Yds', 'TD', 'Avg'],
      ['rec', 'yards', 'td', function (s) { return s.rec ? E.round1(s.yards / s.rec) : ''; }],
      box.receiving));
    return frag;
  }

  function teamTable(title, totals, score) {
    var rows = [
      ['Points', score],
      ['Plays', totals.plays],
      ['Total yards', E.num(totals.yards)],
      ['Yards per play', totals.plays ? E.num(E.round1(totals.yards / totals.plays)) : '0'],
      ['First downs', totals.firstDowns],
      ['Drives', totals.drives],
      ['Touchdowns', totals.touchdowns]
    ];
    return el('div', { class: 'statblock' }, [
      el('h2', { text: title }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'stats' }, [
          el('tbody', {}, rows.map(function (r) {
            return el('tr', {}, [el('td', { text: r[0] }), el('td', { text: String(r[1]) })]);
          }))
        ])
      ])
    ]);
  }

  function renderBoxTab(game, c) {
    var host = qs('#tab-box');
    D.clear(host);
    host.appendChild(el('div', { class: 'row wrap', style: 'margin-bottom:.8rem' }, [
      el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { runExport(App.exportBoxCsv()); } },
        ['Export box score CSV']),
      el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { runExport(App.exportPlaysCsv()); } },
        ['Export play chart CSV'])
    ]));
    host.appendChild(boxTables(c.box));
    host.appendChild(teamTable('Team', c.totals, c.score));
  }

  /* ---------------- games / season ---------------- */

  function renderGamesTab() {
    var host = qs('#tab-games');
    D.clear(host);
    var season = App.seasonSummary();
    var active = App.activeGame();

    host.appendChild(el('div', { class: 'row wrap', style: 'margin-bottom:.8rem' }, [
      el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { openGameDialog('new'); } }, ['New game']),
      el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { openGameDialog('edit'); } }, ['Edit this game']),
      el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { runExport(App.exportData()); } }, ['Export all games'])
    ]));

    var body = el('tbody');
    season.games.forEach(function (entry) {
      var g = entry.game, cc = entry.computed;
      body.appendChild(el('tr', {}, [
        el('td', {}, [
          el('button', {
            type: 'button', class: 'btn btn-sm',
            onclick: function () { App.selectGame(g.id); ui.driveView = null; }
          }, [(g.name || 'Untitled') + (g.id === active.id ? '  •' : '')])
        ]),
        el('td', { text: g.opponent || '—' }),
        el('td', { text: g.date || '' }),
        el('td', { text: String(cc.score) }),
        el('td', { text: String(cc.totals.plays) }),
        el('td', { text: E.num(cc.totals.yards) }),
        el('td', {}, [
          el('button', {
            type: 'button', class: 'btn btn-sm',
            onclick: function () {
              if (global.confirm('Delete "' + (g.name || 'Untitled') + '" and everything charted in it?')) App.deleteGame(g.id);
            }
          }, ['Delete'])
        ])
      ]));
    });

    host.appendChild(el('div', { class: 'statblock' }, [
      el('h2', { text: 'Games' }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'stats' }, [
          el('thead', {}, [el('tr', {}, ['Game', 'Opponent', 'Date', 'Pts', 'Plays', 'Yds', ''].map(function (h) {
            return el('th', { text: h });
          }))]),
          body
        ])
      ])
    ]));

    host.appendChild(el('h2', { text: 'Season totals — all games' }));
    host.appendChild(boxTables(season.box));
    host.appendChild(teamTable('Season team totals', season.totals, season.totals.points));
  }

  /* ---------------- help ---------------- */

  function openHelp() {
    var body = qs('#help-body');
    body.className = 'dlg-body help-body';
    body.innerHTML = [
      '<h3>Yard lines</h3>',
      '<p>Type them exactly like the paper chart: <kbd>-25</kbd> is our own 25, <kbd>+40</kbd> is their 40, ',
      '<kbd>50</kbd> is midfield. <kbd>o25</kbd> and <kbd>opp40</kbd> work too. A bare number other than 50 is ',
      'refused on purpose &mdash; guessing the side would wreck every yardage number after it.</p>',

      '<h3>The only two numbers you type</h3>',
      '<p>The starting spot of each drive, and the snap spot of each play. Yards gained, down and distance are ',
      'all computed: a play stays <em>pending</em> until the next snap spot says where the ball ended up.</p>',

      '<h3>Keyboard</h3>',
      '<ul>',
      '<li><kbd>Tab</kbd> walks the form in the order you fill it in; <kbd>Enter</kbd> logs the play from any field.</li>',
      '<li>On the play-type dropdown: arrow keys move through it, or press one letter to jump ',
      'straight to a type &mdash; <kbd>R</kbd>un, <kbd>P</kbd>ass, <kbd>S</kbd>ack, penalty ',
      '<kbd>F</kbd>lag, <kbd>T</kbd>urnover, safet<kbd>Y</kbd>. Then <kbd>Tab</kbd> to the number.</li>',
      '<li><kbd>Alt</kbd>+<kbd>D</kbd> start drive &middot; <kbd>Alt</kbd>+<kbd>P</kbd> punt &middot; ',
      '<kbd>Alt</kbd>+<kbd>K</kbd> kneel &middot; <kbd>Alt</kbd>+<kbd>S</kbd> spike &middot; ',
      '<kbd>Alt</kbd>+<kbd>H</kbd> end half &middot; <kbd>Alt</kbd>+<kbd>Z</kbd> undo &middot; ',
      '<kbd>Alt</kbd>+<kbd>E</kbd> export &middot; <kbd>Alt</kbd>+<kbd>R</kbd> resolve the last play &middot; ',
      '<kbd>Alt</kbd>+<kbd>T</kbd> toggle TD.</li>',
      '<li><kbd>Esc</kbd> clears the form without logging anything.</li>',
      '</ul>',
      '<p class="hint">Firefox uses <kbd>Alt</kbd>+<kbd>Shift</kbd> for these; macOS uses <kbd>Ctrl</kbd>+<kbd>Alt</kbd>.</p>',

      '<h3>Play types</h3>',
      '<ul>',
      '<li><b>Sack</b> is a rush attempt for the QB at a loss plus a sack in the passing line &mdash; not a pass ',
      'attempt. Chart <b>intentional grounding as a sack</b>, spotted at the foul.</li>',
      '<li><b>Scramble</b> counts as a rush for the QB, never a pass attempt.</li>',
      '<li><b>Penalty</b> repeats the down unless it is an automatic first down. Half the distance to the goal is ',
      'enforced for you. By default the play is wiped and nobody is credited; tick <b>Beyond the LOS</b> to chart ',
      'the real play underneath and apply the flag on top.</li>',
      '<li><b>Turnover on downs</b> is never something you pick &mdash; a 4th-down play that comes up short ends ',
      'the drive by itself once it resolves.</li>',
      '<li>A <b>2-point try</b> is charted like any snap and never touches the box score.</li>',
      '</ul>',

      '<h3>Fixing a mistake</h3>',
      '<p>Tap any play in the list to edit every field on it. Everything after it in that drive recomputes ',
      'immediately. A drive is a clean boundary &mdash; a fix never leaks into the next one. If you type a down, ',
      'distance or yardage by hand it is kept, and the automatic logic picks back up on the next play.</p>',

      '<h3>Your data</h3>',
      '<p>Everything lives in this browser on this machine, with no network of any kind. That means it does ',
      '<em>not</em> travel with the USB drive &mdash; <b>Export</b> after every game and save the JSON onto the ',
      'drive, then <b>Import</b> it on the next laptop.</p>'
    ].join('');
    qs('#help-dialog').showModal();
  }

  /* ================= go ================= */

  /*
   * If start-up throws, say so on the page. Silently leaving a built-but-empty
   * panel behind is indistinguishable from a broken app.
   */
  function safeBoot() {
    try {
      boot();
    } catch (err) {
      var box = document.getElementById('banners');
      if (box) {
        box.appendChild(el('div', { class: 'banner error' }, [
          el('span', { text: 'The chart could not start: ' + (err && err.message ? err.message : err) })
        ]));
      }
      throw err;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot);
  else safeBoot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
