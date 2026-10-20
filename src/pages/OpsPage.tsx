/**
 * /ops — the work status for the owner in a browser or on the phone: the same data as the
 * Dashboard mod (ops/dashboard-mod). Read live from GitHub (the repo is public), so a board change
 * needs no deploy: ops/board.json and ops/usage/latest.json from main, the executors' live state
 * from the `live` branch (ops/agents/publish_live.py). Lazy route; styles in src/styles/ops.css.
 */
import { useEffect, useState } from 'react';
import { linkHandler } from '@/app/router';
import { Icon } from '@/ui/icons';

import '@/styles/ops.css';

const RAW = 'https://raw.githubusercontent.com/SharipovAkhror/living-lyrics';
const BOARD_URL = `${RAW}/main/ops/board.json`;
const USAGE_URL = `${RAW}/main/ops/usage/latest.json`;
const LIVE_URL = `${RAW}/refs/heads/live/ops/live.json`;
const POLL_MS = 120_000;
const STALE_MIN = 45;

type Task = { id: string; section: 'you' | 'now' | 'done' | 'later'; status?: string; title: string; what?: string; now?: string; how?: string; next?: string; who?: string; date?: string };
type Group = { name: string; proven: number; placed?: number; total: number };
type Board = {
  updated?: string;
  headline?: string;
  claude?: string;
  tasks: Task[];
  songs: { id: string; title: string; state?: string; groups: Group[] }[];
  roadmap?: { title: string; percent: number };
};
type Live = { at?: string; grok: { name: string; state: string; minutes: number; step: string }[]; gemini: { slug: string; minutes: number }[] };
type Quota = { weeklyRemaining?: number; fiveHourRemaining?: number };
type Usage = { grok?: { plan?: string; today?: number }; gemini?: { plan?: string; quota?: Record<string, Quota> } };

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function minutesSince(iso?: string, now = Date.now()) {
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)) : null;
}

function ago(minutes: number | null) {
  if (minutes === null) return 'время неизвестно';
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин назад`;
  return `${Math.floor(minutes / 1440)} д назад`;
}

const GROK_STATE: Record<string, string> = { working: 'работает', stalled: 'остановился', finished: 'закончил', none: 'ждёт' };
const STATUS: Record<string, string> = { running: 'идёт', waiting: 'ждёт', done: 'готово', rejected: 'отклонено' };

function tokens(n?: number) {
  if (!n) return '0';
  return n >= 1e6 ? `${Math.round(n / 1e6)} М` : `${Math.round(n / 1e3)} К`;
}

function Bar({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <span className="ops-bar" role="img" aria-label={`${pct} %`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

export default function OpsPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [b, l, u] = await Promise.all([fetchJson<Board>(BOARD_URL), fetchJson<Live>(LIVE_URL), fetchJson<Usage>(USAGE_URL)]);
      if (!alive) return;
      if (b) setBoard(b);
      setFailed(!b);
      setLive(l);
      setUsage(u);
      setNow(Date.now());
    };
    void load();
    const poll = window.setInterval(load, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  const liveAge = minutesSince(live?.at, now);
  const fresh = live && liveAge !== null && liveAge < STALE_MIN ? live : null;
  const you = board?.tasks.filter((t) => t.section === 'you') ?? [];
  const current = board?.tasks.filter((t) => t.section === 'now') ?? [];
  const gemini = usage?.gemini?.quota?.gemini;

  return (
    <div className="ops">
      <header className="ops-top">
        <a className="btn btn-circle btn-plain" href="/" onClick={linkHandler('/')} aria-label="К списку песен">
          <Icon name="chevron.left" size={22} />
        </a>
        <span className="t-headline">Ход работы</span>
        <span style={{ width: 44 }} />
      </header>

      {!board ? (
        <p className="empty t-body secondary">{failed ? 'GitHub не ответил. Попробуем ещё раз через две минуты.' : 'Загружаем доску'}</p>
      ) : (
        <>
          <section className="ops-card glass">
            {board.headline && <p className="t-body">{board.headline}</p>}
            <p className="t-footnote secondary">
              Доска обновлена {ago(minutesSince(board.updated, now))}
              {board.roadmap ? ` · ${board.roadmap.title}: ${board.roadmap.percent} %` : ''}
            </p>
          </section>

          {you.length > 0 && (
            <section className="ops-card glass ops-card--you" aria-labelledby="ops-you">
              <h2 id="ops-you" className="t-headline">Нужно от вас</h2>
              <ul>
                {you.map((t) => (
                  <li key={t.id}>
                    <p className="t-subhead">{t.title}</p>
                    {(t.what || t.how) && <p className="t-footnote secondary">{t.what ?? t.how}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="ops-card glass" aria-labelledby="ops-agents">
            <h2 id="ops-agents" className="t-headline">Кто что делает</h2>
            <ul>
              {board.claude && (
                <li>
                  <p className="t-subhead">Claude</p>
                  <p className="t-footnote secondary">{board.claude}</p>
                </li>
              )}
              {fresh?.grok.filter((g) => g.state === 'working' || g.state === 'stalled').map((g) => (
                <li key={g.name}>
                  <p className="t-subhead">
                    Grok · {g.name} <span className={`ops-chip ops-chip--${g.state}`}>{GROK_STATE[g.state] ?? g.state} · {g.minutes} мин</span>
                  </p>
                  {g.step && <p className="t-footnote secondary ops-clamp">{g.step}</p>}
                </li>
              ))}
              {fresh?.gemini.map((g, i) => (
                <li key={`${g.slug}-${i}`}>
                  <p className="t-subhead">
                    Gemini <span className="ops-chip ops-chip--working">смотрит{g.slug ? ` ${g.slug}` : ' видео'} · {g.minutes} мин</span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="t-footnote tertiary">
              {fresh ? `Состояние Станции ${ago(liveAge)}` : 'Станция давно не присылала состояние: возможно, она выключена.'}
            </p>
          </section>

          {current.length > 0 && (
            <section className="ops-card glass" aria-labelledby="ops-now">
              <h2 id="ops-now" className="t-headline">Задачи</h2>
              <ul>
                {current.map((t) => (
                  <li key={t.id}>
                    <p className="t-subhead">
                      {t.title} {t.status && <span className={`ops-chip ops-chip--${t.status}`}>{STATUS[t.status] ?? t.status}</span>}
                    </p>
                    {(t.now || t.what) && <p className="t-footnote secondary">{t.now ?? t.what}</p>}
                    {t.who && <p className="t-footnote tertiary">{t.who}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {board.songs.length > 0 && (
            <section className="ops-card glass" aria-labelledby="ops-songs">
              <h2 id="ops-songs" className="t-headline">Подсветка по словам</h2>
              <ul>
                {board.songs.flatMap((s) =>
                  s.groups.map((g) => (
                    <li key={`${s.id}-${g.name}`} className="ops-song">
                      <span className="t-subhead">
                        {s.title}
                        {s.groups.length > 1 ? ` · ${g.name.toLowerCase()}` : ''}
                      </span>
                      <span className="t-footnote secondary tabular">
                        {g.proven}/{g.total}
                      </span>
                      <Bar value={g.proven} total={g.total} />
                    </li>
                  )),
                )}
              </ul>
            </section>
          )}

          {usage && (
            <section className="ops-card glass" aria-labelledby="ops-limits">
              <h2 id="ops-limits" className="t-headline">Лимиты</h2>
              <p className="t-footnote secondary">
                {gemini ? `Gemini: 5 ч — осталось ${Math.round(gemini.fiveHourRemaining ?? 0)} %, неделя — ${Math.round(gemini.weeklyRemaining ?? 0)} %` : 'Gemini: нет данных'}
              </p>
              <p className="t-footnote secondary">Grok сегодня: {tokens(usage.grok?.today)} токенов</p>
              <p className="t-footnote tertiary">Лимиты Claude видны в самом приложении Claude.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
