import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAbi } from 'viem';
import { compileContract } from './contract.mjs';
export async function ensurePromotions(directory, registry, client, wallet) {
  const file = join(directory, 'promotions.json'),
    [account] = await wallet.getAddresses();
  let saved;
  try {
    saved = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (saved?.instanceId === registry.instanceId) {
    const abi = parseAbi([
      'function instanceId() view returns(bytes32)',
      'function quoteSigner() view returns(address)',
      'function treasury() view returns(address)',
    ]);
    const [instance, signer, treasury] = await Promise.all(
      ['instanceId', 'quoteSigner', 'treasury'].map((functionName) =>
        client.readContract({ address: saved.address, abi, functionName }),
      ),
    );
    if (
      saved.chainId !== 31337 ||
      instance !== registry.instanceId ||
      signer.toLowerCase() !== saved.quoteSigner?.toLowerCase() ||
      treasury.toLowerCase() !== saved.treasury?.toLowerCase()
    )
      throw new Error('Existing promotion contract deployment mismatch.');
    return saved;
  }
  const compiled = await compileContract('PromotionPayments');
  const transactionHash = await wallet.deployContract({
    account,
    ...compiled,
    args: [registry.instanceId, account, account],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== 'success' || !receipt.contractAddress)
    throw new Error('Promotion contract deployment failed.');
  const deployment = {
    chainId: 31337,
    address: receipt.contractAddress,
    instanceId: registry.instanceId,
    quoteSigner: account,
    treasury: account,
    transactionHash,
  };
  await writeFile(file + '.tmp', JSON.stringify(deployment, null, 2));
  await rename(file + '.tmp', file);
  return deployment;
}
