/**
 * Demo smoke: backfill logbook + generate annual usage PDF.
 * Usage: npm run test:usage-log-pdf
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enterDemo } from '../services/demoStore.js';
import { loadCatalog, listItems } from '../services/inventoryService.js';
import { loadLoans } from '../services/loanService.js';
import { logbookExportPreview, submitBackfill } from '../services/usageLogbookService.js';
import { buildUsageLogPdf, toRocDate } from '../services/usageLogPdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'exports', 'usage-log');

// Minimal browser storage stubs for demoStore.
const store = new Map();
globalThis.sessionStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
  clear() { store.clear(); }
};
globalThis.localStorage = globalThis.sessionStorage;

enterDemo('borrower');
await loadCatalog();
await loadLoans();

const item = listItems().find((row) => row.isActive !== false);
if (!item) throw new Error('demo catalog empty');

const borrowedAt = new Date();
borrowedAt.setMonth(0, 3);
borrowedAt.setHours(10, 0, 0, 0);
const returnedAt = new Date(borrowedAt);
returnedAt.setDate(returnedAt.getDate() + 2);

const result = await submitBackfill({
  propertyId: item.propertyId,
  borrowerName: '測試借用人',
  borrowerId: 'B12345678',
  borrowerDepartment: '學生會',
  borrowerTitle: '公關部部員',
  purpose: '宣傳影片播放展示使用',
  borrowedAt: borrowedAt.toISOString(),
  returnedAt: returnedAt.toISOString(),
  note: 'smoke backfill'
});

if (result.item.availabilityStatus === 'checked_out') {
  throw new Error('backfill must not mark asset checked_out');
}
if (!result.entry.borrowerTitle) throw new Error('borrowerTitle missing on backfill entry');

const rocYear = borrowedAt.getFullYear() - 1911;
const preview = logbookExportPreview(rocYear, item.propertyId);
if (!preview.complete.length) throw new Error('expected complete logbook rows');

const fontPath = path.join(root, 'public', 'fonts', 'kaiu.ttf');
const fontBytes = await fs.readFile(fontPath);
const pdfBytes = await buildUsageLogPdf({
  groups: preview.groups,
  fontBytes,
  rocYear: String(rocYear)
});

await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `${rocYear}-smoke-usage-log.pdf`);
await fs.writeFile(outFile, pdfBytes);

console.log(JSON.stringify({
  ok: true,
  propertyId: item.propertyId,
  loanId: result.entry.id,
  person: `${result.entry.borrowerDepartment}/${result.entry.borrowerTitle}/${result.entry.borrowerName}`,
  borrow: toRocDate(result.entry.checkedOutAt),
  return: toRocDate(result.entry.returnedAt),
  complete: preview.complete.length,
  incomplete: preview.incomplete.length,
  pdf: outFile,
  pdfBytes: pdfBytes.byteLength
}, null, 2));
