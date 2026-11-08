import type { LinkedWallet, ChainRegistration } from './blockchain.js';
import type { BlockchainPayment } from './marketplace.js';
import type { ShareStatus, SubscriptionState } from './platform.js';
export type PlanId = 'free' | 'premium' | 'business';
export type LicenseId = 'personal' | 'commercial' | 'extended';
export interface Recipient {
  wallet?: string;
  name: string;
  percent: number;
}
export interface User {
  emailVerified: boolean;
  isAdmin: boolean;
  isManager?: boolean;
  subscription: SubscriptionState;
  id: string;
  name: string;
  email: string;
  plan: PlanId;
  role: string;
  recipients: Recipient[];
  createdAt: string;
  wallet: LinkedWallet | null;
}
export interface Artwork {
  usagePolicyVersion?: string;
  licenseDurationDays?: number;
  gallery?: { id: string; url: string }[];
  shareApproval?: ShareStatus;
  moderation?: { hidden: boolean; reason: string };
  // Editable financial settings are returned only to the project owner.
  recipients?: Recipient[];
  id: string;
  ownerId: string;
  title: string;
  description: string;
  author: string;
  category: string;
  price: number;
  licenses: LicenseId[];
  status: 'published' | 'draft';
  hash: string;
  registration: string;
  date: string;
  createdAt: string;
  own: boolean;
  format: string;
  size: number;
  image: string;
  seeded: boolean;
  blockchain: ChainRegistration | null;
}
export interface Purchase {
  validFrom?: string;
  validUntil?: string | null;
  expired?: boolean;
  id: string;
  artworkId: string;
  license: LicenseId;
  amount: number;
  date: string;
  createdAt: string;
  packageId: string | null;
  payment: BlockchainPayment | null;
}
export interface Sale extends Purchase {
  title: string;
  buyer: string;
  commission: number;
  net: number;
  allocations: (Recipient & { amount: number })[];
}
export interface TeamMember {
  id: string;
  name: string;
  email: string;
}
export interface Plan {
  name: string;
  price: number;
  limit: number;
  commission: number;
}
export interface Workspace {
  privacy?: { accepted: boolean; version: string };
  publicDemo?: boolean;
  user: User | null;
  artworks: Artwork[];
  purchases: Purchase[];
  sales: Sale[];
  team: TeamMember[];
  plans: Record<PlanId, Plan>;
}
export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
}
