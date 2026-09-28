import { useRef, useState } from 'react'

/** Shared rename field: Enter/blur commit once; Escape and blanks cancel. */
export function InlineRename({ value, label, className, onCommit, onCancel }: {
  value: string
  label: string
  className?: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const finished = useRef(false)
  const finish = (commit: boolean) => {
    if (finished.current) return
    finished.current = true
    const next = draft.trim()
    if (commit && next && next !== value) onCommit(next)
    else onCancel()
  }
  return <input autoFocus className={className} aria-label={label} value={draft}
    onFocus={(event) => event.currentTarget.select()}
    onChange={(event) => setDraft(event.target.value)}
    onClick={(event) => event.stopPropagation()}
    onDoubleClick={(event) => event.stopPropagation()}
    onBlur={() => finish(true)}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        finish(event.key === 'Enter')
      }
    }} />
}
