/**
 * /instruments — the catalogue of engravings and a playground for multi-instrument layouts.
 * Default export; the route is wired in src/app (not here). Styles: src/styles/instruments.css (ig-…).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INSTRUMENTS, hasArt, instrumentSvg, loadInstrumentSvg, scopeSvgIds, type InstrumentInfo } from '@/instruments/catalog';
import { LAYOUT_MODES, LAYOUT_NAMES, type Layout, type LayoutMode } from '@/instruments/layout';
import { InstrumentStage } from '@/scene/InstrumentStage';
import { linkHandler } from '@/app/router';
import { Icon } from '@/icons/Icon';

const FAMILIES: InstrumentInfo['family'][] = ['струнные щипковые', 'струнные ударные', 'смычковые', 'духовые', 'ударные', 'клавишные', 'голоса', 'ансамбль'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MAX_PICK = 6;

export default function InstrumentsPage() {
  const groups = useMemo(() => FAMILIES.map((family) => ({ family, items: INSTRUMENTS.filter((i) => i.family === family) })).filter((g) => g.items.length), []);
  const drawn = INSTRUMENTS.filter((i) => hasArt(i.key)).length;

  return (
    <div className="ig">
      <header className="ig-top">
        <a className="btn btn-circle glass" href="/" onClick={linkHandler('/')} aria-label="К списку песен">
          <Icon name="chevron.left" size={20} weight={2.2} />
        </a>
      </header>

      <div className="ig-head">
        <h1 className="t-large-title">Инструменты</h1>
        <p className="t-body secondary">
          Гравюры, которые сцена показывает в инструментальных частях песен: {drawn} из {INSTRUMENTS.length} в каталоге. Если играют несколько инструментов сразу, сцена раскладывает их сама — это можно попробовать внизу страницы.
        </p>
      </div>

      <section aria-labelledby="ig-catalogue">
        <h2 id="ig-catalogue" className="visually-hidden">
          Каталог
        </h2>
        {groups.map((g) => (
          <div key={g.family}>
            <h3 className="ig-family t-headline">{cap(g.family)}</h3>
            <ul className="ig-grid">
              {g.items.map((info) => (
                <li key={info.key}>
                  <Card info={info} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <Playground />
    </div>
  );
}

/* ---------- Catalogue card ---------- */

function Card({ info }: { info: InstrumentInfo }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState(() => (hasArt(info.key) ? instrumentSvg(info.key) : ''));
  // Load the engraving when the card comes near the viewport
  useEffect(() => {
    if (svg || !hasArt(info.key)) return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void loadInstrumentSvg(info.key).then((s) => alive && setSvg(s));
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [info.key, svg]);
  const html = useMemo(() => scopeSvgIds(svg, `card${info.key.replace(/[^a-z0-9]/g, '')}`), [svg, info.key]);

  return (
    <article className="ig-card">
      <div ref={ref} className="ig-card-art">
        {svg ? <div className="ist-art" aria-hidden dangerouslySetInnerHTML={{ __html: html }} /> : null}
        {!hasArt(info.key) ? <span className="ig-noart t-footnote">Гравюры пока нет — сцена покажет ансамбль</span> : null}
      </div>
      <div className="ig-card-text">
        <div className="ig-card-name">
          <span className="t-headline">{info.name}</span>
          {info.native ? (
            <span className="ig-native t-subhead" dir="auto">
              {info.native}
            </span>
          ) : null}
        </div>
        {info.origin ? <div className="ig-meta t-footnote">{info.origin}</div> : null}
        <p className="ig-desc t-footnote">{info.description}</p>
        <div className="ig-key">{info.key}</div>
      </div>
    </article>
  );
}

/* ---------- Layout playground ---------- */

const SCREENS = [
  { id: 'phone', name: 'iPhone', w: 390, h: 600 },
  { id: 'desktop', name: 'Компьютер', w: 1200, h: 700 },
] as const;

function Playground() {
  const [picked, setPicked] = useState<string[]>(['oud', 'qanun', 'ney']);
  const [mode, setMode] = useState<LayoutMode | 'auto'>('auto');
  const [draw, setDraw] = useState(1);
  const [withPerformers, setWithPerformers] = useState(false);
  const options = INSTRUMENTS.filter((i) => hasArt(i.key) && i.key !== 'ensemble');

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length < MAX_PICK ? [...p, key] : p));
  const performers = withPerformers ? picked.map((k) => `Имя исполнителя (${INSTRUMENTS.find((i) => i.key === k)?.name ?? k})`) : undefined;

  return (
    <section className="ig-section" aria-labelledby="ig-play">
      <h2 id="ig-play" className="t-title2">
        Расстановка
      </h2>
      <p className="t-callout secondary">
        Выберите от одного до шести инструментов; первый выбранный — ведущий. «Авто» подбирает раскладку по числу инструментов и размеру экрана и не даёт гравюре стать меньше читаемой — лишние уходят в «+N». Остальные режимы можно задать песне вручную полем <code>layout</code>.
      </p>
      <div className="ig-play">
        <div className="ig-row" role="group" aria-label="Инструменты">
          <span className="ig-row-title t-footnote">Инструменты · {picked.length} из {MAX_PICK}</span>
          {options.map((i) => {
            const n = picked.indexOf(i.key);
            return (
              <button key={i.key} type="button" className="ig-pick" aria-pressed={n >= 0} disabled={n < 0 && picked.length >= MAX_PICK} onClick={() => toggle(i.key)}>
                {n >= 0 ? <span className="ig-pick-n">{n + 1}</span> : null}
                {i.name}
              </button>
            );
          })}
        </div>
        <div className="ig-row" role="radiogroup" aria-label="Раскладка">
          <span className="ig-row-title t-footnote">Раскладка</span>
          {(['auto', ...LAYOUT_MODES] as const).map((m) => (
            <button key={m} type="button" role="radio" className="ig-pick" aria-checked={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'auto' ? 'Авто' : LAYOUT_NAMES[m]}
            </button>
          ))}
        </div>
        <div className="ig-row">
          <label className="ig-slider t-footnote">
            <span>Прорисовка</span>
            <input type="range" min={0} max={1} step={0.01} value={draw} onChange={(e) => setDraw(+e.target.value)} aria-label="Прорисовка" />
            <span className="tabular">{Math.round(draw * 100)} %</span>
          </label>
          <button type="button" className="ig-pick" aria-pressed={withPerformers} onClick={() => setWithPerformers((v) => !v)}>
            Строка исполнителя
          </button>
        </div>
        {picked.length ? (
          <div className="ig-screens">
            {SCREENS.map((s) => (
              <Screen key={s.id} name={s.name} w={s.w} h={s.h} keys={picked} mode={mode} draw={draw} performers={performers} />
            ))}
          </div>
        ) : (
          <p className="t-footnote secondary">Выберите хотя бы один инструмент.</p>
        )}
      </div>
    </section>
  );
}

/** A screen of a given size, scaled down to fit the column, with the stage inside. */
function Screen({ name, w, h, keys, mode, draw, performers }: { name: string; w: number; h: number; keys: string[]; mode: LayoutMode | 'auto'; draw: number; performers?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(w);
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const k = Math.min(1, avail / w);
  const pad = 12;
  const onLayout = useCallback((l: Layout) => setLayout(l), []);
  const size = useMemo(() => ({ w: w - 2 * pad, h: h - 2 * pad }), [w, h]);

  return (
    <figure className="ig-screen" style={{ margin: 0 }}>
      <div ref={ref} style={{ width: '100%' }}>
        <div className="ig-screen-frame" style={{ width: w * k, height: h * k }}>
          <div className="ig-screen-inner" style={{ width: w, height: h, transform: `scale(${k})` }}>
            <div style={{ position: 'absolute', left: pad, top: pad }}>
              <InstrumentStage keys={keys} performers={performers} mode={mode} progress={draw} presence={1} size={size} onLayout={onLayout} />
            </div>
          </div>
        </div>
      </div>
      <figcaption className="ig-screen-meta t-footnote">
        <span>
          {name} · {w} × {h}
        </span>
        {layout ? (
          <span>
            {LAYOUT_NAMES[layout.mode]}
            {layout.fallback ? ' (авто)' : ''} · {layout.minArt} px{layout.hidden.length ? ` · +${layout.hidden.length}` : ''}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
