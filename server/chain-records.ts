import type { Address, Hex } from 'viem';
import type { ChainRegistration } from '../shared/blockchain.js';
export interface RegistrationRow {
  id: string;
  artwork_id: string;
  user_id: string;
  chain_id: number;
  contract_address: Address;
  instance_id: Hex;
  registrant: Address;
  file_hash: Hex;
  terms_hash: Hex;
  terms_json: string;
  status: ChainRegistration['status'];
  tx_hash: Hex | null;
  block_number: string | null;
  registered_at: string | null;
  error: string | null;
}
export const serializeRegistration = (v: RegistrationRow): ChainRegistration => ({
  id: v.id,
  chainId: v.chain_id,
  contractAddress: v.contract_address,
  instanceId: v.instance_id,
  registrant: v.registrant,
  fileHash: v.file_hash,
  termsHash: v.terms_hash,
  terms: v.terms_json,
  status: v.status,
  transactionHash: v.tx_hash,
  blockNumber: v.block_number,
  registeredAt: v.registered_at,
  error: v.error,
});
