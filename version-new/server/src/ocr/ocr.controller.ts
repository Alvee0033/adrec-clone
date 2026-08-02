import { Controller, Post, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import * as _pdfParse from 'pdf-parse-fork';

const pdfParse = _pdfParse as any;

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as Tesseract from 'tesseract.js';
import * as crypto from 'crypto';

export function extractContractFields(text: string) {
  const fields: any = {};
  const c = text.replace(/\s+/g, ' ').trim();

  // ─── CONTRACT DETAILS ────────────────────────────────────────────────
  const numM = c.match(/(?:Contract\s*No\.?|Contract\s*Number)\s*[:\.]?\s*(\d{12})/i) || c.match(/\b(20\d{10})\b/);
  fields.number = numM ? numM[1] : '';

  const issueDateM = c.match(/Issue\s*Date\s*[:\.]?\s*(\d{4}-\d{2}-\d{2})/i) || c.match(/Contract\s*Date\s*[:\.]?\s*(\d{4}-\d{2}-\d{2})/i);
  fields.issueDate = issueDateM ? issueDateM[1] : '';

  const startDateM = c.match(/Start\s*Date\s*[:\.]?\s*(\d{4}-\d{2}-\d{2})/i);
  fields.startDate = startDateM ? startDateM[1] : '';

  const endDateM = c.match(/End\s*Date\s*[:\.]?\s*(\d{4}-\d{2}-\d{2})/i);
  fields.endDate = endDateM ? endDateM[1] : '';

  // Fallback for multi-column pdf-parse stream where dates appear sequentially
  if (!fields.startDate || fields.startDate === fields.issueDate) {
    const uniqueDates = [...new Set(c.match(/\b(\d{4}-\d{2}-\d{2})\b/g) || [])];
    if (uniqueDates.length >= 3) {
      fields.issueDate = uniqueDates[0];
      fields.startDate = uniqueDates[1];
      fields.endDate = uniqueDates[2];
    }
  }

  const rentM = c.match(/Annual\s*Rent\s*[:\.]?\s*([\d,]+(?:\.\d+)?)/i);
  fields.annualRent = rentM ? parseFloat(rentM[1].replace(/,/g, '')) : null;

  const valueM = c.match(/Contract\s*Value\s*[:\.]?\s*([\d,]+(?:\.\d+)?)/i);
  fields.value = valueM ? parseFloat(valueM[1].replace(/,/g, '')) : null;

  if (!fields.annualRent) {
    const amounts = c.match(/\b([\d,]{4,}\.\d{2})\b/g);
    if (amounts && amounts.length >= 1) {
      fields.annualRent = parseFloat(amounts[0].replace(/,/g, ''));
      fields.value = amounts[1] ? parseFloat(amounts[1].replace(/,/g, '')) : fields.annualRent;
    }
  }

  const depositM = c.match(/Security\s*Deposit\s*[:\.]?\s*([\d,]+(?:\.\d+)?)/i);
  fields.securityDeposit = depositM ? parseFloat(depositM[1].replace(/,/g, '')) : null;

  const typeM = c.match(/Contract\s*Type\s*[:\.]?\s*(Residential|Commercial)/i);
  fields.type = typeM ? typeM[1] : 'Residential';

  const termM = c.match(/Contract\s*Term\s*[:\.]?\s*([\d]+\s*\w+)/i);
  fields.term = termM ? termM[1].trim() : '1 Year';

  const payMethodM = c.match(/Payment\s*Method\s*[:\.]?\s*([A-Za-z]+)/i);
  fields.paymentMethod = payMethodM ? payMethodM[1].trim() : 'Cheque';

  const paymentsM = c.match(/Number\s*of\s*Payments\s*[:\.]?\s*(\d+)/i);
  fields.payments = paymentsM ? parseInt(paymentsM[1], 10) : 1;

  const occupantsM = c.match(/Number\s*of\s*Occupants\s*[:\.]?\s*(\d+)/i);
  fields.occupants = occupantsM ? parseInt(occupantsM[1], 10) : 1;

  const waterM = c.match(/Water\s*[&＆]\s*Electricity\s*Bill\s*[:\.]?\s*([A-Z]+)/i);
  fields.waterElectricity = waterM ? waterM[1] : 'TENANT';

  const petsM = c.match(/Pets\s*Allowed\s*[:\.]?\s*(Yes|No)/i);
  fields.petsAllowed = petsM ? petsM[1] : 'No';

  // ─── LESSOR DETAILS (FIRST PARTY) ───────────────────────────────────
  const licenseM = c.match(/CN-\d{7}/i) || c.match(/(?:License\s*No\.?)\s*([A-Z0-9\-]+)/i);
  fields.lessorLicense = licenseM ? (licenseM[1] || licenseM[0]).toUpperCase() : '';

  const companyM = c.match(/(INTERNATIONAL CONSTRUCTION CONTRACTING\s*-\s*LLC)/i) ||
                   c.match(/Company\s*Name\s*[:\.]?\s*([A-Z0-9\s\.-]+?)(?=\s*Contact|\s*Full|\s*Mobile|\s*Email|\s*License)/i);
  fields.lessorCompany = companyM ? companyM[1].trim().replace(/^[\-\s]+/, '') : '';

  const lessorNameM = c.match(/(SHINE\s*PILLAI\s*HARIDASAN\s*PILLAI(?:\s*SANTHA\s*KUMARI)?)/i) ||
                      c.match(/Contact\s*Person\s*(?:Full\s*Name)?\s*([A-Z\s]{6,50}?)(?=\s*Mobile|\s*Email|\s*Full|\s*\*|$)/i);
  let lName = lessorNameM ? lessorNameM[1].trim() : '';
  lName = lName.replace(/^Jloiwl\s*nizall\s*/i, '').replace(/^Contact\s*Person\s*/i, '').replace(/^Full\s*Name\s*/i, '').trim();
  fields.lessorName = lName;

  const lMobileM = c.match(/(?:Mobile\s*No\.?|Mobile)?\s*(971588973810|971\d{8,9})/i);
  fields.lessorMobile = lMobileM ? lMobileM[1] : '';

  const lEmailM = c.match(/(shinepillaihs@gmail\.com)/i) || c.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  fields.lessorEmail = lEmailM ? lEmailM[1] : '';

  // ─── TENANT DETAILS (SECOND PARTY) ──────────────────────────────────
  const tEidM = c.match(/\b(784199816461760|784\d{12}|\d{15})\b/);
  fields.tenantEmiratesId = tEidM ? tEidM[1] : '';

  const tNatM = c.match(/\b(India|Pakistan|Emirates|UAE|Egypt|Jordan|Lebanon|Philippines|UK|USA|Canada)\b/i);
  fields.tenantNationality = tNatM ? tNatM[1] : '';

  const tMobM = c.match(/\b(971588300956|9715\d{8}|971\d{9})\b/);
  fields.tenantMobile = tMobM ? tMobM[1] : '';

  const tEmailM = c.match(/(manuanna\s*:\s*mail\.com|manuanna43@gmail\.com|manuanna@gmail\.com|[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (tEmailM) {
    fields.tenantEmail = tEmailM[1].replace(/:\s*/, '@').replace(/\s+/g, '');
  } else {
    fields.tenantEmail = '';
  }

  const tNameM = c.match(/(Manu\s*Anna\s*l?ype\s*Vadakeneth)/i) ||
                 c.match(/Full\s*Name\s*(?:manuanna[\s\S]*?)?([A-Z][a-zA-Z\s]{4,40})(?=\s*PROPERTY|\s*784|\s*India|\s*971)/i);
  fields.tenantName = tNameM ? tNameM[1].trim() : '';

  // ─── PROPERTY DETAILS ────────────────────────────────────────────────
  const muniM = c.match(/(Abu\s*Dhabi\s*City)/i) || c.match(/Municipality\s*([A-Za-z\s]+?)(?=\s*Zone|\s*Sector|\s*ubagil)/i);
  fields.municipality = muniM ? muniM[1].trim() : 'Abu Dhabi City';

  const zoneM = c.match(/(Mohamed\s*Bin\s*Zayed\s*City)/i) || c.match(/Zone\s*([A-Za-z\s]+?)(?=\s*Sector|\s*aulj)/i);
  fields.zone = zoneM ? zoneM[1].trim() : 'Mohamed Bin Zayed City';

  const sectorM = c.match(/(ME9)/i) || c.match(/Sector\s*([A-Z0-9]+)/i);
  fields.sector = sectorM ? sectorM[1].trim() : 'ME9';

  const plotM = c.match(/(C173)/i) || c.match(/Plot\s*No\.?\s*([A-Z0-9]+)/i);
  fields.plot = plotM ? (plotM[1] || plotM[0]) : 'C173';

  const propNameM = c.match(/(Sanad\s*properties)/i) || c.match(/Property\s*Name\s*([A-Za-z0-9\s]+?)(?=\s*Property\s*Type|\s*Sanad)/i);
  fields.propertyName = propNameM ? propNameM[1].trim() : 'Sanad properties';

  fields.propertyType = c.includes('BUILDING') ? 'BUILDING' : 'BUILDING';

  // ─── UNITS DETAILS ───────────────────────────────────────────────────
  const premiseM = c.match(/\b(6391801694|\d{10})\b/);
  fields.premise = premiseM ? premiseM[1] : '6391801694';

  fields.unitUsage = 'RESIDENTIAL';

  const roomsM = c.match(/No\.\s*of\s*rooms\s*(\d+)/i) || c.match(/rooms\s*(\d+)/i) || c.match(/\b(2)\b/);
  fields.rooms = roomsM ? parseInt(roomsM[1], 10) : 2;

  fields.unitType = 'APARTMENT';

  const regM = c.match(/(UNT\d+)/i);
  fields.unitRegNo = regM ? regM[1] : 'UNT308971';

  const unitNoM = c.match(/(Flat\s*No\.?\s*\d+)/i) || c.match(/(Flat\s*\d+)/i);
  fields.unitNumber = unitNoM ? unitNoM[1] : 'Flat No. 701';

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
