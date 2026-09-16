/* dom.js — the handful of DOM helpers the two input layers share. */
;(function (global) {
  'use strict';
  var FB = global.FB = global.FB || {};

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid == null || kid === false) return;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function show(node, on) { if (node) node.hidden = !on; }

  // A labelled text input, used everywhere.
  function field(opts) {
    var input = el('input', {
      type: opts.type || 'text',
      id: opts.id,
      autocomplete: 'off',
      autocapitalize: opts.autocapitalize || 'words',
      spellcheck: 'false',
      inputmode: opts.inputmode || null,
      placeholder: opts.placeholder || '',
      enterkeyhint: opts.enterkeyhint || 'done'
    });
    var wrap = el('label', { class: 'field ' + (opts.class || '') }, [
      el('span', { class: 'lbl', text: opts.label }),
      input
    ]);
    return { wrap: wrap, input: input };
  }

  function toggle(opts) {
    var input = el('input', { type: 'checkbox', id: opts.id });
    var wrap = el('label', { class: 'toggle ' + (opts.class || '') }, [input, el('span', { text: opts.label })]);
    return { wrap: wrap, input: input };
  }

  /*
   * A plain <select>, exposing the same {root,get,set,focus} shape as
   * segment() so either can drive a field. Native selects already give you
   * arrow keys and type-ahead, and Enter falls through to the form, which is
   * what logs the play.
   */
  function select(opts) {
    var sel = el('select', { 'aria-label': opts.label || '' });
    opts.items.forEach(function (item) {
      sel.appendChild(el('option', { value: item.value, text: item.label }));
    });
    sel.value = opts.value || opts.items[0].value;
    sel.addEventListener('change', function () {
      if (opts.onChange) opts.onChange(sel.value, 'select');
    });

    /*
     * One keystroke per option, on top of the dropdown's own arrow keys.
     * Native type-ahead can't do this unambiguously - "Pass" and "Penalty"
     * share a letter - and losing a deterministic single key would cost the
     * keyboard flow the whole point of it.
     */
    var keyed = opts.items.filter(function (i) { return i.key; });
    if (keyed.length) {
      sel.addEventListener('keydown', function (ev) {
        if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.key.length !== 1) return;
        var want = ev.key.toLowerCase(), hit = null;
        keyed.forEach(function (i) { if (i.key.toLowerCase() === want) hit = i; });
        if (!hit) return;
        ev.preventDefault();
        // Pressing R on a dropdown already showing Run is still a decision:
        // it has to move the coach on to the number, not sit there.
        var same = sel.value === hit.value;
        if (!same) sel.value = hit.value;
        if (opts.onChange) opts.onChange(sel.value, 'key', same);  // .value fires no change
      });
    }
    return {
      root: sel,
      get: function () { return sel.value; },
      set: function (v) { sel.value = v; },
      focus: function () { sel.focus(); }
    };
  }

  /*
   * Segmented radio control: click, arrow keys, or the letter shown on the
   * button. Enter is deliberately left alone so it still logs the play.
   */
  function segment(opts) {
    var value = opts.value || null;
    var buttons = [];
    var root = el('div', {
      class: 'seg ' + (opts.class || ''),
      role: 'radiogroup',
      'aria-label': opts.label || ''
    });

    opts.items.forEach(function (item) {
      var b = el('button', {
        type: 'button',
        class: 'seg-btn',
        role: 'radio',
        'aria-checked': 'false',
        tabindex: '-1',
        dataset: { value: item.value, key: (item.key || '').toLowerCase() }
      }, [
        el('span', { text: item.label }),
        item.key ? el('span', { class: 'key', text: item.key.toUpperCase() }) : null
      ]);
      b.addEventListener('click', function () { set(item.value, true, 'click'); });
      buttons.push(b);
      root.appendChild(b);
    });

    root.addEventListener('keydown', function (ev) {
      var idx = buttons.indexOf(document.activeElement);
      var move = 0;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') move = 1;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') move = -1;
      if (move) {
        ev.preventDefault();
        var next = buttons[(Math.max(idx, 0) + move + buttons.length) % buttons.length];
        // Arrowing is browsing: focus stays here so the next arrow keeps moving.
        next.focus();
        set(next.dataset.value, true, 'arrow');
        return;
      }
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        var hit = buttons.filter(function (b) { return b.dataset.key === ev.key.toLowerCase(); })[0];
        if (hit) {
          // A letter is a decision: focus here, then let onChange hand focus
          // on to whatever the choice needs typed next.
          ev.preventDefault();
          hit.focus();
          set(hit.dataset.value, true, 'key');
        }
      }
    });

    function paint() {
      var any = false;
      buttons.forEach(function (b) {
        var on = b.dataset.value === value;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on) any = true;
      });
      // Nothing chosen yet: the first button stays tabbable so Tab can reach it.
      if (!any && buttons.length) buttons[0].tabIndex = 0;
    }

    function set(v, fire, source) {
      var same = value === v;
      value = v;
      paint();
      // Re-picking the same option still advances focus - it is a decision.
      if (fire && opts.onChange) opts.onChange(v, source || 'set', same);
    }

    paint();
    return {
      root: root,
      get: function () { return value; },
      set: function (v) { set(v, false); },
      focus: function () { (buttons.filter(function (b) { return b.tabIndex === 0; })[0] || buttons[0]).focus(); }
    };
  }

  FB.dom = {
    el: el, qs: qs, qsa: qsa, clear: clear, show: show,
    field: field, toggle: toggle, segment: segment, select: select
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
