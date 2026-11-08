import { Link } from 'react-router-dom';
import { useFormContext } from 'react-hook-form';
import { LEGAL_VERSION, consentSummary } from '../../shared/legal';
import { useData } from '../lib/workspace';
export function LegalFields() {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  return (
    <div className="legal-consent">
      <input type="hidden" value={LEGAL_VERSION} {...register('legalVersion')} />
      <label className="check-label">
        <input type="checkbox" {...register('legalAccepted')} />
        <span>
          I accept the prototype terms and consent to account data processing for ArtGuard.
        </span>
      </label>
      <div className="legal-links">
        <Link to="/legal/terms" target="_blank">
          Terms / Шарттар
        </Link>
        <Link to="/legal/privacy" target="_blank">
          Privacy / Құпиялық
        </Link>
        <Link to="/legal/refunds" target="_blank">
          Escrow & refunds
        </Link>
      </div>
      <details>
        <summary>Data processing details</summary>
        <p>{consentSummary}</p>
      </details>
      {errors.legalAccepted && (
        <p className="field-error" role="alert">
          {String(errors.legalAccepted.message)}
        </p>
      )}
      {errors.legalVersion && (
        <p className="field-error" role="alert">
          The document version changed. Reload this tab to review the current terms.
        </p>
      )}
    </div>
  );
}
export function LegalNotice() {
  const { user, privacy } = useData();
  return user && privacy && !privacy.accepted ? (
    <div className="local-note" role="status">
      Review the current terms before a new purchase or publication. Previous licenses and records
      remain available. <Link to="/privacy">Review & accept</Link>
    </div>
  ) : null;
}
