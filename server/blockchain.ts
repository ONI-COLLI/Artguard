import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  parseEther,
  type Address,
} from 'viem';
import {
  localChain,
  registryAbi,
  type ChainStatus,
  type Deployment,
} from '../shared/blockchain.js';
import { HttpError } from './errors.js';
import {
  promotionAbi,
  promotionDomain,
  promotionMessage,
  promotionTypes,
  type PromotionQuote,
} from '../shared/promotions.js';
import {
  subscriptionAbi,
  subscriptionDomain,
  subscriptionTypes,
  subscriptionMessage,
  type SubscriptionQuote,
} from '../shared/platform.js';
import {
  marketplaceAbi,
  quoteTypes,
  termQuoteTypes,
  quoteDomain,
  contractQuote,
  type MarketDeployment,
  type MarketStatus,
  type LicenseQuote,
} from '../shared/marketplace.js';

const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const hex32 = z.string().regex(/^0x[\da-fA-F]{64}$/);
const deploymentSchema = z.object({
  chainId: z.literal(31337),
  address,
  instanceId: hex32,
  transactionHash: hex32,
});
const marketSchema = deploymentSchema.extend({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  registryAddress: address,
  quoteSigner: address,
  treasury: address,
});
export class LocalBlockchain {
  readonly client;
  get publicRpcUrl() {
    return process.env.PUBLIC_ORIGIN ? process.env.PUBLIC_ORIGIN + '/rpc' : this.rpcUrl;
  }
  constructor(
    private dataDir: string,
    readonly rpcUrl = process.env.ARTGUARD_RPC_URL || 'http://127.0.0.1:8545',
  ) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpcUrl))
      throw new Error('Only a local development node is supported.');
    this.client = createPublicClient({
      chain: localChain,
      transport: http(rpcUrl, { retryCount: 0, timeout: 2000 }),
      pollingInterval: 1000,
    });
  }
  async status(): Promise<ChainStatus> {
    let deployment: Deployment | null = null;
    try {
      deployment = deploymentSchema.parse(
        JSON.parse(await readFile(join(this.dataDir, 'chain', 'registry.json'), 'utf8')),
      ) as Deployment;
    } catch {
      return {
        ready: false,
        chainId: 31337,
        name: localChain.name,
        rpcUrl: this.publicRpcUrl,
        deployment: null,
        message: 'Local blockchain is not set up. Start npm run chain in the project folder.',
      };
    }
    try {
      const chainId = await this.client.getChainId();
      if (chainId !== 31337) throw new Error('Wrong chain');
      const instance = await this.client.readContract({
        address: deployment.address,
        abi: registryAbi,
        functionName: 'instanceId',
      });
      if (instance !== deployment.instanceId) throw new Error('Registry changed');
      return {
        ready: true,
        chainId: 31337,
        name: localChain.name,
        rpcUrl: this.publicRpcUrl,
        deployment,
        message: 'Local blockchain connected. Test ETH only.',
      };
    } catch {
      return {
        ready: false,
        chainId: 31337,
        name: localChain.name,
        rpcUrl: this.publicRpcUrl,
        deployment,
        message:
          'Local blockchain is offline or its registry changed. Start npm run chain and retry.',
      };
    }
  }
  async requireReady() {
    const status = await this.status();
    if (!status.ready || !status.deployment) throw new HttpError(503, status.message);
    return status.deployment;
  }
  async fund(address: Address, minimumBalance = 0n) {
    await this.requireReady();
    const balance = await this.client.getBalance({ address });
    if (minimumBalance < 0n || minimumBalance > parseEther('30000'))
      throw new HttpError(400, 'Invalid local test funding amount.');
    if (balance >= (minimumBalance > parseEther('2') ? minimumBalance : parseEther('2')))
      throw new HttpError(409, 'This wallet already has enough test ETH.');
    const wallet = createWalletClient({ chain: localChain, transport: http(this.rpcUrl) });
    const [account] = await wallet.getAddresses();
    const needed = minimumBalance > balance ? minimumBalance - balance : 0n;
    const value = needed > parseEther('1') ? needed : parseEther('1');
    if ((await this.client.getBalance({ address: account })) < value + parseEther('0.01')) {
      // This service is restricted to the verified local Anvil instance. Mint disposable faucet funds there.
      const test = createTestClient({
        chain: localChain,
        mode: 'anvil',
        transport: http(this.rpcUrl),
      });
      await test.setBalance({ address: account, value: parseEther('1000000') });
    }
    const hash = await wallet.sendTransaction({ account, to: address, value });
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 20000 });
    if (receipt.status !== 'success')
      throw new HttpError(502, 'Test funding failed. Please try again.');
    return hash;
  }
  async marketplaceStatus(target?: Address): Promise<MarketStatus> {
    const registry = await this.status();
    if (!registry.ready || !registry.deployment)
      return { ready: false, deployment: null, message: registry.message };
    try {
      const current = marketSchema.parse(
        JSON.parse(await readFile(join(this.dataDir, 'chain', 'marketplace.json'), 'utf8')),
      ) as MarketDeployment;
      let history: MarketDeployment[] = [];
      try {
        history = z
          .array(marketSchema)
          .parse(
            JSON.parse(
              await readFile(join(this.dataDir, 'chain', 'marketplace-history.json'), 'utf8'),
            ),
          ) as MarketDeployment[];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      let term: MarketDeployment | null = null;
      try {
        term = marketSchema.parse(
          JSON.parse(await readFile(join(this.dataDir, 'chain', 'term-marketplace.json'), 'utf8')),
        ) as MarketDeployment;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      let escrow: MarketDeployment | null = null;
      try {
        escrow = marketSchema.parse(
          JSON.parse(
            await readFile(join(this.dataDir, 'chain', 'escrow-marketplace.json'), 'utf8'),
          ),
        ) as MarketDeployment;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const contracts = [
        current,
        ...history,
        ...(term ? [term] : []),
        ...(escrow ? [escrow] : []),
      ].filter(
        (m, index, all) =>
          m.instanceId === registry.deployment!.instanceId &&
          all.findIndex((other) => other.address.toLowerCase() === m.address.toLowerCase()) ===
            index,
      );
      const saved = target
        ? contracts.find((m) => m.address.toLowerCase() === target.toLowerCase())
        : current;
      if (!saved) throw new Error('Marketplace is not in this local chain history');
      const [instance, registryAddress, signer, treasury] = await Promise.all([
        this.client.readContract({
          address: saved.address,
          abi: marketplaceAbi,
          functionName: 'instanceId',
        }),
        this.client.readContract({
          address: saved.address,
          abi: marketplaceAbi,
          functionName: 'registry',
        }),
        this.client.readContract({
          address: saved.address,
          abi: marketplaceAbi,
          functionName: 'quoteSigner',
        }),
        this.client.readContract({
          address: saved.address,
          abi: marketplaceAbi,
          functionName: 'treasury',
        }),
      ]);
      if (
        instance !== registry.deployment.instanceId ||
        saved.instanceId !== instance ||
        registryAddress.toLowerCase() !== registry.deployment.address.toLowerCase() ||
        registryAddress.toLowerCase() !== saved.registryAddress.toLowerCase() ||
        signer.toLowerCase() !== saved.quoteSigner.toLowerCase() ||
        treasury.toLowerCase() !== saved.treasury.toLowerCase()
      )
        throw new Error('Marketplace mismatch');
      if (
        saved.version >= 2 &&
        (await this.client.readContract({
          address: saved.address,
          abi: marketplaceAbi,
          functionName: 'version',
        })) !== BigInt(saved.version)
      )
        throw new Error('Marketplace version mismatch');
      return {
        ready: true,
        deployment: saved,
        contracts,
        message: 'Local license marketplace connected. Test ETH only.',
      };
    } catch {
      return {
        ready: false,
        deployment: null,
        message:
          'Local license marketplace is unavailable. Restart npm run chain to deploy or restore it.',
      };
    }
  }
  async requireMarketplace(target?: Address) {
    const status = await this.marketplaceStatus(target);
    if (!status.ready || !status.deployment) throw new HttpError(503, status.message);
    return status.deployment;
  }
  async signQuote(deployment: MarketDeployment, quote: LicenseQuote) {
    const wallet = createWalletClient({ chain: localChain, transport: http(this.rpcUrl) });
    return wallet.signTypedData({
      account: deployment.quoteSigner,
      domain: quoteDomain(deployment.address, deployment.version),
      types: deployment.version >= 3 ? termQuoteTypes : quoteTypes,
      primaryType: 'Quote',
      message: contractQuote(quote),
    });
  }
  async subscriptionDeployment() {
    const registry = await this.requireReady();
    try {
      const saved = deploymentSchema
        .extend({ quoteSigner: address, treasury: address })
        .parse(
          JSON.parse(await readFile(join(this.dataDir, 'chain', 'subscriptions.json'), 'utf8')),
        ) as {
        chainId: 31337;
        address: Address;
        instanceId: `0x${string}`;
        quoteSigner: Address;
        treasury: Address;
        transactionHash: `0x${string}`;
      };
      const [instance, signer, treasury] = await Promise.all([
        this.client.readContract({
          address: saved.address,
          abi: subscriptionAbi,
          functionName: 'instanceId',
        }),
        this.client.readContract({
          address: saved.address,
          abi: subscriptionAbi,
          functionName: 'quoteSigner',
        }),
        this.client.readContract({
          address: saved.address,
          abi: subscriptionAbi,
          functionName: 'treasury',
        }),
      ]);
      if (
        instance !== registry.instanceId ||
        saved.instanceId !== instance ||
        signer.toLowerCase() !== saved.quoteSigner.toLowerCase() ||
        treasury.toLowerCase() !== saved.treasury.toLowerCase()
      )
        throw new Error('Subscription deployment mismatch');
      return saved;
    } catch {
      throw new HttpError(
        503,
        'Local subscription payments are unavailable. Restart npm run chain to deploy or restore the contract.',
      );
    }
  }
  async signSubscription(
    deployment: Awaited<ReturnType<LocalBlockchain['subscriptionDeployment']>>,
    quote: SubscriptionQuote,
  ) {
    const wallet = createWalletClient({ chain: localChain, transport: http(this.rpcUrl) });
    return wallet.signTypedData({
      account: deployment.quoteSigner,
      domain: subscriptionDomain(deployment.address),
      types: subscriptionTypes,
      primaryType: 'Quote',
      message: subscriptionMessage(quote),
    });
  }
  async promotionDeployment() {
    const registry = await this.requireReady();
    try {
      const saved = deploymentSchema
        .extend({ quoteSigner: address, treasury: address })
        .parse(
          JSON.parse(await readFile(join(this.dataDir, 'chain', 'promotions.json'), 'utf8')),
        ) as Awaited<ReturnType<LocalBlockchain['subscriptionDeployment']>>;
      const [instance, signer, treasury] = await Promise.all([
        this.client.readContract({
          address: saved.address,
          abi: promotionAbi,
          functionName: 'instanceId',
        }),
        this.client.readContract({
          address: saved.address,
          abi: promotionAbi,
          functionName: 'quoteSigner',
        }),
        this.client.readContract({
          address: saved.address,
          abi: promotionAbi,
          functionName: 'treasury',
        }),
      ]);
      if (
        instance !== registry.instanceId ||
        saved.instanceId !== instance ||
        signer.toLowerCase() !== saved.quoteSigner.toLowerCase() ||
        treasury.toLowerCase() !== saved.treasury.toLowerCase()
      )
        throw new Error('Promotion deployment mismatch');
      return saved;
    } catch {
      throw new HttpError(
        503,
        'Local promotion payments are unavailable. Run npm run chain:promotions with the local chain running.',
      );
    }
  }
  async signPromotion(
    deployment: Awaited<ReturnType<LocalBlockchain['promotionDeployment']>>,
    quote: PromotionQuote,
  ) {
    return createWalletClient({ chain: localChain, transport: http(this.rpcUrl) }).signTypedData({
      account: deployment.quoteSigner,
      domain: promotionDomain(deployment.address),
      types: promotionTypes,
      primaryType: 'Quote',
      message: promotionMessage(quote),
    });
  }
}
