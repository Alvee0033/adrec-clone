import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '../public/assets');
const templatesDir = path.join(assetsDir, 'templates');

async function renderPreview() {
  const htmlPath = path.join(templatesDir, 'contract_page1_template.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');

  // Inline images as base64 so they always load
  const images = {
    '/assets/qr_code.png': path.join(templatesDir, 'qr_code.png'),
    '/assets/dmt_logo.png': path.join(templatesDir, 'dmt_logo.png'),
    '/assets/dmt_text_logo.png': path.join(templatesDir, 'dmt_text_logo.png'),
    '/assets/templates/qr_code.png': path.join(templatesDir, 'qr_code.png'),
    '/assets/templates/dmt_logo.png': path.join(templatesDir, 'dmt_logo.png'),
    '/assets/templates/dmt_text_logo.png': path.join(templatesDir, 'dmt_text_logo.png'),
  };

  for (const [placeholder, imgPath] of Object.entries(images)) {
    if (fs.existsSync(imgPath)) {
      const b64 = fs.readFileSync(imgPath).toString('base64');
      html = html.replaceAll(`src="${placeholder}"`, `src="data:image/png;base64,${b64}"`);
    }
  }

  // Replace placeholders with sample contract data
  const contract = {
    number: '202401457543',
    issueDate: '2025-07-03',
    startDate: '2025-08-12',
    endDate: '2026-08-14',
    annualRent: '58,000.00',
    value: '58,000.00',
    deposit: '——',
    type: 'Residential',
    typeAr: 'سكني',
    term: '1 Year',
    termAr: 'سنة واحدة',
    payments: '1',
    occupants: '1',
    lessorEmail: 'shinepillaihs@gmail.com',
    lessorMobile: '971588973810',
    lessorLicense: 'CN-1048007',
    lessorCompany: 'INTERNATIONAL CONSTRUCTION CONTRACTING - L L C',
    lessorName: 'SHINE PILLAI HARIDASAN PILLAI SANTHA KUMARI',
  };

  for (const [key, val] of Object.entries(contract)) {
    html = html.replaceAll(`{{${key}}}`, val);
  }

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({
    path: path.join(assetsDir, 'contract_preview.png'),
    fullPage: true,
    clip: { x: 0, y: 0, width: 794, height: 1123 },
  });

  await browser.close();
  console.log('Preview saved to assets/contract_preview.png');
}

renderPreview().catch(console.error);
