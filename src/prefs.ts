import { POSTURES, type Posture } from './skeleton'

// Shared by both pages, so choosing Seated in one holds in the other.
const POSTURE_KEY = 'qigong-pace.posture'

export function loadPosture(): Posture {
  try {
    const saved = localStorage.getItem(POSTURE_KEY)
    if (saved && (POSTURES as readonly string[]).includes(saved)) return saved as Posture
  } catch {
    // Storage can be blocked; standing is the default.
  }
  return 'standing'
}

export function savePosture(p: Posture) {
  try {
    localStorage.setItem(POSTURE_KEY, p)
  } catch {
    // Not remembered, but still applied.
  }
}
