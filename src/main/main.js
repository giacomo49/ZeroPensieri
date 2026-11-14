'use strict';
const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

const { Archive, safeResolve, kindOf, UPLOAD_EXTENSIONS } = require('./archive');
const { OcrEngine } = require('./ocr');
const { Converter } = require('./converter');

// Per le prove automatiche: dati dell'app in una cartella a parte.
if (process.env.ZP_USER_DATA) app.setPath('userData', path.resolve(process.env.ZP_USER_DATA));

const APP_ROOT = path.join(__dirname, '..', '..');
const UI_DIR = path.join(APP_ROOT, 'src', 'renderer');
const MODULES_DIR = path.join(APP_ROOT, 'node_modules');
const STARTER_FOLDERS = ['Auto e Moto', 'Bollette', 'Multe', 'Tasse', 'Salute', 'Casa', 'Banca', 'Altro'];

protocol.registerSchemesAsPrivileged([{
  scheme: 'zp',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let workerWindow = null;
let archive = null;
let engine = null;
let converter = null;
const pickedSources = new Map(); // token -> percorso scelto dall'utente (non ancora in archivio)

// ---------- impostazioni ----------

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function openArchive(root) {
  try {
    if (root && fs.statSync(root).isDirectory()) {
      archive = new Archive(root);
      return true;
    }
  } catch {}
  archive = null;
  return false;
}

function requireArchive() {
  if (!archive) throw new Error('Nessuna cartella collegata');
  return archive;
}

function appState() {
  let isEmpty = false;
  try {
    const top = archive?.list('');
    isEmpty = !!top && top.folders.length === 0 && top.files.length === 0;
  } catch {
    archive = null; // la cartella collegata non c'è più (spostata, chiavetta staccata...): si richiede
  }
  return {
    root: archive ? archive.root : null,
    rootName: archive ? path.basename(archive.root) : null,
    isEmpty,
    toPayCount: archive ? archive.countToPay() : 0,
    starterFolders: STARTER_FOLDERS,
    currentYear: String(new Date().getFullYear()),
    uploadExtensions: UPLOAD_EXTENSIONS,
  };
}

function notifyChanged() {
  mainWindow?.webContents.send('zp:changed', appState());
}

// ---------- protocollo zp://app/... ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };

const LIBS = {
  'marked.js': path.join(MODULES_DIR, 'marked', 'lib', 'marked.esm.js'),
  'purify.js': path.join(MODULES_DIR, 'dompurify', 'dist', 'purify.es.mjs'),
};

function within(base, rel) {
  const abs = path.resolve(base, rel);
  const back = path.relative(base, abs);
  if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('fuori');
  return abs;
}

async function serveFile(abs, type) {
  const stat = await fs.promises.stat(abs);
  if (!stat.isFile()) return new Response('Non trovato', { status: 404 });
  return new Response(Readable.toWeb(fs.createReadStream(abs)), {
    headers: { ...HEADERS, 'Content-Type': type || mimeOf(abs), 'Content-Length': String(stat.size) },
  });
}

async function serveThumbnail(abs) {
  try {
    const image = await nativeImage.createThumbnailFromPath(abs, { width: 480, height: 480 });
    return new Response(image.toPNG(), { headers: { ...HEADERS, 'Content-Type': 'image/png' } });
  } catch {
    if (kindOf(abs) === 'image') return serveFile(abs);
    return new Response('Nessuna anteprima', { status: 404 });
  }
}

async function handleProtocol(request) {
  try {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Non trovato', { status: 404 });
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [area, ...rest] = parts;
    const rel = rest.join('/');
    switch (area) {
      case 'ui': return await serveFile(within(UI_DIR, rel));
      case 'lib':
        if (rest[0] === 'pdfjs') return await serveFile(within(path.join(MODULES_DIR, 'pdfjs-dist'), rest.slice(1).join('/')));
        if (LIBS[rel]) return await serveFile(LIBS[rel]);
        break;
      case 'file': return await serveFile(safeResolve(requireArchive().root, rel));
      case 'thumb': return await serveThumbnail(safeResolve(requireArchive().root, rel));
      case 'picked': {
        const source = pickedSources.get(rest[0]);
        if (source) return rest[1] === 'thumb' ? await serveThumbnail(source) : await serveFile(source);
        break;
      }
    }
    return new Response('Non trovato', { status: 404 });
  } catch {
    return new Response('Non trovato', { status: 404 });
  }
}

// ---------- finestra nascosta che prepara le pagine per l'OCR ----------

const workerJobs = new Map();

function ensureWorker() {
  if (workerWindow && !workerWindow.isDestroyed()) return workerWindow.zpReady;
  workerWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-worker.js'),
      backgroundThrottling: false,
    },
  });
  workerWindow.zpReady = workerWindow.loadURL('zp://app/ui/worker.html').then(() => workerWindow);
  workerWindow.on('closed', () => {
    workerWindow = null;
    for (const job of workerJobs.values()) job.reject(new Error('Preparazione della pagina interrotta'));
    workerJobs.clear();
  });
  return workerWindow.zpReady;
}

async function workerJob(job) {
  const win = await ensureWorker();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    workerJobs.set(id, { resolve, reject });
    win.webContents.send('zp-worker:job', { id, ...job });
  });
}

ipcMain.on('zp-worker:result', (event, { id, ok, value, error }) => {
  if (!workerWindow || event.sender !== workerWindow.webContents) return;
  const job = workerJobs.get(id);
  if (!job) return;
  workerJobs.delete(id);
  if (ok) job.resolve(value); else job.reject(new Error(error));
});

const fileUrl = (area, rel) => `zp://app/${area}/${rel.split('/').map(encodeURIComponent).join('/')}`;

const pages = {
  imageToJpeg: async (rel) => Buffer.from(await workerJob({ type: 'image', url: fileUrl('file', rel) })),
  pdfPageCount: (rel) => workerJob({ type: 'pdf-count', url: fileUrl('file', rel) }),
  pdfPageToJpeg: async (rel, page) => Buffer.from(await workerJob({ type: 'pdf-page', url: fileUrl('file', rel), page })),
};

async function wordToMarkdown(abs) {
  const mammoth = require('mammoth');
  const result = await mammoth.convertToMarkdown({ path: abs });
  return result.value;
}

// ---------- comandi dell'interfaccia ----------

function registerSources(paths) {
  const out = [];
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();
    let stat;
    try { stat = fs.statSync(p); } catch { continue; }
    if (!stat.isFile()) continue;
    if (!UPLOAD_EXTENSIONS.includes(ext)) {
      out.push({ name: path.basename(p), rejected: true });
      continue;
    }
    const token = crypto.randomUUID();
    pickedSources.set(token, p);
    out.push({
      token,
      name: path.basename(p),
      baseName: path.parse(p).name,
      kind: kindOf(p),
      size: stat.size,
      url: `zp://app/picked/${token}/file`,
      thumbUrl: `zp://app/picked/${token}/thumb`,
    });
  }
  return out;
}

const handlers = {
  'state': () => appState(),

  'choose-root': async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Scegli la cartella dei tuoi documenti',
      buttonLabel: 'Usa questa cartella',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if (!openArchive(result.filePaths[0])) throw new Error('Non riesco ad aprire questa cartella');
    writeConfig({ ...readConfig(), root: archive.root });
    prepareReader();
    return appState();
  },

  'create-starter-folders': () => {
    const a = requireArchive();
    for (const name of STARTER_FOLDERS) a.createFolder('', name);
    return appState();
  },

  'list': (rel) => requireArchive().list(rel || ''),
  'create-folder': ({ parent, name }) => requireArchive().createFolder(parent || '', name),

  'pick-files': async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Scegli il documento da caricare',
      buttonLabel: 'Scegli',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documenti (foto, PDF, Word)', extensions: UPLOAD_EXTENSIONS.map((e) => e.slice(1)) }],
    });
    return result.canceled ? [] : registerSources(result.filePaths);
  },
  'register-files': (paths) => registerSources(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []),

  'add-document': ({ tokens, name, folder, toPay, dueDate, convert }) => {
    const sources = tokens.map((t) => pickedSources.get(t)).filter(Boolean);
    const doc = requireArchive().addDocument({ sources, name, folder, toPay, dueDate, convert });
    tokens.forEach((t) => pickedSources.delete(t));
    if (convert) converter.kick();
    notifyChanged();
    return doc;
  },

  'list-to-pay': () => requireArchive().listToPay(),
  'set-paid': ({ id, paid }) => { const d = requireArchive().setPaid(id, paid); notifyChanged(); return d; },
  'set-to-pay': ({ rel, toPay, dueDate }) => { const d = requireArchive().setToPay(rel, toPay, dueDate); notifyChanged(); return d; },
  'forget': (id) => { requireArchive().forget(id); notifyChanged(); },

  'open-file': async (rel) => {
    const error = await shell.openPath(safeResolve(requireArchive().root, rel));
    if (error) throw new Error('Non riesco ad aprire il file con il computer');
  },
  'show-in-folder': (rel) => shell.showItemInFolder(safeResolve(requireArchive().root, rel)),
  'trash-file': async (rel) => {
    const a = requireArchive();
    await shell.trashItem(safeResolve(a.root, rel));
    a.fileRemoved(rel);
    notifyChanged();
  },

  'word-html': async (rel) => {
    const abs = safeResolve(requireArchive().root, rel);
    if (path.extname(abs).toLowerCase() !== '.docx') return null;
    const mammoth = require('mammoth');
    return (await mammoth.convertToHtml({ path: abs })).value;
  },

  'conversion-status': () => converter.status(),
  'retry-conversion': (id) => { requireArchive().retryConversion(id); converter.kick(); notifyChanged(); },
  'retry-engine': () => { converter.kick(); },
};

function registerIpc() {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`zp:${name}`, async (event, arg) => {
      if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Non permesso');
      return fn(arg);
    });
  }
}

// ---------- avvio ----------

function llamaDir() {
  if (process.env.ZP_LLAMA_DIR) return path.resolve(process.env.ZP_LLAMA_DIR);
  if (app.isPackaged) return path.join(process.resourcesPath, 'llama');
  const os = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
  return path.join(APP_ROOT, 'vendor', 'llama', `${os}-${process.arch}`);
}

/** Scarica subito il modello (se manca) e fa ripartire le conversioni rimaste in sospeso. */
function prepareReader() {
  engine.ensureModel().catch(() => {}).finally(() => converter.kick());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#F3F6FB',
    autoHideMenuBar: true,
    title: 'ZeroPensieri',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.setMenuBarVisibility(false);
  if (!process.env.ZP_NO_MAXIMIZE) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL('zp://app/ui/index.html');

  // L'interfaccia non naviga mai altrove; i link esterni si aprono nel browser.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  protocol.handle('zp', handleProtocol);

  engine = new OcrEngine({
    modelsDir: process.env.ZP_MODELS_DIR ? path.resolve(process.env.ZP_MODELS_DIR) : path.join(app.getPath('userData'), 'models'),
    llamaDir: llamaDir(),
    // ZP_OFFLINE serve alle prove automatiche: niente download del modello.
    fetch: process.env.ZP_OFFLINE
      ? async () => { throw new Error('Senza Internet (modalità di prova)'); }
      : (url, init) => net.fetch(url, init),
  });
  converter = new Converter({ getArchive: () => archive, engine, pages, wordToMarkdown });
  converter.on('status', (status) => mainWindow?.webContents.send('zp:conversion-status', status));
  converter.on('converted', () => notifyChanged());

  openArchive(readConfig().root);
  registerIpc();
  createWindow();
  if (archive) prepareReader();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  engine?.stop();
  if (workerWindow && !workerWindow.isDestroyed()) workerWindow.destroy();
});
