import { useRef, useState } from 'react';
import { Group, Row, Segmented, Sheet, Slider, Switch } from '@/components/controls';
import { Icon } from '@/icons/Icon';
import { setSettings, type Settings } from '@/app/settings';
import { EQ_FREQS, EQ_PRESETS, formatFreq, presetById } from '@/player/eq';
import type { AudioEngine, EngineState } from '@/player/engine';
import type { Song } from '@/data/schema';

const RATES = [0.75, 0.85, 1, 1.15, 1.25];

export function SoundSheet({
  open,
  onClose,
  song,
  engine,
  state,
  settings,
}: {
  open: boolean;
  onClose: () => void;
  song: Song;
  engine: AudioEngine;
  state: EngineState;
  settings: Settings;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const setEq = (patch: Partial<Pick<Settings, 'eqEnabled' | 'eqBands' | 'eqPreamp' | 'eqPreset'>>) => {
    const next = { ...settings, ...patch };
    setSettings(patch);
    engine.setEffects(next.eqEnabled, next.eqBands, next.eqPreamp);
  };

  const sourceLabel =
    state.source === 'library' ? 'Запись из библиотеки' : state.source === 'local' ? state.localName ?? 'Свой файл' : 'Аудио не подключено';

  return (
    <Sheet open={open} onClose={onClose} title="Звук" size="large">
      <Group
        header="Источник"
        footer={
          state.source === 'silent'
            ? 'Без файла «Сцена» идёт по тайм-кодам беззвучно. Подойдут m4a (AAC), mp3 и wav; файл сохранится на этом устройстве.'
            : state.source === 'local'
              ? 'Файл хранится только на этом устройстве.'
              : undefined
        }
      >
        <Row icon={<Icon name="music.note" size={20} />} title={sourceLabel} detail={state.error ?? undefined} />
        <Row icon={<Icon name="square.and.arrow.down" size={20} />} title="Подключить свой файл…" onClick={() => input.current?.click()} chevron />
        {state.source === 'local' && (
          <Row icon={<Icon name="xmark" size={18} />} title="Убрать свой файл" onClick={() => void engine.detachFile()} />
        )}
        <input
          ref={input}
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.aac,.flac,.ogg,.opus"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              setError(null);
              await engine.attachFile(f);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </Group>
      {error && <p className="sheet-error t-footnote">{error}</p>}

      {song.audio.status === 'ready' && song.audio.saver && (
        <Group header="Качество" footer="«Экономия» — AAC 96 кбит/с для мобильной сети. Переключается без паузы.">
          <div className="row row--control">
            <Segmented
              label="Качество"
              value={settings.quality}
              options={[
                { value: 'high', label: 'Высокое' },
                { value: 'saver', label: 'Экономия' },
              ]}
              onChange={(q) => {
                setSettings({ quality: q });
                engine.setQuality(q);
              }}
            />
          </div>
        </Group>
      )}

      <Group header="Скорость" footer="Высота голоса сохраняется. Медленнее — удобно разбирать слова.">
        <div className="row row--control">
          <Segmented
            label="Скорость"
            value={String(settings.rate)}
            options={RATES.map((r) => ({ value: String(r), label: `${String(r).replace('.', ',')}×` }))}
            onChange={(v) => {
              const r = parseFloat(v);
              setSettings({ rate: r });
              engine.setRate(r);
            }}
          />
        </div>
      </Group>

      <Group header="Громкость">
        <div className="row row--control row--slider">
          <Icon name="speaker.wave.2" size={18} className="tertiary" />
          <Slider
            label="Громкость"
            min={0}
            max={1}
            step={0.01}
            value={settings.volume}
            onChange={(v) => {
              setSettings({ volume: v });
              engine.setVolume(v);
            }}
          />
        </div>
        <Row title="Выравнивать громкость" detail="Все песни звучат одинаково громко (−14 LUFS)">
          <Switch
            label="Выравнивать громкость"
            checked={settings.normalize}
            onChange={(v) => {
              setSettings({ normalize: v });
              engine.setNormalize(v);
            }}
          />
        </Row>
      </Group>

      <Group
        header="Эквалайзер"
        footer={
          isIOS && settings.eqEnabled
            ? 'Пока эквалайзер включён, iPhone останавливает звук при блокировке экрана. Выключите его, чтобы слушать с заблокированным экраном.'
            : 'Эквалайзер работает только с подключённым аудио.'
        }
      >
        <Row title="Эквалайзер">
          <Switch label="Эквалайзер" checked={settings.eqEnabled} onChange={(v) => setEq({ eqEnabled: v })} />
        </Row>
        {settings.eqEnabled && (
          <>
            <div className="eq-presets">
              {EQ_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`eq-preset${settings.eqPreset === p.id ? ' is-on' : ''}`}
                  onClick={() => setEq({ eqPreset: p.id, eqBands: [...p.bands], eqPreamp: p.preamp })}
                >
                  <span className="t-subhead">{p.name}</span>
                  <span className="t-caption1 secondary">{p.hint}</span>
                </button>
              ))}
            </div>
            <div className="eq-bands" aria-label="Полосы эквалайзера">
              {EQ_FREQS.map((f, i) => (
                <div key={f} className="eq-band">
                  <span className="t-caption2 tabular secondary">{settings.eqBands[i] > 0 ? '+' : ''}{settings.eqBands[i].toFixed(0)}</span>
                  <Slider
                    vertical
                    label={`${formatFreq(f)} Гц`}
                    min={-12}
                    max={12}
                    step={0.5}
                    center={0}
                    value={settings.eqBands[i]}
                    onChange={(v) => {
                      const bands = [...settings.eqBands];
                      bands[i] = v;
                      setEq({ eqBands: bands, eqPreset: 'custom' });
                    }}
                  />
                  <span className="t-caption2 tertiary">{formatFreq(f)}</span>
                </div>
              ))}
            </div>
            <Row title="Сбросить" detail={presetById(settings.eqPreset).id === settings.eqPreset ? presetById(settings.eqPreset).name : 'Своя настройка'}>
              <button className="btn btn-capsule btn-sm btn-gray" onClick={() => setEq({ eqPreset: 'flat', eqBands: new Array(10).fill(0), eqPreamp: 0 })}>
                Сбросить
              </button>
            </Row>
          </>
        )}
      </Group>
    </Sheet>
  );
}
