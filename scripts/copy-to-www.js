const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');

const files = ['index.html', 'app.js', 'styles.css'];

if (!fs.existsSync(www)) fs.mkdirSync(www, { recursive: true });
for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(www, f));
    console.log('Copied', f, '-> www/');
  }
}
console.log('www folder ready for Capacitor.');
