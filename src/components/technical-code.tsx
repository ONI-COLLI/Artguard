import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Code2, Copy, ExternalLink } from 'lucide-react';
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
import { storageLocations } from '../lib/technical-guide';
import { walkthroughStages } from '../lib/technical-summary';

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
  proof,
  showLanguageControl = true,
}: {
  language?: CodeLanguage;
  stepId?: string;
  onLanguageChange?: (language: CodeLanguage) => void;
  onStepChange?: (id: string) => void;
  proof?: ReactNode;
  showLanguageControl?: boolean;
} = {}) {
  const [localStage, setLocalStage] = useState(0);
  const [localSource, setLocalSource] = useState('install');
  const [localLanguage, setLocalLanguage] = useState<CodeLanguage>('en');
  const [codeOpen, setCodeOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(stepId === 'storage');
  const language = suppliedLanguage ?? localLanguage;
  const t = (value: Translation) => translated(value, language);
  const requested = walkthroughStages.findIndex((item) => item.sources.includes(stepId || ''));
  const stageIndex = requested >= 0 ? requested : localStage;
  const stage = walkthroughStages[stageIndex];
  const selectedId = stage.sources.includes(stepId || '')
    ? stepId!
    : stage.sources.includes(localSource)
      ? localSource
      : stage.sources[0];
  const source = technicalSteps.find((item) => item.id === selectedId)!;
  function selectSource(id: string) {
    setLocalSource(id);
    onStepChange?.(id);
  }
  function selectStage(index: number) {
    setLocalStage(index);
    setCodeOpen(false);
    setStorageOpen(false);
    selectSource(walkthroughStages[index].sources[0]);
  }
  function setLanguage(value: CodeLanguage) {
    setLocalLanguage(value);
    onLanguageChange?.(value);
  }
  return (
    <section
      className="compact-walkthrough"
      aria-label={t(both('Blockchain walkthrough', 'Пошаговый разбор блокчейна'))}
    >
      {showLanguageControl && (
        <div
          className="compact-language-row technical-language"
          role="group"
          aria-label="Explanation language"
        >
          {(['en', 'ru'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={language === value}
              onClick={() => setLanguage(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      <nav className="compact-stage-nav" aria-label="Walkthrough steps">
        {walkthroughStages.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-current={index === stageIndex ? 'step' : undefined}
            onClick={() => selectStage(index)}
          >
            <span>{index + 1}</span>
            {t(item.label)}
          </button>
        ))}
      </nav>
      <div className="compact-stage" key={stage.id}>
        <div className="compact-stage-copy" aria-live="polite">
          <span className="eyebrow">
            {stageIndex + 1} / {walkthroughStages.length}
          </span>
          <h2>{t(stage.title)}</h2>
          <p>{t(stage.text)}</p>
          {stage.id === 'startup' && (
            <div className="compact-start-commands">
              <code>npm run chain</code>
              <span>+</span>
              <code>npm run dev</code>
            </div>
          )}
          {stage.id === 'escrow' && (
            <p className="compact-deadlines">
              {t(
                both(
                  'Delivery: 72h · Review: 24h · Dispute: 7 days',
                  'Передача: 72 ч · Проверка: 24 ч · Спор: 7 дней',
                ),
              )}
            </p>
          )}
          <p className="compact-result">{t(stage.result)}</p>
        </div>
        {stage.id === 'verify' && proof}
        <div className="compact-disclosures">
          <details open={codeOpen} onToggle={(event) => setCodeOpen(event.currentTarget.open)}>
            <summary>{t(both('Show code', 'Показать код'))}</summary>
            {codeOpen && (
              <div className="compact-code-content">
                {stage.sources.length > 1 && (
                  <nav className="compact-code-topics" aria-label="Code topics">
                    {stage.sources.map((id) => {
                      const item = technicalSteps.find((step) => step.id === id)!;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={id === source.id}
                          onClick={() => selectSource(id)}
                        >
                          {t(item.short)}
                        </button>
                      );
                    })}
                  </nav>
                )}
                {source.commands && (
                  <section className="technical-terminal">
                    <div>
                      <strong>{t(both('Terminal commands', 'Команды терминала'))}</strong>
                      <CopyButton key={source.id} text={source.commands} language={language} />
                    </div>
                    <pre tabIndex={0}>
                      <code>{source.commands}</code>
                    </pre>
                  </section>
                )}
                <SourceViewer key={source.id} sources={source.sources} language={language} />
                <p className="compact-code-note">{t(source.point)}</p>
                {stage.id === 'startup' && <LiveStatus language={language} />}
              </div>
            )}
          </details>
          <details
            open={storageOpen}
            onToggle={(event) => setStorageOpen(event.currentTarget.open)}
          >
            <summary>{t(both('Where data is stored', 'Где хранятся данные'))}</summary>
            <dl className="compact-storage-list">
              {storageLocations.map((item) => (
                <div key={item.id}>
                  <dt>{t(item.title)}</dt>
                  <dd>
                    <code>
                      {typeof item.location === 'string' ? item.location : t(item.location)}
                    </code>
                    <small>{typeof item.format === 'string' ? item.format : t(item.format)}</small>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="compact-code-note">
              {t(
                both(
                  'Paths use the default data directory. The shared stand uses runtime/public-demo. Runtime contents and private keys are not displayed.',
                  'Указаны пути по умолчанию. Общий стенд использует runtime/public-demo. Содержимое рабочих данных и приватные ключи здесь не показываются.',
                ),
              )}
            </p>
          </details>
        </div>
      </div>
      <div className="compact-controls">
        <button
          className="button small"
          type="button"
          disabled={stageIndex === 0}
          onClick={() => selectStage(stageIndex - 1)}
        >
          <ArrowLeft size={15} />
          {t(both('Back', 'Назад'))}
        </button>
        <button
          className="button primary small"
          type="button"
          onClick={() =>
            selectStage(stageIndex === walkthroughStages.length - 1 ? 0 : stageIndex + 1)
          }
        >
          {t(
            stageIndex === walkthroughStages.length - 1
              ? both('Start again', 'Сначала')
              : both('Next', 'Далее'),
          )}
          <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}
