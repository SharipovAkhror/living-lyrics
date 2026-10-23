/**
 * The last scene render error on this device, for the «О песне» diagnostics line.
 * No account, no address, no user agent. The stored JSON stays within 2 KB.
 */
import { clientCommit } from '@/app/marks';

const KEY = 'living-lyrics.lastError.v1';
const CAP = 2048;

export interface LastError {
  message: string;
  /** First stack frame, file name only. Omitted when the browser gave none. */
  stack?: string;
  /** Date.now() when the error was caught. */
  time: number;
  slug: string;
  /** Build id when the build injected one. */
  build?: string;
}

function utf8len(s: string): number {
  return new TextEncoder().encode(s).length;
}

function oneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  let out = flat.slice(0, max);
  while (out.length > 0 && utf8len(out) > max) out = out.slice(0, out.length - 1);
  return out;
}

/** Keep the function and the file name. Chrome uses `at fn (url)`, WebKit uses `fn@url`. */
function firstFrame(error: Error): string {
  const lines = (error.stack ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const frame =
    lines.find((l) => /^at\s+\S/.test(l) || /@/.test(l)) ?? '';
  if (!frame || frame.startsWith('Error:')) return '';
  const fileOf = (path: string) => {
    const base = path.split(/[\\/]/).pop() ?? path;
    return (base.split('?')[0] ?? base).replace(/\)+$/, '');
  };
  const trimmed = frame
    .replace(/https?:\/\/\S+/g, (url) => fileOf(url.replace(/\)+$/, '')))
    .replace(/file:\/\/\S+/g, (url) => fileOf(url))
    .replace(/\((?:\/|[A-Za-z]:\\)[^)]*\)/g, (wrapped) => `(${fileOf(wrapped.slice(1, -1))})`);
  return oneLine(trimmed, 180);
}

export function recordLastError(error: unknown, slug: string): void {
  const message = oneLine(error instanceof Error && error.message ? error.message : 'Сбой сцены', 300);
  const stack = error instanceof Error ? firstFrame(error) : '';
  const build = clientCommit();
  const row: LastError = {
    message,
    time: Date.now(),
    slug: oneLine(slug, 80) || 'unknown',
  };
  if (stack) row.stack = stack;
  if (build) row.build = build;
  let json = JSON.stringify(row);
  if (utf8len(json) > CAP) {
    row.message = oneLine(row.message, 80);
    json = JSON.stringify(row);
  }
  if (utf8len(json) > CAP && row.stack) {
    delete row.stack;
    json = JSON.stringify(row);
  }
  if (utf8len(json) > CAP && row.build) {
    delete row.build;
    json = JSON.stringify(row);
  }
  if (utf8len(json) > CAP) return;
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* private mode, or the quota is full */
  }
}

export function readLastError(): LastError | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || utf8len(raw) > CAP) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const row = parsed as Partial<LastError>;
    if (typeof row.message !== 'string' || !row.message.trim()) return null;
    if (typeof row.time !== 'number' || !Number.isFinite(row.time)) return null;
    if (typeof row.slug !== 'string' || !row.slug.trim()) return null;
    return {
      message: row.message,
      time: row.time,
      slug: row.slug,
      stack: typeof row.stack === 'string' && row.stack ? row.stack : undefined,
      build: typeof row.build === 'string' && row.build ? row.build : undefined,
    };
  } catch {
    return null;
  }
}

/** `дд.мм.гггг, чч:мм` in the local zone. */
export function formatErrorTime(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** What «Скопировать» puts on the clipboard. The same time and message the sheet shows, then the song. */
export function formatLastError(row: LastError): string {
  const lines = [`${formatErrorTime(row.time)} — ${row.message}`, row.slug];
  if (row.build) lines.push(row.build);
  if (row.stack) lines.push(row.stack);
  return lines.join('\n');
}
