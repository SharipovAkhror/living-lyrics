import { Fragment, type ReactNode } from 'react';

const ARABIC_RUN = /([؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿][؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\s‌‏،؛]*[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿])/g;

/** Wraps Arabic-script runs so they get the Mushaf face and correct direction inside Russian prose. */
function arabic(text: string, key: string): ReactNode[] {
  return text.split(ARABIC_RUN).map((part, i) =>
    i % 2 === 1 ? (
      <bdi key={`${key}-${i}`} className="rt-ar f-mushaf" dir="rtl" lang="ar">
        {part}
      </bdi>
    ) : (
      <Fragment key={`${key}-${i}`}>{part}</Fragment>
    ),
  );
}

/** Minimal inline markup for commentary: **bold**, *italic*, paragraphs separated by blank lines. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const paras = text.split(/\n{2,}/);
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
