import type { HomeSummary } from '../shared/home.js';
import type { ArtworkRow, Repository } from './repository.js';

export function homeSummary(repo: Repository): HomeSummary {
  // Journal receipts are written atomically with confirmed payments. Prepared,
  // failed and simulated local orders never contribute to on-chain activity.
  const receipts = repo.all<{
    kind: string;
    gross: string;
    transaction_hash: string;
    instance_id: string;
  }>(`
    SELECT e.kind,e.gross,e.transaction_hash,e.instance_id
    FROM accounting_events e
    LEFT JOIN accounting_supersessions s ON s.local_event_id=e.id
    WHERE s.local_event_id IS NULL AND e.currency='test_eth'
      AND e.transaction_hash IS NOT NULL AND e.instance_id IS NOT NULL
    UNION ALL
    SELECT kind,gross,transaction_hash,instance_id FROM promotion_accounting_events
    WHERE transaction_hash IS NOT NULL AND instance_id IS NOT NULL
  `);
  const sales = receipts.filter((r) => r.kind === 'sale');
  const projects = repo
    .all<ArtworkRow>(
      "SELECT a.*,u.name AS author FROM artworks a JOIN users u ON u.id=a.owner_id WHERE a.status='published' ORDER BY a.created_at DESC,a.id",
    )
    .filter((a) => repo.marketable(a));
  const featured = projects[0];
  return {
    updatedAt: new Date().toISOString(),
    // A cart can issue several licenses in one transaction. Chain instances
    // are included because transaction hashes can recur after a local reset.
    completedTransactions: new Set(
      receipts.map((r) => `${r.instance_id.toLowerCase()}:${r.transaction_hash.toLowerCase()}`),
    ).size,
    licensesIssued: sales.length,
    projectsAvailable: projects.length,
    licenseVolumeWei: sales.reduce((sum, r) => sum + BigInt(r.gross), 0n).toString(),
    featured: featured
      ? {
          id: featured.id,
          title: featured.title,
          author: repo.serialize(featured, null).author,
          category: featured.category,
          image: `/media/${featured.id}`,
        }
      : null,
  };
}
