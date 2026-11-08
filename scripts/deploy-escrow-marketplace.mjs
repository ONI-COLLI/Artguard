import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAbi } from 'viem';
import { compileContract } from './contract.mjs';
export async function ensureEscrowMarketplace(directory, registry, previous, client, wallet) {
  const file = join(directory, 'escrow-marketplace.json');
  const abi = parseAbi([
    'function instanceId() view returns(bytes32)',
    'function previousMarketplace() view returns(address)',
    'function version() view returns(uint256)',
    'function quoteSigner() view returns(address)',
  ]);
  const [account] = await wallet.getAddresses();
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const [instance, version, parent, signer] = await Promise.all(
      ['instanceId', 'version', 'previousMarketplace', 'quoteSigner'].map((functionName) =>
        client.readContract({ address: saved.address, abi, functionName }),
      ),
    );
    if (
      instance !== registry.instanceId ||
      version !== 4n ||
      parent.toLowerCase() !== previous.address.toLowerCase() ||
      signer.toLowerCase() !== account.toLowerCase()
    )
      throw new Error('Restore the original escrow deployment; its state has been kept.');
    return saved;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const contract = await compileContract('EscrowLicenseMarketplace');
  const transactionHash = await wallet.deployContract({
    account,
    ...contract,
    args: [registry.address, account, previous.treasury, previous.address],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== 'success' || !receipt.contractAddress)
    throw new Error('Escrow marketplace deployment failed.');
  const deployment = { ...previous, version: 4, address: receipt.contractAddress, transactionHash };
  await writeFile(file + '.tmp', JSON.stringify(deployment, null, 2));
  await rename(file + '.tmp', file);
  return deployment;
}
