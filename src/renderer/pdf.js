// Accesso condiviso a pdf.js (anteprime nell'interfaccia e pagine per l'OCR).
import * as pdfjs from '/lib/pdfjs/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/lib/pdfjs/build/pdf.worker.mjs';

export async function loadPdf(url) {
  const data = await (await fetch(url)).arrayBuffer();
  return pdfjs.getDocument({
    data,
    cMapUrl: '/lib/pdfjs/cmaps/',
    standardFontDataUrl: '/lib/pdfjs/standard_fonts/',
    wasmUrl: '/lib/pdfjs/wasm/',
    iccUrl: '/lib/pdfjs/iccs/',
    isEvalSupported: false,
  }).promise;
}

/** Chiude il PDF e libera la memoria. */
export function closePdf(pdf) {
  return pdf.loadingTask.destroy().catch(() => {});
}

/** Disegna una pagina in un <canvas> largo al massimo `maxWidth` pixel CSS. */
export async function renderPage(pdf, pageNumber, canvas, maxWidth) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const cssScale = maxWidth / base.width;
  const viewport = page.getViewport({ scale: cssScale * ratio });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
  page.cleanup();
}
