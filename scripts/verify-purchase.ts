// Read-only verification directly against Anvil. No database, app API or wallet signing.
import {
  createPublicClient,
  decodeFunctionData,
  formatEther,
  http,
  parseEventLogs,
  type Hex,
} from 'viem';
import { marketplaceAbi, termMarketplaceAbi } from '../shared/marketplace.js';

const rpc = 'http://127.0.0.1:8545';
const hash = process.argv[2];
const same = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
function check(label: string, passed: boolean) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
  if (!passed) throw new Error(label);
}

async function verify() {
  if (!/^0x[\da-fA-F]{64}$/.test(hash || ''))
    throw new Error(
      'Usage: npm run verify:purchase -- <64-digit transaction hash starting with 0x>',
    );
  const client = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 5000 }) });
  console.log(`Direct blockchain verification: ${rpc}`);
  console.log(`Transaction: ${hash}\n`);
  check('Connected to local chain 31337', (await client.getChainId()) === 31337);

  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: hash as Hex }),
    client.getTransactionReceipt({ hash: hash as Hex }),
  ]);
  check('Transaction succeeded on-chain', receipt.status === 'success');
  check(
    'Transaction and receipt match',
    same(tx.hash, receipt.transactionHash) &&
      same(tx.blockHash, receipt.blockHash) &&
      same(tx.from, receipt.from) &&
      same(tx.to, receipt.to),
  );
  if (!tx.to) throw new Error('This is a contract deployment, not a license purchase.');
  const [block, code] = await Promise.all([
    client.getBlock({ blockHash: receipt.blockHash }),
    client.getCode({ address: tx.to }),
  ]);
  check(
    'Transaction is included in the reported block',
    block.transactions.some((entry) => same(entry, hash)),
  );
  check('Destination has deployed smart-contract code', !!code && code !== '0x');
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Block hash: ${receipt.blockHash}`);
  console.log(`Buyer: ${tx.from}`);
  console.log(`Contract: ${tx.to}`);
  console.log(`Payment: ${formatEther(tx.value)} test ETH`);
  console.log(
    `Gas paid separately: ${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} test ETH\n`,
  );

  const version = await client.readContract({
    address: tx.to,
    abi: marketplaceAbi,
    functionName: 'version',
  });
  if (version === 4n)
    throw new Error(
      'This is an escrow transaction. Open /#/blockchain-demo and use Verify a real escrow payment with the deposit hash.',
    );
  const decoded = decodeFunctionData({
    abi: version === 3n ? termMarketplaceAbi : marketplaceAbi,
    data: tx.input,
  });
  if (decoded.functionName !== 'buyLicenses')
    throw new Error('This transaction did not call buyLicenses().');
  const quotes = decoded.args[0];
  check('Transaction calls buyLicenses() with a nonempty package', quotes.length > 0);
  check(
    'Transferred value equals the total signed price',
    quotes.reduce((total, q) => total + q.amount, 0n) === tx.value,
  );
  const logs = receipt.logs.filter((log) => same(log.address, tx.to));
  const purchases = parseEventLogs({ abi: marketplaceAbi, eventName: 'LicensePurchased', logs });
  const periods = parseEventLogs({ abi: termMarketplaceAbi, eventName: 'LicenseValidity', logs });
  const allocations = parseEventLogs({ abi: marketplaceAbi, eventName: 'RevenueAllocated', logs });
  check('One LicensePurchased event exists per license', purchases.length === quotes.length);
  const treasury = await client.readContract({
    address: tx.to,
    abi: marketplaceAbi,
    functionName: 'treasury',
  });

  for (const q of quotes) {
    console.log(`\nLicense quote: ${q.id}`);
    console.log(`File fingerprint: ${q.fileHash}`);
    console.log(
      `License type: ${{ 1: 'Personal', 2: 'Commercial', 3: 'Extended' }[q.licenseType] || q.licenseType}`,
    );
    const purchase = purchases.find((event) => same(event.args.quoteId, q.id))?.args;
    const fee = (q.amount * BigInt(q.feeBps)) / 10000n;
    check(
      'License event matches the buyer, seller, file, terms, price and fee',
      !!purchase &&
        same(q.buyer, tx.from) &&
        same(purchase.buyer, q.buyer) &&
        same(purchase.seller, q.seller) &&
        same(purchase.fileHash, q.fileHash) &&
        same(purchase.termsHash, q.termsHash) &&
        purchase.licenseType === q.licenseType &&
        purchase.amount === q.amount &&
        purchase.fee === fee,
    );
    const net = q.amount - fee;
    if (version === 3n) {
      const period = periods.find((e) => same(e.args.quoteId, q.id))?.args;
      const duration =
        'durationSeconds' in q && typeof q.durationSeconds === 'bigint' ? q.durationSeconds : 0n;
      check(
        'On-chain validity matches the signed license period',
        !!period &&
          period.validFrom === block.timestamp &&
          period.validUntil === (duration ? period.validFrom + duration : 18446744073709551615n),
      );
      console.log(
        'Valid until:',
        period!.validUntil === 18446744073709551615n
          ? 'Perpetual'
          : new Date(Number(period!.validUntil) * 1000).toISOString(),
      );
    }
    let coauthorTotal = 0n;
    const expected = q.recipients.map((recipient, index) => {
      const amount = (net * BigInt(q.shares[index])) / 10000n;
      coauthorTotal += amount;
      return { recipient, amount, shareBps: q.shares[index], role: 'Co-author' };
    });
    expected.push({
      recipient: q.seller,
      amount: net - coauthorTotal,
      shareBps: 10000 - q.shares.reduce((sum, share) => sum + share, 0),
      role: 'Creator',
    });
    const recorded = allocations.filter((event) => same(event.args.quoteId, q.id));
    check(
      'RevenueAllocated events match every signed revenue share',
      recorded.length === expected.length &&
        expected.every((entry) =>
          recorded.some(
            (event) =>
              same(event.args.recipient, entry.recipient) &&
              event.args.amount === entry.amount &&
              event.args.shareBps === entry.shareBps,
          ),
        ),
    );

    const [owned, used] = await Promise.all([
      client.readContract({
        address: tx.to,
        abi: marketplaceAbi,
        functionName: 'hasLicense',
        args: [q.buyer, q.fileHash, q.licenseType],
      }),
      client.readContract({
        address: tx.to,
        abi: marketplaceAbi,
        functionName: 'usedQuotes',
        args: [q.id],
      }),
    ]);
    if (version === 3n) {
      const expiry = await client.readContract({
        address: tx.to,
        abi: termMarketplaceAbi,
        functionName: 'licenseExpiry',
        args: [q.buyer, q.fileHash, q.licenseType],
      });
      const now = (await client.getBlock()).timestamp,
        period = periods.find((e) => same(e.args.quoteId, q.id))!.args;
      check(
        'Current license state matches the recorded license period',
        expiry >= period.validUntil && owned === expiry > now,
      );
      console.log('Wallet license currently active:', owned);
    } else check('Contract state: perpetual license ownership is recorded', owned);
    check('Contract state: this quote has been consumed', used);
    console.table([
      { role: 'Platform', wallet: treasury, testETH: formatEther(fee) },
      ...expected.map((entry) => ({
        role: entry.role,
        wallet: entry.recipient,
        testETH: formatEther(entry.amount),
      })),
    ]);
  }
  console.log(
    '\nVERIFIED: block membership, successful receipt, contract state and revenue events match.',
  );
  console.log(
    'These are purchase allocations, not current wallet balances. No transaction was sent.',
  );
  console.log(
    'This is a real transaction in a local EVM test network, not a public Ethereum payment.',
  );
}

verify().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
