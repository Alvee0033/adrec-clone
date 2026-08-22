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

export function extractContractFields(text: string) {
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
    if (idx === -1) return c;
    const start = sectionDefs[idx].pos;
    const end = (idx + 1 < sectionDefs.length) ? sectionDefs[idx + 1].pos : start + 3000;
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
  const numM = c.match(/(?:Contract\s*No\.?|Contract\s*Number)\s*[:\.]?\s*(\d{10,15})/i) || c.match(/\b(20\d{10})\b/);
  fields.number = numM ? numM[1] : '';

  const issueDateM = c.match(/Issue\s*Date\s*[:\.]?\s*(\d{4}-\d{2}-\d{2})/i) || c.match(/Contract\s*Date\s*[:\.]?\s*(\d{4}-\d{2}-\d{2})/i);
  fields.issueDate = issueDateM ? issueDateM[1] : '';

  const startDateM = c.match(/Start\s*Date\s*[:\.]?\s*(\d{4}-\d{2}-\d{2})/i);
  fields.startDate = startDateM ? startDateM[1] : '';

  const endDateM = c.match(/End\s*Date\s*[:\.]?\s*(\d{4}-\d{2}-\d{2})/i);
  fields.endDate = endDateM ? endDateM[1] : '';

  // Positional fallback — issue, start, end appear in sequence
  if (!fields.issueDate || !fields.startDate || !fields.endDate) {
    const allDates = [...new Set(c.match(/\b(\d{4}-\d{2}-\d{2})\b/g) || [])];
    if (!fields.issueDate && allDates[0]) fields.issueDate = allDates[0];
    if (!fields.startDate && allDates[1]) fields.startDate = allDates[1];
    if (!fields.endDate   && allDates[2]) fields.endDate   = allDates[2];
  }

  const rentM = c.match(/Annual\s*Rent\s*[:\.]?\s*([\d,]+(?:\.\d+)?)/i);
  fields.annualRent = rentM ? parseFloat(rentM[1].replace(/,/g, '')) : null;

  const valueM = c.match(/Contract\s*Value\s*[:\.]?\s*([\d,]+(?:\.\d+)?)/i);
  fields.value = valueM ? parseFloat(valueM[1].replace(/,/g, '')) : fields.annualRent;

  if (!fields.annualRent) {
    const amts = c.match(/\b([\d,]{4,}\.\d{2})\b/g);
    if (amts?.length) {
      fields.annualRent = parseFloat(amts[0].replace(/,/g, ''));
      fields.value = amts[1] ? parseFloat(amts[1].replace(/,/g, '')) : fields.annualRent;
    }
  }

  const depositM = c.match(/Security\s*Deposit\s*[:\.]?\s*([\d,]+(?:\.\d+)?)/i);
  fields.securityDeposit = depositM ? parseFloat(depositM[1].replace(/,/g, '')) : null;

  const typeM = c.match(/Contract\s*Type\s*[:\.]?\s*(Residential|Commercial)/i);
  fields.type = typeM ? typeM[1] : 'Residential';

  const termM = c.match(/Contract\s*Term\s*[:\.]?\s*([\d]+\s*\w+)/i);
  fields.term = termM ? termM[1].trim() : '';

  const payMethodM = c.match(/Payment\s*Method\s*[:\.]?\s*([A-Za-z]+)/i);
  fields.paymentMethod = (payMethodM && !['number','of'].includes(payMethodM[1].toLowerCase())) ? payMethodM[1] : 'Cheque';

  const paymentsM = c.match(/Number\s*of\s*Payments\s*[:\.]?\s*(\d+)/i);
  fields.payments = paymentsM ? parseInt(paymentsM[1], 10) : 1;

  const occupantsM = c.match(/Number\s*of\s*Occupants\s*[:\.]?\s*(\d+)/i);
  fields.occupants = occupantsM ? parseInt(occupantsM[1], 10) : 1;

  const waterM = c.match(/Water\s*[&＆]\s*Electricity\s*Bill\s*[:\.]?\s*([A-Z]+)/i);
  fields.waterElectricity = (waterM && waterM[1] !== 'Pets') ? waterM[1] : 'TENANT';

  const petsM = c.match(/Pets\s*Allowed\s*[:\.]?\s*(Yes|No)/i);
  fields.petsAllowed = petsM ? petsM[1] : 'No';

  // ─── LESSOR (FIRST PARTY) ──────────────────────────────────────────────
  const licenseM = lc.match(/\b((?:CN|IN|TL|BL|LIC)-?\d{5,10})\b/i) || c.match(/\b((?:CN|IN|TL|BL|LIC)-?\d{5,10})\b/i);
  fields.lessorLicense = licenseM ? licenseM[1].toUpperCase().replace(/\s/g, '') : '';

  // Company: LLC/PJSC/WLL/EST/GROUP suffix or labeled "Company Name"
  const corpPat   = /((?:\b[A-Z0-9&'.]+\b\s*){1,10}\b(?:LLC|L\.L\.C|PJSC|WLL|FZE|FZC|FZ-LLC|ESTABLISHMENT|EST|CORP|LTD|LIMITED|INC|GROUP)(?:\s*-\s*[A-Z0-9\s]+)?)/i;
  const compLabelM = lc.match(/(?:Company\s*Name|Lessor\s*Company)\s*[:\.]?\s*-?\s*([A-Z0-9\s.&'()\/\-]{3,80}?)(?=\s*Contact|\s*Full\s*Name|\s*Mobile|\s*Email|\s*License|\s*\.1|$)/i);
  const adjLicComp = lc.match(/(?:CN|IN)-\d+\s+([A-Z][A-Z\s.&'-]{4,80}(?:LLC|PJSC|WLL|EST|GROUP|LTD))/i);
  const corpM      = lc.match(corpPat);

  let compName = '';
  if (compLabelM?.[1]?.trim() && !/^[-\s]+$/.test(compLabelM[1])) compName = compLabelM[1];
  else if (adjLicComp?.[1]) compName = adjLicComp[1];
  else if (corpM?.[1])      compName = corpM[1];

  compName = compName
    .replace(/L\s*\.\s*L\s*\.\s*C\.?/gi, 'LLC').replace(/L\s*L\s*C/gi, 'LLC')
    .replace(/^(?:Company\s*Name|Email|Mobile\s*No|License\s*No|CN-\d+|IN-\d+)[:\s-]*/i, '')
    .replace(/^(?:CN|IN|TL|BL|LIC)-?\d{5,10}\s+/i, '')
    .replace(/\s+(?:Contact\s*Person|Full\s*Name|Mobile\s*No|Email|License\s*No).*$/i, '')
    .replace(/^[^A-Za-z0-9]+/, '').replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  // Strip any leading license number or punctuation (e.g. "- INTERNATIONAL...") from company name
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

  const lMobM   = lc.match(/\b(971\d{8,9})\b/);
  fields.lessorMobile = lMobM?.[1] || '';

  const lEmailM = lc.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
  fields.lessorEmail = lEmailM ? lEmailM[1].replace(/^(?:Email|Mail)[:\s]*/i, '').trim() : '';

  // ─── TENANT (SECOND PARTY) ─────────────────────────────────────────────
  const eidM = tc.match(/\b(784\d{12})\b/) || c.match(/\b(784\d{12})\b/);
  fields.tenantEmiratesId = eidM?.[1] || '';

  // Nationality — comprehensive list
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

  // Tenant mobile — UAE mobile NOT already assigned as lessor mobile
  const allMobiles = [...(c.match(/\b(971\d{8,9})\b/g) || [])];
  fields.tenantMobile = allMobiles.find(m => m !== fields.lessorMobile) || allMobiles[1] || allMobiles[0] || '';

  // Tenant email — email NOT already assigned as lessor email
  const allEmails = [...(c.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g) || [])];
  const tEmailRaw = allEmails.find(e => e !== fields.lessorEmail) || allEmails[1] || allEmails[0] || '';
  fields.tenantEmail = tEmailRaw ? tEmailRaw.replace(/^(?:Email|Mail)[:\s]*/i, '').trim() : '';

  // Tenant name — universal multi-strategy (works for ALL CAPS, Title Case, and Mixed Case)
  const cleanTc = tc.replace(/[\u0600-\u06FF]+/g, ' ');

  function cleanTName(raw: string): string {
    let n = raw.replace(/^(?:Full\s*Name|Tenant\s*Name|Name|Contact\s*Person|Company\s*Name|Nationality|Emirates(?:\s*ID)?|Mobile|Email)[:\s-]*/gi, '');
    n = n.replace(/\s+(?:Full\s*Name|Tenant\s*Name|Mobile|Email|Nationality|Emirates(?:\s*ID)?|Phone|Tel|SECOND|FIRST|PROPERTY).*$/gi, '');
    for (const nat of nationalities) {
      const r = new RegExp(`^${nat}[:\\s-]*`, 'gi');
      n = n.replace(r, '');
    }
    return n.replace(/\s+/g, ' ').trim();
  }

  function isGoodTName(n: string): boolean {
    if (!n || n.length < 4 || !n.includes(' ')) return false;
    const lower = n.toLowerCase();
    const badWords = ['second party', 'first party', 'property details', 'unit details', 'rental registry', 'issue date', 'start date', 'end date', 'annual rent', 'commercial', 'residential', 'abu dhabi', 'united arab', 'emirates id', 'full name', 'contact person', 'rental'];
    return !badWords.some(b => lower.includes(b));
  }

  // Strategy 1: Explicit Label "Full Name" or "Tenant Name"
  const fnMatch = cleanTc.match(/(?:Full\s*Name|Tenant\s*Name|Name\s*of\s*Tenant)\s*[:\.]?\s*([A-Za-z\s.'-]{4,60}?)(?=\s*(?:Mobile|Email|Nationality|Emirates|Phone|Tel|SECOND|FIRST|PROPERTY|3\.|2\.|\*|$))/i);
  let extractedTName = '';
  if (fnMatch) {
    const cand = cleanTName(fnMatch[1]);
    if (isGoodTName(cand)) extractedTName = cand;
  }

  // Strategy 2: After Nationality
  if (!extractedTName) {
    const afterNatRx = new RegExp(`(?:\\b${nationalities.join('\\b|\\b')}\\b)\\s+([A-Za-z\\s.'-]{4,60}?)(?=\\s*(?:971\\d|\\+971|Mobile|Email|Phone|Emirates|\\*|$))`, 'i');
    const afterNat = cleanTc.match(afterNatRx);
    if (afterNat) {
      const cand = cleanTName(afterNat[1]);
      if (isGoodTName(cand)) extractedTName = cand;
    }
  }

  // Strategy 3: After Emirates ID
  if (!extractedTName) {
    const afterEid = cleanTc.match(/784\d{12}[\s\S]{0,100}?([A-Z][A-Za-z\s.'-]{3,60}?)(?=\s*(?:971\d|\+971|Mobile|Email|Phone|Emirates|\*|$))/i);
    if (afterEid) {
      const cand = cleanTName(afterEid[1]);
      if (isGoodTName(cand)) extractedTName = cand;
    }
  }

  // Strategy 4: Candidate capitalization sequences
  if (!extractedTName) {
    const candidateNames = [...cleanTc.matchAll(/\b([A-Z][A-Za-z]{1,20}(?:\s+[A-Z][A-Za-z]{1,20}){1,5})\b/g)];
    for (const m of candidateNames) {
      const cand = cleanTName(m[1]);
      if (isGoodTName(cand)) {
        extractedTName = cand;
        break;
      }
    }
  }

  fields.tenantName = extractedTName;

  // ─── PROPERTY DETAILS ──────────────────────────────────────────────────
  const muniM = pc.match(/Municipality\s*[:\.]?\s*([A-Za-z\s]+?)(?=\s*Zone|\s*Sector|\s*Plot|\s*Road|$)/i);
  fields.municipality = muniM?.[1]?.trim() || '';

  const zoneM = pc.match(/Zone\s*[:\.]?\s*([A-Za-z\s]+?)(?=\s*Sector|\s*Plot|\s*Road|\s*Municipality|$)/i);
  fields.zone = zoneM?.[1]?.trim() || '';

  const sectorM = pc.match(/Sector\s*[:\.]?\s*([A-Z0-9]+)/i);
  fields.sector = sectorM?.[1]?.trim() || '';

  const plotM = pc.match(/Plot\s*No\.?\s*[:\.]?\s*([A-Z0-9\-]+)/i);
  fields.plot = plotM?.[1]?.trim() || '';

  const plotAddrM = pc.match(/Plot\s*Address\s*[:\.]?\s*([A-Z0-9\-\/\.]+)/i);
  fields.plotAddress = plotAddrM?.[1]?.trim() || '';

  const propNameM = pc.match(/Property\s*Name\s*[:\.]?\s*([A-Za-z0-9][A-Za-z0-9\s\-\.]{2,59}?)(?=\s{2,}|\s*Property\s*Type|\s*Municipality|\s*Zone|\s*Building|\s*Plot|$)/i);
  const rawPropName = propNameM?.[1]?.trim() || '';
  // Deduplicate if same value repeated (multi-column PDF artifact)
  const halfLen = Math.floor(rawPropName.length / 2);
  const propHalf = rawPropName.slice(0, halfLen).trim();
  fields.propertyName = (propHalf && rawPropName.slice(halfLen).trim().toLowerCase() === propHalf.toLowerCase())
    ? propHalf : rawPropName;

  const propTypeM = c.match(/Property\s*Type\s*[:\.]?\s*([A-Z]+)/i);
  fields.propertyType = propTypeM?.[1] || 'BUILDING';

  // ─── UNITS DETAILS ─────────────────────────────────────────────────────
  const premiseM = uc.match(/(?:Premise|Property)\s*(?:No\.?|Number)?\s*[:\.]?\s*(\d{8,12})/i) || c.match(/\b(\d{10})\b/);
  fields.premise = premiseM?.[1] || '';

  // Unit Usage: only from explicit label, not from generic 'c' fallback
  const unitUsageM = uc.match(/Unit\s*Usage\s*[:\.]?\s*(RESIDENTIAL|COMMERCIAL|INDUSTRIAL|OFFICE)/i);
  fields.unitUsage = unitUsageM?.[1]?.toUpperCase() || 'RESIDENTIAL';

  const hasUnits = sectionDefs.some(s => s.name === 'units');
  const roomsM = uc.match(/No\.?\s*of\s*[Rr]ooms?\s*[:\.]?\s*(\d+)/i) || (hasUnits ? null : c.match(/\bNo\.\s*of\s*[Rr]ooms?\s*[:\.]?\s*(\d+)\b/i));
  fields.rooms = roomsM ? parseInt(roomsM[1], 10) : null;

  // Unit type: only match known keywords, not generic labels
  const unitTypeM = uc.match(/Unit\s*Type\s*[:\.]?\s*(APARTMENT|VILLA|STUDIO|OFFICE|SHOP|WAREHOUSE|FLOOR|RESIDENTIAL|COMMERCIAL)/i)
                 || c.match(/\b(APARTMENT|VILLA|STUDIO|OFFICE|SHOP|WAREHOUSE|FLOOR)\b/i);
  fields.unitType = unitTypeM?.[1]?.toUpperCase() || 'APARTMENT';

  // Registration: only explicit UNT-pattern or reg label, not 10-digit premise number
  const regM = uc.match(/(?:Unit\s*)?Reg(?:istration)?\s*No\.?\s*[:\.]?\s*([A-Z]{2,}\d+)/i) || c.match(/\b(UNT\d+)\b/i);
  fields.unitRegNo = regM?.[1]?.toUpperCase() || '';

  // Unit number: only match Flat/Apt + actual number, not generic "Unit" word
  const unitNoM = uc.match(/(?:Flat|Apt\.?|Apartment)\s*No\.?\s*[:\.]?\s*([\d]+[\w\-\/]*)/i)
               || c.match(/(?:Flat|Apt\.?)\s*No\.?\s*[:\.]?\s*([\d]+[\w\-\/]*)/i);
  fields.unitNumber = unitNoM ? `Flat No. ${unitNoM[1]}` : '';

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
      console.log('PDF text incomplete — running high-res Tesseract OCR fallback…');
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const tempId = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
      const tempPdfPath = path.join(dataDir, `temp_${tempId}.pdf`);
      const tempImgPrefix = path.join(dataDir, `temp_page_${tempId}`);
      fs.writeFileSync(tempPdfPath, dataBuffer);

      try {
        child_process.execSync(`pdftoppm -png -r 200 -f 1 -l 2 "${tempPdfPath}" "${tempImgPrefix}"`);
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
