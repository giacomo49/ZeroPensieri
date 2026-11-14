'use strict';
// Coda delle conversioni in testo (Markdown). Lavora un documento alla volta,
// in sottofondo: l'originale è già al sicuro in archivio, il testo arriva quando è pronto.
// La coda è salvata in archivio.json, quindi riparte da sola alla prossima apertura.

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { kindOf, safeResolve } = require('./archive');

function buildMarkdown(title, sections) {
  const parts = [`# ${title}`];
  const many = sections.length > 1;
  sections.forEach((section, i) => {
    if (many) parts.push(`## Pagina ${i + 1}`);
    parts.push(section.trim() || '_(pagina senza testo leggibile)_');
  });
  return `${parts.join('\n\n')}\n`;
}

class Converter extends EventEmitter {
  /**
   * @param {object} deps
   * @param {() => import('./archive').Archive | null} deps.getArchive
   * @param {import('./ocr').OcrEngine} deps.engine
   * @param {{ imageToJpeg(rel): Promise<Buffer>, pdfPageCount(rel): Promise<number>, pdfPageToJpeg(rel, n): Promise<Buffer> }} deps.pages
   * @param {(absPath: string) => Promise<string>} deps.wordToMarkdown
   */
  constructor({ getArchive, engine, pages, wordToMarkdown }) {
    super();
    this.getArchive = getArchive;
    this.engine = engine;
    this.pages = pages;
    this.wordToMarkdown = wordToMarkdown;
    this.running = false;
    this.current = null;
    engine.on('status', () => this._emit());
  }

  status() {
    const archive = this.getArchive();
    const waiting = archive ? archive.pendingConversions().length : 0;
    return { engine: this.engine.status(), current: this.current, waiting };
  }

  _emit() { this.emit('status', this.status()); }

  /** Avvia la coda se non sta già lavorando. */
  kick() {
    if (this.running) return;
    this.running = true;
    this._run().catch(() => {}).finally(() => {
      this.running = false;
      this.current = null;
      this._emit();
    });
  }

  async _run() {
    const skipped = new Set();
    for (;;) {
      const archive = this.getArchive();
      if (!archive) return;
      const pending = archive.pendingConversions().filter((d) => !skipped.has(d.id));
      if (pending.length === 0) return;
      const needsOcr = (d) => d.files.some((f) => ['image', 'pdf'].includes(kindOf(f)));
      // Finché il modello non c'è, si portano avanti i documenti che non ne hanno bisogno (Word).
      let doc = pending[0];
      if (needsOcr(doc) && !this.engine.modelPresent()) {
        doc = pending.find((d) => !needsOcr(d));
        if (!doc) {
          // Restano solo documenti da leggere con l'OCR: serve il modello. Se il download
          // fallisce ci si ferma qui e i documenti restano in attesa (si riprova dal
          // pulsante "Riprova" o alla prossima apertura).
          try { await this.engine.ensureModel(); } catch { return; }
          continue;
        }
      }

      archive.setConversion(doc.id, { status: 'running' });
      this.current = { id: doc.id, name: doc.name, page: 0, pages: 0 };
      this._emit();
      try {
        const sections = await this._convert(archive, doc);
        if (this.getArchive() !== archive) return; // cartella cambiata nel frattempo
        archive.writeMarkdown(doc.id, buildMarkdown(doc.name, sections));
        archive.setConversion(doc.id, { status: 'done', finishedAt: new Date().toISOString() });
      } catch (err) {
        skipped.add(doc.id);
        archive.setConversion(doc.id, { status: 'error', message: err.message || String(err) });
      }
      this.current = null;
      this.emit('converted', doc.id);
      this._emit();
    }
  }

  async _convert(archive, doc) {
    // Prima conta le pagine, così l'avanzamento mostrato è sensato.
    const plan = [];
    for (const rel of doc.files) {
      const kind = kindOf(rel);
      if (kind === 'image') plan.push({ rel, kind, page: 1 });
      else if (kind === 'pdf') {
        const count = await this.pages.pdfPageCount(rel);
        for (let n = 1; n <= count; n++) plan.push({ rel, kind, page: n });
      } else if (kind === 'word') plan.push({ rel, kind });
    }
    if (plan.length === 0) throw new Error('Questo tipo di file non si può convertire in testo');

    const sections = [];
    this.current.pages = plan.length;
    for (const [i, step] of plan.entries()) {
      this.current.page = i + 1;
      this._emit();
      if (step.kind === 'word') {
        if (path.extname(step.rel).toLowerCase() !== '.docx') {
          throw new Error('I vecchi file Word (.doc) non si possono convertire: salvali come .docx o PDF');
        }
        sections.push(await this.wordToMarkdown(safeResolve(archive.root, step.rel)));
      } else {
        const jpeg = step.kind === 'image'
          ? await this.pages.imageToJpeg(step.rel)
          : await this.pages.pdfPageToJpeg(step.rel, step.page);
        sections.push(await this.engine.recognize(jpeg));
      }
    }
    return sections;
  }
}

module.exports = { Converter, buildMarkdown };
