// Piccoli attrezzi per costruire l'interfaccia senza librerie.

/** Crea un elemento: h('button', { class: 'btn', onclick: fn }, 'Testo', altroNodo) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const ICONS = {
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  euro: '<path d="M17.5 6.5A6.5 6.5 0 0 0 7 12a6.5 6.5 0 0 0 10.5 5.5"/><path d="M4 10.5h9M4 13.5h9"/>',
  home: '<path d="m3 11 9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/>',
  back: '<path d="M10 5 3 12l7 7"/><path d="M3 12h18"/>',
  check: '<path d="m4 12.5 5.5 5.5L20 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  text: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 12h7M9 15.5h7M9 19h4"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5M12 17.5v.5"/>',
  undo: '<path d="M4 9h10a6 6 0 0 1 0 12H8"/><path d="M8 5 4 9l4 4"/>',
};

export function icon(name, size = 28) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

/** Sostituisce il contenuto di un elemento. */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

// ---------- finestre di dialogo ----------

const overlayRoot = () => document.getElementById('overlay-root');

/**
 * Finestra di dialogo. `build(close)` restituisce il contenuto; `close(valore)` la chiude.
 * Restituisce una Promise con il valore passato a close (undefined se chiusa con Esc).
 */
export function dialogBox(build, { wide = false } = {}) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      previousFocus?.focus?.();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(undefined); }
    };
    const box = h('div', { class: `dialog${wide ? ' dialog-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' });
    const backdrop = h('div', { class: 'backdrop' }, box);
    box.append(...[build(close)].flat());
    document.addEventListener('keydown', onKey, true);
    overlayRoot().append(backdrop);
    (box.querySelector('[autofocus]') || box.querySelector('button'))?.focus();
  });
}

export function confirmBox({ title, message, yes = 'Sì', no = 'No', danger = false }) {
  return dialogBox((close) => [
    h('h2', null, title),
    message && h('p', null, message),
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn btn-plain', onclick: () => close(false) }, no),
      h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, yes)),
  ]).then((v) => v === true);
}

export function messageBox({ title, message, ok = 'Ho capito' }) {
  return dialogBox((close) => [
    h('h2', null, title),
    message && h('p', null, message),
    h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', onclick: () => close() }, ok)),
  ]);
}

export function promptBox({ title, label, value = '', ok = 'Va bene', placeholder = '' }) {
  return dialogBox((close) => {
    const input = h('input', { class: 'input', type: 'text', value, placeholder, maxLength: 80, autofocus: true });
    const submit = () => { if (input.value.trim()) close(input.value.trim()); else input.focus(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    return [
      h('h2', null, title),
      h('label', { class: 'field' }, label && h('span', null, label), input),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-plain', onclick: () => close(null) }, 'Annulla'),
        h('button', { class: 'btn btn-primary', onclick: submit }, ok)),
    ];
  });
}

/** Mostra l'errore in modo comprensibile invece di lasciarlo sparire. */
export function showError(err) {
  const text = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  return messageBox({ title: 'Qualcosa non ha funzionato', message: text });
}
