// COSE DA PAGARE: l'elenco dei documenti da pagare, con il tasto "Pagato".
import { h, icon, fill, confirmBox, showError } from './dom.js';
import { app } from './app.js';
import { fileThumb } from './browse.js';
import { openViewer } from './viewer.js';
import { dueInfo, formatDateTime, prettyPath, countLabel } from './format.js';

const KIND_BY_EXT = { jpg: 'image', jpeg: 'image', png: 'image', pdf: 'pdf', docx: 'word', doc: 'word' };

function thumbOf(doc) {
  const rel = doc.files[0];
  return fileThumb({ rel, kind: KIND_BY_EXT[rel.split('.').pop().toLowerCase()] || 'other' });
}

export function toPayView(root) {
  let showPaid = false;

  const act = (promise) => promise.then(refresh).catch(showError);

  function card(doc) {
    const due = doc.paid ? null : dueInfo(doc.dueDate);
    const view = () => openViewer({ files: doc.files, title: doc.name, onChange: refresh });
    return h('article', { class: `pay-card${doc.paid ? ' pay-card-paid' : ''}${due ? ` pay-card-${due.level}` : ''}` },
      h('button', { class: 'pay-thumb', onclick: view, disabled: doc.missing, title: 'Guarda il documento' }, thumbOf(doc)),
      h('div', { class: 'pay-main' },
        h('h3', null, doc.name),
        due && h('p', { class: `due due-${due.level}` }, due.level === 'late' && icon('warning', 22), due.text),
        doc.paid && h('p', { class: 'pay-when' }, icon('check', 20), `Pagato il ${formatDateTime(doc.paidAt)}`),
        h('p', { class: 'pay-where' }, icon('folder', 20), prettyPath(app.state.rootName, doc.folder)),
        doc.missing && h('p', { class: 'note note-warn' }, 'Non trovo più il file: forse è stato spostato o eliminato.')),
      h('div', { class: 'pay-actions' },
        !doc.missing && h('button', { class: 'btn btn-plain', onclick: view }, icon('eye'), 'Guarda'),
        doc.paid
          ? h('button', { class: 'btn btn-plain', onclick: () => act(window.zp.setPaid({ id: doc.id, paid: false })) }, icon('undo'), 'Non è pagato')
          : h('button', { class: 'btn btn-green btn-big', onclick: () => act(window.zp.setPaid({ id: doc.id, paid: true })) }, icon('check', 32), 'PAGATO'),
        doc.missing && h('button', {
          class: 'btn btn-plain',
          onclick: async () => {
            const sure = await confirmBox({ title: 'Tolgo questa voce dall\'elenco?', yes: 'Sì, toglila', no: 'No' });
            if (sure) act(window.zp.forget(doc.id));
          },
        }, icon('close'), 'Togli dall\'elenco')));
  }

  async function refresh() {
    let lists;
    try { lists = await window.zp.listToPay(); } catch (err) { return showError(err); }
    const { pending, paid } = lists;
    fill(root,
      pending.length === 0
        ? h('div', { class: 'all-paid' },
          h('span', { class: 'done-mark' }, icon('check', 72)),
          h('h2', null, 'Non c\'è niente da pagare'),
          h('p', { class: 'lead' }, 'Quando carichi un documento da pagare, lo trovi qui.'))
        : [
          h('p', { class: 'pay-summary' }, 'Hai ', h('strong', null, countLabel(pending.length, 'cosa da pagare', 'cose da pagare')), '. Quando ne paghi una, premi il tasto verde ', h('strong', null, 'PAGATO'), '.'),
          h('div', { class: 'pay-list' }, pending.map(card)),
        ],
      paid.length > 0 && h('section', { class: 'paid-section' },
        h('button', { class: 'btn btn-plain', onclick: () => { showPaid = !showPaid; refresh(); } },
          showPaid ? 'Nascondi le cose già pagate' : `Mostra le cose già pagate (${paid.length})`),
        showPaid && h('div', { class: 'pay-list' }, paid.map(card))));
  }

  refresh();
  return { refresh };
}
