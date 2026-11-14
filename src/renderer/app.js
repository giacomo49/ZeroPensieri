import { h, icon, fill, confirmBox, showError } from './dom.js';
import { greeting, countLabel } from './format.js';
import { uploadView } from './upload.js';
import { browseView } from './browse.js';
import { toPayView } from './topay.js';

const view = document.getElementById('view');
const statusbar = document.getElementById('statusbar');

export const app = {
  state: null,      // stato generale (cartella collegata, numero di cose da pagare...)
  conversion: null, // stato del lettore di documenti
  current: null,    // vista attuale: { name, refresh? }
  go,
};

const SECTIONS = {
  upload: { title: 'Carica documento', color: 'blue', icon: 'upload', render: uploadView },
  browse: { title: 'I tuoi documenti', color: 'green', icon: 'folder', render: browseView },
  topay: { title: 'Cose da pagare', color: 'red', icon: 'euro', render: toPayView },
};

/** Cambia schermata. */
export function go(name, params = {}) {
  view.scrollTop = 0;
  document.body.dataset.section = name;
  if (name === 'home' || !app.state?.root) {
    app.current = { name: 'home' };
    fill(view, app.state?.root ? homeView() : welcomeView());
    return;
  }
  const section = SECTIONS[name];
  const body = h('div', { class: 'section-body' });
  fill(view,
    h('header', { class: `section-header bg-${section.color}` },
      h('button', { class: 'btn btn-back', onclick: () => go('home') }, icon('back'), 'Inizio'),
      h('h1', null, icon(section.icon, 40), section.title)),
    body);
  app.current = { name, ...section.render(body, params) };
}

// ---------- prima apertura ----------

function welcomeView() {
  return h('div', { class: 'welcome' },
    h('div', { class: 'brand brand-big' }, h('span', { class: 'brand-mark' }, icon('check', 44)), 'ZeroPensieri'),
    h('h1', null, 'Benvenuto!'),
    h('p', { class: 'lead' }, 'Per cominciare, scegli la cartella del computer dove tenere tutti i tuoi documenti.'),
    h('button', { class: 'btn btn-primary btn-huge', onclick: chooseRoot }, icon('folder', 36), 'Scegli la cartella'),
    h('p', { class: 'hint' }, 'Puoi sceglierne una che hai già oppure crearne una nuova.'));
}

async function chooseRoot() {
  try {
    const state = await window.zp.chooseRoot();
    if (!state) return;
    app.state = state;
    if (state.isEmpty) {
      const create = await confirmBox({
        title: 'La cartella è vuota. Preparo io le cartelle?',
        message: `Posso creare queste cartelle per tenere in ordine i documenti: ${state.starterFolders.join(', ')}.`,
        yes: 'Sì, creale',
        no: 'No, grazie',
      });
      if (create) app.state = await window.zp.createStarterFolders();
    }
    go('home');
  } catch (err) { showError(err); }
}

// ---------- schermata iniziale ----------

function homeView() {
  const { toPayCount, rootName } = app.state;
  const tile = (name, description, extra) => {
    const section = SECTIONS[name];
    return h('button', { class: `home-tile bg-${section.color}`, onclick: () => go(name) },
      h('span', { class: 'home-tile-icon' }, icon(section.icon, 64)),
      h('span', { class: 'home-tile-title' }, section.title),
      h('span', { class: 'home-tile-text' }, description),
      extra);
  };
  return h('div', { class: 'home' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('check', 30)), 'ZeroPensieri'),
    h('h1', { class: 'home-title' }, `${greeting()} Cosa vuoi fare?`),
    h('div', { class: 'home-tiles' },
      tile('upload', 'Aggiungi una foto, un PDF o un file Word al tuo archivio.'),
      tile('browse', 'Guarda e ritrova i documenti che hai messo in ordine.'),
      tile('topay', 'Le multe, le bollette e le altre cose da non dimenticare.',
        h('span', { class: `home-badge${toPayCount ? '' : ' home-badge-ok'}` },
          toPayCount ? countLabel(toPayCount, 'da pagare', 'da pagare') : 'Tutto pagato'))),
    h('p', { class: 'home-footer' },
      'I documenti sono nella cartella ', h('strong', null, rootName), '. ',
      h('button', { class: 'link', onclick: changeRoot }, 'Cambia cartella')));
}

async function changeRoot() {
  const sure = await confirmBox({
    title: 'Vuoi collegare un\'altra cartella?',
    message: 'I documenti che hai già archiviato restano dove sono, ma il programma mostrerà quelli della nuova cartella.',
    yes: 'Sì, scegli un\'altra cartella',
    no: 'No, lascia così',
  });
  if (sure) chooseRoot();
}

// ---------- barra di stato del lettore di documenti ----------

function renderStatusbar() {
  const status = app.conversion;
  let content = null;
  let level = 'info';
  if (status && app.state?.root) {
    const { engine, current, waiting } = status;
    if (engine.state === 'downloading') {
      const percent = Math.floor(engine.progress * 100);
      content = [
        icon('clock'),
        h('span', null, `Sto preparando il lettore di documenti (solo la prima volta): ${percent}%. Intanto puoi usare il programma.`),
        h('progress', { max: 100, value: percent }),
      ];
    } else if (engine.state === 'error' && waiting > 0) {
      level = 'warn';
      content = [
        icon('warning'),
        h('span', null, 'Non riesco a scaricare il lettore di documenti. Controlla che Internet funzioni.'),
        h('button', { class: 'btn btn-small', onclick: () => window.zp.retryEngine() }, 'Riprova'),
      ];
    } else if (current) {
      const pages = current.pages > 1 ? ` (pagina ${current.page} di ${current.pages})` : '';
      const others = waiting > 1 ? ` Poi ne restano ${waiting - 1}.` : '';
      content = [
        h('span', { class: 'spinner' }),
        h('span', null, `Sto leggendo «${current.name}»${pages} per crearne la copia in testo. Può volerci qualche minuto: intanto puoi usare il programma.${others}`),
      ];
    }
  }
  statusbar.hidden = !content;
  statusbar.dataset.level = level;
  if (content) fill(statusbar, content);
}

// ---------- avvio ----------

window.zp.onChanged((state) => {
  app.state = state;
  if (app.current?.name === 'home') go('home');
  else app.current?.refresh?.();
});

window.zp.onConversionStatus((status) => {
  app.conversion = status;
  renderStatusbar();
});

// Niente "apri file" del browser quando si trascina qualcosa fuori dalla zona giusta.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault());
}

(async function start() {
  try {
    app.state = await window.zp.state();
    app.conversion = await window.zp.conversionStatus();
  } catch (err) { showError(err); }
  renderStatusbar();
  go('home');
})();
