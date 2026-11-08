import sharp from 'sharp';
import { createHash } from 'node:crypto';
const cache = new Map<string, Buffer>();
export async function protectedPreview(bytes: Buffer) {
  const key = createHash('sha256').update(bytes).digest('hex');
  const saved = cache.get(key);
  if (saved) return saved;
  const image = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'none' })
    .rotate()
    .resize({ width: 960, height: 720, fit: 'inside' })
    .flatten({ background: '#242424' })
    .webp({ quality: 65 })
    .toBuffer();
  const metadata = await sharp(image).metadata(),
    width = metadata.width!,
    height = metadata.height!;
  const watermark = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="w" width="220" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)"><text x="12" y="55" fill="white" stroke="#111" stroke-width=".5" opacity=".5" font-family="sans-serif" font-size="22">ARTGUARD PREVIEW</text></pattern></defs><rect width="100%" height="100%" fill="url(#w)"/></svg>`,
  );
  const result = await sharp(image)
    .composite([{ input: watermark }])
    .webp({ quality: 65 })
    .toBuffer();
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
