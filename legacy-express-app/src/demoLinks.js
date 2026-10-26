// Demo only: links to files (payslips, documents, the hours CSV) point at /api/... addresses.
// There's no server on GitHub Pages, so those clicks are answered by the in-browser backend and
// the file is opened or downloaded from memory.
export function installDemoLinks() {
  document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('a[href]')
    if (!a) return
    const href = a.getAttribute('href')
    if (!href || !href.startsWith('/api/')) return
    e.preventDefault()
    const download = a.hasAttribute('download')
    const win = download ? null : window.open('', '_blank')
    try {
      const { handle } = await import('./demoBackend.js')
      const r = await handle({ method: 'GET', url: href })
      if (r.status >= 400) throw new Error((r.body && r.body.error) || 'Could not open that file.')
      const type = String(r.headers['Content-Type'] || r.type || 'application/octet-stream')
      const data = typeof r.body === 'string' ? r.body : r.body instanceof Uint8Array ? r.body : JSON.stringify(r.body)
      const url = URL.createObjectURL(new Blob([data], { type }))
      const name = (/filename="?([^";]+)"?/.exec(String(r.headers['Content-Disposition'] || '')) || [])[1] || 'file'
      if (download || !win) {
        const t = document.createElement('a'); t.href = url; t.download = name; document.body.appendChild(t); t.click(); t.remove()
      } else {
        win.location.href = url
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      if (win) win.close()
      alert(err.message || 'Could not open that file.')
    }
  }, true)
}
