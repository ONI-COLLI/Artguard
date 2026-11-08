import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { recipientsSchema } from '../../shared/schemas';
import { useData, useAction, useFeedback, errorText } from '../lib/workspace';
import { useDialog } from './dialogs';
import { Button } from './ui';

export function Sharing() {
  const { user } = useData(),
    action = useAction('/recipients', 'PATCH'),
    { close } = useDialog(),
    { notify } = useFeedback();
  const [rows, setRows] = useState(() =>
      (user?.recipients || []).map((r, i) => ({ ...r, wallet: r.wallet || '', key: i })),
    ),
    [nextKey, setNextKey] = useState(rows.length),
    [error, setError] = useState('');
  const total = rows.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
  const update = (index: number, field: 'name' | 'wallet' | 'percent', value: string) => {
    setRows((previous) =>
      previous.map((row, i) =>
        i === index ? { ...row, [field]: field === 'percent' ? Number(value) : value } : row,
      ),
    );
    setError('');
  };
  return (
    <form
      className="revenue-sharing-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        const parsed = recipientsSchema.safeParse({ recipients: rows });
        if (!parsed.success) {
          setError(parsed.error.issues[0].message);
          return;
        }
        if (parsed.data.recipients.some((r) => !r.wallet)) {
          setError('Add a wallet for every co-author before saving.');
          return;
        }
        if (
          parsed.data.recipients.some(
            (r) => r.wallet?.toLowerCase() === user?.wallet?.address.toLowerCase(),
          )
        ) {
          setError('Co-author wallets must differ from your creator wallet.');
          return;
        }
        try {
          await action.mutateAsync(parsed.data);
          close();
          notify({
            title: 'Upload defaults saved',
            detail: `New upload forms start with these recipients. Existing projects, quotes, and paid licenses keep their own shares.`,
          });
        } catch (e) {
          setError(errorText(e));
        }
      }}
    >
      <p className="muted small-text">
        Set a starting list for new upload forms. You can change or remove it for each project.
        Saving defaults does not change existing projects or their sales.
      </p>
      <fieldset className="form-fields" disabled={action.isPending}>
        <div className="checkout-row" role="status">
          <span>Your creator share</span>
          <strong>{100 - total}% of net proceeds</strong>
        </div>
        {total > 99 && (
          <p className="form-error" role="alert">
            Co-author shares must total no more than 99%. Keep at least 1% for the creator.
          </p>
        )}
        {rows.map((row, index) => (
          <div className="split-editor" key={row.key}>
            <div className="panel-heading">
              <h3>Co-author {index + 1}</h3>
              <button
                type="button"
                className="icon-button small"
                aria-label={`Remove co-author ${index + 1}`}
                onClick={() => setRows((previous) => previous.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </button>
            </div>
            <div className="field">
              <label htmlFor={`split-name-${row.key}`}>Name / studio</label>
              <input
                id={`split-name-${row.key}`}
                required
                minLength={2}
                maxLength={80}
                value={row.name}
                onChange={(e) => update(index, 'name', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`split-wallet-${row.key}`}>Ethereum wallet</label>
              <input
                id={`split-wallet-${row.key}`}
                required
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                value={row.wallet}
                onChange={(e) => update(index, 'wallet', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`split-share-${row.key}`}>Share of net proceeds, %</label>
              <input
                id={`split-share-${row.key}`}
                required
                type="number"
                min={1}
                max={99}
                step={1}
                value={row.percent || ''}
                onChange={(e) => update(index, 'percent', e.target.value)}
              />
            </div>
          </div>
        ))}
        <Button
          type="button"
          className="full"
          disabled={rows.length >= 10}
          onClick={() => {
            setRows((previous) => [
              ...previous,
              { name: '', wallet: '', percent: 20, key: nextKey },
            ]);
            setNextKey((k) => k + 1);
          }}
        >
          <Plus size={16} />
          Add co-author
        </Button>
        <p className="small-text muted">
          Up to 10 co-authors, 99% combined. You retain at least 1%. Empty the list to keep all net
          proceeds. Rounding stays with the creator.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="primary full"
          busy={action.isPending}
          disabled={total > 99 || total < 0}
        >
          Save upload defaults
        </Button>
      </fieldset>
      <p className="small-text muted">
        Final recipients and shares are saved with each project. Buyers review that project's
        allocation in their quote. Recipients need control of the wallet they provide.
      </p>
    </form>
  );
}
