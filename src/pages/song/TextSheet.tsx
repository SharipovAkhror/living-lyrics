import { useEffect, useRef } from 'react';
import { Sheet } from '@/ui/controls';
import type { Timeline } from '@/data/timeline';
import { formatTime } from '@/data/library';
import { instrument } from '@/instruments/catalog';
import { fontClass } from '@/scene/fonts';
import type { Settings } from '@/app/settings';
import { showHarakatText } from '@/data/harakat';
import { Status } from '@/components/Status';
import { TrText } from '@/scene/LineBlock';

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
          icon={error ? 'book.closed' : 'list.bullet'}
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

  let lastSection = '';
  return (
    <Sheet open={open} onClose={onClose} title="Весь текст" size="large">
      <ol ref={list} className="tl">
        {timeline.cues.map((c) => {
          const sectionHead = c.section.id !== lastSection ? c.section.label : null;
          lastSection = c.section.id;
          const current = c.idx === owner;
          return (
            <li key={c.idx} className="tl-item">
              {sectionHead && <div className="tl-section t-footnote">{sectionHead}</div>}
              <button className={`tl-row${current ? ' is-current' : ''}`} onClick={() => onPick(c.idx)} aria-current={current ? 'true' : undefined}>
                <span className="tl-time t-caption1 tabular">{formatTime(c.start)}</span>
                {c.kind === 'line' ? (
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
                ) : (
                  <span className="tl-text">
                    <span className="tl-inst t-subhead">
                      {c.section.instruments.length
                        ? c.section.instruments.map((k) => instrument(k)?.name ?? k).join(' · ')
                        : c.section.label}
                    </span>
                    <span className="t-footnote secondary">Инструментальная часть · {formatTime(c.end - c.start)}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}
