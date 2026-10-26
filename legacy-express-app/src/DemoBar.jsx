import { useState } from 'react'

// Shown only in the GitHub Pages demo: a reminder that everything is made up, and a reset.
export default function DemoBar({ signedIn = false }) {
  const [busy, setBusy] = useState(false)
  const reset = async () => {
    if (!confirm('Reset the demo? Every change made in this browser is wiped and the made-up data starts again.')) return
    setBusy(true)
    try { const m = await import('./demoBackend.js'); await m.resetDemo() } catch { /* reload anyway */ }
    location.href = import.meta.env.BASE_URL
  }
  return (
    <div className="demobar" role="note">
      <span><b>Demo</b> with made-up staff and data. {signedIn ? 'Changes stay in this browser only.' : 'Nothing here is real.'}</span>
      <button type="button" onClick={reset} disabled={busy}>{busy ? 'Resetting…' : 'Reset demo'}</button>
    </div>
  )
}
