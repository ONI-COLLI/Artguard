import { beforeEach, expect, test, vi } from 'vitest';
import { createConfig, http } from 'wagmi';
import { connect, disconnect, getWalletClient } from 'wagmi/actions';
import { encodeFunctionData } from 'viem';
import { demoWallet } from '../src/lib/demo-wallet';
import { api } from '../src/lib/api';
import { localChain } from '../shared/blockchain';
import { marketplaceAbi } from '../shared/marketplace';
import { consentTypes, consentDomain } from '../shared/platform';

vi.mock('../src/lib/api', () => ({ api: vi.fn() }));
const address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const contract = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const;
const hash = ('0x' + '11'.repeat(32)) as `0x${string}`;
beforeEach(() => {
  vi.mocked(api).mockReset();
});
test('wagmi and viem use the bound demo account for real wallet RPC formats, contract calls and typed consent', async () => {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/demo/wallet') return { available: true, address };
    if (path === '/demo/wallet/rpc')
      return {
        result:
          (options?.data as { method: string }).method === 'eth_sendTransaction'
            ? hash
            : '0x' + '22'.repeat(65),
      };
    throw new Error('Unexpected request: ' + path);
  });
  const config = createConfig({
    chains: [localChain],
    connectors: [demoWallet()],
    storage: null,
    transports: { 31337: http() },
  });
  await connect(config, { connector: config.connectors[0] });
  const wallet = await getWalletClient(config);
  expect(wallet.account.address).toBe(address);
  const tx = await wallet.writeContract({
    address: contract,
    abi: marketplaceAbi,
    functionName: 'withdraw',
  });
  expect(tx).toBe(hash);
  const send = vi
    .mocked(api)
    .mock.calls.find(
      ([path, options]) =>
        path === '/demo/wallet/rpc' &&
        (options?.data as { method: string }).method === 'eth_sendTransaction',
    );
  expect(send?.[1]?.data).toMatchObject({
    method: 'eth_sendTransaction',
    params: [
      {
        from: address,
        to: contract,
        data: encodeFunctionData({ abi: marketplaceAbi, functionName: 'withdraw' }),
      },
    ],
  });
  await wallet.signTypedData({
    domain: consentDomain(hash),
    types: consentTypes,
    primaryType: 'RevenueConsent',
    message: {
      revision: hash,
      project: 'Demo project',
      fileHash: hash,
      creator: contract,
      allocationHash: hash,
      recipient: address,
      shareBps: 2500,
      statement: 'Test consent',
    },
  });
  const sign = vi
    .mocked(api)
    .mock.calls.find(
      ([path, options]) =>
        path === '/demo/wallet/rpc' &&
        (options?.data as { method: string }).method === 'eth_signTypedData_v4',
    );
  const params = (sign?.[1]?.data as { params: string[] }).params;
  expect(params[0].toLowerCase()).toBe(address.toLowerCase());
  expect(JSON.parse(params[1])).toMatchObject({
    primaryType: 'RevenueConsent',
    domain: { chainId: 31337 },
    message: { shareBps: 2500, recipient: address.toLowerCase() },
  });
  await disconnect(config);
  expect(await config.connectors[0].isAuthorized()).toBe(false);
});
test('ordinary accounts cannot connect the built-in demo connector', async () => {
  vi.mocked(api).mockResolvedValue({ available: false });
  const config = createConfig({
    chains: [localChain],
    connectors: [demoWallet()],
    storage: null,
    transports: { 31337: http() },
  });
  await expect(connect(config, { connector: config.connectors[0] })).rejects.toThrow(
    'no provisioned demo wallet',
  );
});
