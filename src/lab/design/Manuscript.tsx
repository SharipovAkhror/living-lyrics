/** Direction A — a reading page. Verse, gloss, footnote. The engraving sits like a plate in a book. */
import { formatTime } from '@/data/library';
import { instrument } from '@/instruments/catalog';
import { Icon } from '@/icons/Icon';
import {
  Engravings,
  Field,
  filterSongs,
  Find,
  Ghost,
  instPresence,
  lineProgress,
  MarkControl,
  Note,
  Rail,
  Sheets,
  songMeta,
  Tasks,
  TimeRead,
  Translation,
  Transport,
  useLab,
  Verse,
} from './shared';
import './manuscript.css';

function Head({ back, title, aside }: { back: () => void; title: string; aside?: string }) {
  return (
    <header className="ms-head">
      <button type="button" className="key" onClick={back} aria-label="К списку">
        <Icon name="chevron.left" size={20} />
      </button>
      <p className="ms-run">
        <span>{title}</span>
        {aside ? <span className="ms-aside">{aside}</span> : null}
      </p>
    </header>
  );
}

function Stage() {
  const lab = useLab();
  const { timeline, t, song, showTr, showComment, dark, setView } = lab;
  if (!timeline) return null;
  const idx = timeline.ownerAt(t);
  const cue = idx >= 0 ? timeline.cues[idx] : null;
  const prev = idx > 0 ? timeline.cues[idx - 1] : null;
  const next = timeline.cues[idx + 1] ?? null;
  return (
    <div className="screen ms-screen">
      <Field song={song} t={t} mode="paper" dark={dark} />
      <Head back={() => setView('library')} title={song.title} aside={song.artist} />
      <div className="ms-stage">
        <div className="ms-main">
          {cue?.kind === 'line' ? (
            <>
              <p className="ms-kicker">
                {cue.section.label}
                {cue.voice ? ` · ${cue.voice}` : ''}
                {cue.repeat ? ' · повтор' : ''}
              </p>
              {prev ? <Ghost cue={prev} /> : null}
              <div className="ms-verse">
                <Verse line={cue.line} />
                <span
                  className="ms-rule"
                  style={{
                    transform: `scaleX(${lineProgress(cue, t)})`,
                    transformOrigin: cue.rtl ? 'right' : 'left',
                  }}
                />
              </div>
              {showTr ? <Translation line={cue.line} /> : null}
              {next ? <Ghost cue={next} /> : null}
            </>
          ) : cue?.kind === 'inst' ? (
            <Plate />
          ) : (
            <p className="ms-kicker">Начало</p>
          )}
        </div>
        {showComment && cue?.kind === 'line' && cue.line.comment ? (
          <aside className="ms-note">
            <p className="ms-fn">Пояснение</p>
            <Note text={cue.line.comment} />
          </aside>
        ) : null}
        {showComment && cue?.kind === 'inst' && (cue.section.comment || cue.section.note) ? (
          <aside className="ms-note">
            <p className="ms-fn">Пояснение</p>
            {cue.section.note ? <p className="ms-caption">{cue.section.note}</p> : null}
            {cue.section.comment ? <Note text={cue.section.comment} /> : null}
          </aside>
        ) : null}
      </div>
      <footer className="ms-foot">
        <button type="button" className="ms-jump" onClick={() => setView('player')}>
          <TimeRead />
          <span>Плеер</span>
        </button>
        <Transport />
      </footer>
      <Sheets />
    </div>
  );
}

function Plate() {
  const { timeline, t } = useLab();
  if (!timeline) return null;
  const cue = timeline.cues[timeline.ownerAt(t)];
  if (!cue || cue.kind !== 'inst') return null;
  const names = cue.section.instruments.map((k) => instrument(k)?.name ?? k);
  const p = instPresence(cue, t);
  return (
    <figure className="ms-plate" style={{ opacity: 0.35 + 0.65 * p }}>
      <p className="ms-kicker">
        {cue.section.label}
        {cue.section.performers?.length ? ` · ${cue.section.performers.join(', ')}` : ''}
      </p>
      <Engravings keys={cue.section.instruments} />
      <figcaption>{names.join(' · ')}</figcaption>
    </figure>
  );
}

function Player() {
  const { song, setView, dark } = useLab();
  return (
    <div className="screen ms-screen">
      <Field song={song} t={0} mode="paper" dark={dark} />
      <Head back={() => setView('stage')} title={song.title} aside="Плеер" />
      <div className="ms-player">
        <Now />
        <div className="ms-deck">
          <div className="ms-timebar">
            <TimeRead />
            <MarkControl />
          </div>
          <Rail />
          <Transport />
          <Tasks />
        </div>
      </div>
      <Sheets />
    </div>
  );
}

function Now() {
  const { timeline, t } = useLab();
  if (!timeline) return null;
  const cue = timeline.cues[timeline.ownerAt(t)];
  if (!cue) return null;
  if (cue.kind === 'inst') return <p className="ms-now">{cue.section.label}</p>;
  return (
    <div className="ms-now">
      <Verse line={cue.line} />
    </div>
  );
}

function Library() {
  const { query, openSong, dark } = useLab();
  const list = filterSongs(query);
  return (
    <div className="screen ms-screen">
      <header className="ms-lib-head">
        <p className="ms-imprint">Живые слова</p>
        <h1>Песни</h1>
        <Find />
      </header>
      <ul className="ms-lib">
        {list.map((song) => (
          <li key={song.slug}>
            <button type="button" className="ms-row" onClick={() => openSong(song.slug)}>
              <Field song={song} t={song.duration * 0.2} mode="paper" dark={dark} />
              <span className="ms-tick" style={{ background: dark ? song.palette.accentDark : song.palette.accent }} />
              <span className="ms-row-text">
                <span className="ms-row-title">{song.title}</span>
                {song.titleOriginal ? <span className="ms-row-orig">{song.titleOriginal}</span> : null}
                <span className="ms-row-meta">{songMeta(song)}</span>
                {song.timing.status === 'draft' ? <span className="ms-draft">Черновые тайм-коды</span> : null}
              </span>
              <span className="ms-dur">{formatTime(song.duration)}</span>
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 ? <p className="ms-empty">Ничего не найдено.</p> : null}
    </div>
  );
}

export function Manuscript() {
  const { view } = useLab();
  if (view === 'library') return <Library />;
  if (view === 'player') return <Player />;
  return <Stage />;
}
