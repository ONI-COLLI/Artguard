import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAbi, zeroAddress } from 'viem';
import { compileMarketplace } from './contract.mjs';
async function save(file, data) {
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(data, null, 2));
  await rename(temporary, file);
}
export async function ensureMarketplace(directory, registry, client, wallet) {
  const file = join(directory, 'marketplace.json');
  const abi = parseAbi([
    'function instanceId() view returns (bytes32)',
    'function registry() view returns (address)',
    'function quoteSigner() view returns (address)',
    'function version() view returns (uint256)',
  ]);
  const [account] = await wallet.getAddresses();
  let previous = zeroAddress,
    saved;
  try {
    saved = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (saved?.instanceId === registry.instanceId) {
    // Fail closed when an existing deployment cannot be checked. Never discard its balances.
    const [instance, registryAddress, signer] = await Promise.all([
      client.readContract({ address: saved.address, abi, functionName: 'instanceId' }),
      client.readContract({ address: saved.address, abi, functionName: 'registry' }),
      client.readContract({ address: saved.address, abi, functionName: 'quoteSigner' }),
    ]);
    if (
      instance !== registry.instanceId ||
      registryAddress.toLowerCase() !== registry.address.toLowerCase() ||
      signer.toLowerCase() !== account.toLowerCase()
    )
      throw new Error(
        'Existing marketplace does not match the registry or signer. Restore its local chain before continuing.',
      );
    const version = saved.version ?? 1;
    if (version === 2) {
      if (
        (await client.readContract({ address: saved.address, abi, functionName: 'version' })) !== 2n
      )
        throw new Error('Marketplace version mismatch.');
      return saved;
    }
    if (version !== 1) throw new Error('Unsupported existing marketplace version.');
    previous = saved.address;
    const historyFile = join(directory, 'marketplace-history.json');
    let history = [];
    try {
      history = JSON.parse(await readFile(historyFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (
      !history.some(
        (entry) =>
          entry.address.toLowerCase() === saved.address.toLowerCase() &&
          entry.instanceId === saved.instanceId,
      )
    )
      history.push({ ...saved, version: 1 });
    // Archive before activating the successor. Old funds remain independently withdrawable.
    await save(historyFile, history);
  }
  const contract = await compileMarketplace();
  const transactionHash = await wallet.deployContract({
    account,
    ...contract,
    args: [registry.address, account, account, previous],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== 'success' || !receipt.contractAddress)
    throw new Error('License marketplace deployment failed.');
  const deployment = {
    version: 2,
    chainId: 31337,
    address: receipt.contractAddress,
    instanceId: registry.instanceId,
    registryAddress: registry.address,
    quoteSigner: account,
    treasury: account,
    transactionHash,
  };
  await save(file, deployment);
  return deployment;
}
