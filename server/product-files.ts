import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { imageType } from './gallery.js';
import { HttpError } from './errors.js';
import type { Repository, ArtworkRow } from './repository.js';

export interface CoverRow {
  file_name: string;
  mime: string;
  width: number | null;
  height: number | null;
  file_width: number | null;
  file_height: number | null;
}
export async function imageDimensions(bytes: Buffer) {
  try {
    const m = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!m.width || !m.height) throw new Error();
    return { width: m.width, height: m.height };
  } catch {
    throw new HttpError(400, 'Choose a readable image, up to 40 million pixels.');
  }
}
function validZip(bytes: Buffer) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) !== 0x06054b50) continue;
    if (i + 22 + bytes.readUInt16LE(i + 20) !== bytes.length) continue;
    const size = bytes.readUInt32LE(i + 12), offset = bytes.readUInt32LE(i + 16);
    return bytes.readUInt16LE(i + 4) === 0 && bytes.readUInt16LE(i + 6) === 0 &&
      bytes.readUInt16LE(i + 10) > 0 && offset + size === i && size >= 46 &&
      offset + 4 <= i && bytes.readUInt32LE(offset) === 0x02014b50;
  }
  return false;
}
export function productFileType(bytes: Buffer) {
  try { return imageType(bytes); } catch { /* Other explicitly supported downloads. */ }
  if (/^%PDF-(?:1\.[0-9]|2\.0)/.test(bytes.subarray(0, 12).toString('ascii')) &&
      bytes.subarray(-1024).includes(Buffer.from('%%EOF')))
    return { mime: 'application/pdf', ext: '.pdf' };
  // Archives are delivered as attachments and are never extracted or executed on the server.
  if (validZip(bytes)) return { mime: 'application/zip', ext: '.zip' };
  throw new HttpError(400, 'Choose a valid PNG, JPG, WEBP, PDF, or ZIP product file.');
}
export function artworkCover(repo: Repository, a: ArtworkRow) {
  return repo.one<CoverRow>('SELECT * FROM artwork_covers WHERE artwork_id=?', a.id);
}
export async function coverBytes(repo: Repository, uploads: string, a: ArtworkRow) {
  const cover = artworkCover(repo, a);
  return readFile(join(uploads, cover?.file_name || a.file_name!));
}
