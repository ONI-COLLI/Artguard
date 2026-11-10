import { useState } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { linearSteps, linearStorage } from '../lib/linear-walkthrough';
import { both, translated, type CodeLanguage, type Translation } from '../lib/demo-language';
import { LiveChainResult } from './live-chain-result';
import './technical-code.css';

export default function TechnicalCodeWalkthrough({
  language: suppliedLanguage,
  onLanguageChange,
  showLanguageControl = true,
}: {
  language?: CodeLanguage;
  onLanguageChange?: (language: CodeLanguage) => void;
  showLanguageControl?: boolean;
} = {}) {
  const [localLanguage, setLocalLanguage] = useState<CodeLanguage>('en');
  const language = suppliedLanguage ?? localLanguage;
  const t = (value: Translation) => translated(value, language);
  return (
    <div className="linear-guide">
      {showLanguageControl && (
        <div className="technical-language" role="group" aria-label="Explanation language">
          {(['en', 'ru'] as const).map((value) => (
            <button
              type="button"
              key={value}
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
      <p className="linear-legend">
        {t(
          both(
            'Code is from the project. Output examples show the expected format; live node data is shown at the end.',
            'Код взят из проекта. Примеры вывода показывают ожидаемый формат; настоящие данные узла — в конце.',
          ),
        )}
      </p>
      <ol
        className="linear-steps"
        aria-label={t(both('Blockchain execution steps', 'Шаги работы блокчейна'))}
      >
        {linearSteps.map((step, index) => (
          <li key={step.id} id={'code-step-' + step.id}>
            <div className="linear-step-number">{index + 1}</div>
            <div className="linear-step-content">
              <h2>{t(step.title)}</h2>
              <p className="linear-step-text">{t(step.text)}</p>
              <div className="linear-code-result">
                <section
                  className="linear-source"
                  aria-label={t(both('Code', 'Код')) + ': ' + step.id}
                >
                  <h3>{t(both('Command / code', 'Команда / код'))}</h3>
                  {step.command && (
                    <pre className="linear-command">
                      <code>{step.command}</code>
                    </pre>
                  )}
                  {step.sources.map((source) => (
                    <div className="linear-source-part" key={source.path + source.firstLine}>
                      <a
                        href={`https://github.com/ONI-COLLI/Artguard/blob/main/${source.path}#L${source.firstLine}-L${source.firstLine + source.code.split('\n').length - 1}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.path}:{source.firstLine}
                      </a>
                      <pre>
                        <code>{source.code}</code>
                      </pre>
                    </div>
                  ))}
                </section>
                <ArrowRight className="linear-result-arrow" aria-hidden="true" size={20} />
                <section className="linear-output" aria-label={t(step.outputKind) + ': ' + step.id}>
                  <h3>{t(step.outputKind)}</h3>
                  <pre>
                    <code>{step.output}</code>
                  </pre>
                </section>
              </div>
            </div>
            {index < linearSteps.length - 1 && (
              <ArrowDown className="linear-step-arrow" aria-hidden="true" size={24} />
            )}
          </li>
        ))}
      </ol>
      <LiveChainResult language={language} />
      <section className="linear-storage" aria-labelledby="linear-storage-heading">
        <h2 id="linear-storage-heading">
          {t(both('Where everything is stored', 'Где всё хранится'))}
        </h2>
        <dl>
          {linearStorage.map((item, index) => (
            <div key={index}>
              <dt>{t(item.title)}</dt>
              <dd>
                <code>{typeof item.path === 'string' ? item.path : t(item.path)}</code>
                <span>{typeof item.note === 'string' ? item.note : t(item.note)}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="linear-caption">
          {t(
            both(
              'ARTGUARD_DATA_DIR changes the base directory. The shared stand uses runtime/public-demo.',
              'ARTGUARD_DATA_DIR меняет базовую папку. Общий стенд использует runtime/public-demo.',
            ),
          )}
        </p>
      </section>
    </div>
  );
}
