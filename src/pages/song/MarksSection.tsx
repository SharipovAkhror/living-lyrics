import { useEffect, useState } from 'react';
import { Group } from '@/ui/controls';
import { formatTime } from '@/data/library';
import { Icon } from '@/ui/icons';
import { clientCommit, formatMarksReport, marksFor, todayISO, useMarks, type Mark } from '@/app/marks';

const ARABIC = /[\u0600-\u06FF]/;

function fallbackCopy(text: string) {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** "Отмеченные места" inside «О песне»: jump, delete, copy for an agent, clear. */
export function MarksSection({
  slug,
  title,
  open,
  onSeek,
  onMark,
}: {
  slug: string;
  title: string;
  open: boolean;
  onSeek: (t: number) => void;
  /** Marks the moment that is playing now. The player no longer carries this control. */
  onMark?: () => void;
}) {
  const { marks, memoryOnly } = useMarks(slug);
  const [copied, setCopied] = useState<'done' | 'fail' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (open) return;
    setCopied(null);
    setConfirmClear(false);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 2200);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    const text = formatMarksReport({ title, slug, marks, commit: clientCommit(), date: todayISO() });
    try {
      await navigator.clipboard.writeText(text);
      setCopied('done');
    } catch {
      setCopied(fallbackCopy(text) ? 'done' : 'fail');
    }
  };

  const footer = memoryOnly
    ? 'Браузер не сохранил отметки на устройство. Они пропадут, если закрыть или обновить страницу.'
    : marks.length
      ? 'Время — момент нажатия. Строка — та, что была на экране.'
      : 'Клавиша M отмечает место и не останавливает звук. То же делает кнопка ниже.';

  return (
    <Group header="Отмеченные места" footer={footer}>
      {onMark && (
        <button type="button" className="row row--button" onClick={onMark}>
          <span className="row-text">
            <span className="row-title">Не совпадает</span>
            <span className="row-detail t-footnote">Отметить место, которое сейчас звучит</span>
          </span>
        </button>
      )}
      {marks.length === 0 ? (
        <div className="row">
          <span className="row-text">
            <span className="row-title">Пока пусто</span>
            <span className="row-detail t-footnote">Отметки этой песни появятся здесь</span>
          </span>
        </div>
      ) : (
        marks.map((mark) => <MarkRow key={mark.id} mark={mark} slug={slug} onSeek={onSeek} />)
      )}
      {marks.length > 0 && (
        <button type="button" className="row row--button" onClick={() => void copy()}>
          <span className="row-text">
            <span className="row-title">{copied === 'done' ? 'Скопировано' : copied === 'fail' ? 'Не удалось скопировать' : 'Скопировать'}</span>
            <span className="row-detail t-footnote">Текст для агента: песня, время, строка</span>
          </span>
        </button>
      )}
      {marks.length > 0 && !confirmClear && (
        <button type="button" className="row row--button row--danger" onClick={() => setConfirmClear(true)}>
          <span className="row-text">
            <span className="row-title">Очистить всё</span>
          </span>
        </button>
      )}
      {marks.length > 0 && confirmClear && (
        <>
          <div className="row">
            <span className="row-text">
              <span className="row-title">Удалить все отметки этой песни?</span>
            </span>
          </div>
          <button
            type="button"
            className="row row--button row--danger"
            onClick={() => {
              marksFor(slug).clear();
              setConfirmClear(false);
            }}
          >
            <span className="row-text">
              <span className="row-title">Удалить</span>
            </span>
          </button>
          <button type="button" className="row row--button" onClick={() => setConfirmClear(false)}>
            <span className="row-text">
              <span className="row-title">Отмена</span>
            </span>
          </button>
        </>
      )}
    </Group>
  );
}

function MarkRow({ mark, slug, onSeek }: { mark: Mark; slug: string; onSeek: (t: number) => void }) {
  const arabic = ARABIC.test(mark.text);
  return (
    <div className="mark-item">
      <button type="button" className="mark-jump" onClick={() => onSeek(mark.t)}>
        <span className="mark-time t-headline tabular">{formatTime(mark.t)}</span>
        <span className="mark-copy">
          <span className={`mark-line${arabic ? ' f-mushaf' : ''}`} dir="auto">
            {mark.text}
          </span>
          <span className="mark-section t-footnote">{mark.sectionLabel}</span>
        </span>
      </button>
      <button
        type="button"
        className="mark-delete"
        aria-label={`Удалить отметку ${formatTime(mark.t)}`}
        onClick={() => marksFor(slug).remove(mark.id)}
      >
        <Icon name="xmark" size={16} />
      </button>
    </div>
  );
}
