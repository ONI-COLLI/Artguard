import { useId } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import type { Recipient } from '../../shared/types';
import { useData } from '../lib/workspace';
import { Button } from './ui';

export function ProjectRecipients() {
  const { user } = useData(),
    id = useId();
  const {
    control,
    register,
    setValue,
    formState: { errors },
  } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'recipients' });
  const recipients = useWatch({ control, name: 'recipients' }) as Recipient[] | undefined;
  const total = (recipients || []).reduce((sum, r) => sum + (Number(r.percent) || 0), 0);
  const creatorWallet = user?.wallet?.address.toLowerCase();
  const ownWallet =
    !!creatorWallet && recipients?.some((r) => r.wallet?.toLowerCase() === creatorWallet);
  return (
    <section className="project-recipients" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>Co-authors & revenue sharing</h3>
      <p className="muted small-text">
        These recipients apply only to this project. Shares are calculated after the platform fee.
        Save the project as a draft, then collect every co-author's wallet approval before
        publishing. A changed split needs new approvals. Open quotes and paid licenses keep their
        original allocation.
      </p>
      <div className="checkout-row" role="status">
        <span>Your creator share</span>
        <strong>{100 - total}% of net proceeds</strong>
      </div>
      {total > 99 && (
        <p className="form-error" role="alert">
          Co-author shares must total no more than 99%. Keep at least 1% for the creator.
        </p>
      )}
      {ownWallet && (
        <p className="form-error" role="alert">
          Co-author wallets must differ from your creator wallet.
        </p>
      )}
      {fields.map((field, index) => (
        <div className="split-editor" key={field.id}>
          <div className="panel-heading">
            <h3>Co-author {index + 1}</h3>
            <button
              className="icon-button small"
              type="button"
              aria-label={`Remove co-author ${index + 1}`}
              onClick={() => remove(index)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="field">
            <label htmlFor={`${id}-${field.id}-name`}>Name / studio</label>
            <input
              id={`${id}-${field.id}-name`}
              maxLength={80}
              {...register(`recipients.${index}.name`)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-${field.id}-wallet`}>Ethereum wallet</label>
            <input
              id={`${id}-${field.id}-wallet`}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              {...register(`recipients.${index}.wallet`)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-${field.id}-percent`}>Share of net proceeds, %</label>
            <input
              id={`${id}-${field.id}-percent`}
              type="number"
              min={1}
              max={99}
              step={1}
              {...register(`recipients.${index}.percent`)}
            />
          </div>
        </div>
      ))}
      <div className="actions">
        <Button
          type="button"
          disabled={fields.length >= 10}
          onClick={() => append({ name: '', wallet: '', percent: 20 })}
        >
          <Plus size={16} />
          Add co-author
        </Button>
        {!!user?.recipients.length && (
          <Button
            type="button"
            onClick={() =>
              setValue(
                'recipients',
                user.recipients.map((r) => ({ ...r })),
                { shouldDirty: true, shouldValidate: true },
              )
            }
          >
            Use upload defaults
          </Button>
        )}
      </div>
      <p className="small-text muted">
        Up to 10 co-authors, 99% combined. Remove all recipients to keep 100% of net proceeds. Each
        co-author must provide a wallet and approve the split before publication. Names without
        wallets can be saved in a draft.
      </p>
      {errors.recipients?.message && (
        <p className="field-error" role="alert">
          {String(errors.recipients.message)}
        </p>
      )}
    </section>
  );
}
