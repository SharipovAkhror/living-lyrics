import { Group, Row, Segmented, Sheet, Slider, Switch } from '@/components/controls';
import { setSettings, type Settings } from '@/app/settings';
import { linkHandler } from '@/app/router';
import type { Song } from '@/data/schema';

export function DisplaySheet({
  open,
  onClose,
  song,
  settings,
  hasTranslit,
  hasAlt,
  hasPersian,
}: {
  open: boolean;
  onClose: () => void;
  song: Song;
  settings: Settings;
  hasTranslit: boolean;
  hasAlt: boolean;
  hasPersian: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Вид" size="large">
      <Group header="Слои текста" footer="Оригинал показывается всегда — на том языке и тем письмом, которыми поют.">
        <Row title="Перевод на русский">
          <Switch label="Перевод" checked={settings.showTranslation} onChange={(v) => setSettings({ showTranslation: v })} />
        </Row>
        {hasTranslit && (
          <Row title="Как произносится" detail="Транскрипция кириллицей">
            <Switch label="Транскрипция" checked={settings.showTranslit} onChange={(v) => setSettings({ showTranslit: v })} />
          </Row>
        )}
        {hasAlt && (
          <Row title="Историческое письмо" detail="Например, Физули арабской графикой">
            <Switch label="Историческое письмо" checked={settings.showAlt} onChange={(v) => setSettings({ showAlt: v })} />
          </Row>
        )}
        <Row title="Шарх" detail="Комментарий: то, что не вошло в перевод">
          <Switch label="Шарх" checked={settings.showSharh} onChange={(v) => setSettings({ showSharh: v })} />
        </Row>
      </Group>

      <Group header="Размер текста">
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

      <Group
        header="Ведение"
        footer={
          settings.follow === 'auto'
            ? 'Текст идёт за музыкой сам. Свайп влево или вправо перескакивает на соседнюю строку.'
            : 'Строки листаете вы. «Воспроизвести» играет текущую строку с её начала.'
        }
      >
        <div className="row row--control">
          <Segmented
            label="Ведение"
            value={settings.follow}
            options={[
              { value: 'auto', label: 'За музыкой' },
              { value: 'manual', label: 'Вручную' },
            ]}
            onChange={(v) => setSettings({ follow: v })}
          />
        </div>
        {settings.follow === 'manual' && (
          <Row title="Пауза после строки">
            <Switch label="Пауза после строки" checked={settings.pauseAfterLine} onChange={(v) => setSettings({ pauseAfterLine: v })} />
          </Row>
        )}
      </Group>

      <Group header="Анимация" footer="«Спокойная» оставляет мягкие появления и подсветку слов. При системной настройке «Уменьшение движения» анимация отключается.">
        <div className="row row--control">
          <Segmented
            label="Анимация"
            value={settings.motion}
            options={[
              { value: 'full', label: 'Полная' },
              { value: 'calm', label: 'Спокойная' },
              { value: 'off', label: 'Без' },
            ]}
            onChange={(v) => setSettings({ motion: v })}
          />
        </div>
      </Group>

      {hasPersian && (
        <Group header="Персидский почерк" footer="Насталик — классический почерк персидской поэзии. Насх — шрифт Мединского Мусхафа.">
          <div className="row row--control">
            <Segmented
              label="Персидский почерк"
              value={settings.persianStyle}
              options={[
                { value: 'nastaliq', label: <span className="f-nastaliq seg-sample">نستعلیق</span> },
                { value: 'naskh', label: <span className="f-mushaf seg-sample">نسخ</span> },
              ]}
              onChange={(v) => setSettings({ persianStyle: v })}
            />
          </div>
        </Group>
      )}

      <Group header="Оформление">
        <div className="row row--control">
          <Segmented
            label="Тема"
            value={settings.theme}
            options={[
              { value: 'auto', label: 'Авто' },
              { value: 'light', label: 'Светлая' },
              { value: 'dark', label: 'Тёмная' },
            ]}
            onChange={(v) => setSettings({ theme: v })}
          />
        </div>
      </Group>

      <Group header="Для редактора">
        <a className="row row--button" href={`/song/${song.slug}/edit`} onClick={linkHandler(`/song/${song.slug}/edit`)}>
          <span className="row-text">
            <span className="row-title">Редактор тайм-кодов</span>
            <span className="row-detail t-footnote">Сверить и поправить время слов</span>
          </span>
        </a>
      </Group>
    </Sheet>
  );
}
