'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Archive, sanitizeName, safeResolve, kindOf } = require('../../src/main/archive');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-test-'));
  const root = path.join(dir, 'Documenti');
  const inbox = path.join(dir, 'inbox');
  fs.mkdirSync(root);
  fs.mkdirSync(inbox);
  const source = (name, content = 'x') => {
    const file = path.join(inbox, name);
    fs.writeFileSync(file, content);
    return file;
  };
  return { root, source, archive: new Archive(root) };
}

test('sanitizeName toglie i caratteri vietati su Windows', () => {
  assert.equal(sanitizeName('  Multa: Bologna / nov?  '), 'Multa Bologna nov');
  assert.equal(sanitizeName('bolletta...'), 'bolletta');
  assert.equal(sanitizeName('CON'), 'CON documento');
  assert.equal(sanitizeName('..\\..\\segreto'), 'segreto');
  assert.equal(sanitizeName('   '), '');
});

test('safeResolve rifiuta i percorsi fuori dalla cartella e quelli riservati', () => {
  const root = path.resolve('/tmp/zp-root');
  assert.equal(safeResolve(root, 'Bollette/2026'), path.join(root, 'Bollette', '2026'));
  assert.throws(() => safeResolve(root, '../fuori.txt'));
  assert.throws(() => safeResolve(root, 'Bollette/../../fuori.txt'));
  assert.throws(() => safeResolve(root, '.zeropensieri/archivio.json'));
});

test('kindOf riconosce i tipi di file', () => {
  assert.equal(kindOf('Foto.JPG'), 'image');
  assert.equal(kindOf('a.pdf'), 'pdf');
  assert.equal(kindOf('a.docx'), 'word');
  assert.equal(kindOf('a.md'), 'markdown');
  assert.equal(kindOf('a.zip'), 'other');
});

test('addDocument copia il file, lo registra e non sovrascrive mai', () => {
  const { root, source, archive } = setup();
  const first = archive.addDocument({ sources: [source('IMG_001.jpg', 'uno')], name: 'Multa Bologna', folder: 'Multe/2026', toPay: true, dueDate: '2026-12-01' });
  assert.deepEqual(first.files, ['Multe/2026/Multa Bologna.jpg']);
  assert.equal(first.markdown, null, 'il testo non esiste finché la conversione non finisce');
  assert.equal(first.conversion.status, 'pending');
  assert.equal(first.toPay, true);
  assert.equal(first.dueDate, '2026-12-01');
  assert.equal(fs.readFileSync(path.join(root, 'Multe/2026/Multa Bologna.jpg'), 'utf8'), 'uno');

  const second = archive.addDocument({ sources: [source('IMG_002.jpg', 'due')], name: 'Multa Bologna', folder: 'Multe/2026', convert: false });
  assert.deepEqual(second.files, ['Multe/2026/Multa Bologna (2).jpg']);
  assert.equal(second.conversion, null);
  assert.equal(fs.readFileSync(path.join(root, 'Multe/2026/Multa Bologna.jpg'), 'utf8'), 'uno');
});

test('più foto diventano le pagine di un solo documento', () => {
  const { source, archive } = setup();
  const doc = archive.addDocument({ sources: [source('a.jpg'), source('b.png')], name: 'Lettera INPS', folder: '' });
  assert.deepEqual(doc.files, ['Lettera INPS - pagina 1.jpg', 'Lettera INPS - pagina 2.png']);
  assert.equal(archive.pendingConversions().length, 1);
});

test('addDocument rifiuta i tipi non previsti e le cartelle fuori archivio', () => {
  const { source, archive } = setup();
  assert.throws(() => archive.addDocument({ sources: [source('virus.exe')], name: 'x', folder: '' }), /non adatto/);
  assert.throws(() => archive.addDocument({ sources: [source('a.pdf')], name: 'x', folder: '../altrove' }));
});

test('da pagare -> pagato -> di nuovo da pagare', () => {
  const { source, archive } = setup();
  const later = archive.addDocument({ sources: [source('a.pdf')], name: 'Tari', folder: '', toPay: true, dueDate: '2027-01-31', convert: false });
  const sooner = archive.addDocument({ sources: [source('b.pdf')], name: 'Multa', folder: '', toPay: true, dueDate: '2026-11-20', convert: false });
  const undated = archive.addDocument({ sources: [source('c.pdf')], name: 'Bollo', folder: '', toPay: true, convert: false });
  archive.addDocument({ sources: [source('d.pdf')], name: 'Referto', folder: '', convert: false });

  assert.deepEqual(archive.listToPay().pending.map((d) => d.name), ['Multa', 'Tari', 'Bollo']);
  assert.equal(archive.countToPay(), 3);

  archive.setPaid(sooner.id, true);
  let lists = archive.listToPay();
  assert.deepEqual(lists.pending.map((d) => d.name), ['Tari', 'Bollo']);
  assert.deepEqual(lists.paid.map((d) => d.name), ['Multa']);
  assert.ok(lists.paid[0].paidAt);

  archive.setPaid(sooner.id, false);
  assert.equal(archive.countToPay(), 3);
  assert.equal(archive.getDoc(later.id).paid, false);
  assert.equal(archive.getDoc(undated.id).dueDate, null);
});

test('le etichette restano dopo aver riaperto l\'archivio', () => {
  const { root, source, archive } = setup();
  const doc = archive.addDocument({ sources: [source('a.pdf')], name: 'Tari', folder: 'Tasse', toPay: true, convert: false });
  archive.setPaid(doc.id, true);
  const reopened = new Archive(root);
  assert.equal(reopened.getDoc(doc.id).paid, true);
  const file = reopened.list('Tasse').files[0];
  assert.equal(file.doc.id, doc.id);
});

test('un file già in archivio si può mettere tra le cose da pagare', () => {
  const { root, archive } = setup();
  fs.mkdirSync(path.join(root, 'Vecchi'));
  fs.writeFileSync(path.join(root, 'Vecchi', 'bollo.pdf'), 'x');
  const doc = archive.setToPay('Vecchi/bollo.pdf', true, '2026-12-31');
  assert.equal(doc.name, 'bollo');
  assert.equal(doc.folder, 'Vecchi');
  assert.equal(archive.countToPay(), 1);
  archive.setToPay('Vecchi/bollo.pdf', false);
  assert.equal(archive.countToPay(), 0);
});

test('list nasconde i file di servizio e segnala i documenti spariti', () => {
  const { root, source, archive } = setup();
  const doc = archive.addDocument({ sources: [source('a.pdf')], name: 'Tari', folder: '', toPay: true, convert: false });
  fs.writeFileSync(path.join(root, 'desktop.ini'), '');
  fs.mkdirSync(path.join(root, '2025'));
  fs.mkdirSync(path.join(root, '2026'));
  const listing = archive.list('');
  assert.deepEqual(listing.files.map((f) => f.name), ['Tari.pdf']);
  assert.deepEqual(listing.folders.map((f) => f.name), ['2026', '2025'], 'anni più recenti per primi');

  fs.unlinkSync(path.join(root, 'Tari.pdf'));
  assert.equal(archive.listToPay().pending[0].missing, true);
  archive.forget(doc.id);
  assert.equal(archive.countToPay(), 0);
});

test('conversione: scrive il testo e aggiorna lo stato', () => {
  const { root, source, archive } = setup();
  const doc = archive.addDocument({ sources: [source('a.jpg')], name: 'Multa', folder: 'Multe' });
  archive.writeMarkdown(doc.id, '# Multa\n\ntesto\n');
  archive.setConversion(doc.id, { status: 'done' });
  assert.equal(archive.getDoc(doc.id).markdown, 'Multe/Multa.md');
  assert.equal(fs.readFileSync(path.join(root, 'Multe/Multa.md'), 'utf8'), '# Multa\n\ntesto\n');
  assert.equal(archive.pendingConversions().length, 0);
  const md = archive.list('Multe').files.find((f) => f.name === 'Multa.md');
  assert.equal(md.isTextCopy, true);

  archive.fileRemoved('Multe/Multa.jpg');
  assert.equal(archive.getDoc(doc.id), null, 'tolto l\'originale, il documento esce dall\'elenco');
});
