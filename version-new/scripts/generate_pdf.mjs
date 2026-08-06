// generate_pdf.mjs - draws contract fields onto blank_template.pdf
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '../public/assets/templates');

// Colours matching the official ADREC contract
const TEAL   = rgb(0.06, 0.38, 0.48);   // header rows
const LGREY  = rgb(0.94, 0.96, 0.98);   // alternate rows
const WHITE  = rgb(1, 1, 1);
const BLACK  = rgb(0, 0, 0);
const BLUE   = rgb(0.09, 0.39, 0.67);   // data values
const LINE   = rgb(0.1, 0.1, 0.1);      // borders

function drawRect(page, x, y, w, h, fill, stroke = null, lineWidth = 0.5) {
  page.drawRectangle({ x, y, width: w, height: h, color: fill,
    borderColor: stroke ?? fill, borderWidth: stroke ? lineWidth : 0 });
}

function drawLine(page, x1, y1, x2, y2, lw = 0.5) {
  page.drawLine({ start: {x: x1, y: y1}, end: {x: x2, y: y2},
    thickness: lw, color: LINE });
}

function drawText(page, text, x, y, font, size, color = BLACK) {
  if (text !== null && text !== undefined) {
    page.drawText(String(text), { x, y, font, size, color });
  }
}

function cell(page, text, x, y, w, h, font, size = 8, color = BLACK,
              fill = WHITE, textOffX = 4, textOffY = 3, rightBorder = true, bottomBorder = true) {
  drawRect(page, x, y, w, h, fill);
  if (rightBorder) drawLine(page, x + w, y, x + w, y + h);
  if (bottomBorder) drawLine(page, x, y, x + w, y);
  if (text !== null && text !== undefined)
    drawText(page, text, x + textOffX, y + textOffY, font, size, color);
}

export async function buildPDF(contract) {
  const templatePath = path.join(assetsDir, 'blank_template.pdf');
  let pdfDoc;

  if (fs.existsSync(templatePath)) {
    const templateBytes = fs.readFileSync(templatePath);
    pdfDoc = await PDFDocument.load(templateBytes);
  } else {
    pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595.5, 842]);
  }

  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.getPages()[0];
  const W = page.getWidth();

  const formatNum = v => {
    if (typeof v === 'number') {
      return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (typeof v === 'string' && !isNaN(parseFloat(v.replace(/,/g, '')))) {
      return parseFloat(v.replace(/,/g, '')).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return String(v || '62,000.00');
  };

  const LEFT  = 30;
  const RIGHT = W - 30;
  const FULL  = RIGHT - LEFT;
  const ROW_H = 16;
  const HDR_H = 18;

  const C1 = 115;
  const C3 = 125;
  const C2 = FULL - C1 - C3;

  let Y = 640;

  // Draw CONTRACT DETAILS Header
  drawRect(page, LEFT, Y, FULL, HDR_H, TEAL);
  drawLine(page, LEFT, Y + HDR_H, LEFT + FULL, Y + HDR_H);
  drawLine(page, LEFT, Y, LEFT + FULL, Y);
  drawLine(page, LEFT, Y, LEFT, Y + HDR_H);
  drawLine(page, LEFT + FULL, Y, LEFT + FULL, Y + HDR_H);
  drawText(page, 'CONTRACT DETAILS', LEFT + 6, Y + 4, fontB, 8.5, WHITE);

  // 6 Specified Fields Mapping
  const targetRows = [
    ['Contract No.',          contract.number || '202401451011',                   true],
    ['Issue Date',            contract.issueDate || '2025-06-28',                 false],
    ['Start Date',            contract.startDate || '2025-08-19',                 true],
    ['End Date',              contract.endDate || '2026-08-20',                   false],
    ['Annual Rent',           formatNum(contract.annualRent || 62000),             true],
    ['Contract Value',        formatNum(contract.value || contract.annualRent || 62000), false],
    ['Security Deposit',      contract.securityDeposit ? formatNum(contract.securityDeposit) : '---', true],
    ['Contract Type',         contract.type || 'Residential',                      false],
    ['Grace Period',          '---',                                               true],
    ['Contract Term',         contract.term || '1 Year',                           false],
    ['Payment Method',        contract.paymentMethod || 'Cheque',                  true],
    ['Number of Payments',    String(contract.payments || 1),                      false],
    ['Number of Occupants',   String(contract.occupants || 1),                     true],
    ['Water & Electricity Bill', contract.waterElectricity || 'TENANT',            false],
    ['Pets Allowed',          contract.petsAllowed || 'No',                        true],
  ];

  const tableH1 = targetRows.length * ROW_H;
  drawLine(page, LEFT, Y - tableH1, LEFT, Y);
  drawLine(page, LEFT + FULL, Y - tableH1, LEFT + FULL, Y);
  drawLine(page, LEFT, Y - tableH1, LEFT + FULL, Y - tableH1);

  targetRows.forEach(([en, val, shade], i) => {
    const ry = Y - (i + 1) * ROW_H;
    const bg = shade ? LGREY : WHITE;

    // label cell
    cell(page, en,  LEFT,          ry, C1, ROW_H, fontR, 7.5, BLACK, bg, 4, 4);
    // value cell
    cell(page, val, LEFT + C1,     ry, C2, ROW_H, fontB, 8,   BLUE,  bg, 6, 4);
    // arabic cell
    cell(page, null, LEFT + C1 + C2, ry, C3, ROW_H, fontR, 7.5, BLACK, bg);

    drawLine(page, LEFT + C1,       ry, LEFT + C1,       ry + ROW_H);
    drawLine(page, LEFT + C1 + C2,  ry, LEFT + C1 + C2,  ry + ROW_H);
  });

  return await pdfDoc.save();
}

if (process.argv[2] === '--test') {
  const contract = {
    number: '202401451011',
    issueDate: '2025-06-28',
    startDate: '2025-08-19',
    endDate: '2026-08-20',
    annualRent: 62000,
    value: 62000,
  };
  buildPDF(contract).then(bytes => {
    fs.writeFileSync(path.join(assetsDir, 'test_output.pdf'), bytes);
    console.log('Successfully generated PDF with specified 6 contract detail fields!');
  }).catch(err => {
    console.error('Error generating PDF:', err);
  });
}
