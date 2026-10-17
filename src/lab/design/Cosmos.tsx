/** Direction B — depth and light around the line. The sky is the song's own palette, moved by the clock. */
import { formatTime } from '@/data/library';
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
  songMeta,
  stillT,
  Tasks,
  TimeRead,
  Translation,
  Transport,
  useLab,
  Verse,
} from './shared';
import './cosmos.css';

function Stage() {
  const lab = useLab();
  const { timeline, t, song, showTr, showComment, dark, setView } = lab;
  if (!timeline) return null;
  const idx = timeline.ownerAt(t);
  const cue = idx >= 0 ? timeline.cues[idx] : null;
  const prev = idx > 0 ? timeline.cues[idx - 1] : null;
  const next = timeline.cues[idx + 1] ?? null;
  return (
    <div className="screen co-screen">
      <Field song={song} t={t} mode="sky" dark={dark} />
      <header className="co-head">
        <button type="button" className="key" onClick={() => setView('library')} aria-label="К списку">
          <Icon name="chevron.left" size={20} />
        </button>
        <p>
          {song.title}
          <span>{song.artist}</span>
        </p>
      </header>
      <div className="co-stage">
        {cue?.kind === 'line' ? (
          <>
            {prev?.kind === 'line' ? (
              <button type="button" className="co-far" onClick={() => lab.pick(prev)}>
                <Verse line={prev.line} />
              </button>
            ) : null}
            <div className={cue.rtl ? 'co-now co-now-rtl' : 'co-now'}>
              <span className="co-pool" aria-hidden />
              <p className="co-kicker">
                {cue.section.label}
                {cue.voice ? ` · ${cue.voice}` : ''}
              </p>
              <Verse line={cue.line} />
              <span
                className="co-beam"
                style={{ transform: `scaleX(${lineProgress(cue, t)})`, transformOrigin: cue.rtl ? 'right' : 'left' }}
              />
              {showTr ? <Translation line={cue.line} /> : null}
            </div>
            {next?.kind === 'line' ? (
              <button type="button" className="co-far co-far-next" onClick={() => lab.pick(next)}>
                <Verse line={next.line} />
              </button>
            ) : next?.kind === 'inst' ? (
              <p className="co-soon">Дальше — {next.section.label.toLowerCase()}</p>
            ) : null}
            {showComment && cue.line.comment ? (
              <div className="co-caption">
                <Note text={cue.line.comment} />
              </div>
            ) : null}
          </>
        ) : cue?.kind === 'inst' ? (
          <Break />
        ) : null}
      </div>
      <footer className="co-foot">
        <button type="button" className="co-time" onClick={() => setView('player')}>
          <TimeRead />
        </button>
        <Transport />
      </footer>
      <Sheets />
    </div>
  );
}

function Break() {
  const { timeline, t, showComment } = useLab();
  if (!timeline) return null;
  const cue = timeline.cues[timeline.ownerAt(t)];
  if (!cue || cue.kind !== 'inst') return null;
  const p = instPresence(cue, t);
  const names = cue.section.instruments.map((k) => instrument(k)?.name ?? k);
  return (
    <figure className="co-break" style={{ opacity: p, transform: `translateY(${(1 - p) * 18}px)` }}>
      <span className="co-pool co-pool-wide" aria-hidden />
      <p className="co-kicker">{cue.section.label}</p>
      <Engravings keys={cue.section.instruments} />
      <figcaption>
        {names.join(' · ')}
        {cue.section.performers?.length ? ` — ${cue.section.performers.join(', ')}` : ''}
      </figcaption>
      {showComment && cue.section.note ? <p className="co-soon">{cue.section.note}</p> : null}
      {showComment && cue.section.comment ? (
        <div className="co-caption">
          <Note text={cue.section.comment} />
        </div>
      ) : null}
    </figure>
  );
}

function Player() {
  const { song, dark, setView, timeline, t } = useLab();
  const cue = timeline ? timeline.cues[timeline.ownerAt(t)] : null;
  return (
    <div className="screen co-screen">
      <Field song={song} t={t} mode="sky" dark={dark} />
      <header className="co-head">
        <button type="button" className="key" onClick={() => setView('stage')} aria-label="К песне">
          <Icon name="chevron.left" size={20} />
        </button>
        <p>
          {song.title}
          <span>Плеер</span>
        </p>
      </header>
      <div className="co-player">
        <div className="co-echo">{cue?.kind === 'line' ? <Verse line={cue.line} /> : <p>{cue?.kind === 'inst' ? cue.section.label : ''}</p>}</div>
        <div className="co-deck">
          <div className="co-timebar">
            <TimeRead />
            <MarkControl />
          </div>
          <Rail />
          <p className="co-hint">Светлые отрезки — проигрыши. Отметка садится на дорожку и не останавливает ход.</p>
          <Transport />
          <Tasks />
        </div>
      </div>
      <Sheets />
    </div>
  );
}

function Library() {
  const { query, openSong, dark } = useLab();
  const list = filterSongs(query);
  return (
    <div className="screen co-screen co-lib">
      <header className="co-lib-head">
        <h1>Песни</h1>
        <Find />
      </header>
      <ul>
        {list.map((song) => (
          <li key={song.slug}>
            <button type="button" onClick={() => openSong(song.slug)}>
              <Field song={song} t={stillT(song.slug)} mode="sky" dark={dark} />
              <span className="co-lib-copy">
                <span className="co-lib-title">{song.title}</span>
                {song.titleOriginal ? <span className="co-lib-orig">{song.titleOriginal}</span> : null}
                <span className="co-lib-meta">
                  {songMeta(song)} · {formatTime(song.duration)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 ? <p className="co-empty">Ничего не найдено.</p> : null}
    </div>
  );
}

export function Cosmos() {
  const { view } = useLab();
  if (view === 'library') return <Library />;
  if (view === 'player') return <Player />;
  return <Stage />;
}
