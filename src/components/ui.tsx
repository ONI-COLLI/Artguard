import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import { Box, ArrowRight, X, Shield, Upload, Check, Clock } from 'lucide-react';
import {
  useForm,
  FormProvider,
  Controller,
  useFormContext,
  type FieldValues,
  type UseFormReturn,
  type Resolver,
} from 'react-hook-form';
import type { ZodType } from 'zod';
import { ApiError } from '../lib/api';
import { Select } from './select';
export function Button({
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...props} disabled={busy || props.disabled} aria-busy={busy || undefined}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function PageHeading({
  kicker,
  title,
  description,
  action,
}: {
  kicker: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{kicker}</div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Empty({
  title,
  description,
  to = '/marketplace',
  label = 'Explore marketplace',
}: {
  title: string;
  description: string;
  to?: string;
  label?: string;
}) {
  return (
    <div className="empty-state">
      <Box />
      <h3>{title}</h3>
      <p>{description}</p>
      <Link className="button primary" to={to}>
        {label}
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Form({
  schema,
  defaults = {},
  onSubmit,
  children,
  className = '',
  warnUnsaved = false,
}: {
  schema: ZodType;
  defaults?: FieldValues;
  onSubmit: (values: FieldValues, form: UseFormReturn<FieldValues>) => Promise<void>;
  children: ReactNode | ((form: UseFormReturn<FieldValues>) => ReactNode);
  className?: string;
  warnUnsaved?: boolean;
}) {
  const resolver: Resolver<FieldValues> = async (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data as FieldValues, errors: {} };
    return {
      values: {},
      errors: Object.fromEntries(
        result.error.issues.map((i) => [
          String(i.path[0]),
          { type: 'validation', message: i.message },
        ]),
      ),
    };
  };
  const form = useForm({ defaultValues: defaults, resolver, mode: 'onBlur' }),
    [error, setError] = useState('');
  const { isDirty, isSubmitting } = form.formState;
  useEffect(() => {
    if (!warnUnsaved || !isDirty) return;
    const listener = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [isDirty, warnUnsaved]);
  return (
    <FormProvider {...form}>
      <form
        className={className}
        noValidate
        aria-busy={isSubmitting}
        onSubmit={form.handleSubmit(async (v) => {
          setError('');
          try {
            await onSubmit(v, form);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Please try again.');
            if (e instanceof ApiError)
              for (const [key, message] of Object.entries(e.fields))
                form.setError(key, { message });
          }
        })}
      >
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <fieldset className="form-fields" disabled={isSubmitting}>
          {typeof children === 'function' ? children(form) : children}
        </fieldset>
        {isSubmitting && (
          <div className="form-request-status" role="status">
            <span className="spinner tiny" /> Waiting for server confirmation…
          </div>
        )}
        {warnUnsaved && isDirty && !isSubmitting && (
          <div className="form-save-state">Unsaved changes — save before leaving this page.</div>
        )}
      </form>
    </FormProvider>
  );
}
export function Field({
  name,
  label,
  type = 'text',
  placeholder,
  options,
  maxLength,
  min,
  max,
  step,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  options?: readonly string[] | { value: string; label: string }[];
  maxLength?: number;
  min?: number;
  max?: number;
  step?: string;
}) {
  const {
    register,
    control,
    formState: { errors },
    watch,
  } = useFormContext();
  const id = useId(),
    [visible, setVisible] = useState(false);
  const error = errors[name]?.message;
  const props = {
    ...(options ? {} : register(name)),
    id,
    'aria-invalid': !!error,
    'aria-describedby': error ? `${id}-error` : undefined,
    placeholder,
    maxLength,
    min,
    max,
    step,
  };
  const value = watch(name);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {type === 'textarea' ? (
        <textarea {...props} />
      ) : options ? (
        <Controller
          name={name}
          control={control}
          defaultValue={typeof options[0] === 'string' ? options[0] : (options[0]?.value ?? '')}
          render={({ field }) => (
            <Select
              {...field}
              value={String(field.value ?? '')}
              id={id}
              aria-invalid={!!error}
              aria-describedby={props['aria-describedby']}
              options={options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))}
            />
          )}
        />
      ) : type === 'password' ? (
        <div className="password-control">
          <input {...props} type={visible ? 'text' : 'password'} autoComplete="current-password" />
          <button
            className="password-toggle"
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        </div>
      ) : (
        <input {...props} type={type} />
      )}{' '}
      {error && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {String(error)}
        </span>
      )}
      {maxLength && (
        <small className="field-counter">
          {String(value || '').length} / {maxLength}
        </small>
      )}
    </div>
  );
}
export function Submit({
  children = 'Save changes',
  pendingText = 'Saving…',
}: {
  children?: ReactNode;
  pendingText?: string;
}) {
  const {
    formState: { isSubmitting },
  } = useFormContext();
  return (
    <Button type="submit" className="primary" busy={isSubmitting}>
      {isSubmitting ? pendingText : children}
    </Button>
  );
}
export function Rights() {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  return (
    <>
      <label className="check-label">
        <input type="checkbox" {...register('rights')} />
        <span>
          I created this artwork or have the rights to publish and license it, including necessary
          permissions for depicted people and third-party materials.
        </span>
      </label>
      {errors.rights && (
        <span className="field-error" role="alert">
          {String(errors.rights.message)}
        </span>
      )}
    </>
  );
}
export const date = (v: string) =>
  new Date(v.length === 10 ? v + 'T12:00:00' : v).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export function CheckItem({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <span className={done ? 'complete' : ''}>
      {done ? <Check size={13} /> : <Clock size={13} />} {children}
    </span>
  );
}
export { Shield, Upload };
