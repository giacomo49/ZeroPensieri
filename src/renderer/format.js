// Testi e date in italiano.

const longDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

/** "2026-11-08" -> Date a mezzanotte, ora locale. */
export function parseDay(isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDay(isoDay) {
  return longDate.format(parseDay(isoDay));
}

export function formatDateTime(iso) {
  return longDate.format(new Date(iso));
}

export function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Giorni che mancano alla scadenza (negativo = già scaduta). */
export function daysUntil(isoDay, today = todayIso()) {
  return Math.round((parseDay(isoDay) - parseDay(today)) / 86400000);
}

/** Etichetta e gravità di una scadenza. */
export function dueInfo(isoDay, today = todayIso()) {
  if (!isoDay) return null;
  const days = daysUntil(isoDay, today);
  const date = formatDay(isoDay);
  if (days < 0) return { level: 'late', text: days === -1 ? `SCADUTA ieri (${date})` : `SCADUTA da ${-days} giorni (${date})` };
  if (days === 0) return { level: 'late', text: `SCADE OGGI (${date})` };
  if (days === 1) return { level: 'soon', text: `Scade DOMANI (${date})` };
  if (days <= 10) return { level: 'soon', text: `Scade tra ${days} giorni (${date})` };
  return { level: 'later', text: `Da pagare entro il ${date}` };
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 13) return 'Buongiorno!';
  if (hour < 18) return 'Buon pomeriggio!';
  return 'Buonasera!';
}

export function countLabel(n, one, many) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** "Bollette/2026" -> ["Bollette", "2026"] */
export const splitRel = (rel) => (rel ? rel.split('/') : []);

export const fileUrl = (area, rel) => `/${area}/${splitRel(rel).map(encodeURIComponent).join('/')}`;

/** Percorso leggibile: "Documenti personali › Bollette › 2026" */
export function prettyPath(rootName, rel) {
  return [rootName, ...splitRel(rel)].join(' › ');
}
