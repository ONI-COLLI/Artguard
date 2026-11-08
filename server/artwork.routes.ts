import { Router } from 'express';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repository, ArtworkRow } from './repository.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';
import { artworkSchema, planRules } from '../shared/schemas.js';
import { seedArt } from './art.js';
import type { Recipient } from '../shared/types.js';
import { requireVerified } from './security.js';
import { shareStatus } from './consents.js';
import { archiveProduct } from './accounting-records.js';
import {
  galleryRows,
  imageType,
  retainedGallery,
  storeGallery,
  saveGallery,
  removeGalleryFiles,
  type GalleryRow,
} from './gallery.js';
import { maxGalleryImages } from '../shared/gallery.js';
import { protectedPreview } from './previews.js';
import { LEGAL_VERSION } from '../shared/legal.js';
import { hasLegalConsent } from './privacy.js';
function validateCreatorWallet(repo: Repository, ownerId: string, recipients: Recipient[]) {
  const wallet = repo.wallet(ownerId)?.address.toLowerCase();
  if (wallet && recipients.some((r) => r.wallet?.toLowerCase() === wallet))
    throw new HttpError(
      400,
      'The creator keeps the remaining share. Use a different wallet for each co-author.',
    );
}
function uploadRecipients(value: unknown) {
  if (value === undefined) return [];
  if (typeof value !== 'string') throw new HttpError(400, 'Send co-authors as one JSON array.');
  try {
    return JSON.parse(value);
  } catch {
    throw new HttpError(400, 'Co-author settings must be a valid JSON array.');
  }
}
export function artworkRoutes(repo: Repository, uploads: string) {
  const r = Router(),
    upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 20 * 1024 * 1024,
        files: maxGalleryImages + 1,
        fields: 20,
        fieldSize: 16384,
      },
    });
  const quota = (id: string) => {
    const u = repo.user(id);
    if (
      repo.one<{ n: number }>('SELECT count(*) AS n FROM artworks WHERE owner_id=?', id)!.n >=
      planRules[u.plan].limit
    )
      throw new HttpError(409, 'Upload limit reached. Upgrade your plan.');
  };
  r.post(
    '/api/artworks',
    (req, _res, next) => {
      requireUser(req);
      next();
    },
    upload.fields([
      { name: 'file', maxCount: 1 },
      { name: 'gallery', maxCount: maxGalleryImages },
    ]),
    async (req, res) => {
      const u = requireUser(req);
      if (req.body.rights !== 'true')
        throw new HttpError(400, 'Confirm your right to publish this artwork.');
      const a = artworkSchema.parse({
        ...req.body,
        recipients: uploadRecipients(req.body.recipients),
        licenses: typeof req.body.licenses === 'string' ? [req.body.licenses] : req.body.licenses,
      });
      validateCreatorWallet(repo, u.id, a.recipients);
      if (a.status === 'published') requireVerified(repo, u);
      const files = req.files as Record<string, Express.Multer.File[]>;
      const file = files?.file?.[0];
      if (!file?.size) throw new HttpError(400, 'Choose an image up to 20 MB.');
      const kind = imageType(file.buffer),
        hash = createHash('sha256').update(file.buffer).digest('hex');
      if (repo.one('SELECT id FROM artworks WHERE hash=?', hash))
        throw new HttpError(409, 'This file is already registered locally.');
      quota(u.id);
      const id = randomUUID(),
        filename = id + kind.ext;
      await writeFile(join(uploads, filename), file.buffer, { flag: 'wx' });
      let added: GalleryRow[] = [];
      try {
        added = await storeGallery(uploads, files?.gallery || []);
        repo.db.exec('BEGIN IMMEDIATE');
        try {
          quota(u.id);
          repo.run(
            'INSERT INTO artworks(id,owner_id,title,description,category,price,licenses,status,file_name,original_name,mime,size,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            id,
            u.id,
            a.title,
            a.description,
            a.category,
            Math.round(a.price * 100),
            JSON.stringify(a.licenses),
            a.status,
            filename,
            file.originalname.slice(0, 200),
            kind.mime,
            file.size,
            hash,
            new Date().toISOString(),
          );
          repo.setArtworkRecipients(id, a.recipients);
          repo.run('INSERT INTO artwork_license_terms VALUES(?,?)', id, a.licenseDurationDays);
          repo.run('INSERT INTO artwork_usage_policies VALUES(?,?)', id, LEGAL_VERSION);
          saveGallery(repo, id, [], added);
          if (a.status === 'published' && !shareStatus(repo, id).ready)
            repo.run("UPDATE artworks SET status='draft' WHERE id=?", id);
          archiveProduct(repo, id, 'created');
          repo.db.exec('COMMIT');
        } catch (error) {
          repo.db.exec('ROLLBACK');
          throw error;
        }
      } catch (error) {
        await unlink(join(uploads, filename)).catch(() => {});
        await removeGalleryFiles(uploads, added);
        throw error;
      }
      res.status(201).json({ ...repo.snapshot(u), artwork: repo.serialize(repo.artwork(id)!, u) });
    },
  );
  r.patch(
    '/api/artworks/:id',
    (req, _res, next) => {
      const u = requireUser(req),
        a = repo.artwork(String(req.params.id));
      if (!a || a.owner_id !== u.id) throw new HttpError(404, 'Artwork not found.');
      next();
    },
    upload.array('gallery', maxGalleryImages),
    async (req, res) => {
      const u = requireUser(req),
        a = repo.artwork(String(req.params.id));
      if (!a || a.owner_id !== u.id) throw new HttpError(404, 'Artwork not found.');
      const body = { ...req.body };
      if (typeof body.recipients === 'string') body.recipients = uploadRecipients(body.recipients);
      if (typeof body.licenses === 'string') body.licenses = [body.licenses];
      const v = artworkSchema.parse({
        licenseDurationDays: repo.licenseDuration(a.id),
        title: a.title,
        description: a.description,
        category: a.category,
        price: a.price / 100,
        licenses: JSON.parse(a.licenses),
        status: a.status,
        recipients: repo.artworkRecipients(a.id),
        ...body,
      });
      validateCreatorWallet(repo, u.id, v.recipients);
      if (v.status === 'published') requireVerified(repo, u);
      if (v.status === 'published' && !hasLegalConsent(repo, u.id))
        throw new HttpError(403, 'Accept the current privacy terms before publishing.');
      const current = galleryRows(repo, a.id);
      const keep = retainedGallery(body.retainedGallery, current);
      const files = (req.files || []) as Express.Multer.File[];
      if (keep.length + files.length > maxGalleryImages)
        throw new HttpError(400, 'Use up to 7 additional photos.');
      const galleryChanged = body.retainedGallery !== undefined || files.length > 0;
      const added = await storeGallery(uploads, files);
      let removed: GalleryRow[] = [];
      let transaction = false;
      try {
        repo.db.exec('BEGIN IMMEDIATE');
        transaction = true;
        if (galleryChanged) {
          if (
            galleryRows(repo, a.id)
              .map((image) => image.id)
              .join() !== current.map((image) => image.id).join()
          )
            throw new HttpError(
              409,
              'The gallery changed in another window. Refresh and try again.',
            );
          removed = saveGallery(repo, a.id, keep, added);
        }
        repo.run(
          'UPDATE artworks SET title=?,description=?,category=?,price=?,licenses=?,status=? WHERE id=?',
          v.title,
          v.description,
          v.category,
          Math.round(v.price * 100),
          JSON.stringify(v.licenses),
          v.status,
          a.id,
        );
        repo.setArtworkRecipients(a.id, v.recipients);
        repo.run(
          'INSERT INTO artwork_license_terms VALUES(?,?) ON CONFLICT(artwork_id) DO UPDATE SET duration_days=excluded.duration_days',
          a.id,
          v.licenseDurationDays,
        );
        if (v.status === 'published' && !shareStatus(repo, a.id).ready)
          repo.run("UPDATE artworks SET status='draft' WHERE id=?", a.id);
        archiveProduct(repo, a.id, 'updated');
        repo.db.exec('COMMIT');
        transaction = false;
      } catch (error) {
        if (transaction) repo.db.exec('ROLLBACK');
        await removeGalleryFiles(uploads, added);
        throw error;
      }
      await removeGalleryFiles(uploads, removed);
      res.json(repo.snapshot(u));
    },
  );
  r.delete('/api/artworks/:id', async (req, res) => {
    const u = requireUser(req),
      a = repo.artwork(String(req.params.id));
    if (!a || a.owner_id !== u.id) throw new HttpError(404, 'Artwork not found.');
    if (
      repo.one('SELECT 1 FROM artwork_reports WHERE artwork_id=?', a.id) ||
      repo.one('SELECT 1 FROM artwork_moderation WHERE artwork_id=?', a.id)
    )
      throw new HttpError(409, 'This project has moderation history. Save it as a draft instead.');
    if (repo.one('SELECT 1 FROM purchases WHERE artwork_id=?', a.id))
      throw new HttpError(409, 'This artwork has licenses. Save it as a draft instead.');
    if (
      repo.one(
        "SELECT 1 FROM chain_registrations WHERE artwork_id=? AND status IN ('pending','confirmed')",
        a.id,
      )
    )
      throw new HttpError(
        409,
        'This artwork has a blockchain record or pending transaction. Save it as a draft instead.',
      );
    if (repo.one('SELECT 1 FROM chain_checkout_items WHERE artwork_id=?', a.id))
      throw new HttpError(
        409,
        'This artwork has a blockchain checkout record. Save it as a draft instead.',
      );
    if (
      repo.one(
        "SELECT 1 FROM promotion_orders WHERE artwork_id=? AND (status IN ('pending','confirmed') OR (status='prepared' AND expires_at>=?))",
        a.id,
        Math.floor(Date.now() / 1000),
      )
    )
      throw new HttpError(
        409,
        'This artwork has a promotion payment or open order. Save it as a draft instead.',
      );
    const images = galleryRows(repo, a.id);
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      archiveProduct(repo, a.id, 'deleted');
      repo.run('DELETE FROM chain_registrations WHERE artwork_id=?', a.id);
      repo.run('DELETE FROM artworks WHERE id=?', a.id);
      repo.db.exec('COMMIT');
    } catch (error) {
      repo.db.exec('ROLLBACK');
      throw error;
    }
    if (a.file_name) await unlink(join(uploads, a.file_name)).catch(() => {});
    await removeGalleryFiles(uploads, images);
    res.json(repo.snapshot(u));
  });
  r.get('/api/verify', (req, res) => {
    const query = String(req.query.query || '')
      .slice(0, 200)
      .toLowerCase();
    const a = repo
      .all<ArtworkRow>(
        'SELECT a.*,u.name AS author FROM artworks a JOIN users u ON u.id=a.owner_id WHERE lower(a.hash)=? OR lower(a.id)=?',
        query,
        query.replace(/^ag-/, ''),
      )
      .find((a) => repo.canView(a, req.user));
    res.json({ artwork: a ? repo.serialize(a, req.user) : null });
  });
  r.get('/media/:id/gallery/:imageId', async (req, res) => {
    const a = repo.artwork(String(req.params.id));
    if (!repo.canView(a, req.user)) throw new HttpError(404, 'Image not found.');
    const image = repo.one<GalleryRow>(
      'SELECT * FROM artwork_images WHERE id=? AND artwork_id=?',
      String(req.params.imageId),
      a.id,
    );
    if (!image) throw new HttpError(404, 'Image not found.');
    const original = await readFile(join(uploads, image.file_name));
    res
      .type(a.owner_id === req.user?.id ? image.mime : 'image/webp')
      .set('Cache-Control', 'private, no-store')
      .send(a.owner_id === req.user?.id ? original : await protectedPreview(original));
  });
  r.get('/media/:id', async (req, res) => {
    const a = repo.artwork(String(req.params.id));
    if (!repo.canView(a, req.user)) throw new HttpError(404, 'Image not found.');
    const bytes = a.file_name ? await readFile(join(uploads, a.file_name)) : null;
    res
      .type(!bytes || a.owner_id === req.user?.id ? a.mime : 'image/webp')
      .set('Cache-Control', 'private, no-store')
      .send(
        bytes
          ? a.owner_id === req.user?.id
            ? bytes
            : await protectedPreview(bytes)
          : seedArt(a.id),
      );
  });
  r.get('/api/artworks/:id/download', async (req, res) => {
    const u = requireUser(req),
      a = repo.artwork(String(req.params.id));
    if (
      !a ||
      (a.owner_id !== u.id &&
        !repo
          .all<{ id: string }>(
            'SELECT id FROM purchases WHERE artwork_id=? AND buyer_id=?',
            a.id,
            u.id,
          )
          .some((p) => !repo.validity(p.id).expired))
    )
      throw new HttpError(403, 'A license is required to download this artwork.');
    res
      .type(a.mime)
      .set(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(a.original_name || a.id + '.svg')}`,
      )
      .send(a.file_name ? await readFile(join(uploads, a.file_name)) : seedArt(a.id));
  });
  return r;
}
