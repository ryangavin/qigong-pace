import { parseSession, serializeSession, sessionFileName, type Session } from './session'

// Getting recorded sessions in and out of the page: download, file picker,
// drag and drop, and `?replay=<url>` for files the dev server serves.

/** Save a session as a JSON file. */
export function downloadSession(s: Session) {
  const url = URL.createObjectURL(new Blob([serializeSession(s)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = sessionFileName(s)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readSessionFile(file: File): Promise<Session> {
  return parseSession(await file.text())
}

/** A session from a URL, e.g. `fixtures/replays/sim-sample.json` from the dev server. */
export async function fetchSession(url: string): Promise<Session> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}).`)
  return parseSession(await res.text())
}

/** Replay a session file dropped anywhere on the page. */
export function onSessionDrop(start: (s: Session, name: string) => void, fail: (message: string) => void) {
  const hasFile = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
  window.addEventListener('dragover', (e) => {
    if (hasFile(e)) e.preventDefault()
  })
  window.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files[0]
    // The debug panel's video import has its own picker; only sessions are dropped.
    if (!file) return
    e.preventDefault()
    try {
      start(await readSessionFile(file), file.name)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })
}

/** A key pressed in a text field or a list isn't a shortcut. */
export function isShortcut(e: KeyboardEvent, key: string) {
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, select, [contenteditable]')) return false
  return e.key.toLowerCase() === key && !e.metaKey && !e.ctrlKey && !e.altKey
}

/** `m:ss`. */
export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
