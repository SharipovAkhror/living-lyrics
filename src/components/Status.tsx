import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/ui/icons';

/**
 * A designed empty, loading or error card. The copy is one or two lines;
 * the action, when there is one, is a 44 pt control passed in by the caller.
 */
export function Status({
  children,
  title,
  action,
  icon = 'info.circle',
  className = '',
  live,
}: {
  children: ReactNode;
  title?: string;
  action?: ReactNode;
  icon?: IconName;
  className?: string;
  /** `alert` announces immediately. `status` is a polite update. */
  live?: 'alert' | 'status';
}) {
  return (
    <div className={className ? `status ${className}` : 'status'} role={live === 'alert' ? 'alert' : live === 'status' ? 'status' : undefined}>
      <span className="status-mark" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <div className="status-text">
        {title && <p className="status-title">{title}</p>}
        <p className="status-copy">{children}</p>
      </div>
      {action}
    </div>
  );
}
