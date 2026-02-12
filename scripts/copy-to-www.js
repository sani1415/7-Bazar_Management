const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');

const files = ['index.html', 'app.js', 'styles.css'];
// Copy lib folder (e.g. hijri-converter-browser.js) if present
const libSrc = path.join(root, 'lib');
const libDest = path.join(www, 'lib');
if (fs.existsSync(libSrc)) {
  if (!fs.existsSync(libDest)) fs.mkdirSync(libDest, { recursive: true });
  for (const name of fs.readdirSync(libSrc)) {
    const srcFile = path.join(libSrc, name);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, path.join(libDest, name));
      console.log('Copied lib/' + name, '-> www/lib/');
    }
  }
}

if (!fs.existsSync(www)) fs.mkdirSync(www, { recursive: true });
for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(www, f));
    console.log('Copied', f, '-> www/');
  }
}
console.log('www folder ready for Capacitor.');
