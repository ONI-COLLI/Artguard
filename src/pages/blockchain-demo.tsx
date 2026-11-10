import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { useData } from '../lib/workspace';
import { Button, PageHeading } from '../components/ui';
import { EscrowProof } from '../components/escrow-proof';
import { both, translated, type CodeLanguage, type Translation } from '../lib/demo-language';
import '../components/technical-code.css';
const TechnicalCodeWalkthrough = lazy(() => import('../components/technical-code'));
const BlockchainProof = lazy(() =>
  import('../components/blockchain-proof').then((m) => ({ default: m.BlockchainProof })),
);
const BlockchainSandbox = lazy(() =>
  import('../components/blockchain-sandbox').then((m) => ({ default: m.BlockchainSandbox })),
);

export default function BlockchainDemonstration() {
  const [params, setParams] = useSearchParams();
  const language: CodeLanguage = params.get('lang') === 'ru' ? 'ru' : 'en';
  const t = (value: Translation) => translated(value, language);
  const { user } = useData();
  const allowed = !!user?.isAdmin && user.emailVerified;
  const [presentation, setPresentation] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  function update(name: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(name, value);
        return next;
      },
      { replace: true },
    );
  }
  useEffect(() => {
    if (!presentation) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresentation(false);
    };
    document.addEventListener('keydown', exit);
    return () => document.removeEventListener('keydown', exit);
  }, [presentation]);
  return (
    <div className={'blockchain-demo compact-demo' + (presentation ? ' is-presenting' : '')}>
      <PageHeading
        kicker={t(both('Technology demo', 'Демонстрация технологии'))}
        title={t(both('Blockchain, step by step', 'Блокчейн: по шагам'))}
        description={t(
          both(
            'From wallet connection to a license and payouts.',
            'От подключения кошелька до лицензии и выплат.',
          ),
        )}
        action={
          <div className="compact-page-actions">
            <div className="technical-language" role="group" aria-label="Explanation language">
              {(['en', 'ru'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={value === language}
                  onClick={() => update('lang', value)}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
            <Button
              className="small"
              aria-pressed={presentation}
              onClick={() => setPresentation(!presentation)}
            >
              <Monitor size={15} />
              {t(
                presentation
                  ? both('Exit presentation', 'Выйти из показа')
                  : both('Presentation view', 'Режим показа'),
              )}
            </Button>
          </div>
        }
      />
      <Suspense fallback={<p role="status">{t(both('Loading…', 'Загрузка…'))}</p>}>
        <TechnicalCodeWalkthrough
          language={language}
          stepId={params.get('step') || undefined}
          onStepChange={(id) => update('step', id)}
          showLanguageControl={false}
          proof={
            <div id="escrow-live-proof">
              <EscrowProof compact language={language} showLanguageControl={false} />
              <details
                className="compact-archive"
                open={archiveOpen}
                onToggle={(event) => setArchiveOpen(event.currentTarget.open)}
              >
                <summary>{t(both('Earlier direct payments', 'Старые прямые платежи'))}</summary>
                {archiveOpen && (
                  <Suspense fallback={<p role="status">{t(both('Loading…', 'Загрузка…'))}</p>}>
                    <BlockchainProof />
                  </Suspense>
                )}
              </details>
            </div>
          }
        />
      </Suspense>
      <footer className="compact-demo-footer">
        <Link to="/presentation">{t(both('Open guided demo', 'Открыть демонстрацию'))} →</Link>
        <span>
          {t(both('Local test network · test ETH', 'Локальная тестовая сеть · test ETH'))}
        </span>
      </footer>
      {allowed && (
        <details
          className="compact-admin-tools"
          open={sandboxOpen}
          onToggle={(event) => setSandboxOpen(event.currentTarget.open)}
        >
          <summary>{t(both('Admin tools', 'Инструменты администратора'))}</summary>
          {sandboxOpen && (
            <Suspense fallback={<p role="status">{t(both('Loading…', 'Загрузка…'))}</p>}>
              <BlockchainSandbox />
            </Suspense>
          )}
        </details>
      )}
    </div>
  );
}
