import { translations } from './i18n.mjs';
const images = new Map();
const bounds = new WeakMap();
let fonts;
const family = display => display ? 'IdentityDisplay, sans-serif' : 'IdentityText, sans-serif';
const font = (size, display) => `${display ? 900 : 400} ${size}px ${family(display)}`;

export function loadImage(src) {
  if (!images.has(src)) images.set(src, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { images.delete(src); reject(new Error('Unable to load illustration: ' + src)); };
    image.src = src;
  }));
  return images.get(src);
}

export async function loadFonts() {
  if (!fonts) fonts = Promise.all([
    new FontFace('IdentityDisplay', 'url(/identity-share/fonts/display.woff)', { weight: '900' }).load(),
    new FontFace('IdentityText', 'url(/identity-share/fonts/body.woff)', { weight: '400' }).load()
  ]).then(loaded => { for (const face of loaded) document.fonts.add(face); })
    .catch(error => { fonts = null; throw error; });
  await fonts;
}

function imageBounds(image) {
  if (!bounds.has(image)) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 20) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
    }
    if (right <= left || bottom <= top) throw new Error('Empty character illustration');
    bounds.set(image, [left, top, right, bottom]);
  }
  return bounds.get(image);
}

export async function makePlan(profile, role) {
  const character = `/personas/animals/${role.key}-l${profile.levelIndex + 1}.webp`;
  const decoration = `/identity-share/decorations/${role.key}.webp`;
  const [image] = await Promise.all([loadImage(character), loadImage(decoration), loadImage('/identity-share/github.svg'), loadFonts()]);
  const measure = document.createElement('canvas').getContext('2d');
  function text(value, x, top, size, color, display, maxWidth, anchor = 'start') {
    value = String(value);
    measure.font = font(size, display);
    size = Math.min(size, size * maxWidth / Math.max(1, measure.measureText(value).width));
    measure.font = font(size, display);
    return { type: 'text', value, x, y: top + measure.measureText(value).actualBoundingBoxAscent, size, color, display, anchor };
  }
  const [x0, y0, x1, y1] = imageBounds(image);
  const ratio = (x1 - x0) / (y1 - y0);
  const croppedHeight = Math.min(737.33, 662.67 / ratio), croppedWidth = croppedHeight * ratio;
  const width = croppedWidth * image.naturalWidth / (x1 - x0), height = croppedHeight * image.naturalHeight / (y1 - y0);
  const copy = translations(profile.language), roleCopy = copy.roles[role.key];
  return {
    roleKey: role.key, roleName: roleCopy.name, language: profile.language, width: 1080, height: 1440,
    items: [
      { type: 'image', src: decoration, x: 220, y: 129.33, width: 840, height: 1120, opacity: 0.73 },
      { type: 'image', src: character, x: 400 + (662.67 - croppedWidth) / 2 - width * x0 / image.naturalWidth, y: 598.67 + (737.33 - croppedHeight) / 2 - height * y0 / image.naturalHeight, width, height, opacity: 1 },
      text(copy.headline, 48, 89, 117.33, '#111318', true, 980),
      text(roleCopy.name, 46, 265, roleCopy.name.length > 3 ? 180 : 201.33, role.accent, true, 945),
      text(roleCopy.slogan, 52, 501, 53.33, '#111318', true, 970),
      text(role.english + ' · ' + profile.level, 53, 587, 26.67, '#111318', false, 950),
      text(profile.tokens, 48, 692, 128, role.accent, true, 365),
      text(copy.tokensLabel, 53, 816, 36, '#181c21', false, 365),
      { type: 'line', x1: 53, y1: 870, x2: 295, y2: 870 },
      text(profile.activeDays, 48, 924, 128, '#102442', true, 365),
      text(copy.activeLabel, 53, 1048, 36, '#181c21', false, 365),
      { type: 'line', x1: 53, y1: 1103, x2: 295, y2: 1103 },
      text(profile.toolCount, 48, 1150, 128, '#102442', true, 365),
      text(copy.toolsLabel, 53, 1282, 36, '#181c21', false, 365),
      text(profile.tools, 53, 1342, 27, '#181c21', false, 385),
      text(profile.username, 53, 1404, 27, '#181c21', false, 360),
      text(roleCopy.quote, 1030, 1380, 22.67, '#181c21', false, 605, 'end'),
      text(profile.period + (profile.snapshot ? ' · ' + copy.snapshot : ''), 1030, 1408, 18.67, '#6b7178', false, 650, 'end'),
      text('Renaissance-Mind/TokenFlow', 991, 32, 25, '#111318', true, 560, 'end'),
      { type: 'image', src: '/identity-share/github.svg', x: 1011, y: 25, width: 36, height: 36, opacity: 1 }
    ]
  };
}

export async function pngBlob(plan) {
  const canvas = document.createElement('canvas'); canvas.width = plan.width; canvas.height = plan.height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const item of plan.items) {
    if (item.type === 'image') { ctx.globalAlpha = item.opacity; ctx.drawImage(await loadImage(item.src), item.x, item.y, item.width, item.height); ctx.globalAlpha = 1; }
    if (item.type === 'line') { ctx.strokeStyle = '#8096ae'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(item.x1, item.y1); ctx.lineTo(item.x2, item.y2); ctx.stroke(); }
    if (item.type === 'text') { ctx.font = font(item.size, item.display); ctx.fillStyle = item.color; ctx.textAlign = item.anchor === 'end' ? 'right' : 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(item.value, item.x, item.y); }
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png'));
}
