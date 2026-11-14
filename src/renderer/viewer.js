// Visualizzatore: mostra un documento a tutto schermo, con le azioni principali.
import { marked } from '/lib/marked.js';
import DOMPurify from '/lib/purify.js';
import { h, icon, fill, confirmBox, dialogBox, showError } from './dom.js';
import { fileUrl, dueInfo } from './format.js';
import { loadPdf, renderPage, closePdf } from './pdf.js';
import { statusBadge } from './browse.js';

const KIND_BY_EXT = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', bmp: 'image',
  pdf: 'pdf', docx: 'word', doc: 'word', md: 'markdown', txt: 'text',
};
const kindOf = (rel) => KIND_BY_EXT[rel.split('.').pop().toLowerCase()] || 'other';

const safeHtml = (html) => DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'] });

async function renderFile(rel, isClosed) {
  const kind = kindOf(rel);
  const url = fileUrl('file', rel);
  if (kind === 'image') return h('img', { class: 'page', src: url, alt: '' });

  if (kind === 'pdf') {
    const pdf = await loadPdf(url);
    const canvases = Array.from({ length: pdf.numPages }, () => h('canvas', { class: 'page' }));
    const holder = h('div', { class: 'pdf-pages' }, canvases);
    // Le pagine si disegnano una dopo l'altra; il PDF si chiude alla fine.
    (async () => {
      try {
        for (const [i, canvas] of canvases.entries()) {
          if (isClosed()) break;
          await renderPage(pdf, i + 1, canvas, 1000);
        }
      } finally { closePdf(pdf); }
    })().catch((err) => {
      console.error('Anteprima PDF non riuscita:', err);
      holder.append(h('p', { class: 'empty' }, 'Non riesco a mostrare tutte le pagine.'));
    });
    return holder;
  }

  if (kind === 'markdown' || kind === 'text') {
    const text = await (await fetch(url)).text();
    const article = h('article', { class: 'page text-page' });
    if (kind === 'markdown') article.innerHTML = safeHtml(marked.parse(text, { gfm: true, breaks: true }));
    else article.append(h('pre', null, text));
    return article;
  }

  if (kind === 'word') {
    const html = await window.zp.wordHtml(rel);
    if (html != null) {
      const article = h('article', { class: 'page text-page' });
      article.innerHTML = safeHtml(html);
      return article;
    }
  }
  return h('div', { class: 'no-preview' },
    icon('file', 72),
    h('p', null, 'Per questo tipo di file non c\'è l\'anteprima.'),
    h('button', { class: 'btn btn-primary btn-big', onclick: () => window.zp.openFile(rel).catch(showError) }, icon('open'), 'Apri con il computer'));
}

/** Chiede (facoltativa) la scadenza quando si mette un documento tra le cose da pagare. */
function askDueDate() {
  return dialogBox((close) => {
    const input = h('input', { class: 'input input-date', type: 'date', min: '2000-01-01', max: '2100-12-31' });
    return [
      h('h2', null, 'Metto questo documento tra le cose da pagare?'),
      h('label', { class: 'field' }, h('span', null, 'Entro quando va pagato? (se lo sai)'), input),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-plain', onclick: () => close(undefined) }, 'Annulla'),
        h('button', { class: 'btn btn-danger', onclick: () => close({ dueDate: input.value || null }) }, 'Sì, è da pagare')),
    ];
  });
}

/**
 * @param {object} opts
 * @param {string[]} opts.files   percorsi (relativi alla cartella collegata) da mostrare in fila
 * @param {string} opts.title
 * @param {() => void} [opts.onChange]  chiamata quando cambia qualcosa (pagato, eliminato...)
 */
export async function openViewer({ files, title, onChange }) {
  const main = files[0];
  const folderRel = main.split('/').slice(0, -1).join('/');
  let doc = null;
  let closed = false;

  const actions = h('div', { class: 'viewer-actions' });
  const info = h('div', { class: 'viewer-info' });
  const body = h('div', { class: 'viewer-body' }, h('p', { class: 'empty' }, 'Un momento…'));
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'viewer-bar' },
      h('button', { class: 'btn btn-back', onclick: close }, icon('back'), 'Chiudi'),
      h('h1', null, title),
      actions),
    info, body);

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(event) {
    if (event.key === 'Escape' && !document.querySelector('.backdrop')) close();
  }
  const changed = () => { onChange?.(); return refreshDoc(); };

  async function refreshDoc() {
    // Lo stato (da pagare, copia in testo...) si legge dall'elenco della cartella.
    try {
      const listing = await window.zp.list(folderRel);
      doc = listing.files.find((f) => f.rel === main)?.doc || null;
    } catch { doc = null; }
    renderChrome();
  }

  function renderChrome() {
    const act = (fn) => () => fn().then(changed).catch(showError);
    fill(actions,
      doc?.toPay && !doc.paid && h('button', { class: 'btn btn-green', onclick: act(() => window.zp.setPaid({ id: doc.id, paid: true })) }, icon('check'), 'Segna come PAGATO'),
      !doc?.toPay && h('button', {
        class: 'btn btn-plain',
        onclick: async () => {
          const answer = await askDueDate();
          if (answer) act(() => window.zp.setToPay({ rel: main, toPay: true, dueDate: answer.dueDate }))();
        },
      }, icon('euro'), 'È da pagare'),
      h('button', { class: 'btn btn-plain', onclick: () => window.zp.openFile(main).catch(showError) }, icon('open'), 'Apri con il computer'),
      h('button', { class: 'btn btn-plain btn-quiet', onclick: remove }, icon('trash'), 'Elimina'));

    const due = doc?.toPay && !doc.paid ? dueInfo(doc.dueDate) : null;
    const conversion = doc?.conversion;
    fill(info,
      statusBadge(doc),
      due && h('span', { class: `due due-${due.level}` }, due.text),
      conversion?.status === 'pending' && h('span', { class: 'note' }, 'Copia in testo: in attesa.'),
      conversion?.status === 'running' && h('span', { class: 'note' }, 'Copia in testo: la sto preparando…'),
      conversion?.status === 'error' && h('span', { class: 'note note-warn' },
        'Non sono riuscito a creare la copia in testo. ',
        h('button', { class: 'link', onclick: () => window.zp.retryConversion(doc.id).then(changed).catch(showError) }, 'Riprova')));
    info.hidden = info.childElementCount === 0;
  }

  async function remove() {
    const sure = await confirmBox({
      title: 'Vuoi eliminare questo file?',
      message: `«${main.split('/').pop()}» verrà spostato nel Cestino del computer.`,
      yes: 'Sì, elimina', no: 'No, tienilo', danger: true,
    });
    if (!sure) return;
    try {
      await window.zp.trashFile(main);
      onChange?.();
      close();
    } catch (err) { showError(err); }
  }

  document.addEventListener('keydown', onKey);
  document.getElementById('overlay-root').append(overlay);
  refreshDoc();

  const rendered = [];
  for (const rel of files) {
    try { rendered.push(await renderFile(rel, () => closed)); }
    catch (err) {
      console.error('Anteprima non riuscita:', err); rendered.push(h('p', { class: 'empty' }, 'Non riesco a mostrare questo file. Forse è stato spostato o eliminato.')); }
  }
  if (!closed) fill(body, rendered);
}
