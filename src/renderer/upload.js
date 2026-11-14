// CARICA DOCUMENTO: scegli il file, la cartella, se è da pagare, e premi "Aggiungi".
import { h, icon, fill, messageBox, showError } from './dom.js';
import { app, go } from './app.js';
import { breadcrumb, folderTile, backTile, newFolderTile, yearTile } from './folders.js';
import { prettyPath } from './format.js';

export function uploadView(root, params) {
  const form = {
    sources: [],
    name: '',
    nameEdited: false,
    folder: params.folder || '',
    toPay: false,
    dueDate: '',
    convert: true,
    busy: false,
  };

  // ----- 1. il documento -----
  const filesBox = h('div');
  const nameInput = h('input', {
    class: 'input', type: 'text', maxLength: 80, placeholder: 'Per esempio: Multa Bologna novembre',
    oninput: () => { form.name = nameInput.value; form.nameEdited = true; updateSubmit(); },
  });
  const nameField = h('label', { class: 'field', hidden: true },
    h('span', null, 'Nome del documento (puoi cambiarlo)'), nameInput);

  async function addSources(promise) {
    try {
      const found = await promise;
      const rejected = found.filter((s) => s.rejected);
      form.sources.push(...found.filter((s) => !s.rejected));
      if (rejected.length) {
        await messageBox({
          title: 'Questo tipo di file non va bene',
          message: `Puoi caricare foto (JPG, PNG), PDF e documenti Word. Non ho potuto prendere: ${rejected.map((r) => r.name).join(', ')}.`,
        });
      }
      if (!form.nameEdited && form.sources.length) {
        form.name = form.sources[0].baseName;
        nameInput.value = form.name;
      }
      renderFiles();
    } catch (err) { showError(err); }
  }

  function renderFiles() {
    nameField.hidden = form.sources.length === 0;
    if (form.sources.length === 0) {
      const zone = h('div', { class: 'dropzone' },
        icon('upload', 56),
        h('p', { class: 'dropzone-title' }, 'Trascina qui il documento'),
        h('p', null, 'oppure'),
        h('button', { class: 'btn btn-primary btn-big', onclick: () => addSources(window.zp.pickFiles()) }, 'Scegli dal computer'),
        h('p', { class: 'hint' }, 'Vanno bene foto (JPG, PNG), PDF e documenti Word.'));
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dropzone-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('dropzone-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dropzone-over');
        if (e.dataTransfer.files.length) addSources(window.zp.registerDroppedFiles(e.dataTransfer.files));
      });
      fill(filesBox, zone);
    } else {
      fill(filesBox,
        h('div', { class: 'picked' },
          form.sources.map((source, i) => h('div', { class: 'picked-item' },
            h('div', { class: 'picked-thumb' }, thumbFor(source)),
            h('div', { class: 'picked-name' }, form.sources.length > 1 ? `Pagina ${i + 1}` : source.name),
            h('button', {
              class: 'btn btn-small btn-plain',
              onclick: () => { form.sources.splice(i, 1); renderFiles(); },
            }, icon('close', 20), 'Togli'))),
          h('button', { class: 'picked-add', onclick: () => addSources(window.zp.pickFiles()) },
            icon('plus', 40), h('span', null, 'Aggiungi un\'altra pagina'))),
        h('p', { class: 'hint' }, 'Se il documento ha più fogli, aggiungi qui tutte le foto: resteranno insieme.'));
    }
    updateSubmit();
  }

  function thumbFor(source) {
    if (source.kind === 'word') return h('span', { class: 'filetype filetype-word' }, 'WORD');
    const img = h('img', { src: source.thumbUrl, alt: '' });
    img.addEventListener('error', () => img.replaceWith(h('span', { class: `filetype filetype-${source.kind}` }, source.kind === 'pdf' ? 'PDF' : 'FOTO')));
    return img;
  }

  // ----- 2. la cartella -----
  const folderBox = h('div');
  async function showFolder(rel) {
    try {
      const listing = await window.zp.list(rel);
      form.folder = listing.rel;
      fill(folderBox,
        breadcrumb(app.state.rootName, listing.rel, showFolder),
        h('div', { class: 'tiles tiles-compact' },
          listing.rel && backTile(listing.rel, showFolder),
          listing.folders.map((f) => folderTile(f, showFolder, { showCount: false })),
          yearTile(listing, app.state.currentYear, showFolder),
          newFolderTile(listing.rel, showFolder)),
        h('p', { class: 'destination' }, 'Il documento andrà in: ', h('strong', null, prettyPath(app.state.rootName, listing.rel))));
    } catch (err) {
      if (rel) showFolder(''); else showError(err);
    }
  }

  // ----- 3. da pagare -----
  const dueInput = h('input', {
    class: 'input input-date', type: 'date', min: '2000-01-01', max: '2100-12-31',
    oninput: () => { form.dueDate = dueInput.value; },
  });
  const dueField = h('label', { class: 'field', hidden: true },
    h('span', null, 'Entro quando va pagato? (se lo sai)'), dueInput);
  const payNo = h('button', { class: 'choice', onclick: () => setToPay(false) }, 'No');
  const payYes = h('button', { class: 'choice choice-pay', onclick: () => setToPay(true) }, icon('euro'), 'Sì, è DA PAGARE');
  function setToPay(value) {
    form.toPay = value;
    payNo.classList.toggle('choice-on', !value);
    payYes.classList.toggle('choice-on', value);
    payNo.setAttribute('aria-pressed', String(!value));
    payYes.setAttribute('aria-pressed', String(value));
    dueField.hidden = !value;
  }
  setToPay(false);

  // ----- 4. copia in testo -----
  const convertBox = h('input', { type: 'checkbox', checked: true, onchange: () => { form.convert = convertBox.checked; } });

  // ----- aggiungi -----
  const submit = h('button', { class: 'btn btn-primary btn-huge', onclick: add }, icon('check', 36), 'Aggiungi all\'archivio');
  const submitHint = h('p', { class: 'hint' });
  function updateSubmit() {
    const ready = form.sources.length > 0 && form.name.trim() && !form.busy;
    submit.disabled = !ready;
    submitHint.textContent = form.sources.length === 0 ? 'Per prima cosa scegli il documento (punto 1).'
      : !form.name.trim() ? 'Scrivi un nome per il documento (punto 1).' : '';
  }

  async function add() {
    form.busy = true;
    updateSubmit();
    try {
      const doc = await window.zp.addDocument({
        tokens: form.sources.map((s) => s.token),
        name: form.name.trim(),
        folder: form.folder,
        toPay: form.toPay,
        dueDate: form.toPay && form.dueDate ? form.dueDate : null,
        convert: form.convert,
      });
      showDone(doc);
    } catch (err) {
      form.busy = false;
      updateSubmit();
      showError(err);
    }
  }

  function showDone(doc) {
    fill(root, h('div', { class: 'done' },
      h('span', { class: 'done-mark' }, icon('check', 72)),
      h('h2', null, 'Documento aggiunto!'),
      h('p', { class: 'lead' }, h('strong', null, doc.name), ' è al sicuro in ', h('strong', null, prettyPath(app.state.rootName, doc.folder)), '.'),
      doc.toPay && h('p', { class: 'lead' }, 'L\'ho messo anche tra le ', h('strong', null, 'cose da pagare'), '.'),
      doc.conversion && h('p', { class: 'hint' }, 'Sto preparando la copia in testo: comparirà da sola nella stessa cartella.'),
      h('div', { class: 'done-actions' },
        h('button', { class: 'btn btn-primary btn-big', onclick: () => go('upload', { folder: doc.folder }) }, icon('upload'), 'Carica un altro documento'),
        h('button', { class: 'btn btn-plain btn-big', onclick: () => go('home') }, icon('home'), 'Torna all\'inizio'))));
    document.getElementById('view').scrollTop = 0;
  }

  const step = (number, title, ...content) => h('section', { class: 'step' },
    h('h2', null, h('span', { class: 'step-number' }, String(number)), title), content);

  fill(root,
    step(1, 'Scegli il documento', filesBox, nameField),
    step(2, 'In quale cartella lo metto?', folderBox),
    step(3, 'È una cosa da pagare?',
      h('div', { class: 'choices' }, payNo, payYes), dueField),
    step(4, 'Copia in testo',
      h('label', { class: 'check' }, convertBox,
        h('span', null, 'Crea anche una copia in testo (Markdown)',
          h('small', null, 'Il computer legge il documento e ne scrive il testo in un secondo file.')))),
    h('div', { class: 'submit-row' }, submit, submitHint));

  renderFiles();
  showFolder(form.folder);
  return {};
}
