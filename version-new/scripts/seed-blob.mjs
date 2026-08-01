/**
 * Seed Vercel Blob with local contracts.json + PDFs
 * Usage: node --env-file=.env.local scripts/seed-blob.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { put } from '@vercel/blob';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsFile = path.join(root, 'data', 'contracts.json');
const pdfsDir = path.join(root, 'data', 'pdfs');

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing BLOB_READ_WRITE_TOKEN');
  process.exit(1);
}

const contracts = JSON.parse(fs.readFileSync(contractsFile, 'utf8'));

for (const [id, c] of Object.entries(contracts)) {
  const localPdf = path.join(pdfsDir, `${id}.pdf`);
  if (fs.existsSync(localPdf)) {
    const blob = await put(`pdfs/${id}.pdf`, fs.readFileSync(localPdf), {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    c.pdfUrl = blob.url;
    console.log('Uploaded PDF', id, '→', blob.url);
  }
}

await put('db/contracts.json', JSON.stringify(contracts, null, 2), {
  access: 'public',
  contentType: 'application/json',
  addRandomSuffix: false,
  allowOverwrite: true,
});

console.log('Seeded contracts DB to Blob (', Object.keys(contracts).length, 'records)');
