import type { FontPersian } from '@/app/settings';
import { Group, Row, Sheet } from '@/ui/controls';
import { LANG_NAMES, formatTime } from '@/data/library';
import { linkHandler } from '@/app/router';
import type { Lyrics, Song } from '@/data/schema';
import { instrument } from '@/instruments/catalog';
import { MarksSection } from './MarksSection';
import { PartsSection } from './PartsSection';

const TIMING: Record<Song['timing']['status'], string> = {
  draft: 'Черновые: время слов оценено, а не измерено по записи — возможны отставания',
  aligned: 'Выровнены по записи автоматически',
  verified: 'Выровнены и проверены',
};

/** "About this song": composition, who sings, who plays, which recording, how exact the timing is. */
export function InfoSheet({
  open,
  onClose,
  song,
  lyrics,
  showHarakat,
  fontPersian,
  onSeek,
  pendingNote,
}: {
  open: boolean;
  onClose: () => void;
  song: Song;
  lyrics: Lyrics | null;
  showHarakat: boolean;
  fontPersian: FontPersian;
  /** Jump to a marked moment. Playback keeps its current play or pause state. */
  onSeek: (t: number) => void;
  /** Shown while the line list is still on its way, or when it failed. */
  pendingNote?: string | null;
}) {
  const voices = new Set<string>();
  const players = new Map<string, Set<string>>();
  for (const s of lyrics?.sections ?? []) {
    if (s.kind === 'vocal') {
      if (s.voice) voices.add(s.voice);
      for (const l of s.lines) if (l.voice) voices.add(l.voice);
    } else {
      for (const k of s.instruments) {
        const name = instrument(k)?.name ?? k;
        if (!players.has(name)) players.set(name, new Set());
      }
      const lead = s.instruments[0];
      if (lead) s.performers?.forEach((p) => players.get(instrument(lead)?.name ?? lead)?.add(p));
    }
  }
  const perf = song.performance;
  const where = [perf?.event, perf?.venue, perf?.city, perf?.date].filter(Boolean).join(' · ');

  return (
    <Sheet open={open} onClose={onClose} title="О песне" size="large">
      <div className="info-head">
        <div className="t-title2">{song.title}</div>
        {song.titleOriginal && (
          <div className="info-original f-mushaf" dir="rtl">
            {song.titleOriginal}
          </div>
        )}
        <div className="t-subhead secondary">
          {song.artist}
          {song.featuring?.length ? ` · ${song.featuring.join(', ')}` : ''}
        </div>
      </div>

      {pendingNote && <p className="sheet-wait t-footnote secondary">{pendingNote}</p>}

      <PartsSection
        song={song}
        lyrics={lyrics}
        showHarakat={showHarakat}
        fontPersian={fontPersian}
        onSeek={onSeek}
      />

      <MarksSection slug={song.slug} title={song.title} open={open} onSeek={onSeek} />

      {(voices.size > 0 || song.credits?.length) && (
        <Group header="Кто поёт и играет">
          {[...voices].map((v) => (
            <Row key={v} title={v} detail="Голос" />
          ))}
          {song.credits?.map((c) => (
            <Row key={c.role + c.name} title={c.name} detail={c.role} />
          ))}
        </Group>
      )}

      {players.size > 0 && (
        <Group header="Инструменты">
          {[...players].map(([name, who]) => (
            <Row key={name} title={name} detail={who.size ? [...who].join(', ') : undefined} />
          ))}
        </Group>
      )}

      {!song.parts?.length && song.poets?.length ? (
        <Group header="Чьи слова">
          {song.poets.map((p) => (
            <Row key={p.name} title={p.name} detail={[p.lang ? LANG_NAMES[p.lang] : null, p.era].filter(Boolean).join(', ')} />
          ))}
        </Group>
      ) : null}

      <Group header="Запись">
        {where && <Row title={where} detail={song.release?.album} />}
        <Row title="Длительность" detail={formatTime(song.duration)} />
        <Row title="Языки" detail={song.languages.map((l) => LANG_NAMES[l] ?? l).join(', ')} />
        <Row title="Тайм-коды" detail={TIMING[song.timing.status]} />
      </Group>

      <Group>
        <a className="row row--button" href="/method" onClick={linkHandler('/method')}>
          <span className="row-text">
            <span className="row-title">Как сделана эта страница</span>
            <span className="row-detail t-footnote">Методология: тексты, перевод, синхронизация</span>
          </span>
        </a>
      </Group>
    </Sheet>
  );
}
