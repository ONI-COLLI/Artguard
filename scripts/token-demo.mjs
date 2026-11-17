import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  sha256,
  stringToHex,
  zeroAddress,
} from 'viem';
import { anvilPath } from './anvil.mjs';
import { compileContract, compileRegistry } from './contract.mjs';
import { localChain } from '../shared/blockchain.ts';
import { escrowAbi, quoteDomain, termQuoteTypes } from '../shared/marketplace.ts';

const registryCode = await compileRegistry();
const escrowCode = await compileContract('EscrowLicenseMarketplace');
const pointsCode = await compileContract('PrototypePoints');
const nftCode = await compileContract('PrototypeLicenseReceipt');

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const { port } = probe.address();
await new Promise((resolve) => probe.close(resolve));

const node = spawn(
  anvilPath(),
  [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--chain-id',
    String(localChain.id),
    '--accounts',
    '3',
    '--silent',
  ],
  { stdio: 'ignore', windowsHide: true },
);
try {
  await once(node, 'spawn');
  const transport = http(`http://127.0.0.1:${port}`, { retryCount: 0, timeout: 1000 });
  const chain = createPublicClient({ chain: localChain, transport, pollingInterval: 100 });
  const wallet = createWalletClient({ chain: localChain, transport });
  let ready = false;
  for (let attempt = 0; attempt < 50 && node.exitCode === null; attempt++) {
    if ((await chain.getChainId().catch(() => undefined)) === localChain.id) {
      ready = true;
      break;
    }
    await delay(100);
  }
  assert.ok(ready, 'Disposable Anvil failed to start.');
  const [deployer, seller, buyer] = await wallet.getAddresses();
  assert.ok(deployer && seller && buyer);

  async function confirmed(hash) {
    const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 8000 });
    assert.equal(receipt.status, 'success', `Transaction reverted: ${hash}`);
    return receipt;
  }
  async function deploy(compiled, args) {
    const receipt = await confirmed(
      await wallet.deployContract({
        ...compiled,
        args,
        account: deployer,
      }),
    );
    assert.ok(receipt.contractAddress);
    return { address: receipt.contractAddress, receipt };
  }
  async function write(account, deployment, contract, functionName, args, value) {
    return confirmed(
      await wallet.writeContract({
        account,
        address: deployment.address,
        abi: contract.abi,
        functionName,
        args,
        value,
      }),
    );
  }
  function evidence(receipt) {
    return {
      hash: receipt.transactionHash,
      block: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
    };
  }

  const instanceId = `0x${randomBytes(32).toString('hex')}`;
  const registry = await deploy(registryCode, [instanceId]);
  const escrow = await deploy(escrowCode, [registry.address, deployer, deployer, zeroAddress]);
  const fileHash = sha256(stringToHex('ArtGuard synthetic token-demo file'));
  const termsHash = sha256(stringToHex('ArtGuard synthetic token-demo licence'));
  const licenseType = 1;
  await write(seller, registry, registryCode, 'registerArtwork', [fileHash, termsHash]);
  const quote = {
    id: sha256(stringToHex('ArtGuard synthetic token-demo order')),
    buyer,
    seller,
    fileHash,
    licenseType,
    termsHash,
    amount: parseEther('0.001'),
    feeBps: 1000,
    expiresAt: (await chain.getBlock()).timestamp + 600n,
    instanceId,
    recipients: [],
    shares: [],
    durationSeconds: 30n * 86400n,
  };
  const nft = await deploy(nftCode, [escrow.address]);
  const claim = {
    account: buyer,
    address: nft.address,
    abi: nftCode.abi,
    functionName: 'claim',
    args: [fileHash, licenseType],
  };
  const revertsWith = (name) => (error) =>
    error instanceof BaseError &&
    error.walk((cause) => cause instanceof ContractFunctionRevertedError)?.data?.errorName === name;
  await assert.rejects(chain.simulateContract(claim), revertsWith('InactiveLicense'));
  const signature = await wallet.signTypedData({
    account: deployer,
    domain: quoteDomain(escrow.address, 4),
    primaryType: 'Quote',
    types: termQuoteTypes,
    message: quote,
  });
  await write(buyer, escrow, escrowCode, 'buyLicenses', [[quote], [signature]], quote.amount);
  await write(seller, escrow, escrowCode, 'markDelivered', [quote.id]);
  const release = await write(buyer, escrow, escrowCode, 'release', [quote.id]);
  assert.equal(
    await chain.readContract({
      address: escrow.address,
      abi: escrowAbi,
      functionName: 'hasLicense',
      args: [buyer, fileHash, licenseType],
    }),
    true,
  );

  const points = await deploy(pointsCode, [buyer]);
  const minted = await write(buyer, nft, nftCode, 'claim', [fileHash, licenseType]);
  const tokenId = BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes32' }, { type: 'uint8' }],
        [buyer, fileHash, licenseType],
      ),
    ),
  );
  const balance = await chain.readContract({
    address: points.address,
    abi: pointsCode.abi,
    functionName: 'balanceOf',
    args: [buyer],
  });
  const owner = await chain.readContract({
    address: nft.address,
    abi: nftCode.abi,
    functionName: 'ownerOf',
    args: [tokenId],
  });
  const [pointsMint] = parseEventLogs({
    abi: pointsCode.abi,
    eventName: 'Transfer',
    logs: points.receipt.logs,
  });
  const [nftMint] = parseEventLogs({ abi: nftCode.abi, eventName: 'Transfer', logs: minted.logs });
  assert.equal(balance, parseEther('100'));
  assert.equal(owner.toLowerCase(), buyer.toLowerCase());
  assert.equal(pointsMint.args.from, zeroAddress);
  assert.equal(pointsMint.args.to.toLowerCase(), buyer.toLowerCase());
  assert.equal(pointsMint.args.value, balance);
  assert.equal(nftMint.args.from, zeroAddress);
  assert.equal(nftMint.args.to.toLowerCase(), buyer.toLowerCase());
  assert.equal(nftMint.args.tokenId, tokenId);
  await assert.rejects(chain.simulateContract(claim), revertsWith('ReceiptAlreadyClaimed'));
  await assert.rejects(
    chain.simulateContract({
      account: buyer,
      address: nft.address,
      abi: nftCode.abi,
      functionName: 'transferFrom',
      args: [buyer, seller, tokenId],
    }),
    revertsWith('NonTransferable'),
  );

  console.log(
    JSON.stringify({
      chainId: localChain.id,
      buyer,
      fileHash,
      licenseType,
      release: evidence(release),
      erc20: {
        address: points.address,
        balance: formatUnits(balance, 18),
        ...evidence(points.receipt),
      },
      erc721: { address: nft.address, tokenId: tokenId.toString(), owner, ...evidence(minted) },
    }),
  );
} finally {
  if (node.pid && node.exitCode === null && node.signalCode === null) {
    const exited = once(node, 'exit');
    node.kill();
    await exited;
  }
}
