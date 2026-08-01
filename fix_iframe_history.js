const fs = require('fs');
const path = require('path');

const adminJsPath = path.join(__dirname, 'src/js/admin.js');
let adminJs = fs.readFileSync(adminJsPath, 'utf8');

// 1. Fix hidePdfPreview
adminJs = adminJs.replace(
  `if (pdfPreviewIframe) pdfPreviewIframe.src = '';`,
  `if (pdfPreviewIframe) {
      try {
        pdfPreviewIframe.contentWindow.location.replace('about:blank');
      } catch(e) {
        pdfPreviewIframe.src = '';
      }
    }`
);

// 2. Fix showPdfPreview
adminJs = adminJs.replace(
  `pdfPreviewIframe.src = src;`,
  `try {
      pdfPreviewIframe.contentWindow.location.replace(src);
    } catch (e) {
      const newIframe = document.createElement('iframe');
      newIframe.id = pdfPreviewIframe.id;
      newIframe.title = pdfPreviewIframe.title;
      newIframe.src = src;
      pdfPreviewIframe.parentNode.replaceChild(newIframe, pdfPreviewIframe);
      pdfPreviewIframe = newIframe;
    }`
);

// 3. Fix modalIframe.src
adminJs = adminJs.replace(
  `modalIframe.src = src;`,
  `try {
      modalIframe.contentWindow.location.replace(src);
    } catch (e) {
      const newIframe = document.createElement('iframe');
      newIframe.id = modalIframe.id;
      newIframe.title = modalIframe.title;
      newIframe.src = src;
      modalIframe.parentNode.replaceChild(newIframe, modalIframe);
      modalIframe = newIframe;
    }`
);

// 4. Fix closePdfMaximize
adminJs = adminJs.replace(
  `if (modalIframe) modalIframe.src = '';`,
  `if (modalIframe) {
      try {
        modalIframe.contentWindow.location.replace('about:blank');
      } catch(e) {
        modalIframe.src = '';
      }
    }`
);

// Also let's fix the "originalShowList" bug while we're at it
adminJs = adminJs.replace(
  `} else {
      showListView();
    }`,
  `} else {
      window.showListView();
    }`
);

fs.writeFileSync(adminJsPath, adminJs);
console.log("admin.js patched successfully.");
