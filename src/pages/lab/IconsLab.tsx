/**
 * Comparison sheet for five icon treatments. The live site is unchanged.
 * Open /lab/icons?v=A&theme=dark for one phone, or ?sheet=all for the row.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { getSong, formatTime } from '@/data/library';
import { useSongAccent } from '@/app/theme';
import { Field } from '@/scene/Field';
import { Icon } from '@/ui/icons';
import { SET_A, SET_B, SET_C, SET_D, type LabDrawing, type LabIconName } from './iconSets';
import './icons-lab.css';

const VARIANTS = ['A', 'B', 'C', 'D', 'E'] as const;
type VariantId = (typeof VARIANTS)[number];

const DRAWINGS: Record<Exclude<VariantId, 'E'>, Record<LabIconName, LabDrawing>> = {
  A: SET_A,
  B: SET_B,
  C: SET_C,
  D: SET_D,
};

/** Glyphs that are not already in the header or the player capsule. */
const REST: LabIconName[] = [
  'magnifyingglass',
  'square.grid.2x2',
  'book.pages',
  'speaker.wave.2',
  'square.and.arrow.down',
  'chevron.down',
  'chevron.right',
  'chevron.up',
  'music.note',
  'xmark',
];

/** Karitas, section voice-4, a wordless voice at this second. */
const NOW = 313;

function isVariant(value: string | null): value is VariantId {
  return VARIANTS.some((id) => id === value);
}

function LabGlyph({ drawing, size, style }: { drawing: LabDrawing; size: number; style?: CSSProperties }) {
  if ('html' in drawing) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={drawing.viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
        aria-hidden
        focusable="false"
        dangerouslySetInnerHTML={{ __html: drawing.html }}
      />
    );
  }
  return (
    <svg width={size} height={size} viewBox={drawing.viewBox} fill="currentColor" style={style} aria-hidden focusable="false">
      <path d={drawing.d} />
    </svg>
  );
}

function Phone({ variant, dark }: { variant: VariantId; dark: boolean }) {
  const song = getSong('karitas');
  if (!song) return <p className="empty">Песня не найдена</p>;
  const words = variant === 'E';
  const drawings = words ? null : DRAWINGS[variant];
  const glyph = (name: LabIconName, size: number, style?: CSSProperties) =>
    drawings ? <LabGlyph drawing={drawings[name]} size={size} style={style} /> : <Icon name={name} size={size} style={style} />;
  const progress = NOW / song.duration;

  return (
    <div className="song" data-lab={variant} style={{ background: dark ? '#07060c' : (song.palette.field[2] ?? song.palette.field[0]) }}>
      <Field colors={song.palette.field} dark={dark} t={380} still />
      <header className="topbar glass">
        <button type="button" className="btn btn-circle btn-plain" aria-label="К списку песен">
          {glyph('chevron.left', 20)}
        </button>
        <div className="topbar-title">
          <div className="topbar-song">{song.title}</div>
          <div className="topbar-section">Голос</div>
        </div>
        {words ? (
          <span className="lab-word glass">О песне</span>
        ) : (
          <button type="button" className="btn btn-circle btn-plain" aria-label="О песне">
            {glyph('info.circle', 21)}
          </button>
        )}
      </header>

      <div className="lab-rest glass">
        {words ? (
          <p>
            Во вкладках слова. Значки остаются у пуска, паузы, назад, вперёд и{' '}
            <span className="lab-rest-icon">{glyph('xmark', 18)}</span>
          </p>
        ) : (
          <>
            <p>Остальные значки</p>
            {REST.map((name) => (
              <span key={name} className="lab-rest-icon">
                {glyph(name, 22)}
              </span>
            ))}
          </>
        )}
      </div>

      <footer className="player glass">
        <div className="scrub">
          <span className="scrub-now">{formatTime(NOW)}</span>
          {words ? (
            <button type="button" className="mark-btn lab-mark-word">
              Не совпадает
            </button>
          ) : (
            <div className="mark-bar">
              <button type="button" className="mark-btn" aria-label="Не совпадает">
                {glyph('flag', 18)}
              </button>
            </div>
          )}
          <div className="scrub-track">
            <div className="scrub-rail">
              <div className="scrub-fill" style={{ transform: `scaleX(${progress})` }} />
            </div>
          </div>
          <span className="scrub-remain">−{formatTime(Math.max(0, song.duration - NOW))}</span>
        </div>
        <div className="transport">
          <button type="button" className="btn btn-plain btn-lg-hit" aria-label="Предыдущая строка">
            {glyph('backward', 22)}
          </button>
          <button type="button" className="btn btn-circle btn-xl btn-ring" aria-label="Воспроизвести">
            {glyph('play', 26, { marginLeft: 2 })}
          </button>
          <button type="button" className="btn btn-plain btn-lg-hit" aria-label="Следующая строка">
            {glyph('forward', 22)}
          </button>
        </div>
        <div className={`utility${words ? ' lab-words' : ''}`}>
          {words ? (
            <>
              <button type="button" className="util glass" aria-pressed="true">
                Перевод
              </button>
              <button type="button" className="util glass">
                Пояснение
              </button>
              <button type="button" className="util glass">
                Весь текст
              </button>
              <button type="button" className="util glass">
                Настройки
              </button>
            </>
          ) : (
            <>
              <button type="button" className="util" aria-pressed="true" aria-label="Перевод">
                {glyph('character.bubble', 22)}
                <span className="util-label">Перевод</span>
              </button>
              <button type="button" className="util" aria-label="Пояснение">
                {glyph('book.closed', 22)}
                <span className="util-label">Пояснение</span>
              </button>
              <button type="button" className="util" aria-label="Весь текст">
                {glyph('list.bullet', 22)}
                <span className="util-label">Весь текст</span>
              </button>
              <button type="button" className="util" aria-label="Настройки">
                {glyph('slider.horizontal.3', 22)}
                <span className="util-label">Настройки</span>
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

export function IconsLab() {
  const params = new URLSearchParams(location.search);
  const sheet = params.get('sheet') === 'all';
  const requested = params.get('v');
  const variant: VariantId = isVariant(requested) ? requested : 'A';
  const theme = params.get('theme') === 'light' ? 'light' : 'dark';
  const song = getSong('karitas');
  useSongAccent(song);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = theme;
    };
    // App applies the saved theme in its own effect, which runs after this one.
    apply();
    const soon = window.setTimeout(apply, 0);
    const later = window.setTimeout(() => {
      apply();
      setReady(true);
    }, 60);
    return () => {
      window.clearTimeout(soon);
      window.clearTimeout(later);
    };
  }, [theme]);

  const dark = theme === 'dark';
  if (sheet) {
    return (
      <div className="lab-sheet" data-lab-ready={ready ? '' : undefined}>
        {VARIANTS.map((id) => (
          <figure key={id}>
            <figcaption>{id}</figcaption>
            <div className="lab-phone">
              <Phone variant={id} dark={dark} />
            </div>
          </figure>
        ))}
      </div>
    );
  }
  return (
    <div className="lab-one" data-lab-ready={ready ? '' : undefined}>
      <Phone variant={variant} dark={dark} />
    </div>
  );
}
