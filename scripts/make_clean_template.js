import fs from 'fs';
import { PDFDocument, rgb } from 'pdf-lib';

async function makeCleanTemplate() {
  const templatePath = 'public/assets/templates/contract_template.pdf';
  const outputPath = 'public/assets/templates/clean_contract_template.pdf';

  console.log('Loading template PDF...');
  const existingPdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const secondPage = pages[1];

  // Helper to draw solid white rectangle covering the old text values completely
  const eraseCell = (page, x, y, width, height, offsetY = 3.5) => {
    page.drawRectangle({
      x: x,
      y: y - offsetY,
      width: width,
      height: height,
      color: rgb(1, 1, 1),
    });
  };

  console.log('Clearing Page 1 (Contract Details)...');
  // CONTRACT DETAILS (Rows 1 to 15: Spans x = 150 to 485, width = 335)
  for (let i = 0; i < 15; i++) {
    const y = 662.9 - (i * 17.25);
    eraseCell(firstPage, 150, y, 335, 13, 3.5);
  }

  // Lessor Email, Mobile, License, Company Name
  eraseCell(firstPage, 32, 290.4, 117, 14, 4);
  eraseCell(firstPage, 149, 290.4, 97, 14, 4);
  eraseCell(firstPage, 246, 290.4, 96, 14, 4);
  eraseCell(firstPage, 342, 290.4, 250, 34, 18); // Double-height company name cell

  // Contact Person details
  eraseCell(firstPage, 120, 226.0, 365, 28, 14); // Double-height name cell
  eraseCell(firstPage, 180, 200.3, 305, 13, 3.5);
  eraseCell(firstPage, 180, 183.1, 305, 13, 3.5);

  console.log('Clearing Page 2 (Tenant & Property Details)...');
  // Tenant Details Row (Y = 642.3, Height = 30 points)
  eraseCell(secondPage, 32, 642.3, 117, 30, 15);
  eraseCell(secondPage, 149, 642.3, 97, 30, 15);
  eraseCell(secondPage, 246, 642.3, 96, 30, 15);
  eraseCell(secondPage, 342, 642.3, 119, 30, 15);
  eraseCell(secondPage, 461, 642.3, 131, 30, 15);

  // Property Details (Rows 1 to 6: Spans x = 150 to 485, width = 335)
  eraseCell(secondPage, 150, 571.7, 335, 13, 3.5); // Municipality
  eraseCell(secondPage, 150, 554.4, 335, 13, 3.5); // Zone
  eraseCell(secondPage, 150, 537.2, 335, 13, 3.5); // Sector
  eraseCell(secondPage, 150, 519.9, 335, 13, 3.5); // Road Name
  eraseCell(secondPage, 150, 502.7, 335, 13, 3.5); // Plot No
  eraseCell(secondPage, 150, 485.5, 335, 13, 3.5); // Plot Address

  // Onwani Address (Row 7 & 8: Single double-height cell)
  eraseCell(secondPage, 150, 459.8, 335, 32, 16);

  // Property details (Rows 9 to 12)
  eraseCell(secondPage, 150, 434.2, 335, 13, 3.5); // Property No
  eraseCell(secondPage, 150, 417.0, 335, 13, 3.5); // Property Reg No
  eraseCell(secondPage, 150, 399.8, 335, 13, 3.5); // Property Name
  eraseCell(secondPage, 150, 382.4, 335, 13, 3.5); // Property Type

  // Units Details table columns (Y = 259.7, Height = 24 points)
  eraseCell(secondPage, 32, 259.7, 88, 24, 15);
  eraseCell(secondPage, 120, 259.7, 100, 24, 15);
  eraseCell(secondPage, 220, 259.7, 62, 24, 15);
  eraseCell(secondPage, 282, 259.7, 63, 24, 15);
  eraseCell(secondPage, 345, 259.7, 80, 24, 15);
  eraseCell(secondPage, 425, 259.7, 80, 24, 15);
  eraseCell(secondPage, 505, 259.7, 87, 24, 15);

  console.log('Saving blanked template PDF...');
  const cleanPdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, cleanPdfBytes);
  console.log('Clean template PDF created successfully at:', outputPath);
}

makeCleanTemplate().catch(console.error);
