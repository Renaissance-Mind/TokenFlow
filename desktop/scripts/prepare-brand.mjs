import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const artwork = await fs.readFile(path.join(root, 'docs/assets/tokenflow.svg'), 'utf8');
// The rounded white frame and fine outline use the same Apple Icon Composer
// mask as ShowAI. Neither belongs in transparent or macOS template tray art.
const transparent = artwork.replace(/\s*<(?:rect|path) id="(?:background|icon-outline)"[^>]*\/>/g, '');
if (transparent === artwork) throw new Error('The brand SVG must contain its white background.');
const monochrome = transparent.replace(/fill="url\(#[^)]+\)"/g, 'fill="#000000"');
const assets = path.join(desktop, 'assets');
await fs.mkdir(assets, { recursive: true });
for (const destination of ['dashboard', 'renderer']) {
  const brand = path.join(desktop, destination, 'brand');
  await fs.mkdir(brand, { recursive: true });
  await fs.writeFile(path.join(brand, 'tokenflow.svg'), artwork);
}
await sharp(Buffer.from(artwork)).resize(1024, 1024).png().toFile(path.join(assets, 'icon.png'));
await sharp(Buffer.from(transparent)).resize(32, 32).png().toFile(path.join(assets, 'tray.png'));
for (const [name, size] of [['trayTemplate.png', 22], ['trayTemplate@2x.png', 44]]) {
  await sharp(Buffer.from(monochrome)).resize(size, size).png().toFile(path.join(assets, name));
}

// Optional web export keeps the deployed favicon and touch icon in sync with
// the same approved artwork. Normal desktop builds need no server checkout.
if (process.argv[2]) {
  const publicDirectory = path.resolve(process.argv[2]);
  await fs.mkdir(path.join(publicDirectory, 'brand'), { recursive: true });
  await fs.writeFile(path.join(publicDirectory, 'brand/tokenflow.svg'), artwork);
  await fs.writeFile(path.join(publicDirectory, 'favicon.svg'), artwork);
  await sharp(Buffer.from(artwork)).resize(180, 180).png().toFile(path.join(publicDirectory, 'apple-touch-icon.png'));
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map(size => sharp(Buffer.from(artwork)).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = sizes[i];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  }
  await fs.writeFile(path.join(publicDirectory, 'favicon.ico'), Buffer.concat([header, ...images]));
}
console.log('Prepared TokenFlow brand, app icon and tray icons from docs/assets/tokenflow.svg.');
