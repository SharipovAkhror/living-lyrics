import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Row, Segmented, Sheet, Slider, Switch } from '@/ui/controls';
import { Icon } from '@/ui/icons';
import { loadFontLabels, ORIGINAL_FONTS, PERSIAN_FONTS, TRANSLATION_FONTS, type FontFace } from '@/app/fontCatalog';
import { effectiveMotion, setSettings, type InstrumentStyle, type LineEntrance, type MotionPref, type Settings, type TextAlign, type ThemePref } from '@/app/settings';
import { EQ_FREQS, EQ_PRESETS, formatFreq, presetById } from '@/player/eq';
import type { AudioEngine, EngineState } from '@/player/engine';
import type { Song } from '@/data/schema';

const RATES = [0.75, 0.85, 1, 1.15, 1.25];
const isIOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

type Page = 'home' | 'text' | 'fonts' | 'comment' | 'instruments' | 'sound' | 'look' | 'eq';

const PAGE_TITLE: Record<Page, string> = {
  home: 'Настройки',
  text: 'Текст',
  fonts: 'Шрифты',
  comment: 'Пояснения',
  instruments: 'Инструменты',
  sound: 'Звук',
  look: 'Оформление',
  eq: 'Эквалайзер',
};

const THEME_NAME: Record<ThemePref, string> = { auto: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };
const MOTION_NAME: Record<MotionPref, string> = { full: 'Полная', calm: 'Спокойная', off: 'Без анимации' };
const STYLE_NAME: Record<InstrumentStyle, string> = {
  drawing: 'Рисунок',
  realistic: 'Реалистичный',
};
const ALIGN_NAME: Record<TextAlign, string> = { center: 'По центру', edge: 'По краю' };
const ENTER_NAME: Record<LineEntrance, string> = { flow: 'Потоком', script: 'По письму', settle: 'На месте' };

/**
 * Settings open as a menu of categories, then one category, then back.
 * Rows inside a category stay put, so nothing jumps under the finger.
 * Every change is saved on this device at once. Old keys are migrated in settings.ts.
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
  has: { translit: boolean; alt: boolean; persian: boolean; arab: boolean };
}) {
  const [page, setPage] = useState<Page>('home');
  const [leaving, setLeaving] = useState<Page | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) void loadFontLabels();
  }, [open]);

  // Samples need the faces themselves, not only the latin names. Loaded when this page opens.
  useEffect(() => {
    if (!open || page !== 'fonts') return;
    void Promise.all([
      import('@fontsource/amiri/arabic-400.css'),
      import('@fontsource/noto-naskh-arabic/arabic-400.css'),
      import('@fontsource/scheherazade-new/arabic-400.css'),
      import('@fontsource/noto-nastaliq-urdu/arabic-400.css'),
      import('@fontsource/source-serif-4/latin-600.css'),
      import('@fontsource/source-serif-4/cyrillic-400-italic.css'),
      import('@fontsource/cormorant-garamond/latin-600.css'),
      import('@fontsource/cormorant-garamond/cyrillic-400-italic.css'),
      import('@fontsource/eb-garamond/latin-600.css'),
      import('@fontsource/eb-garamond/cyrillic-400-italic.css'),
      import('@fontsource/literata/latin-600.css'),
      import('@fontsource/literata/cyrillic-400-italic.css'),
    ]);
  }, [open, page]);

  const go = (next: Page) => {
    if (next === page) return;
    const backward = next === 'home' || (page === 'eq' && next === 'sound');
    setDir(backward ? -1 : 1);
    if (effectiveMotion(settings) === 'off') {
      setLeaving(null);
      setPage(next);
      return;
    }
    setLeaving(page);
    setPage(next);
  };

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeaving(null), 440);
    return () => window.clearTimeout(t);
  }, [leaving, page]);

  const close = () => {
    onClose();
    window.setTimeout(() => {
      setPage('home');
      setLeaving(null);
    }, 420);
  };

  const setEq = (patch: Partial<Pick<Settings, 'eqEnabled' | 'eqBands' | 'eqPreamp' | 'eqPreset'>>) => {
    const next = { ...settings, ...patch };
    setSettings(patch);
    engine.setEffects(next.eqEnabled, next.eqBands, next.eqPreamp);
  };

  const back = page === 'home' ? undefined : () => go(page === 'eq' ? 'sound' : 'home');
  const shown: Page[] = leaving && leaving !== page ? [leaving, page] : [page];
  const sourceLabel = state?.source === 'library' ? 'Запись из библиотеки' : state?.source === 'local' ? (state.localName ?? 'Свой файл') : 'Аудио не подключено';
  const persianName = PERSIAN_FONTS.find((f) => f.id === settings.fontPersian)?.name ?? '';
  const originalName = ORIGINAL_FONTS.find((f) => f.id === settings.fontOriginal)?.name ?? '';
  const translationName = TRANSLATION_FONTS.find((f) => f.id === settings.fontTranslation)?.name ?? '';

  return (
    <Sheet open={open} onClose={close} title={PAGE_TITLE[page]} size="large" onBack={back} backLabel={page === 'eq' ? 'Звук' : 'Настройки'}>
      <div className={`set-stage${dir < 0 ? ' is-back' : ''}`}>
        {shown.map((p) => (
          <div key={p} className={`set-page${p === page ? ' is-enter' : ' is-leave'}`}>
      {p === 'home' && (
        <nav className="set-nav" aria-label="Разделы настроек">
          <Group>
            <Row title="Текст" detail={`${ALIGN_NAME[settings.textAlign]} · ${ENTER_NAME[settings.lineEntrance]}`} onClick={() => go('text')} chevron />
            <Row
              title="Шрифты"
              detail={[has.persian ? persianName : null, originalName, translationName].filter(Boolean).join(' · ')}
              onClick={() => go('fonts')}
              chevron
            />
            <Row title="Пояснения" detail={settings.showComment ? 'Показаны' : 'Скрыты'} onClick={() => go('comment')} chevron />
            <Row title="Инструменты" detail={STYLE_NAME[settings.instrumentStyle]} onClick={() => go('instruments')} chevron />
            <Row
              title="Звук"
              detail={`${String(settings.rate).replace('.', ',')}× · ${settings.eqEnabled ? (EQ_PRESETS.some((p) => p.id === settings.eqPreset) ? presetById(settings.eqPreset).name : 'Своя настройка') : 'эквалайзер выключен'}`}
              onClick={() => go('sound')}
              chevron
            />
            <Row title="Оформление" detail={`${THEME_NAME[settings.theme]} · ${MOTION_NAME[settings.motion]}`} onClick={() => go('look')} chevron />
          </Group>
        </nav>
      )}

      {p === 'text' && (
        <>
          <Group header="Что показывать" footer="Оригинал показывается всегда — на том языке и тем письмом, которыми поют.">
            {has.arab && (
              <Row title="Огласовки" detail="Знаки гласных над и под буквами">
                <Switch label="Огласовки" checked={settings.showHarakat} onChange={(v) => setSettings({ showHarakat: v })} />
              </Row>
            )}
            <Row title="Перевод" detail="Русский текст под строкой">
              <Switch label="Перевод" checked={settings.showTranslation} onChange={(v) => setSettings({ showTranslation: v })} />
            </Row>
            {has.translit && (
              <Row title="Транскрипция" detail="Как произносится, кириллицей">
                <Switch label="Транскрипция" checked={settings.showTranslit} onChange={(v) => setSettings({ showTranslit: v })} />
              </Row>
            )}
            {has.alt && (
              <Row title="Второе письмо" detail="Та же строка другим письмом, например Физули арабской графикой">
                <Switch label="Второе письмо" checked={settings.showAlt} onChange={(v) => setSettings({ showAlt: v })} />
              </Row>
            )}
          </Group>
          <Group header="Как стоит строка">
            <Choice label="Выравнивание" hint="По краю — арабское письмо вправо, латиница и кириллица влево.">
              <Segmented
                label="Выравнивание"
                value={settings.textAlign}
                options={[
                  { value: 'center', label: 'По центру' },
                  { value: 'edge', label: 'По краю' },
                ]}
                onChange={(v) => setSettings({ textAlign: v })}
              />
            </Choice>
            <Choice label="Появление строк" hint="Потоком — сверху вниз. По письму — со стороны письма. На месте — строка проявляется там, где её читают. Перемотка даёт тот же кадр.">
              <Segmented
                label="Появление строк"
                value={settings.lineEntrance}
                options={[
                  { value: 'flow', label: 'Потоком' },
                  { value: 'script', label: 'По письму' },
                  { value: 'settle', label: 'На месте' },
                ]}
                onChange={(v) => setSettings({ lineEntrance: v })}
              />
            </Choice>
            <div className="row row--control row--slider">
              <span className="t-footnote secondary" aria-hidden>
                А
              </span>
              <Slider label="Размер текста" min={0.8} max={1.3} step={0.05} value={settings.textScale} onChange={(v) => setSettings({ textScale: v })} />
              <span className="t-title3 secondary" aria-hidden>
                А
              </span>
            </div>
            <p className="choice-hint choice-hint--pad">Размер оригинала на сцене.</p>
          </Group>
        </>
      )}

      {p === 'fonts' && (
        <Group footer="Арабский текст всегда шрифтом Мединского Мусхафа. Насталик — для тех, кто к нему привык.">
          {has.persian && (
            <FontPick
              label="Персидский"
              sample="زنده شدم"
              sampleDir="rtl"
              value={settings.fontPersian}
              options={PERSIAN_FONTS}
              onChange={(fontPersian) => setSettings({ fontPersian })}
            />
          )}
          <FontPick
            label="Оригинал латиницей и кириллицей"
            sample="I was dead"
            value={settings.fontOriginal}
            options={ORIGINAL_FONTS}
            onChange={(fontOriginal) => setSettings({ fontOriginal })}
          />
          <FontPick
            label="Перевод"
            sample="Я был мёртв"
            italic
            value={settings.fontTranslation}
            options={TRANSLATION_FONTS}
            onChange={(fontTranslation) => setSettings({ fontTranslation })}
          />
        </Group>
      )}

      {p === 'comment' && (
        <Group footer="Длинное пояснение раскрывается сноской под стихом. На широком экране оно стоит справа.">
          <Row title="Показывать пояснения" detail="То, что не вошло в перевод">
            <Switch label="Пояснения" checked={settings.showComment} onChange={(v) => setSettings({ showComment: v })} />
          </Row>
          <Row title="Держать открытым" detail="Сноска сразу развёрнута">
            <Switch label="Держать пояснение открытым" checked={settings.commentOpen} onChange={(v) => setSettings({ commentOpen: v })} />
          </Row>
        </Group>
      )}

      {p === 'instruments' && (
        <Group footer="На странице песни по умолчанию рисунок. Реалистичный вид — объём дафа и уда со светом и материалами; у остальных инструментов остаётся рисунок, пока для них нет модели. При уменьшении движения, без WebGL или на слабом устройстве остаётся рисунок.">
          <Choice label="Стиль" hint="Рисунок — гравюра линией. Реалистичный — та же сцена, объём со светом.">
            <Segmented
              className="seg--lines"
              label="Инструменты"
              value={settings.instrumentStyle}
              options={[
                { value: 'drawing', label: 'рисунок' },
                { value: 'realistic', label: 'реалистичный' },
              ]}
              onChange={(v) => setSettings({ instrumentStyle: v })}
            />
          </Choice>
        </Group>
      )}

      {p === 'sound' && (
        <>
          <Group header="Слушать" footer="Пауза после строки — чтобы разбирать текст по строке. «Воспроизвести» продолжает со следующей.">
            <Row title="Пауза после каждой строки">
              <Switch label="Пауза после каждой строки" checked={settings.pauseAfterLine} onChange={(v) => setSettings({ pauseAfterLine: v })} />
            </Row>
            <Choice label="Скорость">
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
            </Choice>
            {song.audio.saver && (
              <Choice label="Качество">
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
              </Choice>
            )}
            {!isIOS && (
              <div className="row row--control row--slider">
                <Icon name="speaker.wave.2" size={20} className="tertiary" />
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
            <Row title="Эквалайзер" detail={settings.eqEnabled ? presetById(settings.eqPreset).name : 'Выключен'} onClick={() => go('eq')} chevron />
          </Group>
          <Group header="Запись" footer={state?.source === 'local' ? 'Свой файл хранится только на этом устройстве.' : 'Подойдут m4a, mp3, wav и flac. Файл останется только на этом устройстве.'}>
            <Row icon={<Icon name="music.note" size={20} />} title={sourceLabel} detail={state?.error ?? undefined} />
            <Row icon={<Icon name="square.and.arrow.down" size={20} />} title="Подключить свой файл…" onClick={() => input.current?.click()} chevron />
            {state?.source === 'local' && <Row icon={<Icon name="xmark" size={20} />} title="Убрать свой файл" onClick={() => void engine.detachFile()} />}
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
        </>
      )}

      {p === 'eq' && (
        <>
          <Group
            footer={
              isIOS
                ? 'Эквалайзер обрабатывает звук в браузере. На iPhone из‑за этого музыка может остановиться, когда экран заблокирован. Выключите эквалайзер — снова будет играть с заблокированным экраном.'
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
              <Row title="Сбросить" detail={EQ_PRESETS.some((p) => p.id === settings.eqPreset) ? presetById(settings.eqPreset).name : 'Своя настройка'}>
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
        </>
      )}

      {p === 'look' && (
        <Group footer="Без анимации строки сменяются сразу. Небо всё равно следует секунде песни: это ход песни, не отдельное мерцание. Системное «Уменьшение движения» выключает переезды.">
          <Choice label="Тема">
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
          </Choice>
          <Choice label="Движение" hint="Полная, спокойная или без переездов строк.">
            <Segmented
              label="Движение"
              value={settings.motion}
              options={[
                { value: 'full', label: 'Полная' },
                { value: 'calm', label: 'Спокойная' },
                { value: 'off', label: 'Без' },
              ]}
              onChange={(v) => setSettings({ motion: v })}
            />
          </Choice>
        </Group>
      )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function Choice({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="choice">
      <div className="choice-label">{label}</div>
      {children}
      {hint ? <p className="choice-hint">{hint}</p> : null}
    </div>
  );
}

function FontPick<Id extends string>({
  label,
  sample,
  sampleDir,
  italic,
  value,
  options,
  onChange,
}: {
  label: string;
  sample: string;
  sampleDir?: 'rtl' | 'ltr';
  italic?: boolean;
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
          <span className="font-opt-sample" dir={sampleDir} style={{ fontFamily: face.stack, fontStyle: italic ? 'italic' : undefined }}>
            {sample}
          </span>
          <span className="font-opt-name">{face.name}</span>
          <span className="font-opt-note">{face.note}</span>
        </button>
      ))}
    </div>
  );
}
