'use strict';
// Motore OCR: PaddleOCR-VL-1.6 (GGUF ufficiale) eseguito in locale con llama.cpp.
// - scarica il modello la prima volta (con ripresa se il download si interrompe)
// - avvia llama-server solo quando serve e lo spegne quando resta inattivo
// - legge un'immagine e restituisce il testo
// Nessun documento esce dal computer: il server ascolta solo su 127.0.0.1.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const MODEL = {
  repo: 'PaddlePaddle/PaddleOCR-VL-1.6-GGUF',
  revision: '511b09642bb324401f15f97cc23bc67e8f0a291d',
  files: [
    {
      role: 'model',
      name: 'PaddleOCR-VL-1.6-GGUF.gguf',
      size: 935769056,
      sha256: 'f3ae46ec885050acf4b3d31944431e1fd90d50664fb09126af4a3c050ba14ee8',
    },
    {
      role: 'mmproj',
      name: 'PaddleOCR-VL-1.6-GGUF-mmproj.gguf',
      size: 881770560,
      sha256: '204d757d7610d9b3faab10d506d69e5b244e32bf765e2bab2d0167e65e0a058a',
    },
  ],
};
const TOTAL_BYTES = MODEL.files.reduce((sum, f) => sum + f.size, 0);
const IDLE_SHUTDOWN_MS = 3 * 60 * 1000;
const SERVER_START_TIMEOUT_MS = 5 * 60 * 1000;

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function requestJson({ port, method, pathname, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port, method, path: pathname,
      headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    // Su un computer senza scheda grafica una pagina può richiedere molti minuti: nessun timeout.
    req.setTimeout(0);
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class OcrEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.modelsDir  dove tenere i file del modello
   * @param {string} opts.llamaDir   cartella con llama-server
   * @param {typeof fetch} opts.fetch
   */
  constructor({ modelsDir, llamaDir, fetch: fetchImpl }) {
    super();
    this.modelsDir = modelsDir;
    this.llamaDir = llamaDir;
    this.fetch = fetchImpl;
    this.state = 'unknown'; // unknown | missing | downloading | ready | error
    this.progress = 0;
    this.error = null;
    this.child = null;
    this.port = null;
    this.starting = null;
    this.idleTimer = null;
    this.downloading = null;
    this.stderrTail = [];
  }

  status() {
    if (this.state === 'unknown') this.state = this.modelPresent() ? 'ready' : 'missing';
    return { state: this.state, progress: this.progress, error: this.error };
  }

  _set(state, extra = {}) {
    this.state = state;
    Object.assign(this, extra);
    this.emit('status', this.status());
  }

  filePath(role) {
    return path.join(this.modelsDir, MODEL.files.find((f) => f.role === role).name);
  }

  modelPresent() {
    return MODEL.files.every((f) => {
      try { return fs.statSync(path.join(this.modelsDir, f.name)).size === f.size; } catch { return false; }
    });
  }

  serverBinary() {
    return path.join(this.llamaDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  }

  // ---------- download del modello ----------

  ensureModel() {
    if (this.modelPresent()) {
      if (this.state !== 'ready') this._set('ready', { progress: 1, error: null });
      return Promise.resolve();
    }
    if (!this.downloading) {
      this.downloading = this._download().finally(() => { this.downloading = null; });
    }
    return this.downloading;
  }

  async _download() {
    fs.mkdirSync(this.modelsDir, { recursive: true });
    this._set('downloading', { progress: 0, error: null });
    try {
      let doneBefore = 0;
      for (const file of MODEL.files) {
        await this._downloadFile(file, doneBefore);
        doneBefore += file.size;
      }
      this._set('ready', { progress: 1, error: null });
    } catch (err) {
      this._set('error', { error: err.message || String(err) });
      throw err;
    }
  }

  async _downloadFile(file, doneBefore) {
    const dest = path.join(this.modelsDir, file.name);
    const part = `${dest}.part`;
    try { if (fs.statSync(dest).size === file.size) return; } catch {}

    let have = 0;
    try { have = fs.statSync(part).size; } catch {}
    if (have > file.size) { fs.unlinkSync(part); have = 0; }

    if (have < file.size) {
      const url = `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${file.name}`;
      const res = await this.fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {} });
      if (have && res.status !== 206) { have = 0; } // il server non riprende: ricomincia
      if (!res.ok) throw new Error(`Download non riuscito (errore ${res.status})`);
      const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      let lastEmit = 0;
      try {
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          have += chunk.length;
          const now = Date.now();
          if (now - lastEmit > 400) {
            lastEmit = now;
            this._set('downloading', { progress: (doneBefore + have) / TOTAL_BYTES });
          }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
    }

    if (have !== file.size || (await sha256File(part)) !== file.sha256) {
      fs.unlinkSync(part);
      throw new Error('Il file scaricato è incompleto o rovinato');
    }
    fs.renameSync(part, dest);
  }

  // ---------- llama-server ----------

  async _startServer() {
    const bin = this.serverBinary();
    if (!fs.existsSync(bin)) {
      throw new Error(`Manca il programma di lettura (llama-server) in ${this.llamaDir}`);
    }
    const port = await freePort();
    const args = [
      '-m', this.filePath('model'),
      '--mmproj', this.filePath('mmproj'),
      '--host', '127.0.0.1',
      '--port', String(port),
      '--temp', '0',
      '--ctx-size', '8192',
      '--parallel', '1',
      '--jinja',
    ];
    const child = spawn(bin, args, { cwd: this.llamaDir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    // La lettura può durare parecchi minuti: a bassa priorità il computer resta usabile.
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    this.stderrTail = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      this.stderrTail.push(...text.split('\n').filter(Boolean));
      if (this.stderrTail.length > 40) this.stderrTail.splice(0, this.stderrTail.length - 40);
    });
    let exited = null;
    child.once('exit', (code, signal) => {
      exited = { code, signal };
      if (this.child === child) { this.child = null; this.port = null; }
    });
    child.once('error', (err) => { exited = { error: err }; });

    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    for (;;) {
      if (exited) {
        const why = exited.error ? exited.error.message : this.stderrTail.slice(-3).join(' | ');
        throw new Error(`Il lettore di documenti non è partito. ${why}`);
      }
      try {
        const res = await requestJson({ port, method: 'GET', pathname: '/health' });
        if (res.status === 200) break;
      } catch {}
      if (Date.now() > deadline) {
        child.kill();
        throw new Error('Il lettore di documenti impiega troppo tempo a partire');
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    this.port = port;
  }

  async _ensureServer() {
    if (this.child && this.port) return;
    if (!this.starting) this.starting = this._startServer().finally(() => { this.starting = null; });
    await this.starting;
  }

  _touchIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  stop() {
    clearTimeout(this.idleTimer);
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
      this.port = null;
    }
  }

  /** Legge un'immagine (JPEG) e restituisce il testo riconosciuto. */
  async recognize(jpeg) {
    await this.ensureModel();
    await this._ensureServer();
    clearTimeout(this.idleTimer);
    try {
      const res = await requestJson({
        port: this.port,
        method: 'POST',
        pathname: '/v1/chat/completions',
        body: {
          temperature: 0,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}` } },
              { type: 'text', text: 'OCR:' },
            ],
          }],
        },
      });
      const text = res.json?.choices?.[0]?.message?.content;
      if (res.status !== 200 || typeof text !== 'string') {
        throw new Error(res.json?.error?.message || `Lettura non riuscita (errore ${res.status})`);
      }
      return text.trim();
    } finally {
      this._touchIdle();
    }
  }
}

module.exports = { OcrEngine, MODEL };
