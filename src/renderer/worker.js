// Finestra nascosta: trasforma foto e pagine PDF in immagini JPEG pronte per l'OCR.
// Usa il motore grafico di Chromium, così le foto del telefono vengono raddrizzate
// secondo l'orientamento salvato dalla fotocamera (EXIF).
import { loadPdf, closePdf } from './pdf.js';

const MAX_SIDE = 2200; // lato lungo massimo dell'immagine passata all'OCR

async function canvasToJpeg(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new Uint8Array(await blob.arrayBuffer());
}

async function imageToJpeg(url) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToJpeg(canvas);
}

let cached = null; // ultimo PDF aperto, per non ricaricarlo a ogni pagina
async function pdfFor(url) {
  if (cached?.url !== url) {
    if (cached) closePdf(cached.pdf);
    cached = { url, pdf: await loadPdf(url) };
  }
  return cached.pdf;
}

async function pdfPageToJpeg(url, pageNumber) {
  const pdf = await pdfFor(url);
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
  const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas: null, viewport }).promise;
  page.cleanup();
  return canvasToJpeg(canvas);
}

window.zpWorker.onJob(async (job) => {
  try {
    let value;
    if (job.type === 'image') value = await imageToJpeg(job.url);
    else if (job.type === 'pdf-count') value = (await pdfFor(job.url)).numPages;
    else if (job.type === 'pdf-page') value = await pdfPageToJpeg(job.url, job.page);
    else throw new Error(`Lavoro sconosciuto: ${job.type}`);
    window.zpWorker.reply({ id: job.id, ok: true, value });
  } catch (err) {
    window.zpWorker.reply({ id: job.id, ok: false, error: err?.message || String(err) });
  }
});
