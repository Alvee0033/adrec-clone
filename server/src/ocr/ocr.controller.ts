import { Controller, Post, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import * as _pdfParse from 'pdf-parse-fork';
// pdf-parse-fork is a CommonJS module; get the actual function
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
  // Normalize all whitespace for simpler regex
  const c = text.replace(/\s+/g, ' ').trim();

  // ─── CONTRACT DETAILS ────────────────────────────────────────────────
  // PDF layout: "Contract No.202401452538" (no space after label due to PDF column concatenation)
  const numM = c.match(/Contract No\.?\s*(\d{12})/i);
  fields.number = numM ? numM[1] : '';

  const issueDateM = c.match(/Issue Date\s*(\d{4}-\d{2}-\d{2})/i);
  fields.issueDate = issueDateM ? issueDateM[1] : '';

  const startDateM = c.match(/Start Date\s*(\d{4}-\d{2}-\d{2})/i);
  fields.startDate = startDateM ? startDateM[1] : '';

  const endDateM = c.match(/End Date\s*(\d{4}-\d{2}-\d{2})/i);
  fields.endDate = endDateM ? endDateM[1] : '';

  // Annual Rent: "Annual Rent63,000.00" 
  const rentM = c.match(/Annual Rent\s*([\d,]+(?:\.\d+)?)/i);
  fields.annualRent = rentM ? parseFloat(rentM[1].replace(/,/g, '')) : null;

  // Contract Value: "Contract Value63,000.00"
  const valueM = c.match(/Contract Value\s*([\d,]+(?:\.\d+)?)/i);
  fields.value = valueM ? parseFloat(valueM[1].replace(/,/g, '')) : null;

  // Contract Type: "Contract TypeResidential"
  const typeM = c.match(/Contract Type\s*(Residential|Commercial|residential|commercial)/i);
  fields.type = typeM ? typeM[1] : 'Residential';

  // Contract Term: "Contract Term1 Year"
  const termM = c.match(/Contract Term\s*([\d]+\s*\w+)/i);
  fields.term = termM ? termM[1].trim() : '';

  // Payment Method: "Payment MethodCheque"
  const payMethodM = c.match(/Payment Method\s*([A-Za-z]+)/i);
  fields.paymentMethod = payMethodM ? payMethodM[1].trim() : '';

  // Number of Payments: "Number of Payments1"
  const paymentsM = c.match(/Number of Payments\s*(\d+)/i);
  fields.payments = paymentsM ? parseInt(paymentsM[1], 10) : 1;

  // Number of Occupants: "Number of Occupants1"
  const occupantsM = c.match(/Number of Occupants\s*(\d+)/i);
  fields.occupants = occupantsM ? parseInt(occupantsM[1], 10) : 1;

  // Security Deposit: "Security Deposit___" or actual value
  const depositM = c.match(/Security Deposit\s*([\d,]+(?:\.\d+)?)/i);
  fields.securityDeposit = depositM ? parseFloat(depositM[1].replace(/,/g, '')) : null;

  // Grace Period
  const gracePeriodM = c.match(/Grace Period\s*([\d]+\s*\w+)/i);
  fields.gracePeriod = gracePeriodM ? gracePeriodM[1].trim() : '';

  // Water & Electricity
  const waterM = c.match(/Water\s*[&＆]\s*Electricity Bill\s*([A-Z]+)/i);
  fields.waterElectricity = waterM ? waterM[1] : '';

  // Pets Allowed
  const petsM = c.match(/Pets Allowed\s*(Yes|No)/i);
  fields.petsAllowed = petsM ? petsM[1] : '';

  // ─── TENANT DETAILS (SECOND PARTY) ──────────────────────────────────
  // PDF concatenated layout: "Full Name [email] [mobile] [nationality] [emiratesId] [Name] PROPERTY DETAILS"
  const tenantStart = c.indexOf('SECOND PARTY (TENANT)');
  const propStart = c.indexOf('PROPERTY DETAILS');
  if (tenantStart !== -1) {
    const tenantEnd = propStart !== -1 ? propStart : tenantStart + 800;
    const tenantSub = c.substring(tenantStart, tenantEnd);

    // Extract email
    const emailM = tenantSub.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
    fields.tenantEmail = emailM ? emailM[1] : '';

    // Extract Emirates ID (15 digits starting with 784)
    const eidM = tenantSub.match(/\b(784\d{12}|\d{15})\b/);
    fields.tenantEmiratesId = eidM ? eidM[1] : '';

    // Extract nationality (word before the Emirates ID)
    if (eidM) {
      const beforeEid = tenantSub.substring(0, tenantSub.indexOf(eidM[1]));
      const natM = beforeEid.match(/([A-Za-z]+)\s*$/);
      fields.tenantNationality = natM ? natM[1] : '';
    }

    // Extract mobile number (9–15 digits, likely starts with 971)
    const mobileM = tenantSub.match(/\b(971\d{9}|\d{10,12})\b/);
    fields.tenantMobile = mobileM ? mobileM[1] : '';

    // Extract name: everything after the Emirates ID until end of tenant section
    if (eidM) {
      const afterEid = tenantSub.substring(tenantSub.indexOf(eidM[1]) + eidM[1].length).trim();
      const nameM = afterEid.match(/^([A-Za-z][A-Za-z\s]+?)(?:\s*(?:PROPERTY|$))/);
      fields.tenantName = nameM ? nameM[1].trim() : afterEid.substring(0, 60).trim();
    } else {
      fields.tenantName = '';
    }
  }

  // ─── LESSOR DETAILS (FIRST PARTY) ───────────────────────────────────
  // PDF layout: "Company Name --CN-1048007 - COMPANY NAME Contact Person Full Name NAME Mobile No.MOBILE Emailemail"
  const lessorStart = c.indexOf('FIRST PARTY (LESSOR)');
  const secondPartyStart = c.indexOf('SECOND PARTY (TENANT)');
  if (lessorStart !== -1) {
    const lessorEnd = secondPartyStart !== -1 ? secondPartyStart : lessorStart + 800;
    const lessorSub = c.substring(lessorStart, lessorEnd);

    // License: "--CN-1048007"
    const licenseM = lessorSub.match(/--([A-Z]{0,2}-[\w\-]+)/i) || lessorSub.match(/License No\.?\s*([A-Z0-9\-]+)/i);
    fields.lessorLicense = licenseM ? licenseM[1].replace(/^-+/, '') : '';

    // Company Name: "- COMPANY NAME Contact"
    const companyM = lessorSub.match(/(?:--[A-Z0-9\-]+\s+-\s+)([\w\s\-]+?)(?=\s+Contact Person)/i);
    fields.lessorCompany = companyM ? companyM[1].trim() : '';

    // Lessor Full Name (Contact Person)
    const lessorNameM = lessorSub.match(/Contact Person\s+Full Name\s+([\w\s]+?)(?=\s+Mobile No\.)/i);
    fields.lessorName = lessorNameM ? lessorNameM[1].trim() : '';

    // Lessor Mobile
    const lessorMobileM = lessorSub.match(/Mobile No\.\s*(\d{9,15})/i);
    fields.lessorMobile = lessorMobileM ? lessorMobileM[1] : '';

    // Lessor Email: "Emailemail@example.com" (no space after Email label)
    const lessorEmailM = lessorSub.match(/Email\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
    fields.lessorEmail = lessorEmailM ? lessorEmailM[1] : '';
  }

  // ─── PROPERTY DETAILS ────────────────────────────────────────────────
  if (propStart !== -1) {
    const propSub = c.substring(propStart, propStart + 600);

    // Municipality: "MunicipalityAbu Dhabi City"
    const municipalityM = propSub.match(/Municipality\s*([A-Za-z\s]+?)(?=\s*Zone)/i);
    fields.municipality = municipalityM ? municipalityM[1].trim() : '';

    // Zone: "ZoneMohamed Bin Zayed City"
    const zoneM = propSub.match(/Zone\s*([A-Za-z0-9\s]+?)(?=\s*Sector)/i);
    fields.zone = zoneM ? zoneM[1].trim() : '';

    // Sector: "SectorME99"
    const sectorM = propSub.match(/Sector\s*([A-Z0-9]+)/i);
    fields.sector = sectorM ? sectorM[1].trim() : '';

    // Plot No: "Plot No.C173"
    const plotM = propSub.match(/Plot No\.?\s*([A-Z0-9]+)/i);
    fields.plot = plotM ? plotM[1] : '';

    // Property Name: "Property NameSanad propertiesSanad properties" (duplicated in PDF)
    const propNameM = propSub.match(/Property Name\s*(.+?)(?=\s*Property Type)/i);
    if (propNameM) {
      // Remove duplicate: "Sanad propertiesSanad properties" → "Sanad properties"
      let rawName = propNameM[1].trim();
      const half = Math.floor(rawName.length / 2);
      if (rawName.substring(0, half) === rawName.substring(half)) {
        rawName = rawName.substring(0, half);
      }
      fields.propertyName = rawName;
    } else {
      fields.propertyName = '';
    }

    // Property Type: "Property TypeBUILDING"
    const propTypeM = propSub.match(/Property Type\s*(BUILDING|VILLA|APARTMENT|[A-Z]+)/i);
    fields.propertyType = propTypeM ? propTypeM[1].toUpperCase() : '';
  }

  // ─── UNITS DETAILS ───────────────────────────────────────────────────
  const unitsStart = c.indexOf('UNITS DETAILS');
  const occupantsStart = c.indexOf('OCCUPANTS DETAILS');
  if (unitsStart !== -1) {
    const unitsEnd = occupantsStart !== -1 ? occupantsStart : unitsStart + 400;
    const unitsSub = c.substring(unitsStart, unitsEnd);

    // Premise No: 10-digit number
    const premiseM = unitsSub.match(/\b(\d{10})\b/);
    fields.premise = premiseM ? premiseM[1] : '';

    // Unit Usage: RESIDENTIAL / COMMERCIAL etc.
    const usageM = unitsSub.match(/\b(RESIDENTIAL|COMMERCIAL)\b/i);
    fields.unitUsage = usageM ? usageM[1].toUpperCase() : '';

    // No. of rooms
    const roomsM = unitsSub.match(/No\.\s*of\s*rooms\s*(\d+)/i);
    fields.rooms = roomsM ? parseInt(roomsM[1], 10) : null;

    // Unit Type: APARTMENT / VILLA etc.
    const utM = unitsSub.match(/\b(APARTMENT|VILLA|STUDIO|DUPLEX|PENTHOUSE)\b/i);
    fields.unitType = utM ? utM[1].toUpperCase() : '';

    // Unit Reg No: "UNT308001"
    const unitRegM = unitsSub.match(/(UNT\d+)/i);
    fields.unitRegNo = unitRegM ? unitRegM[1] : '';

    // Unit Number: "Flat No. 502"
    const flatM = unitsSub.match(/(Flat\s*No\.?\s*\d+)/i);
    fields.unitNumber = flatM ? flatM[1].trim() : '';
  }

  // ─── OCCUPANTS DETAILS ───────────────────────────────────────────────
  if (occupantsStart !== -1) {
    const occupantsSub = c.substring(occupantsStart, occupantsStart + 200);
    // "Full Name Emirates ID No. / Allah Wasaya Peer Bakhsh784199582683266"
    const occupantM = occupantsSub.match(/Full Name Emirates ID No\..*?\/\s*([\w\s]+?)(784\d{12}|\d{15})/i);
    if (occupantM) {
      fields.occupantName = occupantM[1].trim();
      fields.occupantEmiratesId = occupantM[2];
    }
  }

  return fields;
}

@Controller('api/ocr-pdf')
export class OcrController {
  
  @UseGuards(AuthGuard)
  @Post()
  @UseInterceptors(FileInterceptor('pdf'))
  async ocrPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('No PDF file uploaded');
    }

    const dataBuffer = file.buffer;
    let text = '';

    try {
      const parsedData = await pdfParse(dataBuffer);
      text = parsedData.text || '';
    } catch (e) {
      console.warn('pdf-parse failed:', e);
    }

    const onVercel = Boolean(process.env.VERCEL);
    if (!onVercel && text.trim().length < 50) {
      console.log('PDF text short — running local image OCR…');
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const tempId = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
      const tempPdfPath = path.join(dataDir, `temp_${tempId}.pdf`);
      const tempImgPrefix = path.join(dataDir, `temp_page_${tempId}`);
      fs.writeFileSync(tempPdfPath, dataBuffer);

      try {
        child_process.execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${tempPdfPath}" "${tempImgPrefix}"`);
        const imgPath = `${tempImgPrefix}-1.png`;
        if (fs.existsSync(imgPath)) {
          const ocrResult = await Tesseract.recognize(imgPath, 'eng+ara');
          text = ocrResult.data.text || '';
          fs.unlinkSync(imgPath);
        }
      } catch (ocrErr) {
        console.error('Tesseract OCR execution error:', ocrErr);
      } finally {
        if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
      }
    }

    if (text.trim().length === 0) {
      throw new BadRequestException(
        onVercel
          ? 'Could not extract text from this PDF on Vercel. Use a text-based PDF (not a scanned image).'
          : 'Could not extract text. Check if file is scanned/image-only or corrupt.'
      );
    }

    return { success: true, fields: extractContractFields(text) };
  }
}
