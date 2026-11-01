import { useEffect, useRef } from 'react';
import { Sheet } from '@/ui/controls';
import type { InstCue, LineCue, Timeline } from '@/data/timeline';
import { formatTime } from '@/data/library';
import { fontClass } from '@/scene/fonts';
import type { Settings } from '@/app/settings';
import { showHarakatText } from '@/data/harakat';
import { Status } from '@/components/Status';
import { PlayerIcon } from '@/ui/playerIcons';
import { TrText } from '@/scene/LineBlock';

type TextRow =
  | { key: string; kind: 'line'; cue: LineCue; head: string | null }
  | { key: string; kind: 'gap'; idxs: number[]; start: number; end: number; label: string };

function gapLabel(run: InstCue[]) {
  const choir = run.some((c) => c.section.instruments.includes('choir') || c.section.label.trim().toLowerCase() === 'хор');
  const other = run.some((c) => c.section.instruments.some((k) => k !== 'choir'));
  if (choir && other) return 'Инструментал и хор';
  if (choir) return 'Хор';
  return 'Инструментал';
}

/** Consecutive passages without sung lines become one divider, not a repeated heading. */
function textRows(timeline: Timeline): TextRow[] {
  const rows: TextRow[] = [];
  let lastSection = '';
  let i = 0;
  const cues = timeline.cues;
  while (i < cues.length) {
    const cue = cues[i];
    if (cue.kind === 'inst') {
      const run: InstCue[] = [];
      while (i < cues.length && cues[i].kind === 'inst') run.push(cues[i++] as InstCue);
      rows.push({
        key: `gap-${run[0].idx}`,
        kind: 'gap',
        idxs: run.map((c) => c.idx),
        start: run[0].start,
        end: run[run.length - 1].end,
        label: gapLabel(run),
      });
      continue;
    }
    const head = cue.section.id !== lastSection ? cue.section.label : null;
    lastSection = cue.section.id;
    rows.push({ key: `line-${cue.idx}`, kind: 'line', cue, head });
    i++;
  }
  return rows;
}

export function TextSheet({
  open,
  onClose,
  timeline,
  owner,
  settings,
  onPick,
  error,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  timeline: Timeline | null;
  owner: number;
  settings: Settings;
  onPick: (cueIdx: number) => void;
  /** Set when the text could not be loaded. The sheet offers a retry. */
  error?: string | null;
  onRetry?: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!open || !timeline) return;
    const to = setTimeout(() => {
      list.current?.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
    }, 60);
    return () => clearTimeout(to);
  }, [open, timeline]);

  if (!timeline) {
    return (
      <Sheet open={open} onClose={onClose} title="Весь текст" size="large">
        <Status
          className="sheet-wait"
          icon={error ? 'book.closed' : <PlayerIcon name="text" size={20} />}
          live={error ? 'alert' : 'status'}
          action={
            error && onRetry ? (
              <button type="button" className="btn btn-capsule btn-tinted" onClick={onRetry}>
                Повторить
              </button>
            ) : undefined
          }
        >
          {error ?? 'Текст ещё открывается'}
        </Status>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Весь текст" size="large">
      <ol ref={list} className="tl">
        {textRows(timeline).map((row) => {
          if (row.kind === 'gap') {
            const current = row.idxs.includes(owner);
            return (
              <li key={row.key} className="tl-item">
                <button className={`tl-gap${current ? ' is-current' : ''}`} onClick={() => onPick(row.idxs[0])} aria-current={current ? 'true' : undefined}>
                  <span className="tl-gap-label">
                    — {row.label} <span className="tl-gap-time tabular">({formatTime(row.start)}–{formatTime(row.end)})</span> —
                  </span>
                </button>
              </li>
            );
          }
          const c = row.cue;
          const current = c.idx === owner;
          return (
            <li key={row.key} className="tl-item">
              {row.head && <div className="tl-section t-footnote">{row.head}</div>}
              <button className={`tl-row${current ? ' is-current' : ''}`} onClick={() => onPick(c.idx)} aria-current={current ? 'true' : undefined}>
                <span className="tl-time t-caption1 tabular">{formatTime(c.start)}</span>
                <span className="tl-text">
                  <span className={`tl-orig ${fontClass(c.line, settings)}`} dir={c.rtl ? 'rtl' : 'ltr'} lang={c.line.lang}>
                    {c.line.words.map((w) => showHarakatText(w.w, settings.showHarakat)).join(' ')}
                  </span>
                  {c.repeat > 0 && <span className="tl-repeat t-caption1">повтор</span>}
                  {settings.showTranslation && (
                    <span className="tl-tr t-subhead secondary">
                      <TrText text={c.line.tr.ru} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}
