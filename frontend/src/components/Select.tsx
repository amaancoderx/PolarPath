import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Select.
 *
 * A native select renders the operating system's own list, which on Windows is
 * a white menu that ignores the palette entirely. Since this control appears on
 * the chart screen next to everything else the interface styles, it is built
 * here instead: same tokens, same radius, same motion, and keyboard behaviour
 * that matches what a native select does (typeahead, arrows, Home and End,
 * Escape to close, Enter to commit).
 */

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  group?: string;
}

interface Props {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export default function Select({ id, value, options, onChange, ariaLabel }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const selected = options.find((o) => o.value === value) ?? options[0];

  const groups = useMemo(() => {
    const out: { name: string | null; items: SelectOption[] }[] = [];
    for (const option of options) {
      const name = option.group ?? null;
      const last = out[out.length - 1];
      if (last && last.name === name) last.items.push(option);
      else out.push({ name, items: [option] });
    }
    return out;
  }, [options]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the active option in view when the list is long.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(active);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(options.length - 1, Math.max(0, i + step)));
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (e.key.length === 1) {
      const now = Date.now();
      typed.current.text = now - typed.current.at > 700 ? e.key : typed.current.text + e.key;
      typed.current.at = now;
      const needle = typed.current.text.toLowerCase();
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(needle));
      if (hit >= 0) setActive(hit);
    }
  };

  let flat = -1;

  return (
    <div className={`select${open ? " open" : ""}`} ref={rootRef}>
      <button
        id={id}
        type="button"
        className="select-trigger control"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label ?? ""}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="select-list" id={listId} role="listbox" ref={listRef} tabIndex={-1}>
          {groups.map((group) => (
            <div key={group.name ?? "ungrouped"} className="select-group">
              {group.name && <div className="select-group-label">{group.name}</div>}
              {group.items.map((option) => {
                flat += 1;
                const index = flat;
                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={option.value === value}
                    data-active={index === active}
                    className="select-option"
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(index)}
                  >
                    <span className="select-option-label">{option.label}</span>
                    {option.hint && <span className="select-option-hint">{option.hint}</span>}
                    {option.value === value && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M2.5 6.2 4.8 8.5 9.5 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
