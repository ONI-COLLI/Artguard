import { Router } from 'express';
import { z } from 'zod';
import type { Repository, ArtworkRow } from './repository.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';

export function communityRoutes(repo: Repository) {
  const r = Router();
  r.get('/creators/:id', (req, res) => {
    const id = String(req.params.id), user = repo.user(id);
    if (!user) throw new HttpError(404, 'Creator not found.');
    const projects = repo.all<ArtworkRow>(
      'SELECT a.*,u.name AS author FROM artworks a JOIN users u ON u.id=a.owner_id WHERE a.owner_id=? ORDER BY a.created_at DESC', id,
    ).filter(a => repo.marketable(a));
    const alias = repo.one<{alias: string}>('SELECT alias FROM public_profiles WHERE user_id=?', id)?.alias;
    const name = alias || (id.startsWith('sample-') ? user.name : 'Creator ' + id.slice(0,6));
    const bio = repo.one<{bio: string}>('SELECT bio FROM creator_bios WHERE user_id=?', id)?.bio || '';
    res.json({creator:{id,name,bio},total:projects.length,artworks:projects.slice(0,100).map(a => ({
      ...repo.serialize(a, null), blockchain: null,
    }))});
  });
  r.patch('/creator/profile', (req, res) => {
    const user = requireUser(req), {bio} = z.object({bio:z.string().trim().max(600)}).parse(req.body);
    repo.run('INSERT INTO creator_bios VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio', user.id, bio);
    res.json({bio});
  });
  r.put('/artworks/:id/favorite', (req, res) => {
    const user = requireUser(req), a = repo.artwork(String(req.params.id));
    const {saved} = z.object({saved:z.boolean()}).parse(req.body);
    if (!repo.canView(a,user) || !repo.marketable(a)) throw new HttpError(404,'Artwork not found.');
    if (saved) repo.run('INSERT OR IGNORE INTO artwork_favorites VALUES(?,?,?)',user.id,a.id,new Date().toISOString());
    else repo.run('DELETE FROM artwork_favorites WHERE user_id=? AND artwork_id=?',user.id,a.id);
    res.json(repo.snapshot(user));
  });
  return r;
}
