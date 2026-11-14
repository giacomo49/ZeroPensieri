'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Archive } = require('../../src/main/archive');
const { Converter, buildMarkdown } = require('../../src/main/converter');

function fakeEngine({ failModel = false } = {}) {
  const engine = new EventEmitter();
  engine.status = () => ({ state: 'ready', progress: 1, error: null });
  let present = !failModel;
  engine.modelPresent = () => present;
  engine.ensureModel = async () => { if (failModel) throw new Error('niente internet'); present = true; };
  engine.recognize = async (jpeg) => `testo di ${jpeg.toString()}`;
  return engine;
}

const pages = {
  imageToJpeg: async (rel) => Buffer.from(rel),
  pdfPageCount: async () => 2,
  pdfPageToJpeg: async (rel, n) => Buffer.from(`${rel}#${n}`),
};

function setup(engineOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-conv-'));
  const root = path.join(dir, 'Documenti');
  fs.mkdirSync(root);
  const source = (name) => { const f = path.join(dir, name); fs.writeFileSync(f, 'x'); return f; };
  const archive = new Archive(root);
  const converter = new Converter({
    getArchive: () => archive, engine: fakeEngine(engineOptions), pages,
    wordToMarkdown: async () => 'testo word',
  });
  const idle = () => new Promise((resolve) => {
    const check = () => (converter.running ? setTimeout(check, 5) : resolve());
    check();
  });
  return { root, source, archive, converter, idle };
}

test('buildMarkdown: titolo e pagine numerate solo se sono più di una', () => {
  assert.equal(buildMarkdown('Multa', ['ciao']), '# Multa\n\nciao\n');
  assert.equal(buildMarkdown('Multa', ['uno', '']), '# Multa\n\n## Pagina 1\n\nuno\n\n## Pagina 2\n\n_(pagina senza testo leggibile)_\n');
});

test('converte foto, PDF e Word in un unico file di testo per documento', async () => {
  const { root, source, archive, converter, idle } = setup();
  const photo = archive.addDocument({ sources: [source('a.jpg'), source('b.jpg')], name: 'Lettera', folder: '' });
  const pdf = archive.addDocument({ sources: [source('c.pdf')], name: 'Bolletta', folder: '' });
  const word = archive.addDocument({ sources: [source('d.docx')], name: 'Contratto', folder: '' });
  converter.kick();
  await idle();

  assert.equal(fs.readFileSync(path.join(root, 'Lettera.md'), 'utf8'),
    '# Lettera\n\n## Pagina 1\n\ntesto di Lettera - pagina 1.jpg\n\n## Pagina 2\n\ntesto di Lettera - pagina 2.jpg\n');
  assert.equal(fs.readFileSync(path.join(root, 'Bolletta.md'), 'utf8'),
    '# Bolletta\n\n## Pagina 1\n\ntesto di Bolletta.pdf#1\n\n## Pagina 2\n\ntesto di Bolletta.pdf#2\n');
  assert.equal(fs.readFileSync(path.join(root, 'Contratto.md'), 'utf8'), '# Contratto\n\ntesto word\n');
  for (const doc of [photo, pdf, word]) assert.equal(archive.getDoc(doc.id).conversion.status, 'done');
});

test('un documento che non si riesce a leggere non blocca gli altri', async () => {
  const { source, archive, converter, idle } = setup();
  const old = archive.addDocument({ sources: [source('vecchio.doc')], name: 'Vecchio', folder: '' });
  const ok = archive.addDocument({ sources: [source('a.jpg')], name: 'Foto', folder: '' });
  converter.kick();
  await idle();
  assert.equal(archive.getDoc(old.id).conversion.status, 'error');
  assert.match(archive.getDoc(old.id).conversion.message, /\.doc/);
  assert.equal(archive.getDoc(ok.id).conversion.status, 'done');
});

test('senza modello le foto restano in attesa, ma i Word si convertono lo stesso', async () => {
  const { source, archive, converter, idle } = setup({ failModel: true });
  const photo = archive.addDocument({ sources: [source('a.jpg')], name: 'Foto', folder: '' });
  const word = archive.addDocument({ sources: [source('d.docx')], name: 'Contratto', folder: '' });
  converter.kick();
  await idle();
  assert.equal(archive.getDoc(photo.id).conversion.status, 'pending');
  assert.equal(archive.getDoc(word.id).conversion.status, 'done');
});
