import { RichText } from '@/components/RichText';
import { Sheet } from '@/ui/controls';

/** Full commentary. The phone keeps a one-line footnote until this sheet opens. */
export function NoteSheet({
  open,
  onClose,
  text,
  showHarakat,
}: {
  open: boolean;
  onClose: () => void;
  text: string;
  showHarakat: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Пояснение" size="medium">
      <RichText text={text} showHarakat={showHarakat} className="comment-body" />
    </Sheet>
  );
}
