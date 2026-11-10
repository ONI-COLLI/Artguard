import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Copy,
  Database,
  ExternalLink,
  Monitor,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  technicalSteps,
  translated,
  both,
  type CodeLanguage,
  type SourceExcerpt,
  type Translation,
} from '../lib/technical-source';
import './technical-code.css';
import {
  storageLocations,
  walletTrace,
  demoWalletTrace,
  escrowTrace,
} from '../lib/technical-guide';

function CopyButton({ text, language }: { text: string; language: CodeLanguage }) {
  const [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <>
      <button
        className="small code-copy"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}{' '}
        {translated(copied ? both('Copied', 'Скопировано') : both('Copy', 'Копировать'), language)}
      </button>
      {failed && (
        <span role="alert" className="small-text">
          {translated(
            both('Select and copy the code manually.', 'Выделите и скопируйте код вручную.'),
            language,
          )}
        </span>
      )}
    </>
  );
}
function Tokens({ line }: { line: string }) {
  const parts = line.split(
    /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:async|await|const|let|return|if|else|function|import|from|export|contract|mapping|public|private|external|view|payable|uint256|uint64|bytes32|address|bool|emit|revert|nonReentrant|new|true|false)\b)/g,
  );
  return (
    <>
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.startsWith('//')
              ? 'code-comment'
              : /^["']/.test(part)
                ? 'code-string'
                : /^[a-zA-Z]+$/.test(part)
                  ? 'code-keyword'
                  : undefined
          }
        >
          {part}
        </span>
      ))}
    </>
  );
}
function SourceViewer({ sources, language }: { sources: SourceExcerpt[]; language: CodeLanguage }) {
  const [index, setIndex] = useState(0),
    s = sources[index];
  const last = s.firstLine + s.code.split('\n').length - 1;
  const url = `https://github.com/ONI-COLLI/Artguard/blob/main/${s.path}#L${s.firstLine}-L${last}`;
  return (
    <section
      className="technical-source"
      aria-label={translated(both('Actual project source', 'Реальный код проекта'), language)}
    >
      {sources.length > 1 && (
        <div className="technical-source-tabs" aria-label="Source files">
          {sources.map((source, i) => (
            <button
              type="button"
              key={source.path + source.firstLine}
              className={i === index ? 'active' : ''}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              {source.path.split('/').at(-1)}:{source.firstLine}
            </button>
          ))}
        </div>
      )}
      <div className="technical-source-header">
        <div>
          <Code2 size={16} />
          <strong>{s.path}</strong>
          <span>
            L{s.firstLine}–{last}
          </span>
        </div>
        <CopyButton key={s.path + index} text={s.code} language={language} />
      </div>
      <pre className="technical-code-pre" tabIndex={0} aria-label={s.path}>
        <code>
          {s.code.split('\n').map((line, i) => (
            <span
              className={
                'technical-code-line' +
                (s.highlight && line.includes(s.highlight) ? ' highlighted' : '')
              }
              key={i}
            >
              <span className="technical-line-number" aria-hidden="true">
                {s.firstLine + i}
              </span>
              <span>
                <Tokens line={line || ' '} />
              </span>
            </span>
          ))}
        </code>
      </pre>
      <div className="technical-source-footer">
        <span>
          {translated(
            both(
              'Exact source excerpt; highlighted lines do the key work.',
              'Точный фрагмент файла; выделены ключевые строки.',
            ),
            language,
          )}
        </span>
        <a href={url} target="_blank" rel="noreferrer">
          GitHub <ExternalLink size={13} />
        </a>
      </div>
    </section>
  );
}
type LiveResult = {
  checkedAt: string;
  api: boolean;
  chain: boolean;
  market: boolean;
  chainId: number | null;
  error?: string;
};
function LiveStatus({ language }: { language: CodeLanguage }) {
  const [result, setResult] = useState<LiveResult | null>(null),
    [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setResult(null);
    const responses = await Promise.allSettled([
      api<{ ok: boolean }>('/health'),
      api<{ ready: boolean; chainId: number }>('/blockchain/status'),
      api<{ ready: boolean }>('/blockchain/marketplace'),
    ]);
    const [health, chain, market] = responses;
    const failed = responses.find((r) => r.status === 'rejected');
    setResult({
      checkedAt: new Date().toISOString(),
      api: health.status === 'fulfilled' && health.value.ok === true,
      chain: chain.status === 'fulfilled' && chain.value.ready === true,
      market: market.status === 'fulfilled' && market.value.ready === true,
      chainId: chain.status === 'fulfilled' ? chain.value.chainId : null,
      error:
        failed?.status === 'rejected' ? String(failed.reason?.message || failed.reason) : undefined,
    });
    setBusy(false);
  }
  return (
    <section className="technical-live">
      <div>
        <h3>
          {translated(both('Check this running stand', 'Проверить работающий стенд'), language)}
        </h3>
        <p>
          {translated(
            both(
              'Read-only HTTP requests check the API and connected node. No wallet or login is required.',
              'HTTP-запросы только читают состояние API и узла. Кошелёк и вход в аккаунт не нужны.',
            ),
            language,
          )}
        </p>
      </div>
      <button className="button small" type="button" disabled={busy} onClick={() => void check()}>
        {busy
          ? translated(both('Checking…', 'Проверка…'), language)
          : translated(both('Check live connection', 'Проверить подключение'), language)}
      </button>
      {result && (
        <div className="technical-live-result" role="status">
          {[
            [translated(both('Node API', 'Сервер Node'), language), result.api],
            ['Anvil' + (result.chainId ? ' · ' + result.chainId : ''), result.chain],
            [translated(both('License marketplace', 'Контракт лицензий'), language), result.market],
          ].map(([label, ok]) => (
            <span className={ok ? 'ready' : 'unavailable'} key={String(label)}>
              {ok ? '●' : '○'} {label}:{' '}
              {translated(
                ok ? both('ready', 'доступен') : both('unavailable', 'недоступен'),
                language,
              )}
            </span>
          ))}
          <small>
            {new Date(result.checkedAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-GB')}
          </small>
          {result.error && <p role="alert">{result.error}</p>}
        </div>
      )}
    </section>
  );
}
export default function TechnicalCodeWalkthrough({
  language: suppliedLanguage,
  stepId,
  onLanguageChange,
  onStepChange,
}: {
  language?: CodeLanguage;
  stepId?: string;
  onLanguageChange?: (language: CodeLanguage) => void;
  onStepChange?: (id: string) => void;
} = {}) {
  const [localStep, setLocalStep] = useState(0),
    [localLanguage, setLocalLanguage] = useState<CodeLanguage>('en');
  const language = suppliedLanguage ?? localLanguage;
  const requested = technicalSteps.findIndex((item) => item.id === stepId);
  const step = requested >= 0 ? requested : localStep;
  function setStep(index: number) {
    setLocalStep(index);
    onStepChange?.(technicalSteps[index].id);
  }
  function setLanguage(value: CodeLanguage) {
    setLocalLanguage(value);
    onLanguageChange?.(value);
  }
  const t = (value: Translation) => translated(value, language),
    current = technicalSteps[step];
  const layers = [
    ['client', Monitor, both('React client', 'React-клиент')],
    ['server', Server, both('Express API', 'Express API')],
    ['storage', Database, both('SQLite + files', 'SQLite + файлы')],
    ['chain', ShieldCheck, both('Anvil + Solidity', 'Anvil + Solidity')],
  ] as const;
  return (
    <section className="technical-walkthrough" aria-labelledby="technical-code-heading">
      <header className="technical-intro">
        <div>
          <span className="eyebrow">React → Node → EVM</span>
          <h2 id="technical-code-heading">
            {t(
              both(
                'From startup commands to verified blockchain code',
                'От команд запуска до проверки кода блокчейна',
              ),
            )}
          </h2>
          <p>
            {t(
              both(
                'Follow the real project files. Commands and snippets are for explanation; transactions are verified separately in the live proof panel below.',
                'Разбор реальных файлов проекта. Команды и фрагменты объясняют работу; транзакции отдельно проверяются в панели ниже.',
              ),
            )}
          </p>
        </div>
        <div className="technical-language" role="group" aria-label="Explanation language">
          <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
            EN
          </button>
          <button type="button" aria-pressed={language === 'ru'} onClick={() => setLanguage('ru')}>
            RU
          </button>
        </div>
      </header>
      <div
        className="technical-shortcuts"
        aria-label={t(both('Key technical topics', 'Основные технические темы'))}
      >
        {(
          [
            [
              'wallet',
              both('How wallets connect', 'Как подключаются кошельки'),
              both('Address → SIWE signature → account', 'Адрес → SIWE-подпись → аккаунт'),
            ],
            [
              'storage',
              both('Where data lives', 'Где хранятся данные'),
              both('Browser · SQLite · disk · EVM', 'Браузер · SQLite · диск · EVM'),
            ],
            [
              'deposit',
              both('How escrow holds money', 'Как escrow удерживает деньги'),
              both(
                'Deposit → review → release or refund',
                'Депозит → проверка → выплата или возврат',
              ),
            ],
          ] as const
        ).map(([id, title, description]) => (
          <button
            type="button"
            key={id}
            onClick={() => setStep(technicalSteps.findIndex((item) => item.id === id))}
          >
            <strong>{t(title)}</strong>
            <span>{t(description)}</span>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
      <div
        className="technical-topology"
        aria-label={t(both('Application layers', 'Слои приложения'))}
      >
        {layers.map(([id, Icon, label]) => (
          <div key={id} className={current.layers.includes(id) ? 'active' : ''}>
            <Icon size={20} />
            <strong>{t(label)}</strong>
            <span>
              {id === 'client'
                ? 'Browser'
                : id === 'server'
                  ? 'HTTP / API'
                  : id === 'storage'
                    ? 'Off-chain'
                    : 'Chain 31337'}
            </span>
          </div>
        ))}
      </div>
      <div className="technical-layout">
        <nav className="technical-step-nav" aria-label="Code walkthrough steps">
          {technicalSteps.map((item, i) => (
            <button
              type="button"
              key={item.id}
              aria-current={i === step ? 'step' : undefined}
              className={i === step ? 'active' : ''}
              onClick={() => setStep(i)}
            >
              <span>{i + 1}</span>
              {t(item.short)}
            </button>
          ))}
        </nav>
        <div className="technical-stage" aria-live="polite" aria-atomic="false">
          <div className="technical-stage-copy">
            <h3>{t(current.title)}</h3>
            <p>{t(current.description)}</p>
            <div className="technical-io">
              <div>
                <span>{t(both('Input', 'На входе'))}</span>
                <p>{t(current.input)}</p>
              </div>
              <div>
                <span>{t(both('Result', 'Результат'))}</span>
                <p>{t(current.output)}</p>
              </div>
            </div>
          </div>
          {['wallet', 'demo-wallet'].includes(current.id) && (
            <div className="technical-flow-map">
              <h4>{t(both('Request path', 'Путь запроса'))}</h4>
              <ol className="technical-request-trace">
                {(current.id === 'wallet' ? walletTrace : demoWalletTrace).map((item, i) => (
                  <li key={i}>
                    <span>{i + 1}</span>
                    {t(item)}
                  </li>
                ))}
              </ol>
              <p>
                {t(
                  both(
                    'Illustration of the implementation. These steps do not connect or sign from this page.',
                    'Это схема реализации. Эта страница не подключает кошелёк и не запрашивает подпись.',
                  ),
                )}
              </p>
            </div>
          )}
          {current.id === 'storage' && (
            <section
              className="technical-storage-map"
              aria-label={t(both('Data storage map', 'Карта хранения данных'))}
            >
              {storageLocations.map((item) => (
                <article key={item.id}>
                  <h4>{t(item.title)}</h4>
                  <code>
                    {typeof item.location === 'string' ? item.location : t(item.location)}
                  </code>
                  <span>{typeof item.format === 'string' ? item.format : t(item.format)}</span>
                  <details>
                    <summary>
                      {t(both('Contents and access', 'Что внутри и как используется'))}
                    </summary>
                    <p>{t(item.content)}</p>
                  </details>
                </article>
              ))}
            </section>
          )}
          {escrowTrace.some((item) => item.id === current.id) && (
            <section className="technical-flow-map">
              <h4>
                {t(
                  both(
                    'Escrow: where the money is at each stage',
                    'Escrow: где деньги на каждом этапе',
                  ),
                )}
              </h4>
              <div className="technical-escrow-trace">
                {escrowTrace.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={item.id === current.id ? 'active' : ''}
                    aria-current={item.id === current.id ? 'step' : undefined}
                    onClick={() => setStep(technicalSteps.findIndex((step) => step.id === item.id))}
                  >
                    <strong>{t(item.title)}</strong>
                    <span>{t(item.detail)}</span>
                  </button>
                ))}
              </div>
              <p>
                {t(
                  both(
                    'Interactive explanation, not a new purchase. A credit in balances/refundBalances is still ETH held by the contract until withdrawal.',
                    'Интерактивная схема, а не новая покупка. Начисление в balances/refundBalances остаётся ETH на адресе контракта до вывода.',
                  ),
                )}
              </p>
            </section>
          )}
          {current.commands && (
            <section className="technical-terminal">
              <div>
                <strong>
                  {t(both('Commands on your computer', 'Команды на вашем компьютере'))}
                </strong>
                <CopyButton key={current.id} text={current.commands} language={language} />
              </div>
              <pre tabIndex={0}>
                <code>{current.commands}</code>
              </pre>
            </section>
          )}
          <SourceViewer key={current.id} sources={current.sources} language={language} />
          <p className="technical-takeaway">{t(current.point)}</p>
          <div className="technical-controls">
            <button
              type="button"
              className="button small"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={15} />
              {t(both('Previous code step', 'Предыдущий шаг кода'))}
            </button>
            <span>
              {step + 1} / {technicalSteps.length}
            </span>
            <button
              type="button"
              className="button primary small"
              onClick={() => setStep(step === technicalSteps.length - 1 ? 0 : step + 1)}
            >
              {t(
                step === technicalSteps.length - 1
                  ? both('Start code again', 'Сначала')
                  : both('Next code step', 'Следующий шаг кода'),
              )}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
      <LiveStatus language={language} />
      <p className="technical-proof-link">
        <button
          type="button"
          className="text-button"
          onClick={() =>
            document
              .getElementById('escrow-live-proof')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        >
          {t(
            both(
              'Continue to real transaction verification below ↓',
              'Перейти к проверке настоящей транзакции ниже ↓',
            ),
          )}
        </button>
      </p>
    </section>
  );
}
