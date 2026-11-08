import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Repository } from './repository.js';
import { HttpError } from './errors.js';
import { maxGalleryImages, maxGalleryImageBytes } from '../shared/gallery.js';

export function imageType(b: Buffer) {
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mime: 'image/png', ext: '.png' };
  if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return { mime: 'image/jpeg', ext: '.jpg' };
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return { mime: 'image/webp', ext: '.webp' };
  throw new HttpError(400, 'Choose a valid PNG, JPG, or WEBP image.');
}
export type GalleryRow = {
  id: string;
  file_name: string;
  original_name: string;
  mime: string;
  size: number;
};
export const galleryRows = (repo: Repository, artworkId: string) =>
  repo.all<GalleryRow>(
    'SELECT * FROM artwork_images WHERE artwork_id=? ORDER BY position,id',
    artworkId,
  );
export function retainedGallery(value: unknown, current: GalleryRow[]) {
  if (value === undefined) return current.map((image) => image.id);
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new HttpError(400, 'Invalid gallery selection.');
    }
  }
  const ids = z.array(z.uuid()).max(maxGalleryImages).parse(parsed);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !current.some((image) => image.id === id))
  )
    throw new HttpError(400, 'Select photos belonging to this project. Refresh and try again.');
  return ids;
}
export async function removeGalleryFiles(uploads: string, images: GalleryRow[]) {
  await Promise.all(images.map((image) => unlink(join(uploads, image.file_name)).catch(() => {})));
}
export async function storeGallery(uploads: string, files: Express.Multer.File[]) {
  if (files.length > maxGalleryImages) throw new HttpError(400, 'Use up to 7 additional photos.');
  // Validate the entire batch before writing any file.
  const prepared = files.map((file) => {
    if (!file.size || file.size > maxGalleryImageBytes)
      throw new HttpError(400, 'Each additional photo must be a nonempty image up to 10 MB.');
    const kind = imageType(file.buffer),
      id = randomUUID();
    return {
      file,
      row: {
        id,
        file_name: id + kind.ext,
        original_name: file.originalname.slice(0, 200),
        mime: kind.mime,
        size: file.size,
      },
    };
  });
  const written: GalleryRow[] = [];
  try {
    for (const item of prepared) {
      await writeFile(join(uploads, item.row.file_name), item.file.buffer, { flag: 'wx' });
      written.push(item.row);
    }
    return written;
  } catch (error) {
    await removeGalleryFiles(uploads, written);
    throw error;
  }
}
export function saveGallery(
  repo: Repository,
  artworkId: string,
  keep: string[],
  added: GalleryRow[],
) {
  if (keep.length + added.length > maxGalleryImages)
    throw new HttpError(400, 'Use up to 7 additional photos.');
  const current = galleryRows(repo, artworkId);
  retainedGallery(keep, current);
  const removed = current.filter((image) => !keep.includes(image.id));
  for (const image of removed)
    repo.run('DELETE FROM artwork_images WHERE id=? AND artwork_id=?', image.id, artworkId);
  keep.forEach((id, i) =>
    repo.run('UPDATE artwork_images SET position=? WHERE id=? AND artwork_id=?', i, id, artworkId),
  );
  added.forEach((image, i) =>
    repo.run(
      'INSERT INTO artwork_images(id,artwork_id,file_name,original_name,mime,size,position,created_at) VALUES(?,?,?,?,?,?,?,?)',
      image.id,
      artworkId,
      image.file_name,
      image.original_name,
      image.mime,
      image.size,
      keep.length + i,
      new Date().toISOString(),
    ),
  );
  return removed;
}
