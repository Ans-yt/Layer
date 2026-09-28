import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { FAVICON_URL } from './lib/brand'

const favicon = document.createElement('link')
favicon.id = 'layer-favicon'
favicon.rel = 'icon'
favicon.type = 'image/png'
favicon.href = FAVICON_URL
document.head.querySelector('#layer-favicon')?.remove()
document.head.appendChild(favicon)

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
