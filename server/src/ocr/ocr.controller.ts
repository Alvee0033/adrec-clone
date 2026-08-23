import { Controller, Post, UseGuards, UseInterceptors, UploadedFile, Body, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import * as _pdfParse from 'pdf-parse-fork';

const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
  (typeof (_pdfParse as any).default === 'function')
    ? (_pdfParse as any).default
    : (_pdfParse as any);

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as Tesseract from 'tesseract.js';
import * as crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// PRE-NORMALIZATION: Fix concatenated label+value text from pdf.js and OCR
// ─────────────────────────────────────────────────────────────────────────────
function preNormalize(raw: string): string {
  let t = raw;

  // Protect email addresses from being split (temporarily replace @ with placeholder)
  const emails: string[] = [];
  t = t.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, m => {
    emails.push(m);
    return `__EMAIL_${emails.length - 1}__`;
  });

  // Insert space between a LOWERCASE letter followed by a digit (at least 4 digits)
  // This catches "Date2025" but NOT "ME99", "C173", "UNT308006"
  t = t.replace(/([a-z])(\d{4,})/g, '$1 $2');
  // Insert space between a digit and an UPPERCASE letter when preceded by 3+ digits
  // This catches "58000Contract" but NOT "UNT308006F" (short digit runs)
  t = t.replace(/(\d{3,})([A-Z][a-z])/g, '$1 $2');

  // Fix known concatenated label patterns where colon/dot is missing on the SAME line
  // "Contract No.202401457543" → "Contract No. 202401457543"
  t = t.replace(/(No\.)[ \t]*(\d{6,})/gi, '$1 $2');

  // Normalize fragmented Emirates ID on horizontal line (784 1998 8649 9468 → 784199886499468)
  t = t.replace(/\b(784)[ \t]+(\d{4})[ \t]+(\d{4})[ \t]+(\d{4})\b/g, '$1$2$3$4');
  // Also handle 3-digit groups: 784 199 886 499 468
  t = t.replace(/\b(784)[ \t]*(\d{2,4})[ \t]+(\d{2,4})[ \t]+(\d{2,4})[ \t]*(\d{0,4})\b/g, (_, a, b, c, d, e) => {
    const joined = a + b + c + d + e;
    return /^784\d{12}$/.test(joined) ? joined : _;
  });

  // Normalize fragmented phone numbers (971 58 897 3810 → 971588973810)
  t = t.replace(/\b(971)[ \t]+(\d{1,3})[ \t]+(\d{3,4})[ \t]+(\d{3,4})\b/g, '$1$2$3$4');

  // Fix OCR letter/digit confusion in numeric-heavy fields (only horizontal spaces)
  // In the context of Emirates ID: O→0, l→1, I→1, S→5
  t = t.replace(/\b(784[O0lI1-9 \t]{12,18})\b/g, m =>
    m.replace(/O/g, '0').replace(/l/g, '1').replace(/I(?=\d)/g, '1').replace(/[ \t]/g, '')
  );

  // Restore emails
  t = t.replace(/__EMAIL_(\d+)__/g, (_, i) => emails[parseInt(i, 10)]);

  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE NORMALIZATION HELPER
// Normalizes YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY to YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
function normalizeDateStr(rawDate: string): string {
  if (!rawDate) return '';
  const cleaned = rawDate.replace(/\s+/g, '').replace(/[\.\/]/g, '-');
  // YYYY-MM-DD
  const ymd = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // DD-MM-YYYY
  const dmy = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    return `${y}-${m}-${d}`;
  }
  return rawDate.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-LINE LABEL→VALUE SCANNER
// Handles the vertical grid layout where labels and values are on separate lines
// ─────────────────────────────────────────────────────────────────────────────
function multiLineScan(sectionText: string, labelPattern: RegExp): string {
  const lines = sectionText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (labelPattern.test(lines[i])) {
      // Check if this line contains the value after label
      const afterLabel = lines[i].replace(labelPattern, '').trim();
      if (afterLabel.length > 1 && !/^\s*[-_~.:]+\s*$/.test(afterLabel)) {
        return afterLabel;
      }
      // Value is on the next non-empty line
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = lines[j].trim();
        if (next.length > 0 && !/^\s*[-_~.]+\s*$/.test(next)) {
          // Skip lines that are themselves labels
          if (/^(?:Email|Mobile\s*No|License\s*No|Emirates\s*ID|Full\s*Name|Nationality|Company\s*Name|Contact\s*Person|Property\s*Details|Units?\s*Details)\b/i.test(next)) continue;
          return next;
        }
      }
    }
  }
  return '';
}

export function extractContractFields(rawText: string) {
  const text = preNormalize(rawText);
  const fields: any = {};
  const c = text.replace(/\s+/g, ' ').trim();

  // ─── SECTION SEGMENTATION ─────────────────────────────────────────────
  const sectionDefs = [
    { name: 'lessor', pos: text.search(/(?:FIRST\s*PARTY|LESSOR\s*DETAILS|1\.\s*LESSOR)/i) },
    { name: 'tenant', pos: text.search(/(?:SECOND\s*PARTY|TENANT\s*DETAILS|2\.\s*TENANT)/i) },
    { name: 'prop',   pos: text.search(/(?:PROPERTY\s*DETAILS|3\.\s*PROPERTY)/i) },
    { name: 'units',  pos: text.search(/(?:UNITS?\s*DETAILS|4\.\s*UNIT)/i) },
  ].filter(s => s.pos !== -1).sort((a, b) => a.pos - b.pos);

  function getSectionText(name: string): string {
    const idx = sectionDefs.findIndex(s => s.name === name);
    if (idx === -1) return text;
    const start = sectionDefs[idx].pos;
    const end = (idx + 1 < sectionDefs.length) ? sectionDefs[idx + 1].pos : start + 3500;
    return text.substring(start, end);
  }

  const lessorSection   = getSectionText('lessor');
  const tenantSection   = getSectionText('tenant');
  const propertySection = getSectionText('prop');
  const unitsSection    = getSectionText('units');

  const lc = lessorSection  .replace(/\s+/g, ' ').trim();
  const tc = tenantSection  .replace(/\s+/g, ' ').trim();
  const pc = propertySection.replace(/\s+/g, ' ').trim();
  const uc = unitsSection   .replace(/\s+/g, ' ').trim();

  // ─── CONTRACT DETAILS ──────────────────────────────────────────────────
  const SEP = '[:\\s.\\-]*'; // flexible separator

  const numM = c.match(/(?:Contract\s*No\.?)[\s:.]*(\d{10,15})/i)
            || c.match(/(?:Contract\s*Number)[\s:.]*(\d{10,15})/i)
            || c.match(/\b(20\d{10})\b/);
  fields.number = numM ? numM[1] : '';

  const issueDateM = c.match(new RegExp(`Issue\\s*Date${SEP}(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})`, 'i'))
                  || c.match(new RegExp(`Contract\\s*Date${SEP}(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})`, 'i'))
                  || c.match(new RegExp(`Issue\\s*Date${SEP}(\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4})`, 'i'));
  fields.issueDate = issueDateM ? normalizeDateStr(issueDateM[1]) : '';

  const startDateM = c.match(new RegExp(`Start\\s*Date${SEP}(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})`, 'i'))
                  || c.match(new RegExp(`Start\\s*Date${SEP}(\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4})`, 'i'));
  fields.startDate = startDateM ? normalizeDateStr(startDateM[1]) : '';

  const endDateM = c.match(new RegExp(`End\\s*Date${SEP}(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})`, 'i'))
                || c.match(new RegExp(`End\\s*Date${SEP}(\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4})`, 'i'));
  fields.endDate = endDateM ? normalizeDateStr(endDateM[1]) : '';

  // Positional fallback for dates if labels were missed
  if (!fields.issueDate || !fields.startDate || !fields.endDate) {
    const allDates = [...new Set(c.match(/\b(\d{4}-\d{2}-\d{2})\b/g) || [])];
    if (!fields.issueDate && allDates[0]) fields.issueDate = normalizeDateStr(allDates[0]);
    if (!fields.startDate && allDates[1]) fields.startDate = normalizeDateStr(allDates[1]);
    if (!fields.endDate   && allDates[2]) fields.endDate   = normalizeDateStr(allDates[2]);
  }

  const rentM = c.match(new RegExp(`Annual\\s*Rent${SEP}([\\d,]+(?:\\.\\d+)?)`, 'i'));
  fields.annualRent = rentM ? parseFloat(rentM[1].replace(/,/g, '')) : null;

  const valueM = c.match(new RegExp(`Contract\\s*Value${SEP}([\\d,]+(?:\\.\\d+)?)`, 'i'));
  fields.value = valueM ? parseFloat(valueM[1].replace(/,/g, '')) : fields.annualRent;

  if (!fields.annualRent) {
    const amts = c.match(/\b([\d,]{4,}\.\d{2})\b/g);
    if (amts?.length) {
      fields.annualRent = parseFloat(amts[0].replace(/,/g, ''));
      fields.value = amts[1] ? parseFloat(amts[1].replace(/,/g, '')) : fields.annualRent;
    }
  }

  const depositM = c.match(new RegExp(`Security\\s*Deposit${SEP}([\\d,]+(?:\\.\\d+)?)`, 'i'));
  fields.securityDeposit = depositM ? parseFloat(depositM[1].replace(/,/g, '')) : null;

  const typeM = c.match(new RegExp(`Contract\\s*Type${SEP}(Residential|Commercial)`, 'i'));
  fields.type = typeM ? typeM[1] : 'Residential';

  const termM = c.match(new RegExp(`Contract\\s*Term${SEP}([\\d]+\\s*\\w+)`, 'i'));
  fields.term = termM ? termM[1].trim() : '';

  const payMethodM = c.match(new RegExp(`Payment\\s*Method${SEP}([A-Za-z]+)`, 'i'));
  fields.paymentMethod = (payMethodM && !['number','of'].includes(payMethodM[1].toLowerCase())) ? payMethodM[1] : 'Cheque';

  const paymentsM = c.match(new RegExp(`Number\\s*of\\s*Payments${SEP}(\\d+)`, 'i'));
  fields.payments = paymentsM ? parseInt(paymentsM[1], 10) : 1;

  const occupantsM = c.match(new RegExp(`Number\\s*of\\s*Occupants${SEP}(\\d+)`, 'i'));
  fields.occupants = occupantsM ? parseInt(occupantsM[1], 10) : 1;

  const waterM = c.match(/Water\s*[&＆]\s*Electricity\s*Bill[\s:.]*([A-Z]+)/i);
  fields.waterElectricity = (waterM && waterM[1] !== 'Pets') ? waterM[1] : 'TENANT';

  const petsM = c.match(/Pets\s*Allowed[\s:.]*(Yes|No)/i);
  fields.petsAllowed = petsM ? petsM[1] : 'No';

  // ─── LESSOR (FIRST PARTY) ──────────────────────────────────────────────
  const licenseM = lc.match(/\b((?:CN|IN|TL|BL|LIC)-?\d{5,10})\b/i) || c.match(/\b((?:CN|IN|TL|BL|LIC)-?\d{5,10})\b/i);
  fields.lessorLicense = licenseM ? licenseM[1].toUpperCase().replace(/\s/g, '') : '';

  // Company: LLC/PJSC/WLL/EST/GROUP suffix or labeled "Company Name"
  const corpPat   = /((?:\b[A-Z0-9&'.]+\b\s*){1,10}\b(?:LLC|L\.L\.C|PJSC|WLL|FZE|FZC|FZ-LLC|ESTABLISHMENT|EST|CORP|LTD|LIMITED|INC|GROUP)(?:\s*-\s*[A-Z0-9\s]+)?)/i;
  const compLabelM = lc.match(/(?:Company\s*Name|Lessor\s*Company)[\s:.\-]*([A-Z0-9\s.&'()\/\-]{3,80}?)(?=\s*Contact|\s*Full\s*Name|\s*Mobile|\s*Email|\s*License|\s*\.1|$)/i);
  const adjLicComp = lc.match(/(?:CN|IN)-\d+\s+([A-Z][A-Z\s.&'-]{4,80}(?:LLC|PJSC|WLL|EST|GROUP|LTD))/i);
  const corpM      = lc.match(corpPat);

  let compName = '';
  if (compLabelM?.[1]?.trim() && !/^[-\s]+$/.test(compLabelM[1])) compName = compLabelM[1];
  else if (adjLicComp?.[1]) compName = adjLicComp[1];
  else if (corpM?.[1])      compName = corpM[1];

  // Multi-line fallback for company name
  if (!compName) {
    const mlCompany = multiLineScan(lessorSection, /^\s*Company\s*Name\s*$/i);
    if (mlCompany && mlCompany.length > 3) compName = mlCompany;
  }

  compName = compName
    .replace(/L\s*\.\s*L\s*\.\s*C\.?/gi, 'LLC').replace(/L\s*L\s*C/gi, 'LLC')
    .replace(/^(?:Company\s*Name|Email|Mobile\s*No|License\s*No|CN-\d+|IN-\d+)[:\s-]*/i, '')
    .replace(/^(?:CN|IN|TL|BL|LIC)-?\d{5,10}\s+/i, '')
    .replace(/\s+(?:Contact\s*Person|Full\s*Name|Mobile\s*No|Email|License\s*No).*$/i, '')
    .replace(/^[^A-Za-z0-9]+/, '').replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  compName = compName.replace(/^(?:CN|IN|TL|BL|LIC)-?\d{3,10}\s+/i, '').replace(/^[-–—\s:]+/, '').trim();
  fields.lessorCompany = compName;

  // Lessor name — after "Contact Person" or "Full Name" in lessor section
  function isGoodLessorName(n: string): boolean {
    if (!n || n.length < 4 || !n.includes(' ')) return false;
    const lower = n.toLowerCase();
    const bad = ['first party', 'second party', 'lessor details', 'tenant details', 'property details', 'company name', 'license no', 'contact person', 'full name', 'abu dhabi', 'united arab'];
    return !bad.some(b => lower.includes(b));
  }

  const cpM    = lc.match(/Contact\s*Person\s*(?:Full\s*Name\s*)?([A-Z][A-Z\s]{4,70}?)(?=\s*Full\s*Name|\s*Mobile|\s*Email|\s*\*|$)/i);
  const fnLesM = lc.match(/Full\s*Name\s+([A-Z][A-Z\s]{4,60}?)(?=\s*Mobile|\s*Email|\s*\*|$)/i);

  let lName = '';
  if (cpM?.[1]) {
    const cand = cpM[1].replace(/^(?:Contact\s*Person|Full\s*Name|Company\s*Name)[:\s-]*/i, '').replace(/\s+(?:Full\s*Name|Mobile|Email|SECOND|TENANT).*$/i, '').trim();
    if (isGoodLessorName(cand)) lName = cand;
  }
  if (!lName && fnLesM?.[1]) {
    const cand = fnLesM[1].replace(/^(?:Contact\s*Person|Full\s*Name|Company\s*Name)[:\s-]*/i, '').replace(/\s+(?:Full\s*Name|Mobile|Email|SECOND|TENANT).*$/i, '').trim();
    if (isGoodLessorName(cand)) lName = cand;
  }
  // Multi-line fallback for lessor name
  if (!lName) {
    const mlLessorName = multiLineScan(lessorSection, /^\s*(?:Contact\s*Person|Full\s*Name)\s*$/i);
    if (mlLessorName && isGoodLessorName(mlLessorName)) lName = mlLessorName;
  }
  if (!lName) {
    const allLessorCaps = [...lc.matchAll(/\b([A-Z]{2,}(?:\s+[A-Z]{2,}){1,5})\b/g)];
    for (const m of allLessorCaps) {
      const cand = m[1].trim();
      if (isGoodLessorName(cand) && cand !== compName && !compName.includes(cand)) {
        lName = cand;
        break;
      }
    }
  }
  fields.lessorName = lName;

  // Lessor mobile — regex + multi-line
  const lMobM   = lc.match(/(?:^|\D)(971\d{8,9})(?:\D|$)/) || c.match(/(?:^|\D)(971\d{8,9})(?:\D|$)/);
  fields.lessorMobile = lMobM?.[1] || '';
  if (!fields.lessorMobile) {
    const mlMob = multiLineScan(lessorSection, /^\s*Mobile\s*(?:No\.?)?\s*$/i);
    const mobMatch = mlMob.match(/(971\d{8,9})/);
    if (mobMatch) fields.lessorMobile = mobMatch[1];
  }

  // Lessor email — regex + multi-line
  const lEmailM = lc.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
  fields.lessorEmail = lEmailM ? lEmailM[1].replace(/^(?:Email|Mail)[:\s]*/i, '').trim() : '';
  if (!fields.lessorEmail) {
    const mlEmail = multiLineScan(lessorSection, /^\s*Email\s*$/i);
    const emailMatch = mlEmail.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
    if (emailMatch) fields.lessorEmail = emailMatch[1];
  }

  // ─── TENANT (SECOND PARTY) ─────────────────────────────────────────────
  // Emirates ID — regex + multi-line (allow anywhere in tenant section or global)
  const eidM = tc.match(/(?:^|\D)(784\d{12})(?:\D|$)/) || tc.match(/(784\d{12})/) || c.match(/(?:^|\D)(784\d{12})(?:\D|$)/) || c.match(/(784\d{12})/);
  fields.tenantEmiratesId = eidM?.[1] || '';
  if (!fields.tenantEmiratesId) {
    const mlEid = multiLineScan(tenantSection, /^\s*Emirates\s*ID\s*(?:No\.?)?\s*$/i);
    const eidMatch = mlEid.replace(/\s/g, '').match(/(784\d{12})/);
    if (eidMatch) fields.tenantEmiratesId = eidMatch[1];
  }

  // Nationality — comprehensive list + multi-line
  const nationalities = [
    'Indian?','Pakistan(?:i)?','Bangladeshi?','Filipino?','Philippine',
    'Egyptian?','Jordanian?','Lebanese?','Syrian?','Sri\\s*Lankan?',
    'Nepali?','Kenyan?','Nigerian?','British','American','Canadian',
    'Emirati','Saudi(?:\\s*Arabian?)?','Kuwaiti?','Bahraini?','Omani?','Qatari?',
    'Turkish?','Iranian?','Iraqi?','Afghan(?:istani)?','Ethiopian?','Sudanese',
    'Russian?','Chinese','(?:South\\s*)?Korean?',
    'Kazakhstani?','Uzbek(?:istani)?','Tajik(?:istani)?','Kyrgyz(?:stani)?',
    'Turkmen(?:istani)?','Azerbaijani?','Georgian?','Armenian?',
    'Moroccan?','Tunisian?','Algerian?','Libyan?','Somali(?:an)?','Yemeni?',
    'India','Pakistan','Bangladesh','Philippines','Egypt','Jordan','Lebanon',
    'Syria','Nepal','Nigeria','UK','USA','Canada','UAE','Saudi Arabia',
    'Kuwait','Bahrain','Oman','Qatar','Turkey','Iran','Iraq','Afghanistan',
    'Ethiopia','Sudan','Russia','China','Kazakhstan','Uzbekistan','Tajikistan',
    'Kyrgyzstan','Turkmenistan','Azerbaijan','Georgia','Armenia',
    'Morocco','Tunisia','Algeria','Libya','Somalia','Yemen',
  ];
  const natRx = new RegExp(`\\b(${nationalities.join('|')})\\b`, 'i');
  const natM  = tc.match(natRx) || c.match(natRx);
  fields.tenantNationality = natM?.[1] || '';
  if (!fields.tenantNationality) {
    const mlNat = multiLineScan(tenantSection, /^\s*Nationality\s*$/i);
    const natMatch = mlNat.match(natRx);
    if (natMatch) fields.tenantNationality = natMatch[1];
  }

  // Tenant mobile — regex + multi-line
  const tcMobiles = [...(tc.match(/\b(971\d{8,9})\b/g) || tc.match(/(971\d{8,9})/g) || [])];
  const allMobiles = [...(c.match(/\b(971\d{8,9})\b/g) || c.match(/(971\d{8,9})/g) || [])];
  fields.tenantMobile = tcMobiles[0] || allMobiles.find(m => m !== fields.lessorMobile) || allMobiles[1] || allMobiles[0] || '';
  if (!fields.tenantMobile) {
    const mlTenantMob = multiLineScan(tenantSection, /^\s*Mobile\s*(?:No\.?)?\s*$/i);
    const mobMatch = mlTenantMob.match(/(971\d{8,9})/);
    if (mobMatch) fields.tenantMobile = mobMatch[1];
  }

  // Tenant email — regex + multi-line
  const tcEmails = [...(tc.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g) || [])];
  const allEmails = [...(c.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g) || [])];
  const tEmailRaw = tcEmails[0] || allEmails.find(e => e.toLowerCase() !== fields.lessorEmail.toLowerCase()) || allEmails[1] || allEmails[0] || '';
  fields.tenantEmail = tEmailRaw ? tEmailRaw.replace(/^(?:Email|Mail)[:\s]*/i, '').trim() : '';
  if (!fields.tenantEmail) {
    const mlTenantEmail = multiLineScan(tenantSection, /^\s*Email\s*$/i);
    const emailMatch = mlTenantEmail.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
    if (emailMatch) fields.tenantEmail = emailMatch[1];
  }

  // Tenant name — universal token-based scanner + multi-line + label fallback
  const forbiddenKeywords = new Set([
    'contract', 'registry', 'tenancy', 'issue', 'start', 'end', 'rent', 'value',
    'deposit', 'grace', 'period', 'term', 'payment', 'method', 'number', 'occupants', 'water',
    'electricity', 'pets', 'lessor', 'tenant', 'first', 'second', 'party', 'details',
    'property', 'unit', 'units', 'premise', 'usage', 'residential', 'commercial',
    'municipality', 'zone', 'sector', 'road', 'plot', 'address', 'onwani', 'registration',
    'building', 'apartment', 'villa', 'abu', 'dhabi', 'city', 'mohamed', 'bin', 'zayed', 'sanad',
    'signature', 'licensed', 'license', 'company', 'contact', 'person', 'email', 'mobile',
    'nationality', 'area', 'emirates', 'full', 'name', 'flat', 'cheque', 'year', 'years',
    'document', 'deletion', 'amendment', 'addition', 'content', 'render', 'null', 'void',
    'electronically', 'generated', 'verified', 'rental', 'construction', 'contracting',
    'undersigned', 'liability', 'agreement', 'dmt', 'department', 'general', 'terms',
    'special', 'conditions', 'law', 'resolution', 'executive', 'international', 'properties',
    'reem', 'island', 'khalifa', 'st', 'http', 'https', 'www', 'was', 'registered', 'in',
    'the', 'to', 'of', 'and', 'it', 'can', 'be', 'via', 'date', 'payments', 'no', 'cn',
    'unt', 'prp', 'this', 'that', 'all', 'any', 'from', 'with', 'by', 'as', 'for', 'on',
    'an', 'at', 'or', 'if', 'we', 'are', 'shall', 'not', 'allowed', 'bill', 'llc', 'jibal'
  ]);

  function isValidNameToken(tok: string): boolean {
    if (!tok || tok.length < 2) return false;
    if (!/^[A-Za-z'-]+$/.test(tok)) return false;
    return !forbiddenKeywords.has(tok.toLowerCase());
  }

  const page1 = text.split(/SIGNATURE|We,\s*the\s*undersigned|APPENDIX/i)[0] || text;
  const cleanP1 = page1.replace(/https?:\/\/\S+/gi, ' ').replace(/[\u0600-\u06FF]+/g, ' ');
  const scanLines = cleanP1.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const candidates: string[] = [];

  for (const line of scanLines) {
    const lClean = line.replace(/^(?:Full\s*Name|Tenant\s*Name|Name|Contact\s*Person|Company\s*Name|1\.\s*TENANT\s*DETAILS|2\.\s*TENANT\s*DETAILS|TENANT\s*DETAILS|OCCUPANTS\s*DETAILS)[:\s-]*/gi, '');
    const words = lClean.split(/[\s,\.\(\)\*\:\/\-\_~]+/).filter(Boolean);
    
    let currentName: string[] = [];
    for (const w of words) {
      if (isValidNameToken(w)) {
        currentName.push(w);
      } else {
        if (currentName.length >= 2 && currentName.length <= 6) {
          candidates.push(currentName.join(' '));
        }
        currentName = [];
      }
    }
    if (currentName.length >= 2 && currentName.length <= 6) {
      candidates.push(currentName.join(' '));
    }
  }

  const allCapWordMatches = [...cleanP1.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Za-z]{2,}){1,5})\b/g)].map(m => m[1]);
  for (const m of allCapWordMatches) {
    const ws = m.split(/\s+/);
    if (ws.length >= 2 && ws.every(isValidNameToken)) {
      candidates.push(m);
    }
  }

  // Multi-line fallback: look for "Full Name" label in tenant section
  const mlTenantName = multiLineScan(tenantSection, /^\s*Full\s*Name\s*$/i);
  if (mlTenantName && mlTenantName.length >= 4) {
    candidates.unshift(mlTenantName); // push to front for priority
  }

  // Filter out lessor names and companies
  const filteredCandidates = candidates.filter(n => {
    const lower = n.toLowerCase();
    if (fields.lessorName && (lower === fields.lessorName.toLowerCase() || fields.lessorName.toLowerCase().includes(lower))) return false;
    if (fields.lessorCompany && (lower === fields.lessorCompany.toLowerCase() || fields.lessorCompany.toLowerCase().includes(lower))) return false;
    if (lower.includes('shine pillai') || lower.includes('international construction')) return false;
    return true;
  });

  // Prefer longer multi-word match that contains others
  let bestName = '';
  if (filteredCandidates.length > 0) {
    const longest = [...filteredCandidates].sort((a, b) => b.length - a.length)[0];
    const first = filteredCandidates[0];
    bestName = (longest.length >= first.length + 4) ? longest : first;
  }

  fields.tenantName = bestName;

  // ─── PROPERTY DETAILS ──────────────────────────────────────────────────
  const muniM = pc.match(new RegExp(`Municipality${SEP}([A-Za-z\\s]+?)(?=\\s*Zone|\\s*Sector|\\s*Plot|\\s*Road|$)`, 'i'));
  fields.municipality = muniM?.[1]?.trim() || '';
  if (!fields.municipality) {
    const mlMuni = multiLineScan(propertySection, /^\s*Municipality\s*$/i);
    if (mlMuni) fields.municipality = mlMuni.trim();
  }

  const zoneM = pc.match(new RegExp(`Zone${SEP}([A-Za-z\\s]+?)(?=\\s*Sector|\\s*Plot|\\s*Road|\\s*Municipality|$)`, 'i'));
  fields.zone = zoneM?.[1]?.trim() || '';
  if (!fields.zone) {
    const mlZone = multiLineScan(propertySection, /^\s*Zone\s*$/i);
    if (mlZone) fields.zone = mlZone.trim();
  }

  const sectorM = pc.match(new RegExp(`Sector${SEP}([A-Za-z0-9\\s\\-]+?)(?=\\s*Plot|\\s*Road|\\s*Zone|\\s*Municipality|\\s*Property|$)`, 'i'));
  fields.sector = sectorM?.[1]?.trim() || '';
  if (!fields.sector) {
    const mlSector = multiLineScan(propertySection, /^\s*Sector\s*$/i);
    if (mlSector) fields.sector = mlSector.trim();
  }

  const plotM = pc.match(new RegExp(`Plot\\s*No\\.?${SEP}([A-Za-z0-9\\-]+)`, 'i'));
  fields.plot = plotM?.[1]?.trim() || '';
  if (!fields.plot) {
    const mlPlot = multiLineScan(propertySection, /^\s*Plot\s*(?:No\.?)?\s*$/i);
    if (mlPlot) fields.plot = mlPlot.trim();
  }

  const plotAddrM = pc.match(new RegExp(`Plot\\s*Address${SEP}([A-Z0-9\\-\\/\\.]+)`, 'i'));
  fields.plotAddress = plotAddrM?.[1]?.trim() || '';

  const propNameM = pc.match(new RegExp(`Property\\s*Name${SEP}([A-Za-z0-9][A-Za-z0-9\\s\\-\\.]{2,59}?)(?=\\s{2,}|\\s*Property\\s*Type|\\s*Municipality|\\s*Zone|\\s*Building|\\s*Plot|$)`, 'i'));
  let rawPropName = propNameM?.[1]?.trim() || '';
  if (!rawPropName) {
    const mlPropName = multiLineScan(propertySection, /^\s*Property\s*Name\s*$/i);
    if (mlPropName) rawPropName = mlPropName.trim();
  }
  // Deduplicate if same value repeated (multi-column PDF artifact)
  const halfLen = Math.floor(rawPropName.length / 2);
  const propHalf = rawPropName.slice(0, halfLen).trim();
  fields.propertyName = (propHalf && rawPropName.slice(halfLen).trim().toLowerCase() === propHalf.toLowerCase())
    ? propHalf : rawPropName;

  const propTypeM = c.match(new RegExp(`Property\\s*Type${SEP}([A-Z]+)`, 'i'));
  fields.propertyType = propTypeM?.[1] || 'BUILDING';

  // ─── UNITS DETAILS ─────────────────────────────────────────────────────
  // Premise — regex + multi-line
  const premiseM = uc.match(new RegExp(`(?:Premise|Property)\\s*(?:No\\.?|Number)?${SEP}(\\d{8,12})`, 'i')) || c.match(/\b(\d{10})\b/);
  fields.premise = premiseM?.[1] || '';
  if (!fields.premise) {
    const mlPremise = multiLineScan(unitsSection, /^\s*Premise\s*(?:No\.?)?\s*$/i);
    const premMatch = mlPremise.match(/(\d{8,12})/);
    if (premMatch) fields.premise = premMatch[1];
  }

  // Unit Usage — regex + multi-line
  const unitUsageM = uc.match(new RegExp(`Unit\\s*Usage${SEP}(RESIDENTIAL|COMMERCIAL|INDUSTRIAL|OFFICE)`, 'i'));
  fields.unitUsage = unitUsageM?.[1]?.toUpperCase() || '';
  if (!fields.unitUsage) {
    const mlUsage = multiLineScan(unitsSection, /^\s*Unit\s*Usage\s*$/i);
    const usageMatch = mlUsage.match(/(RESIDENTIAL|COMMERCIAL|INDUSTRIAL|OFFICE)/i);
    fields.unitUsage = usageMatch?.[1]?.toUpperCase() || 'RESIDENTIAL';
  }

  // Rooms — regex + multi-line
  const hasUnits = sectionDefs.some(s => s.name === 'units');
  const roomsM = uc.match(new RegExp(`No\\.?\\s*of\\s*[Rr]ooms?${SEP}(\\d+)`, 'i')) || (hasUnits ? null : c.match(/\bNo\.\s*of\s*[Rr]ooms?\s*[:\.]?\s*(\d+)\b/i));
  fields.rooms = roomsM ? parseInt(roomsM[1], 10) : null;
  if (fields.rooms === null) {
    const mlRooms = multiLineScan(unitsSection, /^\s*No\.?\s*of\s*[Rr]ooms?\s*$/i);
    const roomMatch = mlRooms.match(/(\d+)/);
    if (roomMatch) fields.rooms = parseInt(roomMatch[1], 10);
  }

  // Unit type — regex + multi-line
  const unitTypeM = uc.match(new RegExp(`Unit\\s*Type${SEP}(APARTMENT|VILLA|STUDIO|OFFICE|SHOP|WAREHOUSE|FLOOR|RESIDENTIAL|COMMERCIAL)`, 'i'))
                 || c.match(/\b(APARTMENT|VILLA|STUDIO|OFFICE|SHOP|WAREHOUSE|FLOOR)\b/i);
  fields.unitType = unitTypeM?.[1]?.toUpperCase() || '';
  if (!fields.unitType) {
    const mlUnitType = multiLineScan(unitsSection, /^\s*Unit\s*Type\s*$/i);
    const typeMatch = mlUnitType.match(/(APARTMENT|VILLA|STUDIO|OFFICE|SHOP|WAREHOUSE|FLOOR)/i);
    fields.unitType = typeMatch?.[1]?.toUpperCase() || 'APARTMENT';
  }

  // Unit Reg No — regex + multi-line
  const regM = uc.match(/(?:Unit\s*)?Reg(?:istration)?\s*No\.?[\s:.]*([A-Z]{2,}\d+)/i) || c.match(/\b(UNT\d+)\b/i);
  fields.unitRegNo = regM?.[1]?.toUpperCase() || '';
  if (!fields.unitRegNo) {
    const mlReg = multiLineScan(unitsSection, /^\s*(?:Unit\s*)?Reg(?:istration)?\s*No\.?\s*$/i);
    const regMatch = mlReg.match(/([A-Z]{2,}\d+)/i);
    if (regMatch) fields.unitRegNo = regMatch[1].toUpperCase();
  }

  // Unit number — regex + multi-line
  const unitNoM = uc.match(/(?:Flat|Apt\.?|Apartment)\s*No\.?[\s:.]*(\d+[\w\-\/]*)/i)
               || c.match(/(?:Flat|Apt\.?)\s*No\.?[\s:.]*(\d+[\w\-\/]*)/i);
  fields.unitNumber = unitNoM ? `Flat No. ${unitNoM[1]}` : '';
  if (!fields.unitNumber) {
    const mlUnitNo = multiLineScan(unitsSection, /^\s*(?:Unit|Flat|Apt)\s*No\.?\s*$/i);
    const noMatch = mlUnitNo.match(/(\d+[\w\-\/]*)/);
    if (noMatch) fields.unitNumber = `Flat No. ${noMatch[1]}`;
  }

  // ─── POST-PROCESSING: Final cleanup and validation ─────────────────────
  // Strip whitespace from numeric-only fields
  if (fields.tenantEmiratesId) fields.tenantEmiratesId = fields.tenantEmiratesId.replace(/\s/g, '');
  if (fields.tenantMobile)     fields.tenantMobile     = fields.tenantMobile.replace(/\s/g, '');
  if (fields.lessorMobile)     fields.lessorMobile     = fields.lessorMobile.replace(/\s/g, '');
  if (fields.premise)          fields.premise          = fields.premise.replace(/\s/g, '');

  // Validate Emirates ID format (must be 15 digits starting with 784)
  if (fields.tenantEmiratesId && !/^784\d{12}$/.test(fields.tenantEmiratesId)) {
    fields.tenantEmiratesId = '';
  }

  // Validate phone format (must start with 971)
  if (fields.tenantMobile && !/^971\d{8,9}$/.test(fields.tenantMobile)) {
    fields.tenantMobile = '';
  }
  if (fields.lessorMobile && !/^971\d{8,9}$/.test(fields.lessorMobile)) {
    fields.lessorMobile = '';
  }

  return fields;
}


@Controller('api/ocr-pdf')
export class OcrController {
  
  @UseGuards(AuthGuard)
  @Post()
  @UseInterceptors(FileInterceptor('pdf'))
  async ocrPdf(
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: { text?: string }
  ) {
    // 1. Direct text from client-side extractor
    if (body?.text && body.text.trim().length > 0) {
      const fields = extractContractFields(body.text);
      return { success: true, fields };
    }

    if (!file?.buffer) {
      throw new BadRequestException('No PDF file or text provided');
    }

    const dataBuffer = file.buffer;
    let text = '';

    try {
      const parsedData = await pdfParse(dataBuffer);
      text = parsedData.text || '';
    } catch (e) {
      console.warn('pdf-parse failed:', e);
    }

    let fields = extractContractFields(text);

    const onVercel = Boolean(process.env.VERCEL);
    if (!onVercel && (!fields.number || !fields.tenantName || !fields.annualRent || !fields.startDate || text.trim().length < 50)) {
      console.log('PDF text incomplete — running 300 DPI high-res Tesseract OCR fallback…');
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const tempId = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
      const tempPdfPath = path.join(dataDir, `temp_${tempId}.pdf`);
      const tempImgPrefix = path.join(dataDir, `temp_page_${tempId}`);
      fs.writeFileSync(tempPdfPath, dataBuffer);

      try {
        child_process.execSync(`pdftoppm -png -r 300 -f 1 -l 3 "${tempPdfPath}" "${tempImgPrefix}"`);
        const imgFiles = fs.readdirSync(dataDir).filter(f => f.startsWith(`temp_page_${tempId}`)).sort();
        let ocrText = '';
        for (const imgName of imgFiles) {
          const imgPath = path.join(dataDir, imgName);
          if (fs.existsSync(imgPath)) {
            const ocrResult = await Tesseract.recognize(imgPath, 'eng');
            ocrText += '\n' + (ocrResult.data.text || '');
            fs.unlinkSync(imgPath);
          }
        }
        if (ocrText.trim().length > 0) {
          const ocrFields = extractContractFields(ocrText);
          for (const key of Object.keys(ocrFields)) {
            if (ocrFields[key] !== '' && ocrFields[key] !== null && ocrFields[key] !== undefined) {
              fields[key] = ocrFields[key];
            }
          }
        }
      } catch (ocrErr) {
        console.error('Tesseract OCR execution error:', ocrErr);
      } finally {
        if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
      }
    }

    if (!fields.number && text.trim().length === 0) {
      throw new BadRequestException(
        onVercel
          ? 'Could not extract text from this PDF on Vercel. Use a text-based PDF (not a scanned image).'
          : 'Could not extract text. Check if file is scanned/image-only or corrupt.'
      );
    }

    return { success: true, fields };
  }
}

