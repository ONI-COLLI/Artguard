import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { encodeAbiParameters, isAddress, keccak256, type Hex } from 'viem';
import receiptSource from '../../contracts/PrototypeLicenseReceipt.sol?raw';
import { both, translated, type CodeLanguage, type Translation } from '../lib/demo-language';
import { api } from '../lib/api';

type Receipt = { hash: string; block: string; blockHash: string };
type TokenRun = {
  chainId: number;
  buyer: string;
  fileHash: string;
  licenseType: number;
  release: Receipt;
  erc20: Receipt & { address: string; balance: string };
  erc721: Receipt & { address: string; tokenId: string; owner: string };
};

const claimCode = receiptSource
  .slice(receiptSource.indexOf('    function claim'), receiptSource.indexOf('    function approve'))
  .trimEnd()
  .split('\n')
  .map((line) => line.slice(4))
  .join('\n');

export default function TokenExample({
  language,
  backHref,
  canMint,
}: {
  language: CodeLanguage;
  backHref: string;
  canMint: boolean;
}) {
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const t = (value: Translation) => translated(value, language);
  const issuance = useMutation({
    mutationFn: () =>
      api<TokenRun>('/admin/technical/token-demo', {
        method: 'POST',
        signal: AbortSignal.timeout(120_000),
      }),
  });
  const run = issuance.data;

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const buyer = String(fields.get('buyer')).trim();
    const fileHash = String(fields.get('fileHash')).trim();
    const licenseType = Number(fields.get('licenseType'));
    if (!isAddress(buyer) || !/^0x[0-9a-f]{64}$/i.test(fileHash)) {
      setError(
        t(
          both(
            'Enter a wallet address and a 32-byte file hash.',
            'Введи адрес кошелька и 32-байтовый хеш файла.',
          ),
        ),
      );
      return;
    }
    const encoded = encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }, { type: 'uint8' }],
      [buyer, fileHash as Hex, licenseType],
    );
    setError('');
    setResult(BigInt(keccak256(encoded)).toString());
  }

  return (
    <section className="token-example" aria-labelledby="token-example-title">
      <Link to={backHref} className="back-link">
        {t(both('← Blockchain walkthrough', '← Разбор блокчейна'))}
      </Link>
      <h1 id="token-example-title">
        {t(both('ERC-20 and ERC-721 issuance', 'Выпуск ERC-20 и ERC-721'))}
      </h1>
      <p>
        {t(
          both(
            'ArtGuard uses native test ETH for payments. Escrow release records the buyer, file hash, licence type and expiry on the local chain.',
            'ArtGuard принимает нативный test ETH. При завершении escrow сеть фиксирует кошелёк покупателя, хеш файла, тип и срок лицензии.',
          ),
        )}
      </p>
      <p className="small-text muted">
        EscrowLicenseMarketplace.sol · <code>validUntil[key] = expiry</code>
      </p>
      <section
        className="panel form-panel token-live"
        aria-labelledby="token-live-title"
        aria-busy={issuance.isPending}
      >
        <h2 id="token-live-title">
          {t(both('Local Anvil demonstration', 'Выпуск на локальном Anvil'))}
        </h2>
        <p>
          {t(
            both(
              'Each run creates a test licence through escrow and issues 100 AGP and one NFT. The temporary node verifies both transactions and closes after the run.',
              'В каждом прогоне escrow выдаёт тестовую лицензию, затем контракты выпускают 100 AGP и один NFT. Временный узел проверяет обе транзакции и останавливается после прогона.',
            ),
          )}
        </p>
        {canMint ? (
          <button
            className="primary"
            type="button"
            disabled={issuance.isPending}
            onClick={() => issuance.mutate()}
          >
            {issuance.isPending
              ? t(both('Deploying and issuing…', 'Развёртываем контракты и выпускаем…'))
              : t(both('Issue both test tokens', 'Выпустить оба тестовых токена'))}
          </button>
        ) : (
          <p className="small-text muted">
            {t(
              both(
                'Sign in as a local technical administrator to run on-chain issuance.',
                'Для выпуска в блокчейне войди под локальным техническим администратором.',
              ),
            )}
          </p>
        )}
        {issuance.error && (
          <p role="alert" className="form-error">
            {issuance.error.message}
          </p>
        )}
        {run && (
          <div className="token-proof" aria-live="polite">
            <p role="status">
              {t(both('Issuance confirmed', 'Выпуск подтверждён'))} · Anvil {run.chainId}
            </p>
            <p>
              {t(both('Test wallet', 'Тестовый кошелёк'))} <code>{run.buyer}</code>
            </p>
            <p>
              {t(both('Licence release transaction', 'Транзакция выдачи лицензии'))}{' '}
              <code>{run.release.hash}</code>
            </p>
            <div className="token-example-grid">
              <article>
                <h3>ERC-20 · {run.erc20.balance} AGP</h3>
                <MintReceipt receipt={run.erc20} language={language} />
              </article>
              <article>
                <h3>ERC-721 · ArtGuard Prototype Receipt</h3>
                <p>
                  tokenId <code>{run.erc721.tokenId}</code>
                </p>
                <MintReceipt receipt={run.erc721} language={language} />
              </article>
            </div>
          </div>
        )}
      </section>
      <div className="token-example-grid">
        <article className="panel form-panel">
          <h2>{t(both('Minting code', 'Код выпуска'))}</h2>
          <p className="small-text muted">contracts/PrototypePoints.sol</p>
          <pre>
            <code>{'_mint(recipient, 100 ether); // 100 AGP, 18 decimals'}</code>
          </pre>
          <p>
            {t(
              both(
                'The example contract checks for an active licence, hashes its identifiers and mints one non-transferable receipt to the buyer.',
                'Пример контракта проверяет активную лицензию, хеширует её идентификаторы и выпускает одну непередаваемую квитанцию покупателю.',
              ),
            )}
          </p>
          <p className="small-text muted">contracts/PrototypeLicenseReceipt.sol</p>
          <pre>
            <code>{claimCode}</code>
          </pre>
        </article>
        <form
          className="panel form-panel"
          onSubmit={calculate}
          onChange={() => {
            setResult('');
            setError('');
          }}
        >
          <h2>{t(both('Generate an example token ID', 'Рассчитать ID токена'))}</h2>
          <p>
            {t(
              both(
                'This calculation runs in the browser. The sample data below produces the same ID as the contract formula.',
                'Расчёт выполняется в браузере. Пример ниже даёт тот же ID, что и формула в контракте.',
              ),
            )}
          </p>
          <label>
            {t(both('Buyer wallet', 'Кошелёк покупателя'))}
            <input name="buyer" defaultValue={'0x' + '11'.repeat(20)} required spellCheck={false} />
          </label>
          <label>
            {t(both('SHA-256 file hash', 'SHA-256 файла'))}
            <input
              name="fileHash"
              defaultValue={'0x' + 'ab'.repeat(32)}
              required
              spellCheck={false}
            />
          </label>
          <label>
            {t(both('Licence type', 'Тип лицензии'))}
            <select name="licenseType" defaultValue="1">
              <option value="1">{t(both('Personal', 'Личная'))}</option>
              <option value="2">{t(both('Commercial', 'Коммерческая'))}</option>
              <option value="3">{t(both('Extended', 'Расширенная'))}</option>
            </select>
          </label>
          <button className="primary" type="submit">
            {t(both('Generate token ID', 'Рассчитать tokenId'))}
          </button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {result && (
            <output className="token-id-result">
              <strong>tokenId</strong>
              <code>{result}</code>
            </output>
          )}
          <p className="small-text muted">
            {t(
              both(
                'Use the on-chain demonstration above to mint a receipt.',
                'Для выпуска квитанции используй демонстрацию в блокчейне выше.',
              ),
            )}
          </p>
        </form>
      </div>
    </section>
  );
}

function MintReceipt({
  receipt,
  language,
}: {
  receipt: Receipt & { address: string };
  language: CodeLanguage;
}) {
  const t = (value: Translation) => translated(value, language);
  return (
    <dl>
      <dt>{t(both('Contract', 'Контракт'))}</dt>
      <dd>
        <code>{receipt.address}</code>
      </dd>
      <dt>{t(both('Mint transaction', 'Транзакция выпуска'))}</dt>
      <dd>
        <code>{receipt.hash}</code>
      </dd>
      <dt>{t(both('Block', 'Блок'))}</dt>
      <dd>
        {receipt.block} · <code>{receipt.blockHash}</code>
      </dd>
    </dl>
  );
}
