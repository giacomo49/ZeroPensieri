// Prova completa dell'app vera: prima apertura, caricamento, navigazione, "pagato".
// Uso:  npm run test:e2e
// Con ZP_MODELS_DIR=<cartella con il modello> prova anche la conversione in testo (OCR).
// Con ZP_APP_EXE=<eseguibile> prova l'app impacchettata (dist/...).
// Le schermate finiscono nella cartella indicata da ZP_SHOTS (se impostata).
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, '..', '..');
const fixtures = path.join(here, '..', 'fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-e2e-'));
const root = path.join(tmp, 'Documenti personali');
fs.mkdirSync(root);
const shots = process.env.ZP_SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const withOcr = !!process.env.ZP_MODELS_DIR;

// ZP_APP_EXE=<eseguibile> prova l'app già impacchettata invece dei sorgenti.
const app = await electron.launch({
  ...(process.env.ZP_APP_EXE ? { executablePath: process.env.ZP_APP_EXE, args: [] } : { args: [projectRoot] }),
  env: {
    ...process.env,
    ZP_USER_DATA: path.join(tmp, 'userdata'),
    // Senza modello vero si punta a una cartella vuota e si impedisce il download.
    ZP_MODELS_DIR: process.env.ZP_MODELS_DIR || path.join(tmp, 'models'),
    ...(withOcr ? {} : { ZP_OFFLINE: '1' }),
    ZP_NO_MAXIMIZE: '1',
  },
});

let page;
let step = 0;
const shot = async (name) => {
  // Aspetta che le miniature siano caricate, così le schermate sono complete.
  await page.waitForFunction(() => [...document.images].every((img) => img.complete)).catch(() => {});
  if (shots) await page.screenshot({ path: path.join(shots, `${String(++step).padStart(2, '0')}-${name}.png`) });
};
const stubDialog = (paths) => app.evaluate(({ dialog }, filePaths) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
}, paths);
const section = (title) => page.locator('.home-tile', { hasText: title });

try {
  page = await app.firstWindow();
  if (!page.url().endsWith('index.html')) page = app.windows().find((w) => w.url().endsWith('index.html'));
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') { errors.push(msg.text()); console.error('[console]', msg.text()); } });

  // --- prima apertura ---
  await page.getByRole('heading', { name: 'Benvenuto!' }).waitFor();
  await shot('benvenuto');
  await stubDialog([root]);
  await page.getByRole('button', { name: 'Scegli la cartella' }).click();
  await page.getByRole('button', { name: 'Sì, creale' }).waitFor();
  await shot('cartelle-consigliate');
  await page.getByRole('button', { name: 'Sì, creale' }).click();
  await section('Cose da pagare').waitFor();
  assert.ok(fs.existsSync(path.join(root, 'Multe')), 'cartelle consigliate create');
  await shot('inizio');

  // --- carica una multa da pagare (foto) ---
  await section('Carica documento').click();
  await shot('carica-vuoto');
  await stubDialog([path.join(fixtures, 'multa-foto.jpg')]);
  await page.getByRole('button', { name: 'Scegli dal computer' }).click();
  const name = page.getByPlaceholder('Per esempio: Multa Bologna novembre');
  await name.waitFor();
  assert.equal(await name.inputValue(), 'multa-foto');
  await name.fill('Multa Bologna ZTL');
  await page.locator('.tile-folder', { hasText: 'Multe' }).click();
  await page.getByRole('button', { name: /Crea cartella \d{4}/ }).click();
  const year = String(new Date().getFullYear());
  await page.locator('.destination', { hasText: `Documenti personali › Multe › ${year}` }).waitFor();
  await page.getByRole('button', { name: 'Sì, è DA PAGARE' }).click();
  const soon = new Date(Date.now() + 5 * 86400000);
  const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  await page.locator('.step input[type=date]').fill(iso);
  if (!withOcr) await page.getByRole('checkbox').uncheck();
  await shot('carica-compilato');
  await page.getByRole('button', { name: 'Aggiungi all\'archivio' }).click();
  await page.getByRole('heading', { name: 'Documento aggiunto!' }).waitFor();
  assert.ok(fs.existsSync(path.join(root, 'Multe', year, 'Multa Bologna ZTL.jpg')), 'foto copiata in archivio');
  await shot('aggiunto');

  // --- carica un PDF e un Word, non da pagare ---
  for (const [file, docName, folder] of [['verbale.pdf', 'Bolletta luce ottobre', 'Bollette'], ['contratto.docx', 'Contratto affitto', 'Casa']]) {
    await page.getByRole('button', { name: 'Torna all\'inizio' }).click();
    await section('Carica documento').click();
    await stubDialog([path.join(fixtures, file)]);
    await page.getByRole('button', { name: 'Scegli dal computer' }).click();
    await name.waitFor();
    await name.fill(docName);
    await page.locator('.tile-folder', { hasText: folder }).click();
    await page.locator('.destination', { hasText: folder }).waitFor();
    await page.getByRole('button', { name: 'Aggiungi all\'archivio' }).click();
    await page.getByRole('heading', { name: 'Documento aggiunto!' }).waitFor();
    assert.ok(fs.existsSync(path.join(root, folder, docName + path.extname(file))));
  }
  // Il Word si converte senza OCR: senza modello la copia in testo arriva subito,
  // altrimenti aspetta il suo turno dietro alla foto e al PDF.
  const contractMd = path.join(root, 'Casa', 'Contratto affitto.md');
  await waitFor(() => fs.existsSync(contractMd), withOcr ? 30 * 60 * 1000 : 20000, 'copia in testo del Word');
  assert.match(fs.readFileSync(contractMd, 'utf8'), /Canone mensile: 650 euro/);

  // --- cose da pagare ---
  await page.getByRole('button', { name: 'Torna all\'inizio' }).click();
  await page.locator('.home-badge', { hasText: '1 da pagare' }).waitFor();
  await shot('inizio-con-da-pagare');
  await section('Cose da pagare').click();
  await page.locator('.pay-card', { hasText: 'Multa Bologna ZTL' }).waitFor();
  await page.locator('.due', { hasText: 'Scade tra 5 giorni' }).waitFor();
  await page.locator('.pay-thumb img').first().waitFor();
  await shot('da-pagare');
  await page.locator('.pay-card').getByRole('button', { name: 'Guarda', exact: true }).click();
  await page.locator('.viewer img.page').waitFor();
  await shot('visualizzatore-foto');
  await page.locator('.viewer').getByRole('button', { name: 'Chiudi' }).click();
  await page.locator('.pay-card').getByRole('button', { name: 'PAGATO', exact: true }).click();
  await page.getByRole('heading', { name: 'Non c\'è niente da pagare' }).waitFor();
  await page.getByRole('button', { name: /Mostra le cose già pagate \(1\)/ }).click();
  await page.locator('.pay-card-paid', { hasText: 'Multa Bologna ZTL' }).waitFor();
  await shot('gia-pagato');
  await page.getByRole('button', { name: 'Non è pagato' }).click();
  await page.locator('.pay-card', { hasText: 'Multa Bologna ZTL' }).getByRole('button', { name: 'PAGATO', exact: true }).waitFor();

  // --- i tuoi documenti ---
  await page.getByRole('button', { name: 'Inizio' }).click();
  await section('I tuoi documenti').click();
  await page.locator('.tile-folder', { hasText: 'Bollette' }).waitFor();
  await shot('documenti');
  await page.locator('.tile-folder', { hasText: 'Multe' }).click();
  await page.locator('.tile-folder', { hasText: year }).click();
  await page.locator('.tile-file', { hasText: 'Multa Bologna ZTL.jpg' }).locator('.badge-topay').waitFor();
  await shot('documenti-multe');
  await page.locator('.breadcrumb-link', { hasText: 'Documenti personali' }).click();
  await page.locator('.tile-folder', { hasText: 'Bollette' }).click();
  await page.locator('.tile-file', { hasText: 'Bolletta luce ottobre.pdf' }).click();
  await page.locator('.viewer canvas.page').first().waitFor();
  await page.waitForFunction(() => document.querySelector('.viewer canvas.page')?.width > 300);
  await shot('visualizzatore-pdf');
  await page.locator('.viewer').getByRole('button', { name: 'Chiudi' }).click();
  await page.locator('.breadcrumb-link', { hasText: 'Documenti personali' }).click();
  await page.locator('.tile-folder', { hasText: 'Casa' }).click();
  await page.locator('.tile-file', { hasText: 'Contratto affitto.md' }).click();
  await page.locator('.viewer .text-page', { hasText: 'Canone mensile: 650 euro' }).waitFor();
  await shot('visualizzatore-testo');
  await page.locator('.viewer').getByRole('button', { name: 'Chiudi' }).click();

  // --- conversione con OCR (solo se c'è il modello) ---
  if (withOcr) {
    const md = path.join(root, 'Multe', year, 'Multa Bologna ZTL.md');
    const started = Date.now();
    await waitFor(() => fs.existsSync(md), 30 * 60 * 1000, 'copia in testo della multa');
    const text = fs.readFileSync(md, 'utf8');
    console.log(`OCR della foto finito in ${Math.round((Date.now() - started) / 1000)}s`);
    assert.match(text, /^# Multa Bologna ZTL/);
    assert.match(text, /COMUNE DI BOLOGNA/);
    assert.match(text, /FZ 482 KL/);
    const pdfMd = path.join(root, 'Bollette', 'Bolletta luce ottobre.md');
    await waitFor(() => fs.existsSync(pdfMd), 30 * 60 * 1000, 'copia in testo del PDF');
    assert.match(fs.readFileSync(pdfMd, 'utf8'), /VERBALE DI ACCERTAMENTO/);
    console.log(`OCR di foto + PDF finito in ${Math.round((Date.now() - started) / 1000)}s`);
  }

  assert.deepEqual(errors, [], 'nessun errore nella console');
  console.log(`Tutto bene${withOcr ? ' (OCR compreso)' : ' (senza OCR)'}.`);
} catch (err) {
  if (shots && page) await page.screenshot({ path: path.join(shots, 'errore.png') }).catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function waitFor(condition, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Tempo scaduto aspettando: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
