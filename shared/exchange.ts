export type DisplayCurrency = string;
export type RateSource = 'Frankfurter' | 'CoinGecko';
export interface ExchangeRate {
  code: string;
  name: string;
  kind: 'fiat' | 'crypto';
  numerator: string;
  denominator: string;
  decimals: number;
  observedAt: string;
  source: RateSource;
}
export type RateTable = Record<string, ExchangeRate>;
export interface RateProvider {
  source: RateSource;
  fetchedAt: string | null;
  status: 'current' | 'cached' | 'unavailable';
  error: string | null;
}
export interface ExchangeSnapshot {
  base: 'USD';
  fetchedAt: string;
  rates: RateTable;
  providers: RateProvider[];
}
export const cryptoAssets = [
  ['BTC', 'Bitcoin', 'bitcoin'],
  ['ETH', 'Ethereum', 'ethereum'],
  ['USDT', 'Tether', 'tether'],
  ['USDC', 'USD Coin', 'usd-coin'],
  ['BNB', 'BNB', 'binancecoin'],
  ['SOL', 'Solana', 'solana'],
  ['XRP', 'XRP', 'ripple'],
  ['DOGE', 'Dogecoin', 'dogecoin'],
  ['ADA', 'Cardano', 'cardano'],
  ['TRX', 'TRON', 'tron'],
  ['AVAX', 'Avalanche', 'avalanche-2'],
  ['DOT', 'Polkadot', 'polkadot'],
  ['LINK', 'Chainlink', 'chainlink'],
  ['LTC', 'Litecoin', 'litecoin'],
  ['BCH', 'Bitcoin Cash', 'bitcoin-cash'],
  ['XLM', 'Stellar', 'stellar'],
  ['TON', 'Toncoin', 'the-open-network'],
  ['SHIB', 'Shiba Inu', 'shiba-inu'],
  ['UNI', 'Uniswap', 'uniswap'],
  ['NEAR', 'NEAR Protocol', 'near'],
  ['ATOM', 'Cosmos Hub', 'cosmos'],
  ['ICP', 'Internet Computer', 'internet-computer'],
  ['ETC', 'Ethereum Classic', 'ethereum-classic'],
  ['FIL', 'Filecoin', 'filecoin'],
  ['APT', 'Aptos', 'aptos'],
  ['SUI', 'Sui', 'sui'],
  ['ARB', 'Arbitrum', 'arbitrum'],
  ['OP', 'Optimism', 'optimism'],
  ['INJ', 'Injective', 'injective-protocol'],
  ['HBAR', 'Hedera', 'hedera-hashgraph'],
  ['VET', 'VeChain', 'vechain'],
  ['ALGO', 'Algorand', 'algorand'],
  ['XTZ', 'Tezos', 'tezos'],
  ['AAVE', 'Aave', 'aave'],
  ['DAI', 'Dai', 'dai'],
  ['USDE', 'Ethena USDe', 'ethena-usde'],
  ['POL', 'Polygon', 'polygon-ecosystem-token'],
  ['PEPE', 'Pepe', 'pepe'],
  ['RENDER', 'Render', 'render-token'],
  ['GRT', 'The Graph', 'the-graph'],
  ['LDO', 'Lido DAO', 'lido-dao'],
  ['STX', 'Stacks', 'blockstack'],
  ['KAS', 'Kaspa', 'kaspa'],
  ['TAO', 'Bittensor', 'bittensor'],
  ['XMR', 'Monero', 'monero'],
  ['ZEC', 'Zcash', 'zcash'],
  ['DASH', 'Dash', 'dash'],
  ['BAT', 'Basic Attention Token', 'basic-attention-token'],
  ['CRV', 'Curve DAO', 'curve-dao-token'],
  ['SEI', 'Sei', 'sei-network'],
  ['TIA', 'Celestia', 'celestia'],
  ['BONK', 'Bonk', 'bonk'],
  ['FLOKI', 'Floki', 'floki'],
  ['RUNE', 'THORChain', 'thorchain'],
  ['JUP', 'Jupiter', 'jupiter-exchange-solana'],
  ['WLD', 'Worldcoin', 'worldcoin-wld'],
  ['ENA', 'Ethena', 'ethena'],
  ['IMX', 'Immutable', 'immutable-x'],
  ['SNX', 'Synthetix', 'havven'],
  ['COMP', 'Compound', 'compound-governance-token'],
] as const;

export interface Fraction {
  n: bigint;
  d: bigint;
}
export function decimalFraction(value: string): Fraction {
  const match = /^([+-]?)(\d{1,80})(?:\.(\d{0,80}))?(?:e([+-]?\d{1,3}))?$/i.exec(value);
  if (!match) throw new Error('Invalid decimal amount.');
  const exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  if (Math.abs(exponent) > 100) throw new Error('Decimal amount is out of range.');
  const n = BigInt((match[1] === '-' ? '-' : '') + match[2] + (match[3] || ''));
  return exponent >= 0
    ? { n: n * 10n ** BigInt(exponent), d: 1n }
    : { n, d: 10n ** BigInt(-exponent) };
}
export function rateFraction(code: string, rates: RateTable): Fraction | null {
  if (code === 'USD') return { n: 1n, d: 1n };
  const rate = rates[code];
  return rate ? { n: BigInt(rate.numerator), d: BigInt(rate.denominator) } : null;
}
export function convertFraction(
  amount: Fraction,
  from: string,
  to: string,
  rates: RateTable,
): Fraction | null {
  const source = rateFraction(from, rates),
    target = rateFraction(to, rates);
  return source && target
    ? { n: amount.n * source.d * target.n, d: amount.d * source.n * target.d }
    : null;
}
export function roundedUnits(value: Fraction, decimals: number) {
  const sign = value.n < 0n ? -1n : 1n;
  return sign * ((value.n * sign * 10n ** BigInt(decimals) + value.d / 2n) / value.d);
}
export function decimalString(value: Fraction, decimals: number) {
  const units = roundedUnits(value, decimals),
    abs = units < 0n ? -units : units,
    scale = 10n ** BigInt(decimals);
  const tail = decimals
    ? String(abs % scale)
        .padStart(decimals, '0')
        .replace(/0+$/, '')
    : '';
  return (units < 0n ? '-' : '') + String(abs / scale) + (tail ? '.' + tail : '');
}
