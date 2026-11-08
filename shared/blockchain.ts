import { defineChain, parseAbi, sha256, stringToHex, type Address, type Hex } from 'viem';
import { licenseTypes } from './schemas.js';
import type { Artwork, LicenseId } from './types.js';
import { detailedUsage, licensePeriodRule } from './license-terms.js';
export const localChain = defineChain({
  id: 31337,
  name: 'ArtGuard Local',
  nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        typeof window !== 'undefined' &&
        !['localhost', '127.0.0.1'].includes(window.location.hostname)
          ? new URL('/rpc', window.location.origin).toString()
          : 'http://127.0.0.1:8545',
      ],
    },
  },
  testnet: true,
});
export const registryAbi = parseAbi([
  'function registerArtwork(bytes32 fileHash, bytes32 termsHash)',
  'function instanceId() view returns (bytes32)',
  'function records(bytes32) view returns (address registrant, bytes32 termsHash, uint64 registeredAt)',
  'event ArtworkRegistered(bytes32 indexed fileHash, address indexed registrant, bytes32 termsHash, uint64 registeredAt)',
  'error InvalidHash()',
  'error AlreadyRegistered()',
]);
export interface LinkedWallet {
  address: Address;
  linkedAt: string;
}
export interface Deployment {
  chainId: 31337;
  address: Address;
  instanceId: Hex;
  transactionHash: Hex;
}
export interface ChainStatus {
  ready: boolean;
  chainId: 31337;
  name: string;
  rpcUrl: string;
  deployment: Deployment | null;
  message: string;
}
export interface ChainRegistration {
  id: string;
  chainId: number;
  contractAddress: Address;
  instanceId: Hex;
  registrant: Address;
  fileHash: Hex;
  termsHash: Hex;
  terms: string;
  status: 'prepared' | 'pending' | 'confirmed' | 'failed';
  transactionHash: Hex | null;
  blockNumber: string | null;
  registeredAt: string | null;
  error: string | null;
}
export interface RegistrationState {
  record: ChainRegistration | null;
  pending: ChainRegistration | null;
  verified: boolean;
  termsChanged: boolean;
  message: string;
}
export interface RegistrationIntent {
  registration: ChainRegistration;
  deployment: Deployment;
}
export function termsSnapshot(
  artwork: Pick<Artwork, 'licenses' | 'licenseDurationDays' | 'usagePolicyVersion'>,
) {
  return JSON.stringify({
    version: artwork.usagePolicyVersion ? 2 : 1,
    ...(artwork.usagePolicyVersion
      ? {
          policyVersion: artwork.usagePolicyVersion,
          territory: 'Kazakhstan',
          periodRule: licensePeriodRule,
        }
      : {}),
    ...(artwork.licenseDurationDays ? { durationDays: artwork.licenseDurationDays } : {}),
    licenses: [...artwork.licenses].sort().map((id: LicenseId) => ({
      id,
      terms: artwork.usagePolicyVersion ? detailedUsage[id] : licenseTypes[id].description,
    })),
  });
}
export const termsFingerprint = (terms: string) => sha256(stringToHex(terms));
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
