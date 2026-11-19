import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/** Sample-aligned A4 geometry (points). */
const PAGE = { width: 595.32, height: 841.92 };
const MARGIN_X = 85;
const TABLE_RIGHT = 517.2;
/** Distance from page top (PDF points). */
const ASSET_BOX_TOP = 72;
const ASSET_BOX_BOTTOM = 171.9;
const TABLE_TOP = 172.5;
const COL = {
  seqLeft: 85,
  seqRight: 129.1,
  borrowRight: 205.2,
  returnRight: 271,
  purposeRight: 391.4,
  personRight: 517.2
};
const HEADER_ROW_H = 36;
const DATA_ROW_H = 50.2;
const ROWS_PER_PAGE = 11;
const FONT_SIZE = 12;
const LINE = rgb(0, 0, 0);
/** Sample header fill ≈ #FBE4D5 */
const HEADER_FILL = rgb(0.984, 0.894, 0.835);

const TITLE_PREF_KEY = 'hkp-borrower-title';

export function loadPreferredTitle() {
  try {
    return String(localStorage.getItem(TITLE_PREF_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function savePreferredTitle(title) {
  try {
    const value = String(title || '').trim();
    if (value) localStorage.setItem(TITLE_PREF_KEY, value);
  } catch {
    /* ignore */
  }
}

export function toRocDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const text = String(value).trim();
    const m = text.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) return `${m[1].padStart(3, '0')}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
    return text;
  }
  const y = date.getFullYear() - 1911;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${String(y).padStart(3, '0')}/${mm}/${dd}`;
}

export function rocYearRange(rocYear) {
  const year = Number(rocYear);
  if (!Number.isFinite(year) || year < 1) throw new Error('請選擇有效的民國年度');
  const start = new Date(year + 1911, 0, 1, 0, 0, 0, 0);
  const end = new Date(year + 1911, 11, 31, 23, 59, 59, 999);
  return { start, end, label: `${year}` };
}

function wrapByWidth(font, text, size, maxWidth) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [''];
  const lines = [];
  let current = '';
  for (const ch of raw) {
    const next = current + ch;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = ch;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function drawLine(page, x1, y1, x2, y2) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.8, color: LINE });
}

function drawRect(page, x, y, w, h, { fill = null, border = true } = {}) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderWidth: border ? 0.8 : 0,
    borderColor: border ? LINE : undefined,
    color: fill || undefined,
    borderOpacity: border ? 1 : 0
  });
}

function drawCentered(page, font, text, x, width, y, size = FONT_SIZE) {
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: x + Math.max(0, (width - tw) / 2),
    y,
    size,
    font,
    color: LINE
  });
}

function drawLeft(page, font, text, x, y, size = FONT_SIZE) {
  page.drawText(String(text || ''), { x, y, size, font, color: LINE });
}

function personLabel(row) {
  const unit = String(row.borrowerDepartment || row.unit || '').trim();
  const title = String(row.borrowerTitle || row.title || '').trim();
  const name = String(row.borrowerName || row.name || '').trim();
  return [unit, title, name].filter(Boolean).join('/');
}

function drawAssetHeader(page, font, asset) {
  // Outer box matching sample: same width as table, sits above the peach header row.
  const boxBottom = PAGE.height - ASSET_BOX_BOTTOM;
  const boxHeight = ASSET_BOX_BOTTOM - ASSET_BOX_TOP;
  drawRect(page, COL.seqLeft, boxBottom, TABLE_RIGHT - COL.seqLeft, boxHeight, { border: true });

  const lines = [
    `財產名稱：${asset.name || ''}`,
    `購買日期：${toRocDate(asset.purchaseDate || asset.purchase_date || '')}`,
    `購置社團：${asset.department || asset.club || ''}`,
    `財產編號：${asset.propertyId || asset.property_id || ''}`
  ];
  // Baselines measured from sample (page-top y → pdf-lib y).
  const baselines = [88.9, 109.8, 130.7, 159.5];
  lines.forEach((line, i) => {
    drawLeft(page, font, line, MARGIN_X + 5.6, PAGE.height - baselines[i]);
  });
}

function drawTableHeader(page, font) {
  const top = PAGE.height - TABLE_TOP;
  const bottom = top - HEADER_ROW_H;
  // Peach header fill first, then black grid (matches sample Excel-style sheet).
  drawRect(page, COL.seqLeft, bottom, TABLE_RIGHT - COL.seqLeft, HEADER_ROW_H, {
    fill: HEADER_FILL,
    border: true
  });
  [COL.seqRight, COL.borrowRight, COL.returnRight, COL.purposeRight].forEach((x) => {
    drawLine(page, x, bottom, x, top);
  });
  drawCentered(page, font, '序', COL.seqLeft, COL.seqRight - COL.seqLeft, bottom + 12);
  drawCentered(page, font, '借用日期', COL.seqRight, COL.borrowRight - COL.seqRight, bottom + 12);
  drawCentered(page, font, '歸還日期', COL.borrowRight, COL.returnRight - COL.borrowRight, bottom + 12);
  drawCentered(page, font, '借用之實際', COL.returnRight, COL.purposeRight - COL.returnRight, bottom + 18);
  drawCentered(page, font, '用途', COL.returnRight, COL.purposeRight - COL.returnRight, bottom + 4);
  drawCentered(page, font, '借用人單位職稱/', COL.purposeRight, COL.personRight - COL.purposeRight, bottom + 18);
  drawCentered(page, font, '借用人姓名', COL.purposeRight, COL.personRight - COL.purposeRight, bottom + 4);
}

function drawDataRow(page, font, row, indexOnPage, seq) {
  const headerBottom = PAGE.height - TABLE_TOP - HEADER_ROW_H;
  const top = headerBottom - indexOnPage * DATA_ROW_H;
  const bottom = top - DATA_ROW_H;
  drawRect(page, COL.seqLeft, bottom, TABLE_RIGHT - COL.seqLeft, DATA_ROW_H);
  [COL.seqRight, COL.borrowRight, COL.returnRight, COL.purposeRight].forEach((x) => {
    drawLine(page, x, bottom, x, top);
  });

  drawCentered(page, font, String(seq), COL.seqLeft, COL.seqRight - COL.seqLeft, bottom + 20);
  drawCentered(page, font, toRocDate(row.borrowedAt || row.checkedOutAt), COL.seqRight, COL.borrowRight - COL.seqRight, bottom + 20);
  drawCentered(page, font, toRocDate(row.returnedAt), COL.borrowRight, COL.returnRight - COL.borrowRight, bottom + 20);

  const purposeWidth = COL.purposeRight - COL.returnRight - 10;
  const purposeLines = wrapByWidth(font, row.purpose || '', FONT_SIZE, purposeWidth).slice(0, 2);
  purposeLines.forEach((line, i) => {
    drawLeft(page, font, line, COL.returnRight + 5, bottom + 28 - i * 16);
  });

  const personWidth = COL.personRight - COL.purposeRight - 10;
  const personLines = wrapByWidth(font, personLabel(row), FONT_SIZE, personWidth).slice(0, 2);
  personLines.forEach((line, i) => {
    drawLeft(page, font, line, COL.purposeRight + 5, bottom + 28 - i * 16);
  });
}

function emptyRowsNeeded(count) {
  const rem = count % ROWS_PER_PAGE;
  return rem === 0 ? 0 : ROWS_PER_PAGE - rem;
}

async function embedKaiFont(pdf, fontBytes) {
  if (fontBytes) {
    pdf.registerFontkit(fontkit);
    return pdf.embedFont(fontBytes, { subset: true });
  }
  return pdf.embedFont(StandardFonts.Helvetica);
}

/**
 * @param {object} options
 * @param {Array<{asset: object, rows: object[]}>} options.groups
 * @param {Uint8Array|ArrayBuffer} [options.fontBytes]
 * @param {string} [options.rocYear]
 */
export async function buildUsageLogPdf({ groups, fontBytes, rocYear }) {
  const pdf = await PDFDocument.create();
  const font = await embedKaiFont(pdf, fontBytes ? new Uint8Array(fontBytes) : null);
  const list = Array.isArray(groups) ? groups.filter((g) => g?.asset && Array.isArray(g.rows)) : [];

  if (!list.length) {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    drawLeft(page, font, `民國${rocYear || ''}年度器材使用紀錄（無符合資料）`, MARGIN_X, PAGE.height - 80);
  }

  for (const group of list) {
    const rows = group.rows;
    const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE) || 1);
    for (let p = 0; p < pages; p += 1) {
      const page = pdf.addPage([PAGE.width, PAGE.height]);
      if (p === 0) drawAssetHeader(page, font, group.asset);
      drawTableHeader(page, font);
      const slice = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      slice.forEach((row, i) => drawDataRow(page, font, row, i, p * ROWS_PER_PAGE + i + 1));
      const blanks = emptyRowsNeeded(slice.length);
      for (let i = 0; i < blanks; i += 1) {
        const headerBottom = PAGE.height - TABLE_TOP - HEADER_ROW_H;
        const top = headerBottom - (slice.length + i) * DATA_ROW_H;
        const bottom = top - DATA_ROW_H;
        drawRect(page, COL.seqLeft, bottom, TABLE_RIGHT - COL.seqLeft, DATA_ROW_H);
        [COL.seqRight, COL.borrowRight, COL.returnRight, COL.purposeRight].forEach((x) => {
          drawLine(page, x, bottom, x, top);
        });
      }
    }
  }

  return pdf.save();
}

export async function fetchKaiFontBytes(baseUrl = '') {
  const url = `${String(baseUrl || '').replace(/\/$/, '')}/fonts/kaiu.ttf`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('找不到標楷體字型，請確認 public/fonts/kaiu.ttf');
  return new Uint8Array(await res.arrayBuffer());
}

export function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
