import { useId, useLayoutEffect, useRef, useState, type Ref, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export type SelectOption = {
  value: string;
  label: string;
  shortLabel?: string;
  group?: string;
  disabled?: boolean;
};
type SelectProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  searchable?: boolean;
  placeholder?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

export function Select({
  id,
  name,
  value,
  onChange,
  onBlur,
  options,
  disabled = false,
  searchable = options.length > 8,
  placeholder = 'Select an option',
  className = '',
  ref,
  ...aria
}: SelectProps) {
  const uid = useId(),
    listId = `${uid}-list`;
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(value);
  const typed = useRef({ text: '', time: 0 });
  const selected = options.find((o) => o.value === value);
  const visible = options.filter((o) =>
    `${o.label} ${o.value}`.toLowerCase().includes(query.toLowerCase().trim()),
  );
  const enabled = visible.filter((o) => !o.disabled);
  const activeValue = enabled.some((o) => o.value === active) ? active : enabled[0]?.value;
  const optionId = (v: string) => `${uid}-option-${options.findIndex((o) => o.value === v)}`;
  const close = (restore = false) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  const show = (last = false) => {
    if (trigger.current?.matches(':disabled')) return;
    setQuery('');
    setActive(last ? (options.filter((o) => !o.disabled).at(-1)?.value ?? value) : value);
    setOpen(true);
  };
  const choose = (option: SelectOption) => {
    if (option.disabled || trigger.current?.matches(':disabled')) return;
    onChange(option.value);
    close(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    if (disabled) {
      setOpen(false);
      return;
    }
    const panel = popup.current!;
    panel.showPopover?.();
    const position = () => {
      const r = trigger.current!.getBoundingClientRect(),
        gap = 7,
        inset = 12,
        viewportWidth = document.documentElement.clientWidth || window.innerWidth,
        viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const below = viewportHeight - r.bottom - gap - inset,
        above = r.top - gap - inset;
      const upward = below < 240 && above > below;
      const width = Math.min(Math.max(r.width, searchable ? 300 : 210), viewportWidth - inset * 2);
      Object.assign(panel.style, {
        width: `${width}px`,
        left: `${Math.max(inset, Math.min(r.left, viewportWidth - width - inset))}px`,
        top: upward ? 'auto' : `${r.bottom + gap}px`,
        bottom: upward ? `${viewportHeight - r.top + gap}px` : 'auto',
        maxHeight: `${Math.max(80, Math.min(370, upward ? above : below))}px`,
      });
    };
    position();
    if (searchable) search.current?.focus();
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const reposition = (event: Event) => {
      if (!(event.target instanceof Node) || !panel.contains(event.target)) position();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', reposition, true);
    return () => {
      panel.hidePopover?.();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, disabled, searchable]);
  useLayoutEffect(() => {
    if (open && activeValue !== undefined)
      document.getElementById(optionId(activeValue))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeValue]);
  const keyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        show(event.key === 'ArrowUp');
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(true);
    } else if (
      ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
      (event.target !== search.current || !['Home', 'End'].includes(event.key))
    ) {
      event.preventDefault();
      const i = enabled.findIndex((o) => o.value === activeValue);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? enabled.length - 1
            : Math.max(0, Math.min(enabled.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)));
      if (enabled[next]) setActive(enabled[next].value);
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target !== search.current)) {
      event.preventDefault();
      const option = enabled.find((o) => o.value === activeValue);
      if (option) choose(option);
    } else if (
      !searchable &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now();
      typed.current = {
        text: (now - typed.current.time < 600 ? typed.current.text : '') + event.key.toLowerCase(),
        time: now,
      };
      const match = enabled.find((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (match) setActive(match.value);
    }
  };
  return (
    <div className={`custom-select ${className}`} ref={root} onKeyDown={keyDown}>
      <button
        {...aria}
        id={id || uid}
        type="button"
        role="combobox"
        ref={(node) => {
          trigger.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className="select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && !searchable && activeValue !== undefined ? optionId(activeValue) : undefined
        }
        onBlur={onBlur}
        onClick={() => (open ? close() : show())}
      >
        <span>{selected?.shortLabel ?? selected?.label ?? placeholder}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      {open && !disabled && (
        <div
          ref={popup}
          className="select-popover"
          popover={
            typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype
              ? 'manual'
              : undefined
          }
        >
          {searchable && (
            <div className="select-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={search}
                type="search"
                role="combobox"
                aria-label="Search options"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  activeValue !== undefined ? optionId(activeValue) : undefined
                }
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <div
            className="select-options"
            id={listId}
            role="listbox"
            aria-label={aria['aria-label'] || 'Options'}
          >
            {visible.map((o, i) => (
              <div key={o.value}>
                {o.group && o.group !== visible[i - 1]?.group && (
                  <div className="select-group">{o.group}</div>
                )}
                <div
                  id={optionId(o.value)}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  className={`select-option${o.value === activeValue ? ' is-active' : ''}`}
                  onPointerMove={() => !o.disabled && setActive(o.value)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                >
                  <span>{o.label}</span>
                  {o.value === value && <Check size={15} aria-hidden="true" />}
                </div>
              </div>
            ))}
            {!visible.length && (
              <div className="select-empty" role="status">
                No matches
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
