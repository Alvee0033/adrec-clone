// generate_pdf.mjs - draws contract tables onto blank_template.pdf
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '../public/assets/templates');

// Colours matching the actual contract
const TEAL   = rgb(0.06, 0.38, 0.48);   // header rows
const LGREY  = rgb(0.94, 0.96, 0.98);   // alternate rows
const WHITE  = rgb(1, 1, 1);
const BLACK  = rgb(0, 0, 0);
const BLUE   = rgb(0.09, 0.39, 0.67);   // data values
const LINE   = rgb(0.1, 0.1, 0.1);      // borders

// ── helpers ────────────────────────────────────────────────────────────────
function drawRect(page, x, y, w, h, fill, stroke = null, lineWidth = 0.5) {
  page.drawRectangle({ x, y, width: w, height: h, color: fill,
    borderColor: stroke ?? fill, borderWidth: stroke ? lineWidth : 0 });
}

function drawLine(page, x1, y1, x2, y2, lw = 0.5) {
  page.drawLine({ start: {x: x1, y: y1}, end: {x: x2, y: y2},
    thickness: lw, color: LINE });
}

function drawText(page, text, x, y, font, size, color = BLACK) {
  page.drawText(String(text ?? '—'), { x, y, font, size, color });
}

// Draw a cell: background rect + right border + bottom border + text
function cell(page, text, x, y, w, h, font, size = 8, color = BLACK,
              fill = WHITE, textOffX = 4, textOffY = 3, rightBorder = true, bottomBorder = true) {
  drawRect(page, x, y, w, h, fill);
  if (rightBorder) drawLine(page, x + w, y, x + w, y + h);
  if (bottomBorder) drawLine(page, x, y, x + w, y);
  if (text !== null)
    drawText(page, text, x + textOffX, y + textOffY, font, size, color);
}

// Draw a full-width section header row (teal bg, white text)
function sectionHeader(page, textEn, textAr, x, y, totalW, h, fontB, fontAr, size = 8.5) {
  drawRect(page, x, y, totalW, h, TEAL);
  drawLine(page, x, y, x + totalW, y);           // bottom
  drawText(page, textEn, x + 6, y + 4, fontB, size, WHITE);
  if (textAr) {
    // right-align Arabic
    const arW = fontAr.widthOfTextAtSize(textAr, size);
    drawText(page, textAr, x + totalW - arW - 6, y + 4, fontAr, size, WHITE);
  }
}

// ── main ───────────────────────────────────────────────────────────────────
export async function buildPDF(contract) {
  const templateBytes = fs.readFileSync(path.join(assetsDir, 'blank_template.pdf'));
  const pdfDoc = await PDFDocument.load(templateBytes);

  // embed standard fonts (Helvetica = good enough for English)
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // For Arabic we use a fallback: draw Arabic text with Helvetica just as
  // placeholder glyphs — the template already has the Arabic labels printed.
  // We just need English values anyway.
  const fontAr = fontR; // kept for call-compatibility

  const page = pdfDoc.getPages()[0];
  const W = page.getWidth();   // 595.5

  const formatNum = v => Number(v || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

  // ── Layout constants ─────────────────────────────────────────────────────
  const LEFT  = 30;           // left margin
  const RIGHT = W - 30;       // right margin
  const FULL  = RIGHT - LEFT; // total table width = 535.5
  const ROW_H = 16;           // standard row height
  const HDR_H = 18;           // section header height

  // Column widths for 3-column contract details table
  // [English label | value | Arabic label]
  const C1 = 115;  // English label
  const C3 = 125;  // Arabic label
  const C2 = FULL - C1 - C3; // value column

  // ── SECTION 1: CONTRACT DETAILS ─────────────────────────────────────────
  let Y = 640;  // start Y (PDF origin bottom-left)

  sectionHeader(page, 'CONTRACT DETAILS', 'تفاصيل العقد', LEFT, Y, FULL, HDR_H, fontB, fontAr);
  drawLine(page, LEFT, Y + HDR_H, LEFT + FULL, Y + HDR_H); // top border
  drawLine(page, LEFT, Y, LEFT + FULL, Y);
  drawLine(page, LEFT, Y, LEFT, Y + HDR_H);                // left
  drawLine(page, LEFT + FULL, Y, LEFT + FULL, Y + HDR_H);  // right

  const rows1 = [
    ['Contract No.',          contract.number,                      'رقم العقد',           true],
    ['Issue Date',            contract.issueDate,                   'تاريخ الإصدار',       false],
    ['Start Date',            contract.startDate,                   'تاريخ البداية',       true],
    ['End Date',              contract.endDate,                     'تاريخ النهاية',       false],
    ['Annual Rent',           formatNum(contract.annualRent),       'الإيجار السنوي',      true],
    ['Contract Value',        formatNum(contract.value),            'قيمة العقد',          false],
    ['Security Deposit',      '—',                                  'مبلغ التأمين',        true],
    ['Contract Type',         contract.type,                        'نوع العقد',           false],
    ['Grace Period',          '—',                                  'فترة السماح',         true],
    ['Contract Term',         contract.term,                        'مدة العقد',           false],
    ['Payment Method',        'Cheque',                             'طريقة السداد',        true],
    ['Number of Payments',    String(contract.payments),            'عدد الدفعات',         false],
    ['Number of Occupants',   String(contract.occupants),           'عدد القاطنين',        true],
    ['Water & Electricity Bill', 'TENANT',                          'استهلاك الماء والكهرباء', false],
    ['Pets Allowed',          'No',                                 'السماح بإيواء الحيوانات', true],
  ];

  // Draw outer border
  const tableH1 = rows1.length * ROW_H;
  drawLine(page, LEFT, Y - tableH1, LEFT, Y);
  drawLine(page, LEFT + FULL, Y - tableH1, LEFT + FULL, Y);
  drawLine(page, LEFT, Y - tableH1, LEFT + FULL, Y - tableH1);

  rows1.forEach(([en, val, ar, shade], i) => {
    const ry = Y - (i + 1) * ROW_H;
    const bg = shade ? LGREY : WHITE;

    // label cell
    cell(page, en,  LEFT,          ry, C1, ROW_H, fontR, 7.5, BLACK, bg, 4, 4);
    // value cell
    cell(page, val, LEFT + C1,     ry, C2, ROW_H, fontR, 8,   BLUE,  bg, 6, 4);
    // arabic cell (right-aligned text)
    const arW = fontAr.widthOfTextAtSize(ar, 7.5);
    const arX = LEFT + C1 + C2 + (C3 - arW - 6);
    cell(page, null, LEFT + C1 + C2, ry, C3, ROW_H, fontAr, 7.5, BLACK, bg);
    drawText(page, ar, arX, ry + 4, fontAr, 7.5, BLACK);
    // inner vertical borders
    drawLine(page, LEFT + C1,       ry, LEFT + C1,       ry + ROW_H);
    drawLine(page, LEFT + C1 + C2,  ry, LEFT + C1 + C2,  ry + ROW_H);
  });

  Y -= tableH1 + 10;

  // ── FIRST PARTY HEADER ──────────────────────────────────────────────────
  drawText(page, 'FIRST PARTY (LESSOR)', LEFT, Y + 2, fontB, 8.5, BLACK);
  const fpArW = fontAr.widthOfTextAtSize('الطرف الأول (المؤجر)', 8.5);
  drawText(page, 'الطرف الأول (المؤجر)', LEFT + FULL - fpArW, Y + 2, fontAr, 8.5, BLACK);
  Y -= 16;

  // ── SECTION 2: LESSOR DETAILS ──────────────────────────────────────────
  sectionHeader(page, '1.  LESSOR DETAILS', '.1  تفاصيل المؤجر', LEFT, Y, FULL, HDR_H, fontB, fontAr);
  drawLine(page, LEFT, Y + HDR_H, LEFT + FULL, Y + HDR_H);
  drawLine(page, LEFT, Y, LEFT, Y + HDR_H);
  drawLine(page, LEFT + FULL, Y, LEFT + FULL, Y + HDR_H);
  Y -= HDR_H;

  // Sub-header columns (Arabic labels then English labels)
  // 4 columns: Company Name | License No | Mobile No | Email
  const LC1 = 220, LC2 = 90, LC3 = 90, LC4 = FULL - 220 - 90 - 90; // ~135
  const subCols = [
    { w: LC4, ar: 'البريد الإلكتروني',  en: 'Email' },
    { w: LC3, ar: 'الهاتف المتحرك',     en: 'Mobile No.' },
    { w: LC2, ar: 'رقم الرخصة',         en: 'License No.' },
    { w: LC1, ar: 'اسم الشركة',          en: 'Company Name' },
  ];

  // Arabic sub-header row
  let cx = LEFT;
  drawLine(page, LEFT, Y, LEFT + FULL, Y); // bottom of Arabic header
  drawLine(page, LEFT, Y, LEFT, Y + HDR_H);
  drawLine(page, LEFT + FULL, Y, LEFT + FULL, Y + HDR_H);
  subCols.forEach(col => {
    drawRect(page, cx, Y, col.w, HDR_H, LGREY);
    const tw = fontAr.widthOfTextAtSize(col.ar, 7);
    drawText(page, col.ar, cx + (col.w - tw)/2, Y + 5, fontAr, 7, BLACK);
    drawLine(page, cx + col.w, Y, cx + col.w, Y + HDR_H);
    cx += col.w;
  });
  Y -= HDR_H;

  // English sub-header row
  cx = LEFT;
  drawLine(page, LEFT, Y, LEFT + FULL, Y);
  drawLine(page, LEFT, Y, LEFT, Y + HDR_H);
  drawLine(page, LEFT + FULL, Y, LEFT + FULL, Y + HDR_H);
  subCols.forEach(col => {
    drawRect(page, cx, Y, col.w, HDR_H, LGREY);
    const tw = fontB.widthOfTextAtSize(col.en, 7.5);
    drawText(page, col.en, cx + (col.w - tw)/2, Y + 5, fontB, 7.5, BLACK);
    drawLine(page, cx + col.w, Y, cx + col.w, Y + HDR_H);
    cx += col.w;
  });
  Y -= HDR_H;

  // Data row
  const lessorVals = [contract.lessorEmail, contract.lessorMobile, contract.lessorLicense, contract.lessorCompany];
  cx = LEFT;
  drawLine(page, LEFT, Y, LEFT + FULL, Y); // bottom
  drawLine(page, LEFT, Y, LEFT, Y + HDR_H);
  drawLine(page, LEFT + FULL, Y, LEFT + FULL, Y + HDR_H);
  subCols.forEach((col, i) => {
    const val = lessorVals[i] ?? '—';
    const tw = fontR.widthOfTextAtSize(val, 7.5);
    const textX = cx + (col.w - Math.min(tw, col.w - 8))/2;
    drawRect(page, cx, Y, col.w, HDR_H, WHITE);
    // wrap if too long
    if (tw > col.w - 6) {
      const words = val.split(' ');
      let l1='', l2='';
      words.forEach(w => { if ((l1+' '+w).trim().length < 20) l1 += (l1?' ':'')+w; else l2 += (l2?' ':'')+w; });
      drawText(page, l1, cx + 4, Y + 8, fontR, 7, BLACK);
      if (l2) drawText(page, l2, cx + 4, Y + 1, fontR, 7, BLACK);
    } else {
      drawText(page, val, textX, Y + 4, fontR, 7.5, BLACK);
    }
    drawLine(page, cx + col.w, Y, cx + col.w, Y + HDR_H);
    cx += col.w;
  });
  Y -= HDR_H + 6;

  // ── CONTACT PERSON ─────────────────────────────────────────────────────
  // Header row
  drawRect(page, LEFT, Y, FULL, HDR_H, LGREY);
  drawLine(page, LEFT, Y + HDR_H, LEFT + FULL, Y + HDR_H);
  drawLine(page, LEFT, Y, LEFT + FULL, Y);
  drawLine(page, LEFT, Y, LEFT, Y + HDR_H);
  drawLine(page, LEFT + FULL, Y, LEFT + FULL, Y + HDR_H);
  drawText(page, 'Contact Person', LEFT + 5, Y + 5, fontB, 8.5, BLACK);
  const cpArW = fontAr.widthOfTextAtSize('المعني بالاتصال', 8);
  drawText(page, 'المعني بالاتصال', LEFT + FULL - cpArW - 5, Y + 5, fontAr, 8, BLACK);
  Y -= HDR_H;

  const cpRows = [
    ['Full Name',  contract.lessorName,   'الاسم الكامل',      false],
    ['Mobile No.', contract.lessorMobile,  'الهاتف المتحرك',    true],
    ['Email',      contract.lessorEmail,   'البريد الإلكتروني', false],
  ];

  const LBC1 = 100, LBC3 = 120, LBC2 = FULL - LBC1 - LBC3;
  drawLine(page, LEFT, Y, LEFT, Y - cpRows.length * ROW_H);
  drawLine(page, LEFT + FULL, Y, LEFT + FULL, Y - cpRows.length * ROW_H);
  drawLine(page, LEFT, Y - cpRows.length * ROW_H, LEFT + FULL, Y - cpRows.length * ROW_H);

  cpRows.forEach(([en, val, ar, shade], i) => {
    const ry = Y - (i+1) * ROW_H;
    const bg = shade ? LGREY : WHITE;
    cell(page, en,  LEFT,              ry, LBC1, ROW_H, fontR, 7.5, BLACK,  bg, 4, 4);
    cell(page, val, LEFT + LBC1,       ry, LBC2, ROW_H, fontR, 7.5, BLACK,  bg, 5, 4);
    const arW2 = fontAr.widthOfTextAtSize(ar, 7.5);
    cell(page, null, LEFT + LBC1+LBC2, ry, LBC3, ROW_H, fontAr, 7.5, BLACK, bg);
    drawText(page, ar, LEFT + LBC1+LBC2 + (LBC3 - arW2 - 5), ry + 4, fontAr, 7.5, BLACK);
    drawLine(page, LEFT + LBC1,        ry, LEFT + LBC1,        ry + ROW_H);
    drawLine(page, LEFT + LBC1 + LBC2, ry, LEFT + LBC1 + LBC2, ry + ROW_H);
  });

  return await pdfDoc.save();
}

// CLI test
if (process.argv[2] === '--test') {
  const contract = {
    number: '202401457543',
    issueDate: '2025-07-03',
    startDate: '2025-08-12',
    endDate: '2026-08-14',
    annualRent: 58000,
    value: 58000,
    type: 'Residential',
    term: '1 Year',
    payments: 1,
    occupants: 1,
    lessorCompany: 'INTERNATIONAL CONSTRUCTION CONTRACTING - L L C',
    lessorLicense: 'CN-1048007',
    lessorName: 'SHINE PILLAI HARIDASAN PILLAI SANTHA KUMARI',
    lessorMobile: '971588973810',
    lessorEmail: 'shinepillaihs@gmail.com',
  };
  const bytes = await buildPDF(contract);
  fs.writeFileSync(path.join(assetsDir, 'test_output.pdf'), bytes);
  console.log('Saved test_output.pdf');
}
