import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Box, Code2, Files, GitBranch, LockKeyhole, Terminal, X } from 'lucide-react';
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
function fileKind(path: string) {
  return path.endsWith('.sol')
    ? 'SOL'
    : path.endsWith('.tsx')
      ? 'TSX'
      : path.endsWith('.ts')
        ? 'TS'
        : 'JS';
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
    suppliedBlock !== undefined && suppliedBlock >= 0 && suppliedBlock < studioBlocks.length
      ? suppliedBlock
      : localBlock;
  const block = studioBlocks[index];
  const steps = block.steps.map((id) => linearSteps.find((step) => step.id === id)!);
  const sources = steps.flatMap((step) => step.sources);
  const paths = [...new Set(sources.map((source) => source.path))];
  const firstPath = paths[0];
  const [activeFile, setActiveFile] = useState(firstPath);
  const editor = useRef<HTMLDivElement>(null),
    terminal = useRef<HTMLDivElement>(null),
    tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const files = useRef(new Map<string, HTMLElement>());
  const t = (value: Translation) => translated(value, language);
  useEffect(() => {
    setActiveFile(firstPath);
    editor.current?.scrollTo?.({ top: 0 });
    terminal.current?.scrollTo?.({ top: 0 });
    tabs.current[index]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [index, firstPath]);
  function selectBlock(next: number) {
    setLocalBlock(next);
    onBlockChange?.(next);
  }
  function selectFile(path: string) {
    setActiveFile(path);
    const file = files.current.get(path),
      container = editor.current;
    if (file && container) container.scrollTo?.({ top: file.offsetTop, behavior: 'smooth' });
  }
  return (
    <section
      className="studio-fullscreen"
      aria-label={t(both('ArtGuard code studio', 'Студия кода ArtGuard'))}
    >
      <header className="studio-topbar">
        <div className="studio-brand">
          <span className="studio-brand-icon">
            <Code2 size={20} />
          </span>
          <div>
            <strong>
              ArtGuard<span>.dev</span>
            </strong>
            <small>BLOCKCHAIN WORKSPACE</small>
          </div>
        </div>
        <span className="studio-network">
          <span /> LOCAL TESTNET · 31337
        </span>
        <div className="studio-top-actions">
          {showLanguageControl && (
            <div className="studio-language" role="group" aria-label="Explanation language">
              {(['en', 'ru'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
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
          <Link
            className="studio-close"
            to="/home"
            aria-label={t(both('Back to ArtGuard', 'Вернуться на сайт'))}
          >
            <X size={20} />
          </Link>
        </div>
      </header>
      <nav
        className="studio-progress"
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
          <div className="studio-progress-item" key={item.id}>
            <button
              id={'studio-tab-' + i}
              role="tab"
              aria-label={`${i + 1}. ${t(item.label)}`}
              type="button"
              aria-selected={i === index}
              aria-controls="studio-workspace"
              tabIndex={i === index ? 0 : -1}
              ref={(element) => {
                tabs.current[i] = element;
              }}
              onClick={() => selectBlock(i)}
            >
              <span>{i + 1}</span>
              <strong>{t(item.label)}</strong>
            </button>
            {i < 3 && <ArrowRight size={18} aria-hidden="true" />}
          </div>
        ))}
      </nav>
      <div className="studio-intro">
        <div>
          <span className="studio-step-label">0{index + 1} / 04</span>
          <h1>{t(block.title)}</h1>
        </div>
        <p>{t(block.text)}</p>
      </div>
      <div
        className="studio-ide"
        id="studio-workspace"
        role="tabpanel"
        aria-labelledby={'studio-tab-' + index}
      >
        <div className="studio-editor-pane">
          <aside className="studio-activity" aria-hidden="true">
            <Files size={21} />
            <GitBranch size={20} />
            <Box size={20} />
            <span />
            <LockKeyhole size={17} />
          </aside>
          <div className="studio-editor-main">
            <div
              className="studio-file-tabs"
              aria-label={t(both('Source files', 'Файлы исходников'))}
            >
              {paths.map((path) => (
                <button
                  type="button"
                  key={path}
                  aria-pressed={activeFile === path}
                  onClick={() => selectFile(path)}
                  title={path}
                >
                  <span className={'studio-file-kind kind-' + fileKind(path).toLowerCase()}>
                    {fileKind(path)}
                  </span>
                  {path.split('/').at(-1)}
                </button>
              ))}
            </div>
            <div className="studio-breadcrumb">
              artguard <span>›</span> {activeFile} <LockKeyhole size={11} />
            </div>
            <div className="studio-editor-scroll" ref={editor}>
              {paths.map((path) => (
                <section
                  className="studio-code-file"
                  key={path}
                  ref={(element) => {
                    if (element) files.current.set(path, element);
                    else files.current.delete(path);
                  }}
                >
                  <div className="studio-source-heading">
                    <span>{path}</span>
                    <a
                      href={`https://github.com/ONI-COLLI/Artguard/blob/main/${path}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      GitHub ↗
                    </a>
                  </div>
                  {sources
                    .filter((source) => source.path === path)
                    .map((source) => (
                      <pre key={path + source.firstLine} aria-label={path + ':' + source.firstLine}>
                        <code>
                          {source.code.split('\n').map((line, i) => (
                            <span
                              className={
                                'studio-code-line' +
                                (source.highlight && line.includes(source.highlight)
                                  ? ' is-highlighted'
                                  : '')
                              }
                              key={i}
                            >
                              <span className="studio-line-number" aria-hidden="true">
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
          </div>
        </div>
        <section
          className="studio-terminal-pane"
          aria-label={t(both('Terminal and output', 'Терминал и вывод'))}
        >
          <div className="studio-terminal-toolbar">
            <span>
              <Terminal size={14} /> TERMINAL
            </span>
            <small>{index === 3 ? 'EXAMPLE + LIVE RPC' : 'EXAMPLE OUTPUT'}</small>
            <span className="studio-terminal-shell">
              {steps.some((step) => step.command) ? 'PowerShell' : 'HTTP / RPC'}
            </span>
          </div>
          <div className="studio-terminal-scroll" ref={terminal}>
            <p className="studio-terminal-notice">
              {t(
                both(
                  'Expected output examples. LIVE below reads the real node.',
                  'Примеры ожидаемого вывода. LIVE ниже читает реальный узел.',
                ),
              )}
            </p>
            {steps.map((step) => (
              <section className="studio-terminal-session" key={step.id}>
                <h2>
                  <span>{t(step.title)}</span>
                  <small>{t(step.outputKind)}</small>
                </h2>
                {step.command && (
                  <div className="studio-commands">
                    {step.command.split('\n').map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.startsWith('#') ? 'studio-command-comment' : 'studio-command-line'
                        }
                      >
                        {!line.startsWith('#') && <span>PS C:\ArtGuard&gt; </span>}
                        <code>{line}</code>
                      </div>
                    ))}
                  </div>
                )}
                <pre className="studio-terminal-output">
                  <code>{step.output}</code>
                </pre>
              </section>
            ))}
            {index === 1 && (
              <section className="studio-data-locations">
                <h2>DATA LOCATIONS</h2>
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
              <div className="studio-live-section">
                <span className="studio-live-label">LIVE · ANVIL JSON-RPC</span>
                <LiveChainResult language={language} />
              </div>
            )}
            <div className="studio-terminal-prompt" aria-hidden="true">
              {steps.some((step) => step.command) ? 'PS C:\\ArtGuard>' : 'rpc>'}
              <span />
            </div>
          </div>
        </section>
        <footer className="studio-statusbar">
          <span>
            <GitBranch size={12} /> artguard / local
          </span>
          <span>
            {t(both('Read-only', 'Только чтение'))} · {fileKind(activeFile)} · UTF-8
          </span>
          <span>{index + 1} / 4</span>
        </footer>
      </div>
    </section>
  );
}
