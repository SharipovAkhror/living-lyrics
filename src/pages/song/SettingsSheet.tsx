import { useEffect, useRef, useState } from 'react';
import { Group, Row, Segmented, Sheet, Slider, Switch } from '@/components/controls';
import { Icon } from '@/icons/Icon';
import { loadFontLabels, ORIGINAL_FONTS, PERSIAN_FONTS, TRANSLATION_FONTS, type FontFace } from '@/app/fontCatalog';
import { setSettings, type Settings } from '@/app/settings';
import { EQ_FREQS, EQ_PRESETS, formatFreq, presetById } from '@/player/eq';
import type { AudioEngine, EngineState } from '@/player/engine';
import type { Song } from '@/data/schema';

const RATES = [0.75, 0.85, 1, 1.15, 1.25];
const isIOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * All settings in one sheet. Rows never appear or disappear while you use the sheet (only per song:
 * no transliteration row for a song without one), so nothing jumps under the finger; the equalizer
 * opens as its own page inside the sheet. Every change is saved on this device at once.
 */
export function SettingsSheet({
  open,
  onClose,
  song,
  engine,
  state,
  settings,
  has,
}: {
  open: boolean;
  onClose: () => void;
  song: Song;
  engine: AudioEngine;
  state: EngineState | null;
  settings: Settings;
  has: { translit: boolean; alt: boolean; persian: boolean };
}) {
  const [page, setPage] = useState<'main' | 'eq'>('main');
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) void loadFontLabels();
  }, [open]);

  const close = () => {
    onClose();
    setTimeout(() => setPage('main'), 400);
  };

  const setEq = (patch: Partial<Pick<Settings, 'eqEnabled' | 'eqBands' | 'eqPreamp' | 'eqPreset'>>) => {
    const next = { ...settings, ...patch };
    setSettings(patch);
    engine.setEffects(next.eqEnabled, next.eqBands, next.eqPreamp);
  };

  if (page === 'eq') {
    return (
      <Sheet open={open} onClose={close} title="Эквалайзер" size="large" onBack={() => setPage('main')} backLabel="Настройки">
        <Group
          footer={
            isIOS
              ? 'Пока эквалайзер включён, iPhone останавливает звук при блокировке экрана. Выключите его, чтобы слушать с заблокированным экраном.'
              : 'Эквалайзер работает только с подключённым аудио.'
          }
        >
          <Row title="Эквалайзер">
            <Switch label="Эквалайзер" checked={settings.eqEnabled} onChange={(v) => setEq({ eqEnabled: v })} />
          </Row>
        </Group>
        <div className={`eq-page${settings.eqEnabled ? '' : ' is-off'}`} aria-disabled={!settings.eqEnabled}>
          <div className="eq-presets">
            {EQ_PRESETS.map((p) => (
              <button
                key={p.id}
                disabled={!settings.eqEnabled}
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
                <span className="t-caption2 tabular secondary">
                  {settings.eqBands[i] > 0 ? '+' : ''}
                  {settings.eqBands[i].toFixed(0)}
                </span>
                <Slider
                  vertical
                  label={`${formatFreq(f)} Гц`}
                  min={-12}
                  max={12}
                  step={0.5}
                  center={0}
                  value={settings.eqBands[i]}
                  onChange={(v) => {
                    if (!settings.eqEnabled) return;
                    const bands = [...settings.eqBands];
                    bands[i] = v;
                    setEq({ eqBands: bands, eqPreset: 'custom' });
                  }}
                />
                <span className="t-caption2 tertiary">{formatFreq(f)}</span>
              </div>
            ))}
          </div>
          <Group>
            <Row title="Сбросить" detail={presetById(settings.eqPreset).id === settings.eqPreset ? presetById(settings.eqPreset).name : 'Своя настройка'}>
              <button
                className="btn btn-capsule btn-sm btn-gray"
                disabled={!settings.eqEnabled}
                onClick={() => setEq({ eqPreset: 'flat', eqBands: new Array(10).fill(0), eqPreamp: 0 })}
              >
                Сбросить
              </button>
            </Row>
          </Group>
        </div>
      </Sheet>
    );
  }

  const sourceLabel = state?.source === 'library' ? 'Запись из библиотеки' : state?.source === 'local' ? (state.localName ?? 'Свой файл') : 'Аудио не подключено';

  return (
    <Sheet open={open} onClose={close} title="Настройки" size="large">
      <Group header="Текст" footer="Оригинал показывается всегда — на том языке и тем письмом, которыми поют.">
        <Row title="Перевод на русский">
          <Switch label="Перевод" checked={settings.showTranslation} onChange={(v) => setSettings({ showTranslation: v })} />
        </Row>
        {has.translit && (
          <Row title="Как произносится" detail="Транскрипция кириллицей">
            <Switch label="Транскрипция" checked={settings.showTranslit} onChange={(v) => setSettings({ showTranslit: v })} />
          </Row>
        )}
        {has.alt && (
          <Row title="Историческое письмо" detail="Например, Физули арабской графикой">
            <Switch label="Историческое письмо" checked={settings.showAlt} onChange={(v) => setSettings({ showAlt: v })} />
          </Row>
        )}
        <Row title="Пояснения" detail="Короткий комментарий под текстом: то, что не вошло в перевод">
          <Switch label="Пояснения" checked={settings.showComment} onChange={(v) => setSettings({ showComment: v })} />
        </Row>
        <div className="row row--control row--slider">
          <span className="t-footnote secondary" aria-hidden>
            А
          </span>
          <Slider label="Размер текста" min={0.8} max={1.3} step={0.05} value={settings.textScale} onChange={(v) => setSettings({ textScale: v })} />
          <span className="t-title3 secondary" aria-hidden>
            А
          </span>
        </div>
      </Group>

      <Group header="Шрифты" footer="Арабский текст всегда шрифтом Мединского Мусхафа. Насталик — для тех, кто к нему привык.">
        {has.persian && (
          <FontPick label="Персидский" value={settings.fontPersian} options={PERSIAN_FONTS} onChange={(fontPersian) => setSettings({ fontPersian })} />
        )}
        <FontPick label="Оригинал латиницей и кириллицей" value={settings.fontOriginal} options={ORIGINAL_FONTS} onChange={(fontOriginal) => setSettings({ fontOriginal })} />
        <FontPick label="Перевод" value={settings.fontTranslation} options={TRANSLATION_FONTS} onChange={(fontTranslation) => setSettings({ fontTranslation })} />
      </Group>

      <Group header="Слушать" footer="Пауза после строки — чтобы разбирать текст по строке: «Воспроизвести» продолжает со следующей.">
        <Row title="Пауза после каждой строки">
          <Switch label="Пауза после каждой строки" checked={settings.pauseAfterLine} onChange={(v) => setSettings({ pauseAfterLine: v })} />
        </Row>
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
        {song.audio.saver && (
          <div className="row row--control">
            <Segmented
              label="Качество"
              value={settings.quality}
              options={[
                { value: 'high', label: 'Высокое качество' },
                { value: 'saver', label: 'Экономия трафика' },
              ]}
              onChange={(q) => {
                setSettings({ quality: q });
                engine.setQuality(q);
              }}
            />
          </div>
        )}
        {!isIOS && (
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
        )}
        <Row title="Выравнивать громкость" detail="Все песни звучат одинаково громко">
          <Switch
            label="Выравнивать громкость"
            checked={settings.normalize}
            onChange={(v) => {
              setSettings({ normalize: v });
              engine.setNormalize(v);
            }}
          />
        </Row>
        <Row title="Эквалайзер" onClick={() => setPage('eq')} chevron>
          <span className="secondary">{settings.eqEnabled ? presetById(settings.eqPreset).name : 'Выкл.'}</span>
        </Row>
      </Group>

      <Group header="Оформление" footer="При системной настройке «Уменьшение движения» анимация отключается сама.">
        <div className="row row--control">
          <Segmented
            label="Тема"
            value={settings.theme}
            options={[
              { value: 'auto', label: 'Как в системе' },
              { value: 'light', label: 'Светлая' },
              { value: 'dark', label: 'Тёмная' },
            ]}
            onChange={(v) => setSettings({ theme: v })}
          />
        </div>
        <div className="row row--control">
          <Segmented
            label="Анимация"
            value={settings.motion}
            options={[
              { value: 'full', label: 'Полная' },
              { value: 'calm', label: 'Спокойная' },
              { value: 'off', label: 'Без анимации' },
            ]}
            onChange={(v) => setSettings({ motion: v })}
          />
        </div>
      </Group>

      <Group header="Запись" footer={state?.source === 'local' ? 'Свой файл хранится только на этом устройстве.' : 'Подойдут m4a, mp3, wav и flac; файл останется только на этом устройстве.'}>
        <Row icon={<Icon name="music.note" size={20} />} title={sourceLabel} detail={state?.error ?? undefined} />
        <Row icon={<Icon name="square.and.arrow.down" size={20} />} title="Подключить свой файл…" onClick={() => input.current?.click()} chevron />
        {state?.source === 'local' && <Row icon={<Icon name="xmark" size={18} />} title="Убрать свой файл" onClick={() => void engine.detachFile()} />}
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
    </Sheet>
  );
}

function FontPick<Id extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Id;
  options: FontFace<Id>[];
  onChange: (id: Id) => void;
}) {
  return (
    <div className="font-pick" role="radiogroup" aria-label={label}>
      <div className="font-pick-label t-footnote secondary">{label}</div>
      {options.map((face) => (
        <button
          key={face.id}
          type="button"
          role="radio"
          aria-checked={value === face.id}
          className={`font-opt${value === face.id ? ' is-on' : ''}`}
          onClick={() => onChange(face.id)}
        >
          <span className="font-opt-name" style={{ fontFamily: face.stack }}>
            {face.name}
          </span>
          <span className="font-opt-note">{face.note}</span>
        </button>
      ))}
    </div>
  );
}
