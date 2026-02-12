const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcIcon = path.join(root, 'assets', 'icon-1024.png');
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res');

// Portrait: width x height. Landscape: width x height.
const splashSizes = {
  'drawable': [320, 480],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [1080, 1920],
  'drawable-port-xxxhdpi': [1440, 2560],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
};

const BG_COLOR = '#E8F5E9'; // match launcher background

if (!fs.existsSync(srcIcon)) {
  console.error('Source icon not found: assets/icon-1024.png');
  process.exit(1);
}

async function run() {
  for (const [folder, [w, h]] of Object.entries(splashSizes)) {
    const dir = path.join(resDir, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const iconSize = Math.min(w, h) * 0.35;
    const iconBuf = await sharp(srcIcon).resize(Math.round(iconSize), Math.round(iconSize)).png().toBuffer();
    const x = Math.round((w - iconSize) / 2);
    const y = Math.round((h - iconSize) / 2);
    const outPath = path.join(dir, 'splash.png');
    await sharp({
      create: { width: w, height: h, channels: 3, background: BG_COLOR }
    })
      .composite([{ input: iconBuf, left: Math.max(0, x), top: Math.max(0, y) }])
      .png()
      .toFile(outPath);
    console.log(`  ${folder}/splash.png (${w}x${h})`);
  }
  console.log('Android splash screens updated.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
