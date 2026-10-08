import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Minus } from 'lucide-react';
import { ErrorBox } from '../shared/ui';
import { adminApi } from './adminApi';

export function CategorySelect({
  value,
  options,
  onChange,
  onAdded,
  onRemoved,
  filter = false,
  disabled = false,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onAdded: (value: string) => void;
  onRemoved?: (value: string) => void;
  filter?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [removing, setRemoving] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const id = useId();
  const matches = options.filter(
    (c) => text === value || c.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    setText(value);
  }, [value]);
  useEffect(() => {
    input.current?.setCustomValidity(
      text === value && value ? '' : '목록에서 선택하거나 Enter로 카테고리를 추가해 주세요.',
    );
  }, [text, value]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => {
    if (removing) confirm.current?.showModal();
  }, [removing]);
  function choose(name: string) {
    onChange(name);
    setText(name);
    setOpen(false);
    setActive(-1);
    setError(undefined);
  }
  async function commit() {
    if (busy || disabled || !text.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await adminApi.addCategory(text);
      onAdded(result);
      choose(result);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function cancelRemove() {
    if (!busy) {
      setRemoving(undefined);
      setError(undefined);
      input.current?.focus();
    }
  }
  if (filter)
    return (
      <div className="admin-category-select">
        <select
          aria-label="카테고리 필터"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">전체 카테고리</option>
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    );
  return (
    <div className="admin-category-select category-combo" ref={root}>
      <div className="category-combo-input">
        <input
          ref={input}
          role="combobox"
          aria-label="카테고리"
          aria-expanded={open}
          aria-controls={id}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          required
          maxLength={30}
          value={text}
          placeholder="카테고리 선택 또는 입력"
          disabled={disabled || busy}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((n) => Math.min(n + 1, matches.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((n) => Math.max(n - 1, 0));
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setText(value);
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (active >= 0 && matches[active]) choose(matches[active]);
              else void commit();
            }
          }}
        />
        <button
          type="button"
          aria-label="카테고리 목록"
          disabled={disabled || busy}
          onClick={() => {
            setOpen(!open);
            setActive(-1);
          }}
        >
          <ChevronDown size={17} />
        </button>
      </div>
      {open && !disabled && (
        <div className="category-dropdown">
          <ul id={id} role="listbox" aria-label="카테고리 목록">
            {matches.map((c, n) => (
              <li
                key={c}
                id={`${id}-${n}`}
                role="option"
                aria-selected={c === value}
                className={active === n ? 'active' : ''}
              >
                <button
                  type="button"
                  className="category-choice"
                  disabled={busy}
                  onClick={() => choose(c)}
                >
                  {c}
                </button>
                <button
                  type="button"
                  className="category-minus"
                  aria-label={`${c} 카테고리 삭제`}
                  title="카테고리 삭제"
                  disabled={busy}
                  onClick={() => {
                    setRemoving(c);
                    setOpen(false);
                    setError(undefined);
                  }}
                >
                  <Minus size={16} />
                </button>
              </li>
            ))}
          </ul>
          <p className="category-input-tip">
            {busy
              ? '저장 중…'
              : text.trim() &&
                  !options.some((c) => c.toLocaleLowerCase() === text.trim().toLocaleLowerCase())
                ? 'Enter를 눌러 새 카테고리로 추가'
                : '목록에서 선택하거나 새 이름을 입력하세요'}
          </p>
        </div>
      )}
      {!removing && <ErrorBox error={error} />}
      {removing &&
        createPortal(
          <dialog
            ref={confirm}
            className="admin-dialog category-confirm"
            aria-labelledby={`${id}-confirm`}
            onCancel={(e) => {
              e.preventDefault();
              cancelRemove();
            }}
          >
            <h2 id={`${id}-confirm`}>정말로 삭제하시겠습니까?</h2>
            <p>‘{removing}’ 카테고리를 삭제합니다.</p>
            <p className="admin-help">물품이나 이용 이력이 있는 카테고리는 삭제할 수 없습니다.</p>
            <ErrorBox error={error} />
            <div className="admin-confirm-actions">
              <button type="button" disabled={busy} onClick={cancelRemove}>
                취소
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(undefined);
                  try {
                    await adminApi.removeCategory(removing);
                    onRemoved?.(removing);
                    if (value === removing) {
                      onChange('');
                      setText('');
                    }
                    setRemoving(undefined);
                    input.current?.focus();
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </dialog>,
          document.body,
        )}
    </div>
  );
}
