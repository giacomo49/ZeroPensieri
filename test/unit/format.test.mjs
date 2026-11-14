import test from 'node:test';
import assert from 'node:assert/strict';
import { dueInfo, daysUntil, prettyPath, fileUrl, countLabel } from '../../src/renderer/format.js';

test('daysUntil conta i giorni di calendario', () => {
  assert.equal(daysUntil('2026-11-14', '2026-11-14'), 0);
  assert.equal(daysUntil('2026-11-15', '2026-11-14'), 1);
  assert.equal(daysUntil('2027-01-02', '2026-11-14'), 49);
  assert.equal(daysUntil('2026-10-25', '2026-10-26'), -1); // cambio dell'ora
});

test('dueInfo distingue scadute, vicine e lontane', () => {
  const today = '2026-11-14';
  assert.equal(dueInfo(null, today), null);
  assert.deepEqual(dueInfo('2026-11-08', today), { level: 'late', text: 'SCADUTA da 6 giorni (8 novembre 2026)' });
  assert.equal(dueInfo('2026-11-13', today).text, 'SCADUTA ieri (13 novembre 2026)');
  assert.equal(dueInfo('2026-11-14', today).level, 'late');
  assert.equal(dueInfo('2026-11-15', today).text, 'Scade DOMANI (15 novembre 2026)');
  assert.equal(dueInfo('2026-11-20', today).level, 'soon');
  assert.deepEqual(dueInfo('2027-01-02', today), { level: 'later', text: 'Da pagare entro il 2 gennaio 2027' });
});

test('percorsi e conteggi', () => {
  assert.equal(prettyPath('Documenti', 'Multe/2026'), 'Documenti › Multe › 2026');
  assert.equal(prettyPath('Documenti', ''), 'Documenti');
  assert.equal(fileUrl('file', 'Auto e Moto/2026/Bollo #1.pdf'), '/file/Auto%20e%20Moto/2026/Bollo%20%231.pdf');
  assert.equal(countLabel(1, 'cosa', 'cose'), '1 cosa');
  assert.equal(countLabel(3, 'cosa', 'cose'), '3 cose');
});
