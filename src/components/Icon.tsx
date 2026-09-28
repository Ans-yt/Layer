import type { CSSProperties, ReactNode } from 'react'

type IconName =
  | 'cursor' | 'hand' | 'frame' | 'text' | 'shape' | 'image' | 'icon' | 'section' | 'undo' | 'redo' | 'plus' | 'minus'
  | 'more' | 'chevron-down' | 'chevron-right' | 'chevron-left' | 'close' | 'check' | 'lock' | 'unlock' | 'eye' | 'eye-off'
  | 'copy' | 'trash' | 'group' | 'ungroup' | 'layers' | 'spark' | 'settings' | 'play' | 'pause' | 'zoom-in' | 'zoom-out'
  | 'fit' | 'grid' | 'search' | 'upload' | 'download' | 'external' | 'refresh' | 'warning' | 'info' | 'arrow-up' | 'arrow-down'
  | 'arrow-left' | 'arrow-right' | 'align-left' | 'align-center' | 'align-right' | 'distribute' | 'sliders' | 'palette' | 'type'
  | 'mouse' | 'keyboard' | 'bolt' | 'command' | 'wand' | 'book' | 'plug' | 'code' | 'send' | 'paperclip' | 'check-circle'
  | 'move' | 'rotate' | 'maximize' | 'link' | 'unlink' | 'sun' | 'moon' | 'comment' | 'camera' | 'target' | 'download-cloud' | 'scissors'

const paths: Record<IconName, ReactNode> = {
  cursor: <><path d="m5 3 5.6 17 3.4-7 7-3.4Z"/><path d="m14 14 5 5"/></>,
  hand: <><path d="M7 11V5a1.5 1.5 0 0 1 3 0v5"/><path d="M10 9V3.8a1.5 1.5 0 0 1 3 0V10"/><path d="M13 9V5a1.5 1.5 0 0 1 3 0v7"/><path d="M16 11V8.5a1.5 1.5 0 0 1 3 0v5.2c0 4.2-2.8 7.3-6.9 7.3h-.8C8 21 6.4 19 5 17l-2.2-3.2a1.5 1.5 0 0 1 2.5-1.7L7 14"/></>,
  frame: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M4 9h16"/></>,
  text: <><path d="M4 5h16M12 5v14M8 19h8"/></>,
  shape: <><rect x="4" y="5" width="9" height="9" rx="2"/><circle cx="17.5" cy="16.5" r="3.5"/><path d="m16 4 4 4"/></>,
  image: <><rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m5 17 4.5-4 3 2 2.5-2.5 5 4.5"/></>,
  icon: <><path d="m12 3 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9L9.5 8Z"/></>,
  section: <><path d="M4 4h16v5H4zM4 15h16v5H4z"/><path d="M8 9v6M16 9v6"/></>,
  undo: <><path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/></>,
  redo: <><path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  minus: <path d="M5 12h14"/>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  'chevron-right': <path d="m9 6 6 6-6 6"/>,
  'chevron-left': <path d="m15 6-6 6 6 6"/>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  check: <path d="m5 12 4.5 4.5L19 7"/>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  unlock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.2-2.4"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  'eye-off': <><path d="m3 3 18 18"/><path d="M10.6 6.2A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.1 3.8M6.1 6.8C3.8 8.3 2.5 12 2.5 12s3.5 6 9.5 6c1.1 0 2.1-.2 3-.6"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
  group: <><rect x="4" y="5" width="10" height="10" rx="2"/><rect x="10" y="9" width="10" height="10" rx="2"/></>,
  ungroup: <><path d="M4 5h8v8H4zM12 11h8v8h-8z"/><path d="m8 17-3 3M16 7l3-3"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  spark: <><path d="m12 3 1.7 6.3L20 11l-6.3 1.7L12 19l-1.7-6.3L4 11l6.3-1.7Z"/><path d="m19 3 .5 1.5L21 5l-1.5.5L19 7l-.5-1.5L17 5l1.5-.5Z"/></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.15.08a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.08a2 2 0 0 1 1 1.73v.18a2 2 0 0 1-1 1.73l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.15.08a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.15-.08a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.73v-.18a2 2 0 0 1 1-1.73l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></>,
  play: <path d="m8 5 11 7-11 7Z"/>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  'zoom-in': <><circle cx="10.5" cy="10.5" r="6.5"/><path d="M16 16 21 21M10.5 7.5v6M7.5 10.5h6"/></>,
  'zoom-out': <><circle cx="10.5" cy="10.5" r="6.5"/><path d="M16 16 21 21M7.5 10.5h6"/></>,
  fit: <><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><path d="M9 9h6v6H9z"/></>,
  grid: <><path d="M4 4h16v16H4zM4 10h16M10 4v16"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></>,
  external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.8-4L3 10"/><path d="M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14"/><path d="M21 19v-5h-5"/></>,
  warning: <><path d="m12 3 9 17H3Z"/><path d="M12 9v4M12 17h.01"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  'arrow-up': <><path d="M12 19V5M6 11l6-6 6 6"/></>,
  'arrow-down': <><path d="M12 5v14M6 13l6 6 6-6"/></>,
  'arrow-left': <><path d="M19 12H5M11 6l-6 6 6 6"/></>,
  'arrow-right': <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  'align-left': <><path d="M4 5h12M4 10h8M4 15h15M4 20h9"/></>,
  'align-center': <><path d="M6 5h12M4 10h16M7 15h10M5 20h14"/></>,
  'align-right': <><path d="M8 5h12M12 10h8M5 15h15M11 20h9"/></>,
  distribute: <><path d="M5 5v14M19 5v14M10 7v10M14 7v10"/></>,
  sliders: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18h1.3a1.8 1.8 0 0 0 1.2-3.1 1.8 1.8 0 0 1 1.2-3.1H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7" cy="11" r="1"/><circle cx="9" cy="7" r="1"/><circle cx="14" cy="7" r="1"/></>,
  type: <><path d="M4 5h16M12 5v14M8 19h8"/></>,
  mouse: <><rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v5M7 9h10"/></>,
  keyboard: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 14h8M16 14h2"/></>,
  bolt: <path d="m13 2-9 11h7l-1 9 9-12h-7Z"/>,
  command: <><path d="M9 9V6a3 3 0 1 0-3 3h3Zm6 0V6a3 3 0 1 1 3 3h-3Zm0 6h3a3 3 0 1 1-3 3v-3Zm-6 0H6a3 3 0 1 1 3 3v-3Z"/><path d="M9 9h6v6H9z"/></>,
  wand: <><path d="m15 4 5 5M3 21l10-10M5 4v4M3 6h4M18 15v4M16 17h4"/></>,
  book: <><path d="M4 5a3 3 0 0 1 3-2h13v16H7a3 3 0 0 0-3 2Zm0 0v16"/><path d="M7 19h13"/></>,
  plug: <><path d="M9 7V3M15 7V3M6 7h12v2a6 6 0 0 1-12 0Z"/><path d="M12 15v6"/></>,
  code: <><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/></>,
  send: <><path d="m21 3-7.2 18-3.4-7.4L3 10.2Z"/><path d="M21 3 10.4 13.6"/></>,
  paperclip: <path d="m20.5 11.5-8.8 8.8a5 5 0 0 1-7.1-7.1l9.6-9.6a3.5 3.5 0 0 1 5 5l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.8-8.8"/>,
  'check-circle': <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  move: <><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></>,
  rotate: <><path d="M5 9a7 7 0 1 1 1 7"/><path d="M5 4v5h5"/></>,
  maximize: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.3l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.3l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></>,
  unlink: <><path d="m8 12 8-8M3 8l3-3a5 5 0 0 1 7 0M21 16l-3 3a5 5 0 0 1-7 0"/><path d="m3 3 18 18"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>,
  comment: <><path d="M4 5h16v11H8l-4 4Z"/><path d="M8 9h8M8 12h5"/></>,
  camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4Z"/><circle cx="12" cy="13" r="3.5"/></>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>,
  'download-cloud': <><path d="M7 18H6a4 4 0 0 1 0-8 6 6 0 0 1 11.3-2.7A4.5 4.5 0 0 1 18 18h-1"/><path d="M12 11v8M8.5 15.5 12 19l3.5-3.5"/></>,
  scissors: <><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="m8.2 7.4 11.3 10.2M8.2 16.6 19.5 6.4"/></>,
}

export function Icon({ name, size = 16, strokeWidth = 1.7, className, style }: { name: IconName; size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export type { IconName }
