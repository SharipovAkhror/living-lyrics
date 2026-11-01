import { Fragment, type ReactNode } from 'react';
import { stripHarakat } from '@/data/harakat';
import { MD_LINK, BARE_URL, urlHost } from '@/data/commentText';

const ARABIC_RUN = /([؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿][؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\s‌‏،؛]*[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿])/g;

/** Trailing punctuation that stays outside a bare URL link. */
const TRAIL = /[.,;:)»]+$/;

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

/**
 * Splits a plain-text segment into text runs and http/https links.
 * Handles markdown [text](url) links and bare URLs.
 * Non-http/https schemes are left as plain text.
 */
function linkify(text: string, key: string): ReactNode[] {
  // Combined regex: markdown link OR bare URL (order matters — MD first).
  const COMBINED = new RegExp(
    `${MD_LINK.source}|${BARE_URL.source}`,
    'g',
  );
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  COMBINED.lastIndex = 0;
  let idx = 0;
  while ((match = COMBINED.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(...arabic(text.slice(last, match.index), `${key}-t${idx}`));
    }
    idx++;
    if (match[1] !== undefined) {
      // Markdown link: [label](url)
      const label = match[1];
      const url = match[2];
      nodes.push(
        <a key={`${key}-a${idx}`} href={url} target="_blank" rel="noreferrer noopener" className="rt-link">
          {arabic(label, `${key}-al${idx}`)}
        </a>,
      );
    } else {
      // Bare URL — keep trailing punctuation outside the link.
      const raw = match[0];
      const trail = raw.match(TRAIL)?.[0] ?? '';
      const bare = trail ? raw.slice(0, -trail.length) : raw;
      nodes.push(
        <a key={`${key}-a${idx}`} href={bare} target="_blank" rel="noreferrer noopener" className="rt-link">
          {urlHost(bare)}
        </a>,
      );
      if (trail) nodes.push(trail);
      // Rewind past trailing punctuation left outside the link.
      COMBINED.lastIndex -= trail.length;
    }
    last = COMBINED.lastIndex;
    idx++;
  }
  if (last < text.length) {
    nodes.push(...arabic(text.slice(last), `${key}-t${idx}`));
  }
  return nodes;
}

/** Minimal inline markup for commentary: **bold**, *italic*, [text](url) links, paragraphs separated by blank lines. */
export function RichText({ text, className, showHarakat = true }: { text: string; className?: string; showHarakat?: boolean }) {
  const body = showHarakat ? text : stripHarakat(text);
  const paras = body.split(/\n{2,}/);
  return (
    <div className={className}>
      {paras.map((p, pi) => (
        <p key={pi}>
          {p.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((seg, si) => {
            const k = `${pi}-${si}`;
            if (seg.startsWith('**') && seg.endsWith('**')) return <strong key={k}>{linkify(seg.slice(2, -2), k)}</strong>;
            if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) return <em key={k}>{linkify(seg.slice(1, -1), k)}</em>;
            return <Fragment key={k}>{linkify(seg, k)}</Fragment>;
          })}
        </p>
      ))}
    </div>
  );
}
