/*
 * playform.js — the one play form.
 *
 * Used twice: as the live entry form and inside the edit dialog. Building it
 * once means an edited play can express exactly what a logged play can, and
 * the two can never drift apart.
 *
 * Every control is built up front and shown or hidden as the play type
 * changes, so DOM order == Tab order == the order the coach fills it in:
 *   formation -> backfield -> motion -> play call -> snap spot -> play type
 *   -> outcome -> player numbers -> TD -> log.
 */
;(function (global) {
  'use strict';
  var FB = global.FB;
  var D = FB.dom, E = FB.Engine;

  // key = the single keystroke that picks this option while the dropdown has
  // focus. 'f' for the penalty Flag, since Pass already owns 'p'.
  var PLAY_TYPES = [
    { value: 'run', label: 'Run', key: 'r' },
    { value: 'pass', label: 'Pass', key: 'p' },
    { value: 'sack', label: 'Sack', key: 's' },
    { value: 'penalty', label: 'Penalty', key: 'f' },
    { value: 'turnover', label: 'Turnover', key: 't' },
    { value: 'safety', label: 'Safety', key: 'y' }
  ];

  var PASS_OUTCOMES = [
    { value: 'complete', label: 'Complete', key: 'c' },
    { value: 'incomplete', label: 'Incomplete', key: 'i' },
    { value: 'scramble', label: 'Scramble', key: 'm' }
  ];

  function create(opts) {
    opts = opts || {};
    var mode = opts.mode || 'entry';
    var isEdit = mode === 'edit';
    var api = {};

    var root = D.el('form', { class: 'pf', novalidate: true, autocomplete: 'off' });

    /*
     * Shown instead of silently hiding the whole form when there's no drive to
     * log into. An empty panel reads as a broken app; this says what to do.
     */
    var lockBtn = D.el('button', { type: 'button', class: 'btn btn-primary btn-sm' }, ['Start a drive']);
    var lock = D.el('div', { class: 'pf-lock', hidden: true }, [
      D.el('span', { text: 'Enter the drive\u2019s starting yard line before logging plays.' }),
      lockBtn
    ]);
    lockBtn.addEventListener('click', function () { if (opts.onLockedClick) opts.onLockedClick(); });
    // Only live entry can be locked; editing an existing play always has a
    // drive to belong to.
    if (!isEdit) root.appendChild(lock);

    /* --- the four free-text fields (Phase 2 hangs autocomplete off these) --- */
    var formation = D.field({ label: 'Formation', placeholder: 'Trips Rt', enterkeyhint: 'next' });
    var backfield = D.field({ label: 'Backfield', placeholder: 'Pistol', enterkeyhint: 'next' });
    var motion = D.field({ label: 'Motion', placeholder: 'Z jet', enterkeyhint: 'next' });
    var playCall = D.field({ label: 'Play call', placeholder: 'Power R', enterkeyhint: 'next' });
    root.appendChild(D.el('div', { class: 'pf-grid pf-row-detail' }, [
      formation.wrap, backfield.wrap, motion.wrap, playCall.wrap
    ]));

    /* --- snap spot: the only field position ever typed --- */
    var spot = D.field({
      label: 'Snap spot', class: 'spot-field grow',
      placeholder: '-25 or +40', inputmode: 'text', autocapitalize: 'off', enterkeyhint: 'next'
    });
    var spotNote = D.el('div', { class: 'pf-note pf-row-note' });
    root.appendChild(D.el('div', { class: 'row pf-row-spot' }, [spot.wrap]));
    root.appendChild(spotNote);

    /* --- play type --- */
    /*
     * A dropdown. Picking a type by its letter is a decision, so focus jumps
     * straight to the number that type needs - that is the whole keyboard
     * rhythm. Arrowing through the list is only browsing, and a closed
     * <select> fires change on every step, so focus stays put for that.
     */
    var typeSeg = D.select({
      label: 'Play type', items: PLAY_TYPES, value: 'run',
      onChange: function (v, source) { sync(); if (source === 'key') focusContext(); }
    });
    root.appendChild(D.el('div', { class: 'field pf-row-type' }, [
      D.el('span', { class: 'lbl', text: 'Play type' }), typeSeg.root
    ]));

    var context = D.el('div', { class: 'pf-context' });
    root.appendChild(context);

    /* --- pass outcome --- */
    var outcomeSeg = D.segment({
      label: 'Pass outcome', class: 'seg-sub', items: PASS_OUTCOMES, value: 'complete',
      onChange: function () { sync(); }
    });
    var outcomeRow = D.el('div', { class: 'field' }, [
      D.el('span', { class: 'lbl', text: 'Outcome' }), outcomeSeg.root
    ]);
    context.appendChild(outcomeRow);

    /* --- turnover kind --- */
    var turnoverSeg = D.segment({
      label: 'Turnover', class: 'seg-sub', value: 'interception',
      items: [
        { value: 'interception', label: 'Interception', key: 'i' },
        { value: 'fumble', label: 'Fumble lost', key: 'f' }
      ],
      onChange: function (v, source) { sync(); if (source !== 'arrow') focusContext(); }
    });
    var turnoverRow = D.el('div', { class: 'field' }, [
      D.el('span', { class: 'lbl', text: 'Turnover' }), turnoverSeg.root
    ]);
    context.appendChild(turnoverRow);

    /* --- underlying play (fumble, or a penalty beyond the LOS) --- */
    var underSeg = D.segment({
      label: 'Underlying play', class: 'seg-sub', value: 'run',
      items: [
        { value: 'run', label: 'Run', key: 'r' },
        { value: 'pass', label: 'Pass', key: 'p' }
      ],
      onChange: function (v, source) { sync(); if (source !== 'arrow') focusContext(); }
    });
    var underRow = D.el('div', { class: 'field' }, [
      D.el('span', { class: 'lbl', text: 'Chart the play as' }), underSeg.root
    ]);
    context.appendChild(underRow);

    /* --- penalty --- */
    var penOnSeg = D.segment({
      label: 'Penalty on', class: 'seg-sub', value: 'us',
      items: [
        { value: 'us', label: 'On us', key: 'u' },
        { value: 'them', label: 'On them', key: 'h' }
      ]
    });
    var penYards = D.field({ label: 'Yards', class: 'num-field', inputmode: 'numeric', placeholder: '10' });
    var penAuto = D.toggle({ label: 'Automatic 1st down' });
    var penBeyond = D.toggle({ label: 'Beyond the LOS' });
    penBeyond.input.addEventListener('change', function () { sync(); });
    var penCredited = D.field({
      label: 'Yards credited to the play', class: 'num-field', inputmode: 'text', placeholder: '0'
    });
    var penRow = D.el('div', { class: 'field' }, [
      D.el('span', { class: 'lbl', text: 'Penalty' }),
      penOnSeg.root,
      D.el('div', { class: 'row wrap gap-top' }, [penYards.wrap, penAuto.wrap, penBeyond.wrap])
    ]);
    context.appendChild(penRow);
    context.appendChild(penCredited.wrap);

    /* --- player numbers --- */
    var carrier = D.field({ label: 'Ball carrier #', class: 'num-field', inputmode: 'numeric', placeholder: '22' });
    var qb = D.field({ label: 'QB #', class: 'num-field', inputmode: 'numeric', placeholder: '12' });
    var receiver = D.field({ label: 'Receiver #', class: 'num-field', inputmode: 'numeric', placeholder: '80' });
    var playersRow = D.el('div', { class: 'pf-grid' }, [carrier.wrap, qb.wrap, receiver.wrap]);
    context.appendChild(playersRow);

    /* --- TD --- */
    var td = D.toggle({ label: 'Touchdown', class: 'td' });
    var tdRow = D.el('div', { class: 'row wrap pf-row-td' }, [td.wrap]);
    root.appendChild(tdRow);

    /* --- kneel / spike / 2-pt flags (edit only; live entry uses the buttons) --- */
    var kneel = D.toggle({ label: 'Kneel' });
    var spike = D.toggle({ label: 'Spike' });
    var twoPt = D.toggle({ label: '2-point try (no box score)' });
    var flagsRow = D.el('div', { class: 'row wrap pf-row-flags' }, [kneel.wrap, spike.wrap, twoPt.wrap]);
    if (isEdit) root.appendChild(flagsRow); else flagsRow.hidden = true;

    /* --- derived-value overrides (edit only) --- */
    var ovDown = D.field({ label: 'Down', class: 'num-field', inputmode: 'numeric', placeholder: 'auto' });
    var ovDist = D.field({ label: 'Distance', class: 'num-field', inputmode: 'numeric', placeholder: 'auto' });
    var ovYards = D.field({ label: 'Yards', class: 'num-field', inputmode: 'text', placeholder: 'auto' });
    var ovRow = D.el('div', { class: 'field pf-row-ov' }, [
      D.el('span', { class: 'lbl', text: 'Override the computed numbers' }),
      D.el('div', { class: 'pf-grid' }, [ovDown.wrap, ovDist.wrap, ovYards.wrap]),
      D.el('div', {
        class: 'pf-note',
        text: 'Leave these blank to let the chart compute them. Anything you type here is kept, and the auto-logic picks back up on the next play.'
      })
    ]);
    if (isEdit) root.appendChild(ovRow);

    /* --- error + submit --- */
    var errBox = D.el('div', { class: 'err pf-row-err', hidden: true });
    root.appendChild(errBox);

    var submitBtn = D.el('button', { type: 'submit', class: 'btn btn-primary btn-tall' }, [
      D.el('span', { text: isEdit ? 'Save changes' : 'Log play' }),
      isEdit ? null : D.el('span', { class: 'key', text: 'ENTER' })
    ]);
    var deleteBtn = D.el('button', { type: 'button', class: 'btn btn-bad' }, ['Delete play']);
    var clearBtn = D.el('button', { type: 'button', class: 'btn btn-quiet' }, ['Clear']);
    var submitRow = D.el('div', { class: 'pf-submit' }, [submitBtn, isEdit ? deleteBtn : clearBtn]);
    root.appendChild(submitRow);

    deleteBtn.addEventListener('click', function () { if (opts.onDelete) opts.onDelete(); });
    clearBtn.addEventListener('click', function () { api.reset({ keepSpot: true }); api.focusFirst(); });

    /*
     * Enter logs the play from anywhere in the form, including from a
     * segmented button, where Enter would otherwise just re-pick the option.
     */
    root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey) return;
      if (ev.target && ev.target.tagName === 'TEXTAREA') return;
      ev.preventDefault();
      submit();
    });

    root.addEventListener('submit', function (ev) { ev.preventDefault(); submit(); });

    function submit() {
      var res = api.getValues();
      if (!res.ok) {
        api.showError(res.error);
        if (res.focus && res.focus.focus) res.focus.focus();
        return;
      }
      api.showError(null);
      if (opts.onSubmit) opts.onSubmit(res.attrs);
    }

    /* ---------------- visibility ---------------- */

    // What kind of play the form is currently describing, once turnovers and
    // beyond-the-LOS penalties are unwrapped.
    function effectiveType() {
      var t = typeSeg.get();
      if (t === 'turnover') {
        return turnoverSeg.get() === 'interception' ? 'pass' : underSeg.get();
      }
      if (t === 'penalty' && penBeyond.input.checked) return underSeg.get();
      return t;
    }

    function sync() {
      var t = typeSeg.get();
      var isInt = t === 'turnover' && turnoverSeg.get() === 'interception';
      var eff = effectiveType();
      var outcome = isInt ? 'intercepted' : outcomeSeg.get();

      D.show(turnoverRow, t === 'turnover');
      D.show(underRow, (t === 'turnover' && turnoverSeg.get() === 'fumble') ||
        (t === 'penalty' && penBeyond.input.checked));
      D.show(penRow, t === 'penalty');
      D.show(penCredited.wrap, t === 'penalty' && penBeyond.input.checked);
      D.show(outcomeRow, eff === 'pass' && !isInt);

      var wipedPenalty = t === 'penalty' && !penBeyond.input.checked;
      D.show(playersRow, !wipedPenalty);
      D.show(carrier.wrap, !wipedPenalty && (eff === 'run' || eff === 'safety'));
      D.show(qb.wrap, !wipedPenalty && (eff === 'pass' || eff === 'sack'));
      D.show(receiver.wrap, !wipedPenalty && eff === 'pass' && outcome === 'complete');

      // A TD is impossible on a wiped penalty, a sack, a safety or a pick.
      var canScore = !wipedPenalty && eff !== 'sack' && eff !== 'safety' && !isInt &&
        !(eff === 'pass' && (outcome === 'incomplete'));
      D.show(tdRow, canScore);
      if (!canScore) td.input.checked = false;

      context.hidden = !(turnoverRow.hidden === false || penRow.hidden === false ||
        outcomeRow.hidden === false || playersRow.hidden === false || underRow.hidden === false);
    }

    /*
     * After a play type is picked, jump to the first thing that still needs
     * typing so the coach never hunts for it. Skipped on touch, where
     * stealing focus would throw the on-screen keyboard over the form.
     */
    function focusContext() {
      if (isEdit) return;
      if (opts.shouldAutoFocus && !opts.shouldAutoFocus()) return;
      var first = [carrier.input, qb.input, receiver.input, penYards.input].filter(function (i) {
        return i.offsetParent !== null && !i.value;
      })[0];
      if (first) first.focus();
    }

    /* ---------------- values in ---------------- */

    api.root = root;
    api.elements = {
      formation: formation.input, backfield: backfield.input, motion: motion.input,
      playCall: playCall.input, spot: spot.input, carrier: carrier.input, qb: qb.input,
      receiver: receiver.input, td: td.input, submit: submitBtn
    };

    api.setValues = function (p) {
      p = p || {};
      formation.input.value = p.formation || '';
      backfield.input.value = p.backfield || '';
      motion.input.value = p.motion || '';
      playCall.input.value = p.playCall || '';
      spot.input.value = p.spot == null ? '' : E.formatSpot(p.spot);
      carrier.input.value = p.carrier || '';
      qb.input.value = p.qb || '';
      receiver.input.value = p.receiver || '';
      td.input.checked = !!p.td;
      kneel.input.checked = !!p.isKneel;
      spike.input.checked = !!p.isSpike;
      twoPt.input.checked = !!p.isTwoPoint;

      if (p.turnover === 'interception') {
        typeSeg.set('turnover'); turnoverSeg.set('interception');
      } else if (p.turnover === 'fumble') {
        typeSeg.set('turnover'); turnoverSeg.set('fumble');
        underSeg.set(p.playType === 'pass' ? 'pass' : 'run');
        if (p.passOutcome) outcomeSeg.set(p.passOutcome === 'intercepted' ? 'complete' : p.passOutcome);
      } else {
        typeSeg.set(p.playType || 'run');
        if (p.passOutcome && p.passOutcome !== 'intercepted') outcomeSeg.set(p.passOutcome);
      }

      var pen = p.penalty;
      penOnSeg.set(pen ? pen.on : 'us');
      penYards.input.value = pen ? pen.yards : '';
      penAuto.input.checked = !!(pen && pen.autoFirst);
      penBeyond.input.checked = !!(pen && pen.beyondLOS);
      penCredited.input.value = pen && pen.beyondLOS ? pen.creditedYards : '';
      if (pen && pen.beyondLOS && pen.underlyingType !== 'none') underSeg.set(pen.underlyingType);

      var ov = p.overrides || {};
      ovDown.input.value = ov.down == null ? '' : ov.down;
      ovDist.input.value = ov.distance == null ? '' : ov.distance;
      ovYards.input.value = ov.yards == null ? '' : ov.yards;

      sync();
    };

    /* ---------------- values out ---------------- */

    function numOrNull(input) {
      var v = String(input.value || '').trim();
      if (!v) return null;
      var n = Number(v);
      return isNaN(n) ? null : n;
    }

    api.getValues = function () {
      var parsed = E.parseSpot(spot.input.value);
      if (!parsed.ok) return { ok: false, error: parsed.error, focus: spot.input };

      var t = typeSeg.get();
      var isInt = t === 'turnover' && turnoverSeg.get() === 'interception';
      var eff = effectiveType();
      // The outcome belongs to the play underneath, whatever wrapper it has:
      // a fumble, or a penalty charted beyond the line of scrimmage.
      var outcome = eff !== 'pass' ? null : (isInt ? 'intercepted' : outcomeSeg.get());

      var attrs = {
        spot: parsed.value,
        formation: formation.input.value.trim(),
        backfield: backfield.input.value.trim(),
        motion: motion.input.value.trim(),
        playCall: playCall.input.value.trim(),
        carrier: '', qb: '', receiver: '',
        td: !!(td.input.checked && !tdRow.hidden),
        turnover: null,
        passOutcome: null,
        penalty: null,
        isKneel: kneel.input.checked,
        isSpike: spike.input.checked,
        isTwoPoint: twoPt.input.checked
      };

      attrs.passOutcome = outcome;

      if (t === 'penalty') {
        var yards = numOrNull(penYards.input);
        if (yards == null) return { ok: false, error: 'Penalty yardage?', focus: penYards.input };
        var beyond = penBeyond.input.checked;
        attrs.playType = 'penalty';
        attrs.penalty = {
          on: penOnSeg.get(),
          yards: Math.abs(yards),
          autoFirst: penAuto.input.checked,
          beyondLOS: beyond,
          underlyingType: beyond ? underSeg.get() : 'none',
          creditedYards: beyond ? (numOrNull(penCredited.input) || 0) : 0
        };
      } else if (isInt) {
        attrs.playType = 'pass';
        attrs.turnover = 'interception';
      } else {
        attrs.playType = eff;
        if (t === 'turnover') attrs.turnover = 'fumble';
      }

      // Player numbers, only where they mean something.
      if (!(t === 'penalty' && !penBeyond.input.checked)) {
        if (eff === 'run' || eff === 'safety') attrs.carrier = carrier.input.value.trim();
        if (eff === 'pass' || eff === 'sack') attrs.qb = qb.input.value.trim();
        if (eff === 'pass' && outcome === 'complete') attrs.receiver = receiver.input.value.trim();
      }

      if (isEdit) {
        attrs.overrides = {};
        var d = numOrNull(ovDown.input);
        var di = numOrNull(ovDist.input);
        var y = numOrNull(ovYards.input);
        if (d != null) attrs.overrides.down = d;
        if (di != null) attrs.overrides.distance = di;
        if (y != null) attrs.overrides.yards = y;
      }

      return { ok: true, attrs: attrs };
    };

    /* ---------------- misc ---------------- */

    api.reset = function (o) {
      o = o || {};
      formation.input.value = '';
      backfield.input.value = '';
      motion.input.value = '';
      playCall.input.value = '';
      carrier.input.value = '';
      qb.input.value = '';
      receiver.input.value = '';
      td.input.checked = false;
      kneel.input.checked = false;
      spike.input.checked = false;
      if (!o.keepTwoPoint) twoPt.input.checked = false;
      penYards.input.value = '';
      penCredited.input.value = '';
      penAuto.input.checked = false;
      penBeyond.input.checked = false;
      // Every sub-choice goes back to its default too. A "pass incomplete"
      // left over from the last snap would silently mis-chart the next one.
      outcomeSeg.set('complete');
      turnoverSeg.set('interception');
      underSeg.set('run');
      penOnSeg.set('us');
      ovDown.input.value = '';
      ovDist.input.value = '';
      ovYards.input.value = '';
      if (!o.keepType) typeSeg.set('run');
      if (!o.keepSpot) spot.input.value = '';
      api.showError(null);
      sync();
    };

    /*
     * Locked means visible but inert: the coach can see the whole form and is
     * told the one thing standing between them and using it.
     */
    api.setEnabled = function (on) {
      lock.hidden = !!on;
      root.classList.toggle('pf-locked', !on);
      D.qsa('input, select, button, textarea', root).forEach(function (node) {
        if (node === lockBtn) return;
        node.disabled = !on;
      });
    };

    api.focusFirst = function () { formation.input.focus(); };
    api.focusSpot = function () { spot.input.select(); };
    api.setSpot = function (signed) { spot.input.value = signed == null ? '' : E.formatSpot(signed); };
    api.getSpotText = function () { return spot.input.value; };
    api.setNote = function (textOrNull) {
      spotNote.textContent = textOrNull || '';
      spotNote.hidden = !textOrNull;
    };
    api.toggleTd = function () {
      if (tdRow.hidden) return false;
      td.input.checked = !td.input.checked;
      return td.input.checked;
    };
    api.setTwoPoint = function (on) { twoPt.input.checked = !!on; };
    api.showError = function (msg) {
      errBox.textContent = msg || '';
      errBox.hidden = !msg;
    };
    api.submit = submit;

    sync();
    return api;
  }

  FB.PlayForm = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
