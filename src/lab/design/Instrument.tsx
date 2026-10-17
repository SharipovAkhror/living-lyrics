/** Direction C — a listening instrument. Modules, a numbered display, one filled key. */
import { formatTime, LANG_NAMES } from '@/data/library';
import { instrument } from '@/instruments/catalog';
import { Icon } from '@/icons/Icon';
import {
  Engravings,
  Field,
  filterSongs,
  Find,
  instPresence,
  lineProgress,
  MarkControl,
  Note,
  Rail,
  Sheets,
  Tasks,
  TimeRead,
  Translation,
  Transport,
  useLab,
  Verse,
} from './shared';
import './instrument.css';

function Stage() {
  const lab = useLab();
  const { timeline, t, song, showTr, showComment, dark, setView } = lab;
  if (!timeline) return null;
  const idx = timeline.ownerAt(t);
  const cue = idx >= 0 ? timeline.cues[idx] : null;
  const upcoming = timeline.cues.slice(Math.max(0, idx + 1), Math.max(0, idx + 1) + 5);
  return (
    <div className="screen mod-screen">
      <Field song={song} t={t} mode="grid" dark={dark} />
      <header className="mod-head">
        <button type="button" className="key" onClick={() => setView('library')} aria-label="К списку">
          <Icon name="chevron.left" size={18} />
        </button>
        <p className="mod-index">{cue?.kind === 'line' ? String(cue.n).padStart(2, '0') : cue?.kind === 'inst' ? '00' : '—'}</p>
        <p className="mod-section">{cue ? (cue.kind === 'line' ? cue.section.label : cue.section.label) : song.title}</p>
        <button type="button" className="mod-clock" onClick={() => setView('player')}>
          <TimeRead />
        </button>
      </header>
      <div className="mod-stage">
        <div className="mod-display">
          {cue?.kind === 'line' ? (
            <>
              <div className="mod-corners" aria-hidden />
              {cue.voice ? <p className="mod-voice">{cue.voice}{cue.repeat ? ' · повтор' : ''}</p> : null}
              <Verse line={cue.line} />
              <span
                className="mod-meter"
                style={{ transform: `scaleX(${lineProgress(cue, t)})`, transformOrigin: cue.rtl ? 'right' : 'left' }}
              />
            </>
          ) : cue?.kind === 'inst' ? (
            <Plate />
          ) : (
            <p className="mod-voice">Нет строки</p>
          )}
        </div>
        {showTr && cue?.kind === 'line' ? (
          <section className="mod-block">
            <h2>Перевод</h2>
            <Translation line={cue.line} />
          </section>
        ) : null}
        {showComment && cue?.kind === 'line' && cue.line.comment ? (
          <section className="mod-block mod-block-quiet">
            <h2>Пояснение</h2>
            <Note text={cue.line.comment} />
          </section>
        ) : null}
        {showComment && cue?.kind === 'inst' && (cue.section.note || cue.section.comment) ? (
          <section className="mod-block mod-block-quiet">
            <h2>Пояснение</h2>
            {cue.section.note ? <p>{cue.section.note}</p> : null}
            {cue.section.comment ? <Note text={cue.section.comment} /> : null}
          </section>
        ) : null}
        <aside className="mod-bay">
          <h2>Дальше</h2>
          <ol>
            {upcoming.map((c) => (
              <li key={c.idx}>
                <button type="button" onClick={() => lab.pick(c)}>
                  <span>{c.kind === 'line' ? String(c.n).padStart(2, '0') : '—'}</span>
                  <span dir={c.kind === 'line' && c.rtl ? 'rtl' : 'ltr'}>
                    {c.kind === 'line' ? linePreview(c.line.words.map((w) => w.w).join(' ')) : c.section.label}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      <footer className="mod-foot">
        <Transport />
        <button type="button" className="mod-open" onClick={() => setView('player')}>
          Плеер
        </button>
      </footer>
      <Sheets />
    </div>
  );
}

function linePreview(text: string) {
  return text.length > 42 ? `${text.slice(0, 40)}…` : text;
}

function Plate() {
  const { timeline, t } = useLab();
  if (!timeline) return null;
  const cue = timeline.cues[timeline.ownerAt(t)];
  if (!cue || cue.kind !== 'inst') return null;
  const p = instPresence(cue, t);
  const names = cue.section.instruments.map((k) => {
    const info = instrument(k);
    return info?.native ? `${info.name} · ${info.native}` : info?.name ?? k;
  });
  return (
    <figure className="mod-plate" style={{ opacity: 0.4 + 0.6 * p }}>
      <Engravings keys={cue.section.instruments} />
      <figcaption>
        {names.join(' / ')}
        {cue.section.performers?.length ? ` — ${cue.section.performers[0]}` : ''}
      </figcaption>
    </figure>
  );
}

function Player() {
  const { song, dark, setView, marks } = useLab();
  return (
    <div className="screen mod-screen">
      <Field song={song} t={0} mode="grid" dark={dark} />
      <header className="mod-head">
        <button type="button" className="key" onClick={() => setView('stage')} aria-label="К песне">
          <Icon name="chevron.left" size={18} />
        </button>
        <p className="mod-index">–</p>
        <p className="mod-section">{song.title}</p>
        <TimeRead />
      </header>
      <div className="mod-player">
        <section className="mod-block mod-track">
          <div className="mod-track-bar">
            <h2>Дорожка</h2>
            <MarkControl />
          </div>
          <Rail />
          <p className="mod-spec">
            Штрих — проигрыш. Флажков на дорожке: {marks.length}. Ход не останавливается.
          </p>
        </section>
        <section className="mod-block">
          <h2>Ход</h2>
          <Transport />
        </section>
        <section className="mod-block">
          <h2>Вид</h2>
          <Tasks />
        </section>
      </div>
      <Sheets />
    </div>
  );
}

function Library() {
  const { query, openSong, dark } = useLab();
  const list = filterSongs(query);
  return (
    <div className="screen mod-screen">
      <header className="mod-lib-head">
        <p className="mod-index">01</p>
        <h1>Песни</h1>
        <Find />
      </header>
      <div className="mod-table" role="table">
        <div className="mod-thead" role="row">
          <span />
          <span>Название</span>
          <span>Кто</span>
          <span>Время</span>
        </div>
        {list.map((song, i) => (
          <button key={song.slug} type="button" className="mod-trow" role="row" onClick={() => openSong(song.slug)}>
            <span className="mod-swatch" aria-hidden>
              <Field song={song} t={12 + i} mode="grid" dark={dark} />
            </span>
            <span>
              <strong>{song.title}</strong>
              {song.titleOriginal ? <em>{song.titleOriginal}</em> : null}
              <small>
                {song.artist} · {song.languages.map((l) => LANG_NAMES[l] ?? l).join(', ')}
              </small>
            </span>
            <span>{song.artist}</span>
            <span className="mod-num">{formatTime(song.duration)}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? <p className="mod-empty">Ничего не найдено.</p> : null}
    </div>
  );
}

export function InstrumentView() {
  const { view } = useLab();
  if (view === 'library') return <Library />;
  if (view === 'player') return <Player />;
  return <Stage />;
}
