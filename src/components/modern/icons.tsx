import type { ReactNode } from "react";

const PATHS = {
  home: <path d="M4 11.2 12 4l8 7.2V20h-5.4v-5.4H9.4V20H4z" />,
  search: (
    <path d="M10.8 4a6.8 6.8 0 0 1 5.4 10.9l3.9 3.9-1.4 1.4-3.9-3.9A6.8 6.8 0 1 1 10.8 4Zm0 2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z" />
  ),
  library: (
    <path d="M4 4h2.2v16H4zm4.3 0h2.2v16H8.3zm5.2.2 2.1-.6 4.4 15.8-2.1.6z" />
  ),
  play: <path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2Z" />,
  pause: <path d="M7 5h3.6v14H7zm6.4 0H17v14h-3.6z" />,
  next: <path d="M5 5.6v12.8a.7.7 0 0 0 1.1.6l9.2-6.4V19H18V5h-2.7v6.4L6.1 5a.7.7 0 0 0-1.1.6Z" />,
  previous: <path d="M19 5.6v12.8a.7.7 0 0 1-1.1.6l-9.2-6.4V19H6V5h2.7v6.4L17.9 5a.7.7 0 0 1 1.1.6Z" />,
  heart: (
    <path d="M12 20.3 4.9 13.4a4.7 4.7 0 0 1 6.6-6.7l.5.5.5-.5a4.7 4.7 0 0 1 6.6 6.7Zm0-2.8 5.7-5.5a2.7 2.7 0 0 0-3.8-3.9L12 10 10.1 8.1A2.7 2.7 0 0 0 6.3 12Z" />
  ),
  heartFilled: (
    <path d="M12 20.3 4.9 13.4a4.7 4.7 0 0 1 6.6-6.7l.5.5.5-.5a4.7 4.7 0 0 1 6.6 6.7Z" />
  ),
  download: <path d="M11 4h2v9.2l3.3-3.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4 3.3 3.3zM5 18.5h14v2H5z" />,
  check: <path d="m9.6 17.6-5-5L6 11.2l3.6 3.6L18 6.4l1.4 1.4z" />,
  trash: <path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-.8 12H6.8zm2.1 2 .5 8h6.8l.5-8z" />,
  back: <path d="m14.6 5 1.4 1.4L10.4 12l5.6 5.6-1.4 1.4-7-7z" />,
  down: <path d="m5 9.4 1.4-1.4 5.6 5.6L17.6 8 19 9.4l-7 7z" />,
  chevron: <path d="m9.4 5 7 7-7 7L8 17.6l5.6-5.6L8 6.4z" />,
  shuffle: (
    <path d="M15 4h5v5h-2V7.4l-3.3 3.3-1.4-1.4L16.6 6H15zM4 6.4 5.4 5l13 13H18v-1h2v3h-5v-2h1.6zM9.3 13.3l1.4 1.4L5.4 20 4 18.6z" />
  ),
  refresh: (
    <path d="M12 5a7 7 0 0 1 6.3 4H21v-.1V3l-2 2V4.9A9 9 0 1 0 21 12h-2a7 7 0 1 1-7-7Z" />
  ),
  link: (
    <path d="M10.6 13.4a1 1 0 0 0 1.4 0l4.6-4.6a3 3 0 0 0-4.2-4.2L10.6 6.4 12 7.8l1.8-1.8a1 1 0 0 1 1.4 1.4L10.6 12a1 1 0 0 0 0 1.4Zm2.8-2.8a1 1 0 0 0-1.4 0l-4.6 4.6a3 3 0 0 0 4.2 4.2l1.8-1.8-1.4-1.4-1.8 1.8a1 1 0 0 1-1.4-1.4l4.6-4.6a1 1 0 0 0 0-1.4Z" />
  ),
  swap: <path d="M7 4 2.8 8.2 4.2 9.6 6 7.8V16h2V7.8l1.8 1.8 1.4-1.4zm10 16 4.2-4.2-1.4-1.4-1.8 1.8V8h-2v8.2l-1.8-1.8-1.4 1.4z" />,
  user: <path d="M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 10c4.4 0 8 2.1 8 4.7V20H4v-1.3C4 16.1 7.6 14 12 14Z" />,
  plus: <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />,
  more: <path d="M12 4.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 5.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 5.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />,
  repeat: <path d="M17 2.5 21 6.5l-4 4V7.5H7V11H5V5.5h12zM7 21.5l-4-4 4-4v3h10V13h2v5.5H7z" />,
  queue: <path d="M3 5h14v2H3zm0 6h14v2H3zm0 6h9v2H3zm12-1v6l6-3z" />,
  note: <path d="M19 3v12.5a3.5 3.5 0 1 1-2-3.2V7.6l-8 1.8v8.1a3.5 3.5 0 1 1-2-3.2V5.8z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="m-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
