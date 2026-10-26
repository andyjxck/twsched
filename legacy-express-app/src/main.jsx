import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(<App />)

if (import.meta.env.VITE_DEMO === '1') {
  import('./demoLinks.js').then((m) => m.installDemoLinks())
} else if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
