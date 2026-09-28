import { Icon } from './Icon'

const steps = [
  { kicker: '01 / 05', title: 'Start with the page', body: 'Pages keep a layout, a viewport size, notes, breakpoints, and their layers together. Pick Home or Library in the left rail.', icon: 'frame' as const, action: 'Next' },
  { kicker: '02 / 05', title: 'Place a layer', body: 'Use Insert for website starters, or the rail for text, shapes, images, and sections. Drag directly on the canvas to move.', icon: 'shape' as const, action: 'Next' },
  { kicker: '03 / 05', title: 'Make the structure explicit', body: 'Select layers to see precise controls. Use the responsive layout section, named components, notes, and the blue dotted snap guides.', icon: 'grid' as const, action: 'Next' },
  { kicker: '04 / 05', title: 'Cut a literal chamfer', body: 'Select a layer and press ⌘ C / Ctrl C, or choose Cut corners in the rail. Drag a corner, turn on mirroring, and keep the 4px snap when you want tidy diagonal cuts.', icon: 'scissors' as const, action: 'Next' },
  { kicker: '05 / 05', title: 'Preview and hand off', body: 'Preview runs saved interactions. Export gives another AI or developer the structured design, readable brief, and runnable HTML preview.', icon: 'download' as const, action: 'Finish' },
]

const stars = [
  [7, 24, 2, '#f4f1e8'], [13, 38, 1, '#8dccff'], [18, 68, 2, '#f4f1e8'], [24, 30, 1, '#8993a4'], [29, 76, 2, '#8dccff'],
  [35, 47, 1, '#f4f1e8'], [42, 22, 2, '#8dccff'], [47, 70, 1, '#f4f1e8'], [54, 35, 2, '#8993a4'], [60, 82, 2, '#f4f1e8'],
  [67, 26, 1, '#8dccff'], [72, 59, 2, '#f4f1e8'], [78, 36, 1, '#8993a4'], [84, 75, 2, '#8dccff'], [91, 29, 2, '#f4f1e8'],
  [95, 62, 1, '#8dccff'], [11, 86, 1, '#8993a4'], [37, 88, 2, '#f4f1e8'], [64, 51, 1, '#8dccff'], [88, 89, 1, '#f4f1e8'],
] as const

const pixels = [
  [17, 55, 'plus'], [31, 31, 'cross'], [44, 68, 'plus'], [57, 49, 'cross'], [74, 72, 'plus'], [87, 45, 'cross'],
] as const

export function Tutorial({ step, setStep, onClose }: { step: number; setStep: (value: number) => void; onClose: () => void }) {
  const current = steps[step] ?? steps[0]
  const next = () => step >= steps.length - 1 ? onClose() : setStep(step + 1)
  return <div className="tutorial-backdrop"><div className="tutorial-card"><div className="tutorial-topline"><span>Layer in about a minute</span><button className="text-button" onClick={onClose}>Skip tour</button></div><div className="tutorial-illustration"><div className="pixel-window"><div className="pixel-titlebar"><span>THE UNKNOWN</span><div className="pixel-window-buttons"><i /><i /><i /></div></div><div className="pixel-stars" aria-hidden="true">{stars.map(([left, top, size, color], index) => <i key={`star-${index}`} style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, background: color }} />)}{pixels.map(([left, top, kind], index) => <b key={`pixel-${index}`} className={`pixel-${kind}`} style={{ left: `${left}%`, top: `${top}%` }} />)}</div><div className="tutorial-icon"><Icon name={current.icon} size={24} /></div><span className="pixel-corner-mark">L//</span></div></div><div className="tutorial-copy"><span className="panel-kicker">{current.kicker}</span><h2>{current.title}</h2><p>{current.body}</p></div><div className="tutorial-footer"><div className="tutorial-dots">{steps.map((_, index) => <button key={index} className={index === step ? 'active' : ''} onClick={() => setStep(index)} aria-label={`Go to step ${index + 1}`} />)}</div><button className="primary-button" onClick={next}>{current.action} <Icon name="arrow-right" size={14} /></button></div></div></div>
}
