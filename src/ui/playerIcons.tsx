/**
 * Player and song-header marks. Drawn for this screen, not taken from an icon set.
 * One 24-grid. Stroke 1.75, round caps and joins, corner radius 2 on the stroke.
 * Play is filled and shifted +1 on x: the triangle's weight sits left of the box.
 * Pause is two bars whose pair is centred, so the two marks share a centre.
 * Line skip is a bar plus a triangle: the bar is the line, not a track.
 * A pressed song action adds the short ll-on bar. The outline stays; there is no plate.
 */
import type { ReactNode } from 'react';

export type PlayerIconName =
  | 'back'
  | 'about'
  | 'line-prev'
  | 'line-next'
  | 'play'
  | 'pause'
  | 'translate'
  | 'comment'
  | 'text'
  | 'settings'
  | 'flag';

const ON = <path className="ll-on" d="M8 21.25h8" />;

const marks: Record<PlayerIconName, ReactNode> = {
  back: <path d="M14.75 5.25L8.25 12l6.5 6.75" />,
  about: (
    <>
      <circle cx="12" cy="12" r="7.25" />
      <path d="M12 10.75V16.25" />
      <path d="M12 8h.01" />
    </>
  ),
  'line-prev': (
    <>
      <path d="M6.25 6.25v11.5" />
      <path d="M17.25 7.25L10.25 12l7 4.75" />
    </>
  ),
  'line-next': (
    <>
      <path d="M17.75 6.25v11.5" />
      <path d="M6.75 7.25L13.75 12l-7 4.75" />
    </>
  ),
  play: (
    <g transform="translate(1 0)">
      <path
        d="M8.15 5.35c0-.7.76-1.13 1.36-.77l9.15 5.45c.58.35.58 1.2 0 1.54l-9.15 5.45c-.6.36-1.36-.07-1.36-.77z"
        fill="currentColor"
        stroke="none"
      />
    </g>
  ),
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="5.7" y="4.75" width="3.7" height="14.5" rx="1.35" />
      <rect x="14.6" y="4.75" width="3.7" height="14.5" rx="1.35" />
    </g>
  ),
  translate: (
    <>
      <path d="M4.5 6.25h9.2a2.4 2.4 0 0 1 2.4 2.4v3.3a2.4 2.4 0 0 1-2.4 2.4H8.1L5.6 17.1v-2.75H4.5a2.4 2.4 0 0 1-2.4-2.4V8.65a2.4 2.4 0 0 1 2.4-2.4z" />
      <path d="M14.2 10.2h5.3a1.7 1.7 0 0 1 1.7 1.7v2.15a1.7 1.7 0 0 1-1.7 1.7h-.55V17.2l-1.7-1.45h-3.05a1.7 1.7 0 0 1-1.7-1.7v-2.15a1.7 1.7 0 0 1 1.7-1.7z" />
      <path d="M7.15 13.15L9.05 8.4l1.9 4.75" />
      <path d="M7.7 11.7h2.5" />
      {ON}
    </>
  ),
  comment: (
    <>
      <path d="M12 5.4c-3.1 0-5.6 1.15-5.6 1.15v10.1S8.9 15.6 12 15.6s5.6 1.05 5.6 1.05V6.55S15.1 5.4 12 5.4z" />
      <path d="M12 5.4v10.2" />
      {ON}
    </>
  ),
  text: (
    <>
      <path d="M5.25 7.25h13.5" />
      <path d="M5.25 12h10.5" />
      <path d="M5.25 16.75h7.5" />
      {ON}
    </>
  ),
  settings: (
    <>
      <path d="M4.25 7h8.7" />
      <path d="M18.2 7h1.55" />
      <circle cx="15.25" cy="7" r="2.05" />
      <path d="M4.25 12h2.4" />
      <path d="M11.9 12h7.85" />
      <circle cx="9" cy="12" r="2.05" />
      <path d="M4.25 17h9.7" />
      <path d="M19.2 17h.55" />
      <circle cx="16.25" cy="17" r="2.05" />
      {ON}
    </>
  ),
  flag: (
    <>
      <path d="M6.75 4.5v15.25" />
      <path d="M6.75 5.4h8.7l-2.15 3.15 2.15 3.15H6.75" />
    </>
  ),
};

export function PlayerIcon({ name, size = 24 }: { name: PlayerIconName; size?: number }) {
  const px = Math.round(size);
  return (
    <svg
      className="ll-icon ll-pair player-icon"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {marks[name]}
    </svg>
  );
}
