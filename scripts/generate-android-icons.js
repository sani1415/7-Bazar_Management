const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcIcon = path.join(root, 'assets', 'icon-1024.png');
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res');

const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const outputNames = ['ic_launcher_foreground.png', 'ic_launcher.png', 'ic_launcher_round.png'];

if (!fs.existsSync(srcIcon)) {
  console.error('Source icon not found: assets/icon-1024.png');
  process.exit(1);
}

async function run() {
  for (const [folder, size] of Object.entries(sizes)) {
    const dir = path.join(resDir, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const buffer = await sharp(srcIcon).resize(size, size).png().toBuffer();
    for (const name of outputNames) {
      fs.writeFileSync(path.join(dir, name), buffer);
      console.log(`  ${folder}/${name} (${size}x${size})`);
    }
  }
  console.log('Android launcher icons updated.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
