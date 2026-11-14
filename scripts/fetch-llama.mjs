// Scarica llama.cpp (il programma che fa girare il modello OCR) nella cartella vendor/llama.
// Uso:  node scripts/fetch-llama.mjs [win32|darwin] [x64|arm64]
// Senza argomenti scarica la versione adatta al computer su cui gira.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE = 'b12385';
const ASSETS = {
  'win-x64': { file: `llama-${RELEASE}-bin-win-cpu-x64.zip`, sha256: '47d7c1d67c69ed158cb7f1ccfbfe26afe5705bd584c452ecdc8f87d4763ab1f5' },
  'win-arm64': { file: `llama-${RELEASE}-bin-win-cpu-arm64.zip`, sha256: '898f7af2ca0c910e57cb84c29e3b2bb6c804fecf70f3f7b419bbae6038e932b8' },
  'mac-arm64': { file: `llama-${RELEASE}-bin-macos-arm64.tar.gz`, sha256: '4d4e5081da84bad7d817b7ee9ead5535b1741c254c160be6a49c7561c7f3cf11' },
  'mac-x64': { file: `llama-${RELEASE}-bin-macos-x64.tar.gz`, sha256: 'd927e504bc7cd9b172874614e9d81d9a2d2dc6c65c2376b314c4c13a73595520' },
};

const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;
const key = `${{ win32: 'win', darwin: 'mac' }[platform] || platform}-${arch}`;
const asset = ASSETS[key];
if (!asset) {
  console.error(`Nessuna versione di llama.cpp prevista per ${key}. Disponibili: ${Object.keys(ASSETS).join(', ')}`);
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'vendor', 'llama', key);
const stamp = path.join(dest, '.versione');
if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === asset.sha256) {
  console.log(`llama.cpp ${RELEASE} (${key}) è già presente.`);
  process.exit(0);
}

const url = `https://github.com/ggml-org/llama.cpp/releases/download/${RELEASE}/${asset.file}`;
console.log(`Scarico ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download non riuscito: ${res.status}`);
const data = Buffer.from(await res.arrayBuffer());
const sha256 = createHash('sha256').update(data).digest('hex');
if (sha256 !== asset.sha256) throw new Error(`Impronta del file diversa da quella attesa (${sha256})`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-llama-'));
try {
  const archive = path.join(tmp, asset.file);
  const unpacked = path.join(tmp, 'out');
  fs.writeFileSync(archive, data);
  fs.mkdirSync(unpacked);
  // "tar" di macOS e di Windows 10/11 apre sia i .tar.gz sia gli .zip.
  execFileSync('tar', ['-xf', archive, '-C', unpacked], { stdio: 'inherit' });

  // Alcuni pacchetti hanno una cartella in più (llama-bXXXX/): si entra dentro.
  let source = unpacked;
  const entries = fs.readdirSync(unpacked);
  if (entries.length === 1 && fs.statSync(path.join(unpacked, entries[0])).isDirectory()) source = path.join(unpacked, entries[0]);

  // Serve solo il server con le sue librerie.
  const wanted = (name) => /^llama-server(\.exe)?$/.test(name) || /\.(dll|dylib)$/.test(name) || /^LICENSE/i.test(name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (wanted(name)) fs.cpSync(path.join(source, name), path.join(dest, name), { verbatimSymlinks: true });
  }
  fs.writeFileSync(stamp, `${asset.sha256}\n`);
  console.log(`Pronto: ${path.relative(root, dest)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
