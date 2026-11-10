import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { both, translated, type CodeLanguage } from '../lib/demo-language';
import type { EscrowProof } from '../../shared/escrow-proof';
import { testEth } from '../../shared/marketplace';
import { explainEscrowCheck } from '../lib/escrow-proof-explainer';

export function LiveChainResult({ language }: { language: CodeLanguage }) {
  const [input, setInput] = useState(''),
    [hash, setHash] = useState(''),
    [invalid, setInvalid] = useState(false);
  const t = (en: string, ru: string) => translated(both(en, ru), language);
  const query = useQuery({
    queryKey: ['escrow-proof', hash],
    queryFn: () =>
      api<EscrowProof>(
        '/blockchain/escrow-proof' + (hash ? '?transactionHash=' + encodeURIComponent(hash) : ''),
      ),
    retry: false,
  });
  const data =
    query.data && Array.isArray(query.data.orders) && !query.error && !invalid ? query.data : null;
  return (
    <section className="linear-live-result" aria-labelledby="live-chain-heading">
      <div className="linear-live-heading">
        <h2 id="live-chain-heading">{t('Live node result', 'Настоящие данные узла')}</h2>
        <span>Anvil RPC · 31337</span>
      </div>
      <form
        className="linear-proof-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = input.trim();
          if (value && !/^0x[a-fA-F0-9]{64}$/.test(value)) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          setHash(value);
          if (value === hash) void query.refetch();
        }}
      >
        <label htmlFor="linear-deposit-hash">
          {t('Deposit hash — empty means latest', 'Хеш депозита — пусто означает последнюю оплату')}
        </label>
        <div>
          <input
            id="linear-deposit-hash"
            placeholder="0x…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button className="button small" type="submit" disabled={query.isFetching}>
            {t('Verify', 'Проверить')}
          </button>
        </div>
      </form>
      {invalid && (
        <p role="alert">
          {t(
            'Enter 0x followed by 64 hexadecimal characters.',
            'Нужен хеш: 0x и 64 шестнадцатеричных символа.',
          )}
        </p>
      )}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.isFetching && <p role="status">{t('Reading the node…', 'Чтение узла…')}</p>}
      {data && (
        <>
          <p className="linear-proof-summary" role="status">
            {data.status === 'verified'
              ? t('Confirmed by the node', 'Подтверждено узлом')
              : data.message}
            {data.checks.length > 0 && (
              <>
                {' '}
                · {t('Checks', 'Проверки')}: {data.checks.filter((item) => item.passed).length}/
                {data.checks.length}
              </>
            )}
          </p>
          <ul className="linear-live-checks">
            {data.checks.map((item, index) => {
              const explanation = explainEscrowCheck(item.label);
              return (
                <li className={item.passed ? 'passed' : 'failed'} key={index}>
                  {item.passed ? '✓' : '✕'}{' '}
                  {explanation ? translated(explanation.title, language) : item.label}
                </li>
              );
            })}
          </ul>
          {data.status === 'verified' &&
            data.orders.map((order) => (
              <article className="linear-live-order" key={order.id}>
                <dl>
                  <div>
                    <dt>{t('State / amount', 'Состояние / сумма')}</dt>
                    <dd>
                      {order.state} · {testEth(order.amountWei)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Block', 'Блок')}</dt>
                    <dd>{order.block}</dd>
                  </div>
                  <div>
                    <dt>{t('Deposit', 'Депозит')}</dt>
                    <dd>
                      <code>{order.depositHash}</code>
                    </dd>
                  </div>
                  {order.releaseHash && (
                    <div>
                      <dt>{t('Release', 'Завершение')}</dt>
                      <dd>
                        <code>{order.releaseHash}</code>
                      </dd>
                    </div>
                  )}
                  {order.refundHash && (
                    <div>
                      <dt>{t('Refund credit', 'Начисление возврата')}</dt>
                      <dd>
                        <code>{order.refundHash}</code>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{t('Buyer / license', 'Покупатель / лицензия')}</dt>
                    <dd>
                      <code>{order.buyer}</code> ·{' '}
                      {order.licenseActive
                        ? t('active', 'действует')
                        : t('inactive', 'не действует')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Held / refund credit', 'Удерживается / возврат')}</dt>
                    <dd>
                      {testEth(order.heldWei)} / {testEth(order.refundBalanceWei)}
                    </dd>
                  </div>
                </dl>
                {order.allocations.length > 0 && (
                  <>
                    <h3>{t('Contract credits', 'Начисления внутри контракта')}</h3>
                    <ul>
                      {order.allocations.map((item, index) => (
                        <li key={index}>
                          <code>{item.wallet}</code> → {testEth(item.amountWei)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <h3>{t('Confirmed withdrawals', 'Подтверждённые выводы')}</h3>
                {order.withdrawals.length ? (
                  <ul>
                    {order.withdrawals.map((item, index) => (
                      <li key={index}>
                        <code>{item.wallet}</code> → {testEth(item.amountWei)}
                        <br />
                        <code>{item.hash}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {t(
                      'No withdrawals found in the scanned 5,000-block window.',
                      'В проверяемом окне 5 000 блоков выводы не найдены.',
                    )}
                  </p>
                )}
                <p className="linear-caption">
                  {t(
                    'One withdrawal may combine credits from several orders.',
                    'Один вывод может объединять начисления нескольких заказов.',
                  )}
                </p>
              </article>
            ))}
          <p className="linear-caption">
            {t('Checked', 'Проверено')}:{' '}
            {new Date(data.checkedAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-GB')}
          </p>
        </>
      )}
    </section>
  );
}
