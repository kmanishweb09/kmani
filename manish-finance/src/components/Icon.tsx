/** Hand-drawn 24×24 stroke icons. Decorative unless a `label` is given. */

const PATHS: Record<string, string> = {
  desk: "M4 5h16v14H4z M4 10h16 M10 10v9",
  deals: "M4 8h11 M12 5l3 3-3 3 M20 16H9 M12 13l-3 3 3 3",
  sectors: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  companies: "M5 20V6l7-3 7 3v14 M9 9h1 M14 9h1 M9 13h1 M14 13h1 M10 20v-4h4v4 M3 20h18",
  lab: "M9 3h6 M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3 M7.5 14h9",
  briefs: "M5 4h11l3 3v13H5z M8 9h8 M8 13h8 M8 17h5",
  notebook: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z M9 3v18 M12 8h4 M12 12h4",
  sources: "M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7 M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19 12l2-1-1-3-2 .3-1.2-1.2L17 5l-3-1-1 2h-2l-1-2-3 1 .2 2.1L6 8.3 4 8l-1 3 2 1v2l-2 1 1 3 2-.3 1.2 1.2L7 21l3 1 1-2h2l1 2 3-1-.2-2.1 1.2-1.2 2 .3 1-3-2-1z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
  close: "M6 6l12 12 M18 6L6 18",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  chevronUp: "M5 15l7-7 7 7",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5H5V6h5",
  evidence: "M7 4h8l4 4v12H7z M15 4v4h4 M10 12h6 M10 16h4",
  bookmark: "M7 4h10v16l-5-4-5 4z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4z M10 20h4",
  compare: "M4 5h7v14H4z M13 5h7v14h-7z",
  download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
  upload: "M12 20V9 M7 14l5-5 5 5 M5 4h14",
  print: "M7 9V4h10v5 M5 9h14v7h-3 M8 16H5 M8 13h8v7H8z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4",
  check: "M5 12l5 5 9-10",
  alert: "M12 4l9 16H3z M12 10v4 M12 17h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5h.01",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  archive: "M4 5h16v4H4z M5 9v10h14V9 M10 13h4",
  edit: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
  filter: "M4 5h16l-6 7v6l-4 2v-8z",
  sort: "M8 4v16 M4 8l4-4 4 4 M16 20V4 M12 16l4 4 4-4",
  sortAsc: "M12 5v14 M6 11l6-6 6 6",
  sortDesc: "M12 5v14 M6 13l6 6 6-6",
  collapse: "M15 5l-7 7 7 7 M20 4v16",
  expand: "M9 5l7 7-7 7 M4 4v16",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  signal: "M4 18h2 M9 14h2v4H9z M14 10h2v8h-2z M19 6h2v12h-2z",
  flask: "M9 3h6 M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3",
  play: "M8 5l11 7-11 7z",
  pause: "M8 5v14 M16 5v14",
  copy: "M8 8h12v12H8z M4 16V4h12",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  columns: "M4 5h16v14H4z M10 5v14 M15 5v14",
  lock: "M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  question: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14 M12 17h.01",
  timer: "M12 6a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M12 10v4 M10 3h4",
  layers: "M12 3l9 5-9 5-9-5z M3 13l9 5 9-5",
  command: "M8 8h8v8H8z M8 8a2 2 0 1 1-2-2 M16 8a2 2 0 1 0 2-2 M8 16a2 2 0 1 0-2 2 M16 16a2 2 0 1 1 2 2",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  const d = PATHS[name] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {(d as string).split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  );
}
