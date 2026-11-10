import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../lib/workspace';
import { PageHeading } from '../components/ui';
import { both, translated, type CodeLanguage, type Translation } from '../lib/demo-language';
import '../components/technical-code.css';
import TechnicalCodeWalkthrough from '../components/technical-code';
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
  const tools = params.get('tools') === '1' && !!user?.isAdmin && user.emailVerified;
  const archive = params.get('legacy') === '1';
  const requestedBlock = Number(params.get('block'));
  const oldStep = params.get('step') || '';
  const mapped = ['chain', 'client', 'install'].includes(oldStep)
    ? 0
    : ['wallet', 'demo-wallet', 'file', 'fingerprint', 'register', 'storage'].includes(oldStep)
      ? 1
      : ['quote', 'deposit', 'delivery', 'release', 'refund'].includes(oldStep)
        ? 2
        : ['withdraw', 'verify'].includes(oldStep)
          ? 3
          : 0;
  const block =
    Number.isInteger(requestedBlock) && requestedBlock >= 1 && requestedBlock <= 4
      ? requestedBlock - 1
      : mapped;
  if (!tools && !archive)
    return (
      <TechnicalCodeWalkthrough
        language={language}
        block={block}
        onLanguageChange={(value) =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.set('lang', value);
              return next;
            },
            { replace: true },
          )
        }
        onBlockChange={(value) =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.set('block', String(value + 1));
              return next;
            },
            { replace: true },
          )
        }
      />
    );
  return (
    <div className="blockchain-demo linear-demo">
      <PageHeading
        kicker="React → Node → EVM"
        title={t(both('Blockchain: code → result', 'Блокчейн: код → результат'))}
        description={t(
          both(
            'Read from top to bottom. Every step is visible.',
            'Читай сверху вниз. Все шаги видны сразу.',
          ),
        )}
        action={
          <div className="technical-language" role="group" aria-label="Explanation language">
            {(['en', 'ru'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={language === value}
                onClick={() =>
                  setParams(
                    (previous) => {
                      const next = new URLSearchParams(previous);
                      next.set('lang', value);
                      return next;
                    },
                    { replace: true },
                  )
                }
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        }
      />
      <Suspense fallback={<p role="status">{t(both('Loading…', 'Загрузка…'))}</p>}>
        {tools ? (
          <BlockchainSandbox />
        ) : archive ? (
          <BlockchainProof />
        ) : (
          <TechnicalCodeWalkthrough language={language} showLanguageControl={false} />
        )}
      </Suspense>
    </div>
  );
}
