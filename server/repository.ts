import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  Artwork,
  Workspace,
  User,
  PlanId,
  LicenseId,
  Recipient,
  Purchase,
  Sale,
  TeamMember,
} from '../shared/types.js';
import { planRules } from '../shared/schemas.js';
import type { LinkedWallet } from '../shared/blockchain.js';
import { serializeRegistration, type RegistrationRow } from './chain-records.js';
import { paymentFor } from './chain-checkouts.js';
import { shareStatus, syncShareVersion } from './consents.js';
import type { SubscriptionState } from '../shared/platform.js';
import { hasLegalConsent } from './privacy.js';
import { LEGAL_VERSION } from '../shared/legal.js';
export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  plan: PlanId;
  role: string;
  recipients: string;
  created_at: string;
}
export interface ArtworkRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  category: string;
  price: number;
  licenses: string;
  status: 'published' | 'draft';
  file_name: string | null;
  original_name: string | null;
  mime: string;
  size: number;
  hash: string;
  created_at: string;
  author: string;
}
export interface PurchaseRow {
  id: string;
  buyer_id: string;
  artwork_id: string;
  license: LicenseId;
  amount: number;
  commission: number;
  allocations: string;
  package_id: string | null;
  created_at: string;
  buyer?: string;
  title?: string;
}
export const publicUser = (
  u: UserRow,
): Omit<User, 'emailVerified' | 'isAdmin' | 'isManager' | 'subscription'> => ({
  id: u.id,
  name: u.name,
  email: u.email,
  plan: u.plan,
  role: u.role,
  recipients: JSON.parse(u.recipients) as Recipient[],
  createdAt: u.created_at,
  wallet: null,
});
export class Repository {
  constructor(public db: DatabaseSync) {}
  one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }
  user(id: string) {
    const user = this.one<UserRow>('SELECT * FROM users WHERE id=?', id)!;
    return user ? { ...user, plan: this.subscription(id).plan } : user;
  }
  emailVerified(id: string) {
    return !!this.one(
      'SELECT 1 FROM email_verifications v JOIN users u ON u.id=v.user_id WHERE v.user_id=? AND v.email=u.email COLLATE NOCASE',
      id,
    );
  }
  isAdmin(id: string) {
    return !!this.one('SELECT 1 FROM admin_accounts WHERE user_id=?', id);
  }
  isManager(id: string) {
    return !!this.one('SELECT 1 FROM manager_accounts WHERE user_id=?', id);
  }
  licenseDuration(id: string) {
    return (
      this.one<{ duration_days: number }>(
        'SELECT duration_days FROM artwork_license_terms WHERE artwork_id=?',
        id,
      )?.duration_days || 0
    );
  }
  validity(id: string) {
    const saved = this.one<{ valid_from: number; valid_until: number | null }>(
      'SELECT * FROM license_validity WHERE purchase_id=?',
      id,
    );
    return {
      validFrom: saved ? new Date(saved.valid_from * 1000).toISOString() : undefined,
      validUntil: saved?.valid_until ? new Date(saved.valid_until * 1000).toISOString() : null,
      expired: !!saved?.valid_until && saved.valid_until <= Math.floor(Date.now() / 1000),
    };
  }
  subscription(id: string): SubscriptionState {
    const s = this.one<{
      plan: 'premium' | 'business';
      valid_until: number;
      cancel_at_end: number;
    }>('SELECT * FROM subscriptions WHERE user_id=?', id);
    return {
      plan: s && s.valid_until > Math.floor(Date.now() / 1000) ? s.plan : 'free',
      validUntil: s?.valid_until || null,
      cancelAtEnd: !!s?.cancel_at_end,
    };
  }
  wallet(id: string) {
    return (
      this.one<LinkedWallet>(
        'SELECT address,linked_at AS linkedAt FROM wallets WHERE user_id=?',
        id,
      ) || null
    );
  }
  artwork(id: string) {
    return this.one<ArtworkRow>(
      'SELECT a.*,u.name AS author FROM artworks a JOIN users u ON u.id=a.owner_id WHERE a.id=?',
      id,
    );
  }
  artworkRecipients(id: string): Recipient[] {
    const saved = this.one<{ recipients: string }>(
      'SELECT recipients FROM artwork_revenue_settings WHERE artwork_id=?',
      id,
    );
    return saved ? JSON.parse(saved.recipients) : [];
  }
  setArtworkRecipients(id: string, recipients: Recipient[]) {
    this.run(
      'INSERT INTO artwork_revenue_settings(artwork_id,recipients) VALUES(?,?) ON CONFLICT(artwork_id) DO UPDATE SET recipients=excluded.recipients',
      id,
      JSON.stringify(recipients),
    );
    syncShareVersion(this, id);
  }
  isCoauthor(id: string, user: UserRow | null) {
    const wallet = user ? this.wallet(user.id)?.address.toLowerCase() : null;
    return !!wallet && this.artworkRecipients(id).some((r) => r.wallet?.toLowerCase() === wallet);
  }
  hidden(id: string) {
    return !!this.one('SELECT 1 FROM artwork_moderation WHERE artwork_id=? AND hidden=1', id);
  }
  marketable(a: ArtworkRow) {
    return a.status === 'published' && !this.hidden(a.id) && shareStatus(this, a.id).ready;
  }
  purchased(id: string, user: UserRow | null) {
    return (
      !!user && !!this.one('SELECT 1 FROM purchases WHERE artwork_id=? AND buyer_id=?', id, user.id)
    );
  }
  canView(a: ArtworkRow | undefined, user: UserRow | null): a is ArtworkRow {
    return (
      !!a &&
      (a.owner_id === user?.id ||
        this.purchased(a.id, user) ||
        (!!user && this.isAdmin(user.id)) ||
        (!this.hidden(a.id) && (this.marketable(a) || this.isCoauthor(a.id, user))))
    );
  }
  serialize(a: ArtworkRow, user: UserRow | null): Artwork {
    return {
      usagePolicyVersion: this.one<{ version: string }>(
        'SELECT version FROM artwork_usage_policies WHERE artwork_id=?',
        a.id,
      )?.version,
      licenseDurationDays: this.licenseDuration(a.id),
      ...(a.owner_id === user?.id ? { recipients: this.artworkRecipients(a.id) } : {}),
      ...(a.owner_id === user?.id || this.isCoauthor(a.id, user)
        ? { shareApproval: shareStatus(this, a.id) }
        : {}),
      ...(a.owner_id === user?.id || (!!user && this.isAdmin(user.id))
        ? {
            moderation: this.one<{ hidden: number; reason: string }>(
              'SELECT hidden,reason FROM artwork_moderation WHERE artwork_id=?',
              a.id,
            )
              ? {
                  hidden: this.hidden(a.id),
                  reason: this.one<{ reason: string }>(
                    'SELECT reason FROM artwork_moderation WHERE artwork_id=?',
                    a.id,
                  )!.reason,
                }
              : { hidden: false, reason: '' },
          }
        : {}),
      id: a.id,
      ownerId: a.owner_id,
      title: a.title,
      description: a.description,
      author: a.owner_id.startsWith('sample-')
        ? a.author
        : this.one<{ alias: string }>(
            'SELECT alias FROM public_profiles WHERE user_id=?',
            a.owner_id,
          )?.alias || 'Creator ' + a.owner_id.slice(0, 6),
      category: a.category,
      price: a.price / 100,
      licenses: JSON.parse(a.licenses),
      status: a.status,
      hash: a.hash,
      registration: `AG-${a.id.toUpperCase()}`,
      date: a.created_at.slice(0, 10),
      createdAt: a.created_at,
      own: a.owner_id === user?.id,
      format: a.mime.split('/')[1].toUpperCase(),
      size: a.size,
      image: `/media/${a.id}`,
      gallery: this.all<{ id: string }>(
        'SELECT id FROM artwork_images WHERE artwork_id=? ORDER BY position,id',
        a.id,
      ).map((image) => ({ id: image.id, url: `/media/${a.id}/gallery/${image.id}` })),
      seeded: !a.file_name,
      blockchain: (() => {
        const row = this.one<RegistrationRow>(
          "SELECT * FROM chain_registrations WHERE artwork_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1",
          a.id,
        );
        return row ? serializeRegistration(row) : null;
      })(),
    };
  }
  snapshot(user: UserRow | null): Workspace {
    user = user ? this.user(user.id) : null;
    const artworks = (
      user
        ? this.all<ArtworkRow>(
            'SELECT a.*,u.name AS author FROM artworks a JOIN users u ON u.id=a.owner_id ORDER BY a.created_at DESC',
          )
        : []
    )
      .filter((a) => this.canView(a, user))
      .map((a) => this.serialize(a, user));
    const purchase = (p: PurchaseRow): Purchase => ({
      ...this.validity(p.id),
      id: p.id,
      artworkId: p.artwork_id,
      license: p.license,
      amount: p.amount / 100,
      date: p.created_at.slice(0, 10),
      createdAt: p.created_at,
      packageId: p.package_id,
      payment: paymentFor(this, p.id),
    });
    const purchases = user
      ? this.all<PurchaseRow>(
          'SELECT * FROM purchases WHERE buyer_id=? ORDER BY created_at DESC',
          user.id,
        ).map(purchase)
      : [];
    const sales: Sale[] = user
      ? this.all<PurchaseRow>(
          'SELECT p.*,u.name AS buyer,a.title FROM purchases p JOIN artworks a ON a.id=p.artwork_id JOIN users u ON u.id=p.buyer_id WHERE a.owner_id=? ORDER BY p.created_at DESC',
          user.id,
        ).map((s) => ({
          ...purchase(s),
          title: s.title!,
          buyer: s.buyer!,
          commission: s.commission / 100,
          net: (s.amount - s.commission) / 100,
          allocations: JSON.parse(s.allocations),
        }))
      : [];
    if (user) {
      // One access record can have several paid renewals. Retain each sale in creator history.
      for (const item of this.all<
        PurchaseRow & {
          quote_id: string;
          quote_amount: number;
          quote_commission: number;
          confirmed_at: string;
        }
      >(
        "SELECT p.*,u.name buyer,i.title,i.quote_id,i.amount quote_amount,i.commission quote_commission,coalesce(e.settled_at,c.confirmed_at) confirmed_at FROM chain_checkout_items i JOIN chain_checkouts c ON c.id=i.checkout_id LEFT JOIN chain_purchase_links l ON l.quote_id=i.quote_id JOIN purchases p ON p.id=coalesce(i.purchase_id,l.purchase_id) JOIN users u ON u.id=p.buyer_id LEFT JOIN escrow_records e ON e.quote_id=i.quote_id WHERE i.seller_id=? AND c.status='confirmed'",
        user.id,
      )) {
        if (paymentFor(this, item.id)?.quoteId === item.quote_id) continue;
        const payment = paymentFor(this, item.id, item.quote_id)!;
        sales.push({
          ...purchase(item),
          id: item.quote_id,
          title: item.title!,
          buyer: item.buyer!,
          amount: item.quote_amount / 100,
          commission: item.quote_commission / 100,
          net: (item.quote_amount - item.quote_commission) / 100,
          date: item.confirmed_at.slice(0, 10),
          createdAt: item.confirmed_at,
          payment,
          allocations: (payment.allocations || []).map((a) => ({
            name: a.name,
            wallet: a.wallet,
            percent: a.percent,
            amount: ((item.quote_amount - item.quote_commission) * a.percent) / 10000,
          })),
        });
      }
      sales.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return {
      privacy: user
        ? { accepted: hasLegalConsent(this, user.id), version: LEGAL_VERSION }
        : undefined,
      user: user
        ? {
            ...publicUser(user),
            wallet: this.wallet(user.id),
            emailVerified: this.emailVerified(user.id),
            isAdmin: this.isAdmin(user.id),
            isManager: this.isManager(user.id),
            subscription: this.subscription(user.id),
          }
        : null,
      artworks,
      purchases,
      sales,
      team: user
        ? this.all<TeamMember>('SELECT id,name,email FROM team WHERE owner_id=?', user.id)
        : [],
      plans: planRules,
      ...(process.env.ARTGUARD_PUBLIC_DEMO === 'true' ? { publicDemo: true } : {}),
    };
  }
}
