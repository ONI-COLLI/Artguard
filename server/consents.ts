import { createHash, randomUUID } from 'node:crypto';
import type { Address, Hex } from 'viem';
import type { Repository } from './repository.js';
import type { ShareStatus, ConsentRequest } from '../shared/platform.js';
import { consentDomain } from '../shared/platform.js';
import { HttpError } from './errors.js';
const hash = (value: string) => ('0x' + createHash('sha256').update(value).digest('hex')) as Hex;
export interface ShareVersion {
  id: string;
  fingerprint: Hex;
  owner_wallet: Address | null;
  recipients_json: string;
}
export function syncShareVersion(repo: Repository, artworkId: string): ShareVersion | null {
  const artwork = repo.artwork(artworkId);
  if (!artwork) return null;
  const recipients = repo.artworkRecipients(artworkId),
    owner = repo.wallet(artwork.owner_id)?.address || null;
  const fingerprint = hash(
    JSON.stringify([artwork.id, artwork.title, artwork.hash, owner?.toLowerCase(), recipients]),
  );
  const last = repo.one<ShareVersion>(
    'SELECT * FROM share_versions WHERE artwork_id=? ORDER BY rowid DESC LIMIT 1',
    artworkId,
  );
  if (last?.fingerprint === fingerprint) return last;
  if (!last && !recipients.length) return null;
  const version = {
    id: randomUUID(),
    fingerprint,
    owner_wallet: owner,
    recipients_json: JSON.stringify(recipients),
  };
  repo.run(
    'INSERT INTO share_versions VALUES(?,?,?,?,?,?)',
    version.id,
    artworkId,
    fingerprint,
    owner,
    version.recipients_json,
    new Date().toISOString(),
  );
  return version;
}
export function shareStatus(repo: Repository, artworkId: string): ShareStatus {
  const version = syncShareVersion(repo, artworkId),
    recipients = repo.artworkRecipients(artworkId);
  const approvals = version
    ? repo.all<{ wallet: string; status: 'approved' | 'declined' }>(
        'SELECT wallet,status FROM share_approvals WHERE version_id=?',
        version.id,
      )
    : [];
  const rows = recipients.map((r) => ({
    ...r,
    status:
      approvals.find((a) => a.wallet.toLowerCase() === r.wallet?.toLowerCase())?.status ||
      ('pending' as const),
  }));
  return {
    versionId: version?.id || null,
    ownerWallet: version?.owner_wallet || null,
    recipients: rows,
    ready:
      !rows.length ||
      (!!version?.owner_wallet && rows.every((r) => !!r.wallet && r.status === 'approved')),
  };
}
export function consentRequest(
  repo: Repository,
  artworkId: string,
  wallet: Address,
): ConsentRequest {
  const artwork = repo.artwork(artworkId),
    status = shareStatus(repo, artworkId);
  const recipient = status.recipients.find((r) => r.wallet?.toLowerCase() === wallet.toLowerCase());
  if (!artwork || !recipient || !status.versionId)
    throw new HttpError(404, 'Co-author invitation not found.');
  if (!status.ownerWallet)
    throw new HttpError(409, 'The creator must link their wallet before you can approve.');
  const salt = repo.one<{ value: Hex }>(
    "SELECT value FROM platform_meta WHERE key='consent_salt'",
  )!.value;
  const version = repo.one<ShareVersion>(
    'SELECT * FROM share_versions WHERE id=?',
    status.versionId,
  )!;
  return {
    versionId: version.id,
    domain: consentDomain(salt),
    message: {
      revision: hash(version.id),
      project: artwork.title,
      fileHash: /^[a-f0-9]{64}$/.test(artwork.hash) ? `0x${artwork.hash}` : hash(artwork.hash),
      creator: status.ownerWallet as Address,
      allocationHash: version.fingerprint,
      recipient: wallet,
      shareBps: recipient.percent * 100,
      statement:
        'I approve this project revenue split after the applicable platform fee. Prices and license offers may change. This signature authorizes no payment.',
    },
  };
}
export function requireApprovedShares(repo: Repository, artworkId: string) {
  if (!shareStatus(repo, artworkId).ready)
    throw new HttpError(
      409,
      'Every co-author must approve the current revenue split with their linked wallet before new license orders.',
    );
}
