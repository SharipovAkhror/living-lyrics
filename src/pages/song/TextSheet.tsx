import { useEffect, useRef } from 'react';
import { Sheet } from '@/components/controls';
import type { Timeline } from '@/data/timeline';
import { formatTime } from '@/data/library';
import { instrument } from '@/instruments/catalog';
import { fontClass } from '@/scene/fonts';
import type { Settings } from '@/app/settings';
import { showHarakatText } from '@/data/harakat';

export function TextSheet({
  open,
  onClose,
  timeline,
  owner,
  settings,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  timeline: Timeline;
  owner: number;
  settings: Settings;
  onPick: (cueIdx: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!open) return;
    const to = setTimeout(() => {
      list.current?.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
    }, 60);
    return () => clearTimeout(to);
  }, [open]);

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
                    {settings.showTranslation && <span className="tl-tr t-subhead secondary">{c.line.tr.ru}</span>}
                  </span>
                ) : (
                  <span className="tl-text">
                    <span className="tl-inst t-subhead">
                      {c.section.instruments.map((k) => instrument(k)?.name ?? k).join(' · ')}
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
