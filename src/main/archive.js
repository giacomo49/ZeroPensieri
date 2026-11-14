'use strict';
// Archivio: tutto quello che riguarda la cartella collegata.
// I file veri stanno nella cartella scelta dall'utente; le etichette ("da pagare",
// "già pagato", scadenze, stato della conversione) stanno in
// <cartella>/.zeropensieri/archivio.json, così viaggiano insieme ai documenti.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const META_DIR = '.zeropensieri';
const DB_FILE = 'archivio.json';

const KINDS = {
  image: ['.jpg', '.jpeg', '.png'],
  pdf: ['.pdf'],
  word: ['.docx', '.doc'],
  markdown: ['.md'],
};
const UPLOAD_EXTENSIONS = [...KINDS.image, ...KINDS.pdf, ...KINDS.word];
const PREVIEW_ONLY_IMAGES = ['.webp', '.gif', '.bmp'];
const IGNORED_FILES = new Set(['desktop.ini', 'thumbs.db']);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function kindOf(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  for (const [kind, exts] of Object.entries(KINDS)) if (exts.includes(ext)) return kind;
  if (PREVIEW_ONLY_IMAGES.includes(ext)) return 'image';
  if (ext === '.txt') return 'text';
  return 'other';
}

// Percorsi relativi sempre con "/" così l'archivio resta valido tra Windows e Mac.
const toRel = (p) => p.split(path.sep).join('/');

function safeResolve(root, rel = '') {
  const abs = path.resolve(root, rel);
  const relBack = path.relative(root, abs);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) {
    throw new Error('Percorso fuori dalla cartella collegata');
  }
  if (toRel(relBack).split('/').some((part) => part === META_DIR)) {
    throw new Error('Percorso riservato');
  }
  return abs;
}

function sanitizeName(raw) {
  let name = String(raw ?? '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '');
  if (name.length > 80) name = name.slice(0, 80).trim();
  if (WINDOWS_RESERVED.test(name)) name = `${name} documento`;
  return name;
}

function isHidden(name) {
  return name.startsWith('.') || name.startsWith('~$') || IGNORED_FILES.has(name.toLowerCase());
}

class Archive {
  constructor(root) {
    this.root = path.resolve(root);
    this.metaDir = path.join(this.root, META_DIR);
    this.dbPath = path.join(this.metaDir, DB_FILE);
    this.db = this._load();
  }

  // ---------- archivio.json ----------

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      if (data && typeof data.documents === 'object') return data;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // File rovinato: lo mettiamo da parte invece di perderlo.
        try { fs.renameSync(this.dbPath, `${this.dbPath}.rovinato-${Date.now()}`); } catch {}
      }
    }
    return { version: 1, documents: {} };
  }

  _save() {
    fs.mkdirSync(this.metaDir, { recursive: true });
    if (process.platform === 'win32') {
      try { require('node:child_process').execFile('attrib', ['+h', this.metaDir]); } catch {}
    }
    const tmp = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.dbPath);
  }

  _docByFile(rel) {
    return Object.values(this.db.documents).find((d) => d.files.includes(rel) || d.markdown === rel) || null;
  }

  _exists(rel) {
    try { return fs.statSync(safeResolve(this.root, rel)).isFile(); } catch { return false; }
  }

  _publicDoc(doc) {
    return {
      id: doc.id,
      name: doc.name,
      folder: doc.folder,
      files: doc.files,
      markdown: doc.markdown && this._exists(doc.markdown) ? doc.markdown : null,
      toPay: !!doc.toPay,
      paid: !!doc.paid,
      paidAt: doc.paidAt || null,
      dueDate: doc.dueDate || null,
      addedAt: doc.addedAt,
      conversion: doc.conversion || null,
      missing: !doc.files.some((f) => this._exists(f)),
    };
  }

  getDoc(id) {
    const doc = this.db.documents[id];
    return doc ? this._publicDoc(doc) : null;
  }

  // ---------- navigazione ----------

  list(rel = '') {
    const abs = safeResolve(this.root, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const folders = [];
    const files = [];
    for (const entry of entries) {
      if (isHidden(entry.name)) continue;
      const childRel = toRel(path.join(rel, entry.name));
      if (entry.isDirectory()) {
        let count = 0;
        try {
          count = fs.readdirSync(path.join(abs, entry.name)).filter((n) => !isHidden(n)).length;
        } catch {}
        folders.push({ name: entry.name, rel: childRel, count });
      } else if (entry.isFile()) {
        let stat;
        try { stat = fs.statSync(path.join(abs, entry.name)); } catch { continue; }
        const doc = this._docByFile(childRel);
        files.push({
          name: entry.name,
          rel: childRel,
          kind: kindOf(entry.name),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          doc: doc ? this._publicDoc(doc) : null,
          isTextCopy: !!doc && doc.markdown === childRel,
        });
      }
    }
    const byName = (a, b) => a.name.localeCompare(b.name, 'it', { numeric: true, sensitivity: 'base' });
    // Le cartelle degli anni: prima le più recenti.
    const isYear = (f) => /^(19|20)\d\d$/.test(f.name);
    folders.sort((a, b) => (isYear(a) && isYear(b) ? b.name.localeCompare(a.name) : byName(a, b)));
    files.sort(byName);
    return { rel: toRel(rel), folders, files };
  }

  createFolder(parentRel, rawName) {
    const name = sanitizeName(rawName);
    if (!name) throw new Error('Scrivi un nome per la cartella');
    const abs = safeResolve(this.root, path.join(parentRel || '', name));
    fs.mkdirSync(abs, { recursive: true });
    return toRel(path.relative(this.root, abs));
  }

  // ---------- aggiunta documenti ----------

  /**
   * Copia nell'archivio uno o più file che insieme formano UN documento
   * (es. le foto delle due facciate di una lettera).
   */
  addDocument({ sources, name, folder = '', toPay = false, dueDate = null, convert = true }) {
    if (!Array.isArray(sources) || sources.length === 0) throw new Error('Nessun file scelto');
    const cleanName = sanitizeName(name) || sanitizeName(path.parse(sources[0]).name) || 'Documento';
    const folderAbs = safeResolve(this.root, folder);
    fs.mkdirSync(folderAbs, { recursive: true });

    for (const src of sources) {
      const ext = path.extname(src).toLowerCase();
      if (!UPLOAD_EXTENSIONS.includes(ext)) throw new Error(`Tipo di file non adatto: ${path.basename(src)}`);
      if (!fs.statSync(src).isFile()) throw new Error(`File non trovato: ${path.basename(src)}`);
    }

    // Cerca un nome libero: "Multa", poi "Multa (2)", "Multa (3)"...
    const targetsFor = (base) => {
      const many = sources.length > 1;
      const fileNames = sources.map((src, i) =>
        `${base}${many ? ` - pagina ${i + 1}` : ''}${path.extname(src).toLowerCase()}`);
      return { fileNames, mdName: `${base}.md` };
    };
    const taken = new Set(fs.readdirSync(folderAbs).map((n) => n.toLowerCase()));
    let base = cleanName;
    let targets = targetsFor(base);
    for (let n = 2; [...targets.fileNames, targets.mdName].some((f) => taken.has(f.toLowerCase())); n++) {
      base = `${cleanName} (${n})`;
      targets = targetsFor(base);
    }

    const copied = [];
    try {
      sources.forEach((src, i) => {
        const dest = path.join(folderAbs, targets.fileNames[i]);
        fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        copied.push(dest);
      });
    } catch (err) {
      for (const f of copied) { try { fs.unlinkSync(f); } catch {} }
      throw err;
    }

    const relFolder = toRel(path.relative(this.root, folderAbs));
    const rel = (fileName) => toRel(path.join(relFolder, fileName));
    const id = crypto.randomUUID();
    const doc = {
      id,
      name: base,
      folder: relFolder,
      files: targets.fileNames.map(rel),
      markdown: convert ? rel(targets.mdName) : null,
      toPay: !!toPay,
      paid: false,
      paidAt: null,
      dueDate: toPay && dueDate ? dueDate : null,
      addedAt: new Date().toISOString(),
      conversion: convert ? { status: 'pending' } : null,
    };
    this.db.documents[id] = doc;
    this._save();
    return this._publicDoc(doc);
  }

  // ---------- cose da pagare ----------

  listToPay() {
    const docs = Object.values(this.db.documents).filter((d) => d.toPay).map((d) => this._publicDoc(d));
    const pending = docs.filter((d) => !d.paid).sort((a, b) => {
      // Prima quelle con scadenza (la più vicina in cima), poi le altre in ordine di arrivo.
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.addedAt.localeCompare(b.addedAt);
    });
    const paid = docs.filter((d) => d.paid).sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''));
    return { pending, paid };
  }

  countToPay() {
    return Object.values(this.db.documents).filter((d) => d.toPay && !d.paid).length;
  }

  setPaid(id, paid) {
    const doc = this.db.documents[id];
    if (!doc) throw new Error('Documento non trovato');
    doc.paid = !!paid;
    doc.paidAt = paid ? new Date().toISOString() : null;
    this._save();
    return this._publicDoc(doc);
  }

  /** Mette (o toglie) un file già presente in archivio tra le cose da pagare. */
  setToPay(fileRel, toPay, dueDate = null) {
    safeResolve(this.root, fileRel);
    let doc = this._docByFile(fileRel);
    if (!doc) {
      if (!toPay) return null;
      if (!this._exists(fileRel)) throw new Error('File non trovato');
      const id = crypto.randomUUID();
      doc = {
        id,
        name: path.parse(fileRel).name,
        folder: toRel(path.dirname(fileRel)).replace(/^\.$/, ''),
        files: [fileRel],
        markdown: null,
        addedAt: new Date().toISOString(),
        conversion: null,
      };
      this.db.documents[id] = doc;
    }
    doc.toPay = !!toPay;
    doc.dueDate = toPay && dueDate ? dueDate : null;
    if (!toPay) { doc.paid = false; doc.paidAt = null; }
    this._save();
    return this._publicDoc(doc);
  }

  /** Dimentica un documento (i file NON vengono toccati). */
  forget(id) {
    delete this.db.documents[id];
    this._save();
  }

  /** Da chiamare dopo aver spostato un file nel cestino. */
  fileRemoved(fileRel) {
    const doc = this._docByFile(fileRel);
    if (!doc) return;
    if (doc.markdown === fileRel) {
      doc.markdown = null;
      doc.conversion = null;
    } else {
      doc.files = doc.files.filter((f) => f !== fileRel);
      if (doc.files.length === 0) delete this.db.documents[doc.id];
    }
    this._save();
  }

  // ---------- conversione in testo ----------

  pendingConversions() {
    return Object.values(this.db.documents)
      .filter((d) => d.conversion && (d.conversion.status === 'pending' || d.conversion.status === 'running'))
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
      .map((d) => this._publicDoc(d));
  }

  setConversion(id, conversion) {
    const doc = this.db.documents[id];
    if (!doc) return;
    doc.conversion = conversion;
    this._save();
  }

  retryConversion(id) {
    const doc = this.db.documents[id];
    if (!doc || !doc.markdown) return;
    doc.conversion = { status: 'pending' };
    this._save();
  }

  writeMarkdown(id, text) {
    const doc = this.db.documents[id];
    if (!doc || !doc.markdown) return;
    fs.writeFileSync(safeResolve(this.root, doc.markdown), text, 'utf8');
  }
}

module.exports = { Archive, safeResolve, sanitizeName, kindOf, UPLOAD_EXTENSIONS, META_DIR };
