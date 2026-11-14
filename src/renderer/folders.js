// Pezzi condivisi per mostrare e scegliere le cartelle.
import { h, icon, promptBox, showError } from './dom.js';
import { splitRel, countLabel } from './format.js';

/** Briciole di pane: Documenti personali › Bollette › 2026 (ogni pezzo è cliccabile). */
export function breadcrumb(rootName, rel, onNavigate) {
  const parts = splitRel(rel);
  const crumbs = [{ label: rootName, rel: '' }, ...parts.map((p, i) => ({ label: p, rel: parts.slice(0, i + 1).join('/') }))];
  return h('nav', { class: 'breadcrumb', 'aria-label': 'Dove sei' },
    crumbs.map((crumb, i) => [
      i > 0 && h('span', { class: 'breadcrumb-sep' }, '›'),
      i === crumbs.length - 1
        ? h('span', { class: 'breadcrumb-here' }, crumb.label)
        : h('button', { class: 'breadcrumb-link', onclick: () => onNavigate(crumb.rel) }, crumb.label),
    ]));
}

export function folderTile(folder, onOpen, { showCount = true } = {}) {
  return h('button', { class: 'tile tile-folder', onclick: () => onOpen(folder.rel) },
    h('span', { class: 'tile-icon' }, icon('folder', 56)),
    h('span', { class: 'tile-name' }, folder.name),
    showCount && h('span', { class: 'tile-meta' }, folder.count === 0 ? 'vuota' : countLabel(folder.count, 'elemento', 'elementi')));
}

export function backTile(rel, onNavigate) {
  const parent = splitRel(rel).slice(0, -1).join('/');
  return h('button', { class: 'tile tile-action', onclick: () => onNavigate(parent) },
    h('span', { class: 'tile-icon' }, icon('back', 48)),
    h('span', { class: 'tile-name' }, 'Torna indietro'));
}

export function newFolderTile(rel, onCreated) {
  return h('button', {
    class: 'tile tile-action tile-dashed',
    onclick: async () => {
      const name = await promptBox({ title: 'Nuova cartella', label: 'Come vuoi chiamarla?', ok: 'Crea cartella', placeholder: 'Per esempio: Condominio' });
      if (!name) return;
      try { onCreated(await window.zp.createFolder({ parent: rel, name })); } catch (err) { showError(err); }
    },
  },
  h('span', { class: 'tile-icon' }, icon('plus', 48)),
  h('span', { class: 'tile-name' }, 'Nuova cartella'));
}

/** Dentro una cartella-tema propone al volo la cartella dell'anno in corso, se manca. */
export function yearTile(listing, currentYear, onCreated) {
  const depth = splitRel(listing.rel).length;
  const hereIsYear = /^(19|20)\d\d$/.test(splitRel(listing.rel).at(-1) || '');
  if (depth === 0 || hereIsYear || listing.folders.some((f) => f.name === currentYear)) return null;
  return h('button', {
    class: 'tile tile-action tile-dashed',
    onclick: async () => {
      try { onCreated(await window.zp.createFolder({ parent: listing.rel, name: currentYear })); } catch (err) { showError(err); }
    },
  },
  h('span', { class: 'tile-icon' }, icon('plus', 48)),
  h('span', { class: 'tile-name' }, `Crea cartella ${currentYear}`));
}
