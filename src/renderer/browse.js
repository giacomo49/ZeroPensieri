// I TUOI DOCUMENTI: naviga nella cartella collegata e guarda le anteprime.
import { h, icon, fill, showError } from './dom.js';
import { app, go } from './app.js';
import { breadcrumb, folderTile, backTile, newFolderTile } from './folders.js';
import { fileUrl } from './format.js';
import { loadPdf, renderPage, closePdf } from './pdf.js';
import { openViewer } from './viewer.js';

// Le anteprime dei PDF si disegnano una alla volta, solo quando entrano nello schermo.
let pdfQueue = Promise.resolve();
const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    thumbObserver.unobserve(entry.target);
    const canvas = entry.target;
    pdfQueue = pdfQueue.then(async () => {
      if (!canvas.isConnected) return;
      const pdf = await loadPdf(canvas.dataset.url);
      try { await renderPage(pdf, 1, canvas, 260); } finally { closePdf(pdf); }
    }).catch(() => canvas.replaceWith(h('span', { class: 'filetype filetype-pdf' }, 'PDF')));
  }
}, { rootMargin: '200px' });

export function statusBadge(doc) {
  if (!doc?.toPay) return null;
  return doc.paid
    ? h('span', { class: 'badge badge-paid' }, icon('check', 18), 'Già pagato')
    : h('span', { class: 'badge badge-topay' }, 'Da pagare');
}

export function fileThumb(file) {
  if (file.kind === 'image') {
    const img = h('img', { src: fileUrl('thumb', file.rel), alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(h('span', { class: 'filetype filetype-image' }, 'FOTO')));
    return img;
  }
  if (file.kind === 'pdf') {
    const canvas = h('canvas', { dataset: { url: fileUrl('file', file.rel) } });
    thumbObserver.observe(canvas);
    return canvas;
  }
  const labels = { word: 'WORD', markdown: 'TESTO', text: 'TESTO' };
  return h('span', { class: `filetype filetype-${file.kind}` }, labels[file.kind] || 'FILE');
}

function fileTile(file, onOpen) {
  return h('button', { class: 'tile tile-file', onclick: () => onOpen(file) },
    h('span', { class: 'tile-thumb' }, fileThumb(file)),
    h('span', { class: 'tile-name' }, file.name),
    file.isTextCopy ? h('span', { class: 'tile-meta' }, 'copia in testo') : statusBadge(file.doc));
}

export function browseView(root, params) {
  let currentRel = params.folder || '';

  async function show(rel) {
    let listing;
    try {
      listing = await window.zp.list(rel);
    } catch (err) {
      if (rel) return show(''); // la cartella non c'è più: torna all'inizio
      return showError(err);
    }
    currentRel = listing.rel;
    const empty = listing.folders.length === 0 && listing.files.length === 0;
    fill(root,
      h('div', { class: 'browse-bar' },
        breadcrumb(app.state.rootName, listing.rel, show),
        h('button', { class: 'btn btn-blue', onclick: () => go('upload', { folder: listing.rel }) }, icon('upload'), 'Carica qui un documento')),
      h('div', { class: 'tiles' },
        listing.rel && backTile(listing.rel, show),
        listing.folders.map((f) => folderTile(f, show)),
        listing.files.map((f) => fileTile(f, (file) => openViewer({ files: [file.rel], title: file.name, onChange: () => show(currentRel) }))),
        newFolderTile(listing.rel, () => show(currentRel))),
      empty && h('p', { class: 'empty' }, 'Questa cartella è ancora vuota.'));
  }

  show(currentRel);
  return { refresh: () => show(currentRel) };
}
