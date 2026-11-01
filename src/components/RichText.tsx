import { Fragment, type ReactNode } from 'react';
import { stripHarakat } from '@/data/harakat';

const ARABIC_RUN = /([؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿][؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\s‌‏،؛]*[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿])/g;

/**
 * Letters that Persian uses and the Mushaf face does not shape as one cluster.
 * KFGQPC draws U+0622 (alef madda) in such a word as a dotted circle. The lyric
 * line already uses Amiri for these, and that face draws the letter.
 */
const PERSIAN_LETTER = /[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/;

/** Wraps Arabic-script runs so they get a matching face and direction inside Russian prose. */
function arabic(text: string, key: string): ReactNode[] {
  return text.split(ARABIC_RUN).map((part, i) => {
    if (i % 2 !== 1) return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    const persian = PERSIAN_LETTER.test(part);
    return (
      <bdi key={`${key}-${i}`} className={persian ? 'rt-ar f-persian' : 'rt-ar f-mushaf'} dir="rtl" lang={persian ? 'fa' : 'ar'}>
        {part}
      </bdi>
    );
  });
}

/** Minimal inline markup for commentary: **bold**, *italic*, paragraphs separated by blank lines. */
export function RichText({ text, className, showHarakat = true }: { text: string; className?: string; showHarakat?: boolean }) {
  const body = showHarakat ? text : stripHarakat(text);
  const paras = body.split(/\n{2,}/);
  return (
    <div className={className}>
      {paras.map((p, pi) => (
        <p key={pi}>
          {p.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((seg, si) => {
            const k = `${pi}-${si}`;
            if (seg.startsWith('**') && seg.endsWith('**')) return <strong key={k}>{arabic(seg.slice(2, -2), k)}</strong>;
            if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) return <em key={k}>{arabic(seg.slice(1, -1), k)}</em>;
            return <Fragment key={k}>{arabic(seg, k)}</Fragment>;
          })}
        </p>
      ))}
    </div>
  );
}
