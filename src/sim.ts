import type { Follower } from './follower'
import { JOINTS, torsoLength, type Pose } from './skeleton'

/**
 * A pretend learner for working without a webcam: copies the teacher's move at
 * `speed` × the original, with a little tracker-like jitter. `wander` lets the
 * screen-right forearm drift off the teacher's line now and then, so the view
 * has a limb that doesn't match.
 */
export class SimStudent {
  pos = 0
  speed = 0.4
  paused = false
  /** How far the forearm drifts at its widest, in torso lengths; 0 keeps to the teacher. */
  wander = 0
  private seed = 1
  private t = 0

  constructor(opts: { speed?: number; wander?: number } = {}) {
    this.speed = opts.speed ?? this.speed
    this.wander = opts.wander ?? this.wander
  }

  // Deterministic jitter so the student looks tracked, not perfect.
  private jitter() {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296
    return (this.seed / 4294967296 - 0.5) * 0.006
  }

  /** Advance with the follower by `dt` seconds and return the student's pose. */
  step(follower: Follower, dt: number): Pose {
    const ref = follower.ref
    if (follower.state === 'following' && !this.paused) {
      this.pos = Math.min(ref.poses.length - 1, this.pos + this.speed * ref.fps * dt)
      this.t += dt
    }
    if (follower.state === 'waiting') {
      this.pos = 0
      this.t = 0
    }
    const base = ref.poses[Math.round(this.pos)]
    const pose = {} as Pose
    for (const j of JOINTS) pose[j] = { x: base[j].x + this.jitter(), y: base[j].y + this.jitter(), v: 0.95 }
    if (this.wander > 0) {
      // Drift out and up in slow swells, about one every nine seconds.
      const swell = Math.max(0, Math.sin((this.t * 2 * Math.PI) / 9)) ** 2
      const d = this.wander * torsoLength(base) * swell
      pose.rWrist.x += d
      pose.rWrist.y -= d * 0.6
      pose.rElbow.x += d * 0.3
    }
    return pose
  }
}
