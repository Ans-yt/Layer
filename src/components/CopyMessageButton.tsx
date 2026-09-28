import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export function CopyMessageButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const request = useRef(0)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    setStatus('idle')
    pending.current = false
    return () => { request.current++; clearTimeout(timer.current) }
  }, [text])

  const copy = async () => {
    if (pending.current) return
    const current = ++request.current
    pending.current = true
    clearTimeout(timer.current)
    setStatus('copying')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      if (request.current !== current) return
      setStatus('copied')
      timer.current = setTimeout(() => setStatus('idle'), 2000)
    } catch {
      if (request.current === current) setStatus('error')
    } finally {
      if (request.current === current) pending.current = false
    }
  }

  return <div className="message-utilities">
    <button className="message-copy" onClick={() => void copy()} disabled={status === 'copying'} aria-label="Copy message" data-tooltip="Copy message as Markdown">
      <Icon name={status === 'copied' ? 'check' : 'copy'} size={12} /><span aria-hidden="true">{status === 'copied' ? 'Copied' : status === 'copying' ? 'Copying…' : 'Copy'}</span>
    </button>
    <span role="status" className={status === 'error' ? 'message-copy-error' : 'visually-hidden'}>
      {status === 'copied' ? 'Message copied.' : status === 'error' ? 'Copy unavailable. Select the message text and copy it manually.' : ''}
    </span>
  </div>
}
