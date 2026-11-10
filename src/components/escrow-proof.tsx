import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button } from './ui';
import { testEth } from '../../shared/marketplace';
import type { EscrowProof as Proof } from '../../shared/escrow-proof';
import { both, translated, type CodeLanguage, type Translation } from '../lib/demo-language';
import { explainEscrowCheck } from '../lib/escrow-proof-explainer';
import './escrow-proof.css';
export function EscrowProof({
  language: suppliedLanguage,
  onLanguageChange,
  onExplain,
  showLanguageControl = true,
  compact = false,
}: {
  language?: CodeLanguage;
  onLanguageChange?: (language: CodeLanguage) => void;
  onExplain?: (id: string) => void;
  showLanguageControl?: boolean;
  compact?: boolean;
} = {}) {
  const [localLanguage, setLocalLanguage] = useState<CodeLanguage>('en');
  const language = suppliedLanguage ?? localLanguage;
  const t = (value: Translation) => translated(value, language);
  const [input, setInput] = useState(''),
    [hash, setHash] = useState('');
  const query = useQuery({
    queryKey: ['escrow-proof', hash],
    queryFn: () =>
      api<Proof>(
        '/blockchain/escrow-proof' + (hash ? '?transactionHash=' + encodeURIComponent(hash) : ''),
      ),
    retry: false,
  });
  const data = query.data && Array.isArray(query.data.orders) ? query.data : null;
  return (
    <section className={'panel escrow-proof' + (compact ? ' is-compact' : '')}>
      <div className="escrow-proof-heading">
        {!compact && (
          <h2>
            {t(
              compact
                ? both('Live blockchain check', 'Проверка в блокчейне')
                : both('Verify a real escrow payment', 'Проверить настоящую оплату escrow'),
            )}
          </h2>
        )}
        {showLanguageControl && (
          <div className="technical-language" role="group" aria-label="Proof explanation language">
            {(['en', 'ru'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === language}
                onClick={() => {
                  setLocalLanguage(value);
                  onLanguageChange?.(value);
                }}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      {!compact && (
        <p className="muted">
          {t(
            both(
              'Reads the local blockchain directly. No login or database purchase record is required.',
              'Данные читаются напрямую из локального блокчейна. Вход и запись покупки в базе не требуются.',
            ),
          )}
        </p>
      )}
      {!compact && (
        <div className="escrow-proof-explanation">
          <strong>{t(both('What are the checks below?', 'Что означают пункты ниже?'))}</strong>
          <p>
            {t(
              both(
                'They are verification results for an existing payment, not steps to buy. Each compares data read from the node: transaction → block → contract state → release or refund events. Expand a result to see what is compared.',
                'Это результаты проверки существующей оплаты, а не шаги покупки. Каждый пункт сверяет данные узла: транзакция → блок → состояние контракта → события завершения или возврата. Раскройте пункт, чтобы увидеть, что сравнивается.',
              ),
            )}
          </p>
          {onExplain && (
            <div className="actions">
              <button type="button" className="text-button" onClick={() => onExplain('wallet')}>
                {t(both('Wallet connection + code', 'Подключение кошелька + код'))}
              </button>
              <button type="button" className="text-button" onClick={() => onExplain('deposit')}>
                {t(both('Escrow lifecycle + code', 'Жизненный цикл escrow + код'))}
              </button>
              <button type="button" className="text-button" onClick={() => onExplain('storage')}>
                {t(both('Where data is stored', 'Где хранятся данные'))}
              </button>
            </div>
          )}
        </div>
      )}
      <form
        className="escrow-proof-form"
        onSubmit={(e) => {
          e.preventDefault();
          setHash(input.trim());
          if (input.trim() === hash) void query.refetch();
        }}
      >
        <label className="field-label" htmlFor="escrow-proof-hash">
          {t(
            compact
              ? both('Deposit transaction hash', 'Хеш транзакции депозита')
              : both(
                  'Deposit transaction hash (leave empty for the latest)',
                  'Хеш транзакции депозита (пусто — последняя оплата)',
                ),
          )}
        </label>
        <div className="actions">
          <input
            id="escrow-proof-hash"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x…"
            pattern="0x[a-fA-F0-9]{64}"
          />
          <Button type="submit" busy={query.isFetching}>
            {t(compact ? both('Verify', 'Проверить') : both('Verify escrow', 'Проверить escrow'))}
          </Button>
        </div>
      </form>
      {query.error && (
        <p role="alert" className="form-error">
          {query.error.message}
        </p>
      )}
      {query.isFetching && (
        <p role="status">
          {t(
            both(
              'Reading deposit, contract state and settlement events…',
              'Читаем депозит, состояние контракта и события завершения…',
            ),
          )}
        </p>
      )}
      {data && !query.error && (
        <>
          {(!compact || data.status !== 'verified') && (
            <p role="status">
              {language === 'ru' && data.status === 'verified'
                ? 'Узел подтвердил депозит и текущее состояние escrow. Начисления и вывод — отдельные действия.'
                : data.message}
            </p>
          )}
          {data.checks.length > 0 && (
            <p className="escrow-check-count">
              {t(both('Passed checks', 'Пройдено проверок'))}:{' '}
              <strong>
                {data.checks.filter((check) => check.passed).length} / {data.checks.length}
              </strong>
            </p>
          )}
          <details className="compact-proof-evidence" open={!compact}>
            <summary>{t(both('Technical checks', 'Технические проверки'))}</summary>
            <ul className="chain-proof-checks explained-proof-checks">
              {data.checks.map((c, i) => {
                const explanation = explainEscrowCheck(c.label);
                return (
                  <li className={c.passed ? 'passed' : 'failed'} key={i}>
                    <details>
                      <summary>
                        <span
                          aria-label={t(
                            c.passed ? both('Passed', 'Пройдено') : both('Failed', 'Не пройдено'),
                          )}
                        >
                          {c.passed ? '✓' : '✕'}
                        </span>{' '}
                        {explanation ? t(explanation.title) : c.label}
                      </summary>
                      {explanation && <p>{t(explanation.detail)}</p>}
                      <code>{c.label}</code>
                      {onExplain && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => onExplain('verify')}
                        >
                          {t(both('Open the verification code', 'Открыть код проверки'))}
                        </button>
                      )}
                    </details>
                  </li>
                );
              })}
            </ul>
          </details>
          {data.status === 'verified' &&
            data.orders.map((o) => (
              <article className="escrow-proof-order" key={o.id}>
                <div className="escrow-card-title">
                  <strong>
                    {t(both('On-chain status', 'Состояние в блокчейне'))}:{' '}
                    {language === 'ru'
                      ? {
                          funded: 'депозит удерживается',
                          delivered: 'передан на проверку',
                          disputed: 'открыт спор',
                          released: 'сделка завершена',
                          refunded: 'возврат начислен',
                        }[o.state] || o.state
                      : o.state}
                  </strong>
                  <strong>{testEth(o.amountWei)}</strong>
                </div>
                <p>
                  {t(both('Held for this order', 'Удерживается для заказа'))}: {testEth(o.heldWei)}{' '}
                  · {t(both('Current wallet license', 'Лицензия кошелька сейчас'))}:{' '}
                  {t(
                    o.licenseActive
                      ? both('active', 'действует')
                      : both('inactive', 'не действует'),
                  )}
                </p>
                {['funded', 'delivered', 'disputed'].includes(o.state) && (
                  <p>
                    {t(
                      both(
                        'No revenue from this order has been released to the seller, co-authors or platform.',
                        'Выручка этого заказа ещё не начислена автору, соавторам и сервису.',
                      ),
                    )}
                  </p>
                )}
                <details>
                  <summary>
                    {t(
                      both(
                        'Deposit and settlement transactions',
                        'Транзакции депозита и завершения',
                      ),
                    )}
                  </summary>
                  <p>
                    {t(both('Deposit · block', 'Депозит · блок'))} {o.block}:{' '}
                    <code>{o.depositHash}</code>
                  </p>
                  {o.releaseHash && (
                    <p>
                      {t(both('Release', 'Завершение'))}: <code>{o.releaseHash}</code>
                    </p>
                  )}
                  {o.refundHash && (
                    <p>
                      {t(both('Refund credited', 'Возврат начислен'))}: <code>{o.refundHash}</code>
                    </p>
                  )}
                  <p>
                    {t(both('Order', 'Заказ'))}: <code>{o.id}</code>
                  </p>
                  <p>
                    {t(both('Buyer', 'Покупатель'))}: <code>{o.buyer}</code>
                  </p>
                  <p>
                    {t(both('Seller', 'Автор'))}: <code>{o.seller}</code>
                  </p>
                  <p>
                    {t(
                      both(
                        'Buyer’s available refund balance',
                        'Доступное начисление возврата покупателю',
                      ),
                    )}
                    : {testEth(o.refundBalanceWei)}
                  </p>
                </details>
                {o.allocations.length > 0 && (
                  <details>
                    <summary>
                      {t(
                        both('Revenue allocations at release', 'Начисления выручки при завершении'),
                      )}
                    </summary>
                    <p>
                      {t(
                        both(
                          'These amounts are contract credits. A separate withdrawal moves ETH to each wallet.',
                          'Это начисления внутри контракта. ETH поступает в каждый кошелёк при отдельном выводе.',
                        ),
                      )}
                    </p>
                    <ul>
                      {o.allocations.map((a, i) => (
                        <li key={i}>
                          <code>{a.wallet}</code> · {testEth(a.amountWei)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {o.withdrawals.length > 0 && (
                  <details>
                    <summary>
                      {t(
                        both(
                          'Confirmed withdrawals (recent 5,000 blocks)',
                          'Подтверждённые выводы (последние 5 000 блоков)',
                        ),
                      )}
                    </summary>
                    <p className="field-hint">
                      {t(
                        both(
                          'A withdrawal can combine credits from several orders.',
                          'Один вывод может объединять начисления от нескольких заказов.',
                        ),
                      )}
                    </p>
                    <ul>
                      {o.withdrawals.map((w, i) => (
                        <li key={i}>
                          <code>{w.wallet}</code> · {testEth(w.amountWei)}
                          <p>
                            {t(both('Transaction', 'Транзакция'))}: <code>{w.hash}</code>
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
        </>
      )}
      <p className="field-hint">
        {t(
          compact
            ? both('Anvil RPC', 'Anvil RPC')
            : both(
                'Source: Anvil JSON-RPC. Deposit, release and withdrawal are different transactions.',
                'Источник: Anvil JSON-RPC. Депозит, завершение и вывод — разные транзакции.',
              ),
        )}
        {data && (
          <>
            {' '}
            · {t(both('Checked', 'Проверено'))}:{' '}
            {new Date(data.checkedAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-GB')}
          </>
        )}
      </p>
    </section>
  );
}
