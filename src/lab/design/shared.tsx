/**
 * Shared pieces for the T5 design prototypes. Production pages do not import this module.
 * The picture is a function of song time: the same second always paints the same sky.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Line, Song } from '@/data/schema';
import { isRtlScript } from '@/data/schema';
import { formatTime, LANG_NAMES, songs } from '@/data/library';
import { type Cue, type InstCue, type LineCue, type Timeline } from '@/data/timeline';
import { useSettings } from '@/app/settings';
import { fontClass } from '@/scene/fonts';
import { instrument, loadInstrumentSvg, scopeSvgIds } from '@/instruments/catalog';
import { Icon } from '@/icons/Icon';
import { RichText } from '@/components/RichText';

export type DirId = 'a' | 'b' | 'c';
export type LabView = 'stage' | 'player' | 'library';
export type Panel = 'text' | 'settings' | null;
export type Moment = 'vocal' | 'inst';

export interface Mark {
  id: string;
  t: number;
  line: string;
}

export interface LabQuery {
  view: LabView;
  song: string;
  at: Moment;
  t: number;
  play: boolean;
  /** When true, lyrics must not move the clock. The address already chose a second. */
  lockTime: boolean;
}

const FEATURED = 'i-have-come-alive';
/** Middle of the Persian line «مرده بدم / زنده شدم» — original script, translation, comment. */
const FEATURED_VOCAL = 133.6;
/** Inside the tanbur break, after the engraving has fully arrived. */
const FEATURED_INST = 48;

export function readLabQuery(): LabQuery {
  const q = new URLSearchParams(location.search);
  const view: LabView = q.get('view') === 'player' || q.get('view') === 'library' ? (q.get('view') as LabView) : 'stage';
  const at: Moment = q.get('at') === 'inst' ? 'inst' : 'vocal';
  const song = q.get('song') || FEATURED;
  const raw = q.get('t');
  const explicit = raw != null && Number.isFinite(Number(raw));
  let t = 0;
  let lockTime = false;
  if (explicit) {
    t = Number(raw);
    lockTime = true;
  } else if ((song || FEATURED) === FEATURED) {
    t = at === 'inst' ? FEATURED_INST : FEATURED_VOCAL;
    lockTime = true;
  }
  return { view, song, at, t, play: q.get('play') === '1', lockTime };
}

export function momentFor(timeline: Timeline, at: Moment) {
  if (at === 'inst') {
    const cue =
      timeline.cues.find((c) => c.kind === 'inst' && c.section.instruments.some((k) => k !== 'voice')) ??
      timeline.cues.find((c) => c.kind === 'inst');
    if (!cue) return 0;
    return cue.start + Math.min(8, (cue.end - cue.start) * 0.35);
  }
  const withNote = timeline.cues.find((c) => c.kind === 'line' && c.line.comment);
  if (withNote) return (withNote.start + withNote.end) / 2;
  const any = timeline.cues.find((c) => c.kind === 'line');
  return any ? any.start : 0;
}

export function stillT(slug: string) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 16777619);
  return (h >>> 0) % 180;
}

interface Star {
  x: number;
  y: number;
  r: number;
  p: number;
}

function starField(): Star[] {
  let s = 20261017;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: Star[] = [];
  for (let i = 0; i < 48; i++) {
    out.push({ x: next() * 100, y: next() * 100, r: 1.1 + next() * 1.3, p: next() * 6.28 });
  }
  return out;
}

const STARS = starField();

export interface LabApi {
  dir: DirId;
  view: LabView;
  dark: boolean;
  song: Song;
  catalog: Song[];
  timeline: Timeline | null;
  t: number;
  playing: boolean;
  showTr: boolean;
  showComment: boolean;
  panel: Panel;
  marks: Mark[];
  toast: Mark | null;
  query: string;
  setView: (view: LabView) => void;
  openSong: (slug: string) => void;
  setQuery: (q: string) => void;
  toggle: () => void;
  seek: (t: number) => void;
  skip: (dir: -1 | 1) => void;
  pick: (cue: Cue) => void;
  setShowTr: (v: boolean) => void;
  setShowComment: (v: boolean) => void;
  setPanel: (p: Panel) => void;
  placeMark: () => void;
  undoMark: () => void;
}

const Ctx = createContext<LabApi | null>(null);

export function LabProvider({ value, children }: { value: LabApi; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLab() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLab outside the design lab');
  return v;
}

export function filterSongs(q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return songs;
  return songs.filter((song) =>
    [song.title, song.titleOriginal, song.artist, song.release?.album, ...(song.poets ?? []).map((p) => p.name), ...song.languages.map((l) => LANG_NAMES[l])]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(s)),
  );
}

export function songMeta(song: Song) {
  const langs = song.languages.map((l) => LANG_NAMES[l] ?? l).join(', ');
  return `${song.artist} · ${langs}`;
}

export function Field({ song, t, mode, dark }: { song: Song; t: number; mode: 'paper' | 'sky' | 'grid'; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = t * 0.018;
    el.style.setProperty('--x1', `${50 + Math.sin(a) * 18}%`);
    el.style.setProperty('--y1', `${38 + Math.cos(a * 0.73) * 16}%`);
    el.style.setProperty('--x2', `${70 + Math.sin(a * 0.51 + 1.4) * 16}%`);
    el.style.setProperty('--y2', `${64 + Math.cos(a * 0.44 + 0.5) * 14}%`);
    el.style.setProperty('--x3', `${26 + Math.sin(a * 0.36 + 2.2) * 12}%`);
    el.style.setProperty('--y3', `${76 + Math.cos(a * 0.66 + 1) * 10}%`);
  }, [t]);
  const [c1, c2, c3, c4] = song.palette.field;
  return (
    <div
      ref={ref}
      className={`field field--${mode}`}
      style={{ ['--f1' as string]: c1, ['--f2' as string]: c2, ['--f3' as string]: c3, ['--f4' as string]: c4 ?? c3 }}
      aria-hidden
    >
      {mode === 'sky' &&
        STARS.map((star, i) => {
          const tw = 0.5 + 0.5 * Math.sin(t * 0.22 + star.p);
          const opacity = dark ? 0.28 + tw * 0.62 : 0.16 + tw * 0.3;
          return <i key={i} className="star" style={{ left: `${star.x}%`, top: `${star.y}%`, width: star.r, height: star.r, opacity }} />;
        })}
    </div>
  );
}

export function Verse({ line, className }: { line: Line; className?: string }) {
  const settings = useSettings();
  const rtl = isRtlScript(line.script);
  return (
    <p className={`verse ${fontClass(line, settings)} ${className ?? ''}`} dir={rtl ? 'rtl' : 'ltr'} lang={line.lang}>
      {line.words.map((w, i) => (
        <span key={`${line.id}-${i}`} className={w.em ? 'key' : undefined}>
          {w.w}
          {i < line.words.length - 1 ? w.br ? <br /> : ' ' : null}
        </span>
      ))}
    </p>
  );
}

export function Translation({ line }: { line: Line }) {
  return (
    <div className="tr" lang="ru">
      <RichText text={line.tr.ru} />
    </div>
  );
}

export function Note({ text }: { text: string }) {
  return <RichText className="note" text={text} />;
}

export function Engravings({ keys }: { keys: string[] }) {
  const sig = keys.join('|');
  const [svg, setSvg] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const list = sig ? sig.split('|') : [];
    void Promise.all(list.map((k) => loadInstrumentSvg(k))).then((raw) => {
      if (!alive) return;
      setSvg(raw.map((s, i) => scopeSvgIds(s, `lab-${list[i]}-${i}`)));
    });
    return () => {
      alive = false;
    };
  }, [sig]);
  return (
    <div className="engrave">
      {svg.map((s, i) => (
        <div key={keys[i] ?? i} className="engrave-one" dangerouslySetInnerHTML={{ __html: s }} />
      ))}
    </div>
  );
}

export function lineProgress(cue: LineCue, t: number) {
  const span = Math.max(0.05, cue.end - cue.start);
  return Math.min(1, Math.max(0, (t - cue.start) / span));
}

export function instPresence(cue: InstCue, t: number) {
  const intro = Math.min(2.4, Math.max(0.8, (cue.end - cue.start) * 0.08));
  return Math.min(1, Math.max(0, (t - cue.start) / intro));
}

export function Ghost({ cue }: { cue: Cue }) {
  const { pick } = useLab();
  if (cue.kind === 'inst') {
    const names = cue.section.instruments.map((k) => instrument(k)?.name ?? k).join(', ');
    return (
      <button type="button" className="ghost" onClick={() => pick(cue)}>
        {cue.section.label}: {names}
      </button>
    );
  }
  return (
    <button type="button" className="ghost" onClick={() => pick(cue)}>
      <Verse line={cue.line} />
    </button>
  );
}

export function Rail() {
  const { timeline, t, song, marks, seek } = useLab();
  const ref = useRef<HTMLDivElement>(null);
  if (!timeline) return null;
  const at = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const x = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    seek(x * song.duration);
  };
  return (
    <div
      className="rail"
      ref={ref}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={Math.round(song.duration)}
      aria-valuenow={Math.round(t)}
      aria-valuetext={formatTime(t)}
      aria-label="Место в песне"
      tabIndex={0}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        at(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) at(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') seek(t + 5);
        else if (e.key === 'ArrowLeft') seek(t - 5);
      }}
    >
      {timeline.cues
        .filter((c): c is InstCue => c.kind === 'inst')
        .map((c) => (
          <span
            key={c.section.id}
            className="rail-inst"
            style={{ left: `${(c.start / song.duration) * 100}%`, width: `${((c.end - c.start) / song.duration) * 100}%` }}
            title={c.section.label}
          />
        ))}
      {marks.map((m) => (
        <span key={m.id} className="rail-mark" style={{ left: `${(m.t / song.duration) * 100}%` }} />
      ))}
      <span className="rail-head" style={{ left: `${(t / song.duration) * 100}%` }} />
    </div>
  );
}

export function Transport() {
  const { playing, toggle, skip } = useLab();
  return (
    <div className="transport">
      <button type="button" className="key" onClick={() => skip(-1)} aria-label="Предыдущая строка">
        <Icon name="backward" size={20} />
      </button>
      <button type="button" className="key key-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Слушать'}>
        <Icon name={playing ? 'pause' : 'play'} size={24} />
      </button>
      <button type="button" className="key" onClick={() => skip(1)} aria-label="Следующая строка">
        <Icon name="forward" size={20} />
      </button>
    </div>
  );
}

export function Tasks() {
  const { showTr, showComment, setShowTr, setShowComment, setPanel } = useLab();
  return (
    <div className="tasks">
      <button type="button" aria-pressed={showTr} onClick={() => setShowTr(!showTr)}>
        Перевод
      </button>
      <button type="button" aria-pressed={showComment} onClick={() => setShowComment(!showComment)}>
        Пояснение
      </button>
      <button type="button" onClick={() => setPanel('text')}>
        Весь текст
      </button>
      <button type="button" onClick={() => setPanel('settings')}>
        Настройки
      </button>
    </div>
  );
}

export function MarkControl() {
  const { toast, placeMark, undoMark } = useLab();
  if (toast) {
    return (
      <div className="mark-live">
        <span>Отмечено {formatTime(toast.t)}</span>
        <button type="button" onClick={undoMark}>
          Отменить
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="mark" onClick={placeMark}>
      Не совпадает
    </button>
  );
}

export function TimeRead() {
  const { t, song } = useLab();
  return (
    <span className="time">
      {formatTime(t)}
      <span className="time-of"> / {formatTime(song.duration)}</span>
    </span>
  );
}

export function Sheets() {
  const { panel, setPanel, timeline, t, pick, song } = useLab();
  if (!panel) return null;
  const owner = timeline ? timeline.ownerAt(t) : -1;
  return (
    <div className="sheet-back" onClick={() => setPanel(null)}>
      <div
        className="sheet"
        role="dialog"
        aria-label={panel === 'text' ? 'Весь текст' : 'Настройки'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-bar">
          <h2>{panel === 'text' ? 'Весь текст' : 'Настройки'}</h2>
          <button type="button" className="key" onClick={() => setPanel(null)} aria-label="Закрыть">
            <Icon name="chevron.down" size={18} />
          </button>
        </div>
        {panel === 'settings' ? (
          <div className="sheet-body">
            <p>
              Тема следует системе или выбору в настройках сайта. Шрифты — те, что выбраны для песни: персидский Amiri,
              арабский — шрифт Мусхафа, латиница и перевод — Source Serif 4, если вы не сменили их.
            </p>
            <p>
              Время строк у «{song.title}» ещё черновое, поэтому строка загорается целиком. Пословную заливку прототип не
              рисует.
            </p>
            <p>Звук в прототипе не подключён: дорожка идёт по часам песни, чтобы кадр зависел только от секунды.</p>
          </div>
        ) : (
          <ul className="text-list">
            {timeline?.cues.map((c) => (
              <li key={c.kind === 'line' ? c.line.id + c.idx : c.section.id}>
                <button type="button" className={c.idx === owner ? 'is-on' : undefined} onClick={() => pick(c)}>
                  <span className="text-k">{c.kind === 'line' ? String(c.n).padStart(2, '0') : '—'}</span>
                  <span className="text-main">
                    {c.kind === 'line' ? (
                      <Verse line={c.line} />
                    ) : (
                      <span className="text-inst">{c.section.label}</span>
                    )}
                    {c.kind === 'line' && <span className="text-tr">{c.line.tr.ru.replace(/\*\*/g, '')}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Find() {
  const { query, setQuery } = useLab();
  return (
    <label className="find">
      <span className="find-ico" aria-hidden>
        <Icon name="magnifyingglass" size={16} weight={2} />
      </span>
      <input
        type="search"
        value={query}
        placeholder="Название, поэт, язык"
        aria-label="Поиск"
        onChange={(e) => setQuery(e.target.value)}
      />
    </label>
  );
}
