/** Quiet list of the song keys. Not a sheet and not a tab trap. */
import type { CSSProperties } from 'react';

const ROWS: [string, string][] = [
  ['Пробел, K', 'Пуск и пауза'],
  ['J, L', 'На 10 секунд назад и вперёд'],
  ['←, →', 'Предыдущая и следующая строка'],
  ['Shift+←, Shift+→', 'На 10 секунд'],
  ['Home, 0', 'В начало'],
  ['1–9', 'От 10 % до 90 % длины'],
  ['T', 'Перевод'],
  ['C', 'Пояснение'],
  ['M', 'Отметить «не совпадает»'],
  ['?', 'Эта справка'],
  ['Esc', 'Закрыть справку или лист, выйти из полного экрана'],
];

const panel: CSSProperties = {
  position: 'fixed',
  zIndex: 40,
  right: 16,
  bottom: 16,
  width: 'min(22rem, calc(100vw - 32px))',
  margin: 0,
  padding: '12px 14px',
  borderRadius: 16,
  background: 'var(--bg-elevated)',
  color: 'var(--ink)',
  font: '400 0.75rem/1.35 var(--font-ui)',
};
const head: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
const title: CSSProperties = { margin: 0, font: '600 0.875rem/1.3 var(--font-ui)' };
const close: CSSProperties = { border: 0, background: 'none', color: 'var(--ink-2)', font: 'inherit', cursor: 'pointer' };
const note: CSSProperties = { margin: '6px 0 8px', color: 'var(--ink-2)' };
const list: CSSProperties = { display: 'grid', gap: 4, margin: 0 };
const row: CSSProperties = { display: 'grid', gridTemplateColumns: '9.5rem 1fr', gap: 8 };
const cell: CSSProperties = { margin: 0 };
const key: CSSProperties = { margin: 0, color: 'var(--ink-2)' };

export function KeysHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="keys-help" style={panel} role="dialog" aria-modal="false" aria-label="Клавиши">
      <div style={head}>
        <h2 style={title}>Клавиши</h2>
        <button type="button" style={close} onClick={onClose} aria-label="Закрыть справку">
          Закрыть
        </button>
      </div>
      <p style={note}>На русской раскладке те же физические клавиши.</p>
      <dl style={list}>
        {ROWS.map(([name, what]) => (
          <div key={name} style={row}>
            <dt style={key}>{name}</dt>
            <dd style={cell}>{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
