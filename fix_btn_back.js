const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src/styles/admin.css');
let css = fs.readFileSync(cssPath, 'utf8');

css = css.replace(
  `.btn-back {
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  color: var(--admin-muted);
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  cursor: pointer;
  padding: 8px 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
  margin-bottom: 8px;
}`,
  `.btn-back {
  font-family: inherit;
  font-size: 15px;
  font-weight: 750;
  color: var(--admin-ink);
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  cursor: pointer;
  padding: 10px 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}`
);

fs.writeFileSync(cssPath, css);
console.log("admin.css patched successfully.");
