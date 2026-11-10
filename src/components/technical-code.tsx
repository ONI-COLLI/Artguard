import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { linearSteps, linearStorage, studioBlocks } from '../lib/linear-walkthrough';
import { both, translated, type CodeLanguage, type Translation } from '../lib/demo-language';
import { LiveChainResult } from './live-chain-result';
import './technical-code.css';

const keywords = new Set(
  'async await const let return if else function import from export contract mapping public private external view payable uint256 uint64 bytes32 address bool emit revert nonReentrant new true false try catch finally throw'.split(
    ' ',
  ),
);
function SyntaxLine({ line }: { line: string }) {
  const parts = line.split(
    /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b0x[\da-fA-F]+\b|\b\d+\b|\b[A-Za-z_$][\w$]*(?=\s*\()|\b(?:async|await|const|let|return|if|else|function|import|from|export|contract|mapping|public|private|external|view|payable|uint256|uint64|bytes32|address|bool|emit|revert|nonReentrant|new|true|false|try|catch|finally|throw)\b)/g,
  );
  return (
    <>
      {parts.map((part, index) => (
        <span
          key={index}
          className={
            part.startsWith('//')
              ? 'syntax-comment'
              : /^["']/.test(part)
                ? 'syntax-string'
                : keywords.has(part)
                  ? 'syntax-keyword'
                  : /^(?:0x[\da-fA-F]+|\d+)$/.test(part)
                    ? 'syntax-number'
                    : /^[A-Za-z_$][\w$]*$/.test(part)
                      ? 'syntax-function'
                      : undefined
          }
        >
          {part}
        </span>
      ))}
    </>
  );
}
export default function TechnicalCodeWalkthrough({
  language: suppliedLanguage,
  onLanguageChange,
  showLanguageControl = true,
  block: suppliedBlock,
  onBlockChange,
}: {
  language?: CodeLanguage;
  onLanguageChange?: (language: CodeLanguage) => void;
  showLanguageControl?: boolean;
  block?: number;
  onBlockChange?: (index: number) => void;
} = {}) {
  const [localLanguage, setLocalLanguage] = useState<CodeLanguage>('en');
  const [localBlock, setLocalBlock] = useState(0);
  const language = suppliedLanguage ?? localLanguage;
  const index =
    suppliedBlock !== undefined &&
    Number.isInteger(suppliedBlock) &&
    suppliedBlock >= 0 &&
    suppliedBlock < studioBlocks.length
      ? suppliedBlock
      : localBlock;
  const block = studioBlocks[index];
  const steps = block.steps.map((id) => linearSteps.find((step) => step.id === id)!);
  const sources = steps.flatMap((step) => step.sources);
  const paths = [...new Set(sources.map((source) => source.path))];
  const container = useRef<HTMLElement>(null),
    editor = useRef<HTMLDivElement>(null),
    terminal = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const t = (value: Translation) => translated(value, language);
  useLayoutEffect(() => {
    const shell = container.current?.closest<HTMLElement>('.workspace');
    if (!shell) return;
    const previous = shell.style.getPropertyValue('--walkthrough-height');
    const fit = () => {
      const top = shell.getBoundingClientRect().top + window.scrollY;
      shell.style.setProperty('--walkthrough-height', `${Math.max(0, window.innerHeight - top)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      if (previous) shell.style.setProperty('--walkthrough-height', previous);
      else shell.style.removeProperty('--walkthrough-height');
    };
  }, []);
  useEffect(() => {
    editor.current?.scrollTo?.({ top: 0 });
    terminal.current?.scrollTo?.({ top: 0 });
  }, [index]);
  function selectBlock(next: number) {
    setLocalBlock(next);
    onBlockChange?.(next);
  }
  return (
    <section
      className="code-walkthrough"
      ref={container}
      aria-label={t(both('Blockchain code walkthrough', 'Разбор кода блокчейна'))}
    >
      <div className="walkthrough-heading">
        <h1>{t(both('Blockchain: code and output', 'Блокчейн: код и вывод'))}</h1>
        {showLanguageControl && (
          <div className="technical-language" role="group" aria-label="Explanation language">
            {(['en', 'ru'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={language === value}
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
      <nav
        className="walkthrough-steps"
        role="tablist"
        aria-label="Execution blocks"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? 3
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + 4) % 4;
          selectBlock(next);
          tabs.current[next]?.focus();
        }}
      >
        {studioBlocks.map((item, i) => (
          <div className="walkthrough-step" key={item.id}>
            <button
              id={'code-tab-' + i}
              type="button"
              role="tab"
              aria-label={`${i + 1}. ${t(item.label)}`}
              aria-selected={i === index}
              aria-controls="code-workspace"
              tabIndex={i === index ? 0 : -1}
              ref={(element) => {
                tabs.current[i] = element;
              }}
              onClick={() => selectBlock(i)}
            >
              <span>{i + 1}</span>
              <strong>{t(item.label)}</strong>
            </button>
            {i < 3 && <ArrowRight size={16} aria-hidden="true" />}
          </div>
        ))}
      </nav>
      <div className="walkthrough-summary">
        <h2>{t(block.title)}</h2>
        <p>{t(block.text)}</p>
      </div>
      <div
        className="walkthrough-panels"
        id="code-workspace"
        role="tabpanel"
        aria-labelledby={'code-tab-' + index}
      >
        <section className="walkthrough-code-panel" aria-label={t(both('Code', 'Код'))}>
          <div className="walkthrough-panel-heading">{t(both('Code', 'Код'))}</div>
          <div className="walkthrough-code-scroll" ref={editor}>
            {paths.map((path) => (
              <section className="walkthrough-code-file" key={path}>
                <div className="walkthrough-file-heading">
                  <a
                    href={`https://github.com/ONI-COLLI/Artguard/blob/main/${path}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {path.split('/').at(-1)}
                  </a>
                  <span>{path.slice(0, path.lastIndexOf('/') + 1)}</span>
                </div>
                {sources
                  .filter((source) => source.path === path)
                  .map((source) => (
                    <pre key={path + source.firstLine} aria-label={path + ':' + source.firstLine}>
                      <code>
                        {source.code.split('\n').map((line, i) => (
                          <span
                            className={
                              'walkthrough-code-line' +
                              (source.highlight && line.includes(source.highlight)
                                ? ' is-highlighted'
                                : '')
                            }
                            key={i}
                          >
                            <span className="walkthrough-line-number" aria-hidden="true">
                              {source.firstLine + i}
                            </span>
                            <span>
                              <SyntaxLine line={line || ' '} />
                            </span>
                          </span>
                        ))}
                      </code>
                    </pre>
                  ))}
              </section>
            ))}
          </div>
        </section>
        <section
          className="walkthrough-output-panel"
          aria-label={t(both('Terminal and output', 'Терминал и вывод'))}
        >
          <div className="walkthrough-panel-heading">
            <span>{t(both('Terminal output', 'Вывод терминала'))}</span>
            <small>{index === 3 ? 'EXAMPLE + LIVE RPC' : t(both('Example', 'Пример'))}</small>
          </div>
          <div className="walkthrough-output-scroll" ref={terminal}>
            {steps.map((step) => (
              <section className="walkthrough-output-step" key={step.id}>
                <h3>
                  {t(step.title)}
                  <small>{t(step.outputKind)}</small>
                </h3>
                {step.command && (
                  <pre className="walkthrough-command">
                    <code>{step.command}</code>
                  </pre>
                )}
                <pre className="walkthrough-output">
                  <code>{step.output}</code>
                </pre>
              </section>
            ))}
            {index === 1 && (
              <section className="walkthrough-storage">
                <h3>{t(both('Storage', 'Хранение'))}</h3>
                {linearStorage.map((item, i) => (
                  <div key={i}>
                    <strong>{t(item.title)}</strong>
                    <code>{typeof item.path === 'string' ? item.path : t(item.path)}</code>
                    <p>{typeof item.note === 'string' ? item.note : t(item.note)}</p>
                  </div>
                ))}
              </section>
            )}
            {index === 3 && (
              <div className="walkthrough-live">
                <span className="walkthrough-live-label">LIVE · ANVIL JSON-RPC</span>
                <LiveChainResult language={language} />
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
