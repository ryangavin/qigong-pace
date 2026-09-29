import { buildReference, type Reference } from './follower'
import type { Pose, Posture, Pt } from './skeleton'

// Built-in moves, authored as keyframes of a front-on figure so the app works
// before anyone loads a video. Angles are in degrees, seen from the front.

export interface BodyKey {
  /** Seconds from the start of the move. */
  t: number
  /** Screen-left arm raised from hanging (0) through the side (90) to overhead (180). */
  lArm: number
  /** Screen-left elbow bent back toward the body's midline. */
  lElbow: number
  rArm: number
  rElbow: number
  /** Knee bend, 0 (standing) to 1 (deep horse stance). Ignored when seated. */
  sink: number
}

/** The move list groups moves by set, in this order. */
export const MOVE_SETS = ['Ba Duan Jin', 'Shibashi', 'Yi Jin Jing', 'Wu Qin Xi', 'Liu Zi Jue', 'Standalone'] as const
export type MoveSet = (typeof MOVE_SETS)[number]

export interface Move {
  id: string
  name: string
  set: MoveSet
  /** From docs/move-catalog.md: 1 reads well from the front, 2 loses a turn, lean or depth. */
  tier: 1 | 2
  cue: string
  /** Replaces `cue` when seated, where the cue talks about the legs. */
  seatedCue?: string
  /** Tier 2: what the front-on teacher can't show. */
  lost?: string
  /**
   * Which ways the move can be practised. The move list only offers moves for
   * the learner's chosen posture. A seated move is driven by the same keys
   * (arms only; `sink` is ignored) with the figure sitting on a stool, so list
   * 'seated' only where the arms alone carry the move.
   */
  postures: Posture[]
  keys: BodyKey[]
}

// Keys are written as in docs/move-catalog.md, one line per move so the two
// can be compared: [t, lArm, lElbow, rArm, rElbow, sink], with R for the rest arms.
type KeyTuple = (number | readonly number[])[]
const R = [12, 70, 12, 70] as const

function K(...tuples: KeyTuple[]): BodyKey[] {
  return tuples.map((tuple) => {
    const n = tuple.flat()
    if (n.length !== 6) throw new Error(`A key needs 6 numbers: [${n}]`)
    const [t, lArm, lElbow, rArm, rElbow, sink] = n
    return { t, lArm, lElbow, rArm, rElbow, sink }
  })
}

const BOTH: Posture[] = ['standing', 'seated']
// The catalog's "partial" seated moves need the legs, so they stand only.
const STANDING: Posture[] = ['standing']

// Each set lists tier 1 before tier 2, and follows the set's own order within a tier.
export const DEMO_MOVES: Move[] = [
  // ---- Ba Duan Jin ----
  {
    id: 'lift-sky',
    name: 'Holding up the sky',
    set: 'Ba Duan Jin',
    tier: 1,
    cue: 'Lift the joined hands up the front, press the palms to the sky, open down the sides.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,22,115,22,115,.2],[6,30,150,30,150,0],[8.5,168,290,168,290,0],[10.5,168,290,168,290,0],[10.5,168,-70,168,-70,0],[14,90,0,90,0,.3],[17,30,120,30,120,.3],[19.5,R,0],[21,R,0]),
  },
  {
    id: 'draw-bow',
    name: 'Drawing the bow to shoot the hawk',
    set: 'Ba Duan Jin',
    tier: 1,
    cue: 'Sink into horse stance, push one hand out, draw the other back like a bowstring.',
    seatedCue: 'Sit tall, push one hand out, draw the other back like a bowstring.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,25,140,25,140,.15],[7.5,88,5,88,178,.6],[9.5,88,5,88,178,.6],[12,110,0,90,0,.45],[14.5,30,120,30,120,.1],[17,25,140,25,140,.15],[20.5,88,178,88,5,.6],[22.5,88,178,88,5,.6],[25,90,0,110,0,.45],[27.5,30,120,30,120,.1],[29.5,R,0],[31,R,0]),
  },
  {
    id: 'separate',
    name: 'Separating heaven and earth',
    set: 'Ba Duan Jin',
    tier: 1,
    cue: 'One palm pushes to the sky, the other presses to the earth; change.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,22,115,22,115,.25],[6.5,172,360,22,8,0],[8.5,172,360,22,8,0],[11.5,22,115,22,115,.3],[14.5,22,8,172,360,0],[16.5,22,8,172,360,0],[19.5,22,115,22,115,.3],[22,R,0],[23.5,R,0]),
  },

  // ---- Shibashi ----
  {
    id: 'rainbow',
    name: 'Painting a rainbow',
    set: 'Shibashi',
    tier: 1,
    cue: 'Shift your weight; one arm floats out palm up while the other arcs over your head.',
    seatedCue: 'One arm floats out palm up while the other arcs over your head.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,30,150,30,150,.2],[6,168,290,168,290,0],[6,168,-70,168,290,0],[9.5,95,0,160,280,.3],[11.5,95,0,160,280,.3],[14,168,-70,168,290,.1],[14,168,-70,168,-70,.1],[17.5,160,-80,95,0,.3],[19.5,160,-80,95,0,.3],[22,168,-70,168,-70,.1],[25.5,90,0,90,0,0],[28.5,R,0],[30,R,0]),
  },
  {
    id: 'separate-clouds',
    name: 'Separating the clouds',
    set: 'Shibashi',
    tier: 1,
    cue: 'Cross wrists low, lift them overhead, part the clouds down the sides.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,18,125,18,125,.35],[7,168,290,168,290,0],[7,168,-70,168,-70,0],[10.5,90,0,90,0,.15],[13.5,18,125,18,125,.35],[16,R,0],[17.5,R,0]),
  },
  {
    id: 'wild-goose',
    name: 'Flying wild goose',
    set: 'Shibashi',
    tier: 1,
    cue: 'Wings rise to shoulder height, then float down as you sink.',
    seatedCue: 'Wings rise to shoulder height, then float down as you breathe out.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[5,95,10,95,10,0],[9,20,10,20,10,.6],[12.5,95,10,95,10,0],[16,20,10,20,10,.6],[19,R,0],[20.5,R,0]),
  },
  {
    id: 'open-the-chest',
    name: 'Opening the chest',
    set: 'Shibashi',
    tier: 2,
    cue: 'Arms forward, open wide to the sides, close forward, press down.',
    lost: 'arms reaching forward (drawn with the elbows out)',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,70,180,70,180,0],[7,90,0,90,0,0],[10,70,180,70,180,0],[13,22,8,22,8,.4],[15.5,R,0],[17,R,0]),
  },
  {
    id: 'cloud-hands',
    name: 'Cloud hands',
    set: 'Shibashi',
    tier: 2,
    cue: 'Upper hand drifts across at face height, lower hand at the belly; swap.',
    lost: 'the waist turn',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,40,165,15,115,.3],[7,80,365,12,125,.3],[7,80,5,12,125,.3],[10.5,15,115,40,165,.3],[14,12,125,80,365,.3],[14,12,125,80,5,.3],[17.5,40,165,15,115,.3],[20,R,0],[21.5,R,0]),
  },
  {
    id: 'scoop-sea',
    name: 'Scooping the sea, looking at the sky',
    set: 'Shibashi',
    tier: 2,
    cue: 'Bend and cross the hands low, lift them up the middle and open to the sky.',
    lost: 'the forward bend and lean back',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,5,50,5,50,.5],[7,25,140,25,140,.2],[9.5,150,360,150,360,0],[11.5,150,360,150,360,0],[11.5,150,0,150,0,0],[14.5,90,0,90,0,.1],[17.5,R,0],[19,R,0]),
  },
  {
    id: 'dove-wings',
    name: 'Flying dove spreads wings',
    set: 'Shibashi',
    tier: 2,
    cue: 'Arms forward, spread the wings wide as you sink, close forward, press down.',
    seatedCue: 'Arms forward, spread the wings wide, close forward, press down.',
    lost: 'arms reaching forward (drawn with the elbows out)',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,70,180,70,180,0],[7,90,0,90,0,.3],[10,70,180,70,180,0],[13,22,8,22,8,.4],[15.5,R,0],[17,R,0]),
  },
  {
    id: 'flywheel',
    name: 'Rotating the flywheel',
    set: 'Shibashi',
    tier: 2,
    cue: 'Both arms draw one big wheel in front of you; reverse.',
    lost: 'the torso lean',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3,10,10,-10,10,.3],[6,90,10,-70,10,.3],[9,180,10,-180,10,.1],[12,290,10,-270,10,.3],[15,360,10,-360,10,.3],[15,0,10,0,10,.3],[18,-70,10,90,10,.3],[21,-180,10,180,10,.1],[24,-270,10,290,10,.3],[27,-360,10,360,10,.3],[27,0,10,0,10,.3],[29,R,0],[30.5,R,0]),
  },
  {
    id: 'bounce-ball',
    name: 'Stepping and bouncing the ball',
    set: 'Shibashi',
    tier: 2,
    cue: 'Lift a hand and pat the ball down beside you; change sides.',
    lost: 'the knee lift',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,75,150,12,70,.1],[5,25,20,12,70,.3],[6.5,75,150,12,70,.1],[8,25,20,12,70,.3],[9.5,12,70,75,150,.1],[11,12,70,25,20,.3],[12.5,12,70,75,150,.1],[14,12,70,25,20,.3],[15.5,R,0],[17,R,0]),
  },

  // ---- Yi Jin Jing ----
  {
    id: 'pestle-2',
    name: 'Wei Tuo presents the pestle 2',
    set: 'Yi Jin Jing',
    tier: 1,
    cue: 'Elbows up with fingertips meeting at the chest, then spread the arms like a wide beam.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,85,180,85,180,0],[7,90,0,90,0,0],[13,90,0,90,0,0],[16.5,R,0],[18,R,0]),
  },
  {
    id: 'pestle-3',
    name: 'Wei Tuo presents the pestle 3',
    set: 'Yi Jin Jing',
    tier: 1,
    cue: 'Hands pass the face and push the sky, then lower down the sides.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,85,180,85,180,0],[7,172,360,172,360,0],[12,172,360,172,360,0],[12,172,0,172,0,0],[15,90,0,90,0,0],[18,R,0],[19.5,R,0]),
  },
  {
    id: 'three-plates',
    name: 'Three plates falling on the floor',
    set: 'Yi Jin Jing',
    tier: 1,
    cue: 'Palms lift, then press down as you squat, deeper each time.',
    postures: STANDING,
    keys: K([0,R,0],[1.5,R,0],[4,90,0,90,0,0],[7,35,10,35,10,.35],[9.5,80,15,80,15,.1],[12.5,32,10,32,10,.65],[15,80,15,80,15,.1],[18,28,10,28,10,.9],[21,80,15,80,15,0],[24,R,0],[25.5,R,0]),
  },
  {
    id: 'pestle-1',
    name: 'Wei Tuo presents the pestle 1',
    set: 'Yi Jin Jing',
    tier: 2,
    cue: 'Arms float forward, then palms join in front of the chest.',
    lost: 'arms rising forward (drawn with the elbows out)',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,70,180,70,180,0],[7,8,145,8,145,0],[11,8,145,8,145,0],[12.5,R,0],[14,R,0]),
  },
  {
    id: 'pluck-star',
    name: 'Plucking a star',
    set: 'Yi Jin Jing',
    tier: 2,
    cue: 'Swing the hand down across the body, then up to hook a star above your head.',
    lost: 'the twist and the hand behind the back',
    postures: STANDING,
    keys: K([0,R,0],[1.5,R,0],[3.5,-10,20,15,40,.4],[7,150,260,15,40,.1],[9,150,260,15,40,.1],[11.5,R,.1],[14,15,40,-10,20,.4],[17.5,15,40,150,260,.1],[19.5,15,40,150,260,.1],[22,R,0],[23.5,R,0]),
  },
  {
    id: 'nine-ghosts',
    name: 'Nine ghosts drawing sabres',
    set: 'Yi Jin Jing',
    tier: 2,
    cue: 'One hand behind the head, the other up the spine; open and close the chest.',
    lost: 'the twist',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,150,260,20,120,0],[7,150,260,20,120,.4],[9,150,260,20,120,0],[11.5,R,0],[14,20,120,150,260,0],[17,20,120,150,260,.4],[19,20,120,150,260,0],[21.5,R,0],[23,R,0]),
  },

  // ---- Wu Qin Xi ----
  {
    id: 'tiger-paws',
    name: 'Tiger raising paws',
    set: 'Wu Qin Xi',
    tier: 1,
    cue: 'Claws rise up the front, open and push to the sky, then pull down.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,22,115,22,115,.1],[6,30,150,30,150,0],[8.5,172,360,172,360,0],[10,172,360,172,360,0],[12.5,30,150,30,150,.1],[14.5,22,115,22,115,.2],[16.5,R,0],[18,R,0]),
  },
  {
    id: 'bird-flying',
    name: 'Bird flying',
    set: 'Wu Qin Xi',
    tier: 1,
    cue: 'Wings lift to the shoulders, fold in, then rise high overhead.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3,25,115,25,115,.3],[6,100,15,100,15,0],[8.5,25,115,25,115,.3],[12,168,-70,168,-70,0],[15,25,115,25,115,.3],[17,R,0],[18.5,R,0]),
  },
  {
    id: 'deer-antlers',
    name: 'Deer butting antlers',
    set: 'Wu Qin Xi',
    tier: 2,
    cue: 'Turn and swing the antlers up and back; look to the back heel.',
    lost: 'the twist and the look back, which are the point of the move',
    postures: STANDING,
    keys: K([0,R,0],[1.5,R,0],[4,22,115,22,115,.2],[7,150,30,30,90,.4],[9,150,30,30,90,.4],[11.5,22,115,22,115,.2],[14.5,30,90,150,30,.4],[16.5,30,90,150,30,.4],[19,R,0],[20.5,R,0]),
  },
  {
    id: 'bear-waist',
    name: 'Bear rotating the waist',
    set: 'Wu Qin Xi',
    tier: 2,
    cue: 'Paws at the belly; the waist draws slow circles.',
    lost: 'the torso circle',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3,25,140,25,140,.3],[5,30,105,5,120,.3],[7,15,90,15,90,.3],[9,5,120,30,105,.3],[11,25,140,25,140,.3],[13,30,105,5,120,.3],[15,15,90,15,90,.3],[17,5,120,30,105,.3],[19,25,140,25,140,.3],[21,R,0],[22.5,R,0]),
  },
  {
    id: 'ape-lifting',
    name: 'Ape lifting',
    set: 'Wu Qin Xi',
    tier: 2,
    cue: 'Pinch the fingers into hooks and draw them up to the chest, rising tall; release.',
    lost: 'the shrug, heel rise and head turn',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3,22,115,22,115,.2],[6,20,160,20,160,0],[9,20,160,20,160,0],[12,22,115,22,115,.2],[13.5,R,0],[15,R,0]),
  },
  {
    id: 'ape-fruit',
    name: 'Ape picking fruit',
    set: 'Wu Qin Xi',
    tier: 2,
    cue: 'Reach high and out to pluck the fruit, then bring it to your face.',
    lost: 'the step and leg lift',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,30,60,15,40,.4],[6.5,140,10,15,40,0],[8.5,40,165,20,120,.3],[10,R,0],[12.5,15,40,30,60,.4],[15.5,15,40,140,10,0],[17.5,20,120,40,165,.3],[19,R,0],[20.5,R,0]),
  },
  {
    id: 'bird-stretching',
    name: 'Bird stretching',
    set: 'Wu Qin Xi',
    tier: 2,
    cue: 'Hands stack and rise overhead, press down, then swing back like tail feathers.',
    lost: 'the leg lift and chest arch',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3,20,115,20,115,.3],[6.5,168,290,168,290,0],[8.5,168,290,168,290,0],[11,20,115,20,115,.3],[14,35,0,35,0,0],[16,R,0],[17.5,R,0]),
  },

  // ---- Liu Zi Jue ----
  {
    id: 'xi',
    name: 'Xi, for the triple burner',
    set: 'Liu Zi Jue',
    tier: 1,
    cue: 'Backs of the hands lift to the chest, open overhead, fold in, press down and part at the hips, sounding "xi".',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3,15,125,15,125,.1],[6,25,155,25,155,0],[9,140,365,140,365,0],[11,80,170,80,170,.1],[14,22,115,22,115,.35],[16.5,30,10,30,10,.35],[19,R,0],[20.5,R,0]),
  },
  {
    id: 'he',
    name: 'He, for the heart',
    set: 'Liu Zi Jue',
    tier: 2,
    cue: 'Scoop the palms up to the chest, turn them over and press down, sounding "he".',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3.5,22,115,22,115,.4],[6.5,25,155,25,155,.1],[9.5,22,115,22,115,.35],[11.5,R,0],[13,R,0]),
  },
  {
    id: 'hu',
    name: 'Hu, for the spleen',
    set: 'Liu Zi Jue',
    tier: 2,
    cue: 'Hands open from the navel as if holding a ball, sounding "hu"; gather back in.',
    lost: 'the hands opening forward',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[3,22,115,22,115,.1],[6,40,95,40,95,.4],[9,22,115,22,115,.1],[12,40,95,40,95,.4],[15,22,115,22,115,.1],[16.5,R,0],[18,R,0]),
  },
  {
    id: 'chui',
    name: 'Chui, for the kidneys',
    set: 'Liu Zi Jue',
    tier: 2,
    cue: 'Hands to the lower back, slide them down the legs as you squat, sounding "chui"; gather a ball and rise.',
    lost: 'the hands behind the back',
    postures: STANDING,
    keys: K([0,R,0],[1.5,R,0],[3.5,45,5,45,5,0],[5.5,30,50,30,50,0],[9,15,5,15,5,.7],[11.5,5,50,5,50,.7],[14,22,115,22,115,.1],[16,R,0],[17.5,R,0]),
  },

  // ---- Standalone ----
  {
    id: 'lift-lower-qi',
    name: 'Lifting and lowering qi',
    set: 'Standalone',
    tier: 1,
    cue: 'Scoop the arms up the sides, then let the palms float down the front to the belly.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[5,90,0,90,0,0],[8,168,-70,168,-70,0],[9,168,-70,168,-70,0],[9,168,290,168,290,0],[12.5,30,150,30,150,.2],[15,22,115,22,115,.35],[17.5,R,0],[19,R,0]),
  },
  {
    id: 'open-close-chest',
    name: 'Opening and closing at the chest',
    set: 'Standalone',
    tier: 1,
    cue: 'Palms face at the chest; breathe in to open, breathe out to close.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,30,150,30,150,.1],[7,75,150,75,150,0],[10,30,150,30,150,.3],[13,75,150,75,150,0],[16,30,150,30,150,.3],[18.5,R,0],[20,R,0]),
  },
  {
    // Not in the catalog: the app's original wide version, kept alongside the chest one.
    id: 'open-close',
    name: 'Opening and closing',
    set: 'Standalone',
    tier: 1,
    cue: 'Arms open wide as you rise, fold back to the belly as you sink.',
    seatedCue: 'Arms open wide as you breathe in, fold back to the belly as you breathe out.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4.5,75,20,75,20,0],[8,25,95,25,95,.5],[11,75,20,75,20,0],[14.5,25,95,25,95,.5],[17.5,R,0],[19,R,0]),
  },
  {
    id: 'hug-tree',
    name: 'Standing post, hugging the tree',
    set: 'Standalone',
    tier: 1,
    cue: 'Soften the knees, round the arms as if hugging a tree, breathe.',
    seatedCue: 'Sit tall, round the arms as if hugging a tree, breathe.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[5,35,150,35,150,.25],[25,35,150,35,150,.25],[29,R,0],[30.5,R,0]),
  },
  {
    id: 'gather-qi',
    name: 'Gathering qi to the dantian',
    set: 'Standalone',
    tier: 1,
    cue: 'Arms open, fold the hands onto the belly, rest.',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[4,45,5,45,5,0],[7,22,115,22,115,0],[12,22,115,22,115,0],[15,R,0],[16.5,R,0]),
  },
  {
    id: 'shaking',
    name: 'Shaking',
    set: 'Standalone',
    tier: 1,
    cue: 'Bounce gently from the knees and let the arms hang loose.',
    postures: STANDING,
    keys: K([0,R,0],[1.5,R,0],[2.5,8,15,8,15,.05],[3,8,25,8,25,.2],[3.5,8,15,8,15,.05],[4,8,25,8,25,.2],[4.5,8,15,8,15,.05],[5,8,25,8,25,.2],[5.5,8,15,8,15,.05],[6,8,25,8,25,.2],[6.5,8,15,8,15,.05],[7,8,25,8,25,.2],[7.5,8,15,8,15,.05],[9,R,0],[10.5,R,0]),
  },
  {
    id: 'arm-swing',
    name: 'Twisting arm swing',
    set: 'Standalone',
    tier: 2,
    cue: 'Turn from the waist and let the arms swing and wrap loosely.',
    lost: 'the twist',
    postures: BOTH,
    keys: K([0,R,0],[1.5,R,0],[2.5,70,20,10,130,.15],[4,10,130,70,20,.15],[5.5,70,20,10,130,.15],[7,10,130,70,20,.15],[8.5,70,20,10,130,.15],[10,10,130,70,20,.15],[11.5,R,0],[13,R,0]),
  },
]

// Body proportions in torso lengths.
const BODY = {
  torso: 0.19,
  shoulderHalf: 0.42,
  hipHalf: 0.22,
  upperArm: 0.72,
  forearm: 0.66,
  thigh: 0.95,
  shin: 0.95,
  head: 0.55,
  stanceHalf: 0.34,
}

export const DEMO_ASPECT = 4 / 3
const GROUND = 0.94

const ease = (u: number) => u * u * (3 - 2 * u)

// Two keys may share a `t` to jump between equivalent angles (see the catalog).
// That zero-length segment is never interpolated: `t` reaching it is at most
// `a.t`, which the segment before already returned.
export function sample(keys: BodyKey[], t: number): BodyKey {
  if (t <= keys[0].t) return keys[0]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (t <= b.t) {
      const u = ease((t - a.t) / (b.t - a.t))
      const lerp = (x: number, y: number) => x + (y - x) * u
      return {
        t,
        lArm: lerp(a.lArm, b.lArm),
        lElbow: lerp(a.lElbow, b.lElbow),
        rArm: lerp(a.rArm, b.rArm),
        rElbow: lerp(a.rElbow, b.rElbow),
        sink: lerp(a.sink, b.sink),
      }
    }
  }
  return keys[keys.length - 1]
}

const deg = Math.PI / 180

// Seated on a stool the thighs point at the viewer, so from the front they
// read as a short drop from hip to knee.
const SEATED_THIGH_DROP = 0.2

export function poseAt(k: BodyKey, posture: Posture = 'standing'): Pose {
  const T = BODY.torso
  const cx = DEMO_ASPECT / 2
  const seated = posture === 'seated'
  // Sinking: the thighs come forward, so from the front they look shorter and the knees open a little.
  const sink = seated ? 0 : k.sink
  const thighDrop = seated ? SEATED_THIGH_DROP : BODY.thigh * (1 - 0.45 * sink)
  const hipY = GROUND - (thighDrop + BODY.shin) * T
  const shoulderY = hipY - T
  const p = (x: number, y: number): Pt => ({ x, y, v: 1 })

  // side = -1 for the screen-left limb, +1 for the screen-right one.
  const arm = (side: -1 | 1, raise: number, bend: number) => {
    const sx = cx + side * BODY.shoulderHalf * T
    const upper = raise * deg
    const fore = (raise - bend) * deg
    const ex = sx + side * Math.sin(upper) * BODY.upperArm * T
    const ey = shoulderY + Math.cos(upper) * BODY.upperArm * T
    const wx = ex + side * Math.sin(fore) * BODY.forearm * T
    const wy = ey + Math.cos(fore) * BODY.forearm * T
    return [p(sx, shoulderY), p(ex, ey), p(wx, wy)] as const
  }
  const leg = (side: -1 | 1) => {
    const hx = cx + side * BODY.hipHalf * T
    // Seated, the knees sit a little wider than the hips with the shins straight down.
    const ax = cx + side * (seated ? BODY.hipHalf + 0.1 : BODY.stanceHalf) * T
    const kx = seated ? ax : (hx + ax) / 2 + side * 0.12 * sink * T
    const ky = hipY + thighDrop * T
    return [p(hx, hipY), p(kx, ky), p(ax, GROUND)] as const
  }
  const [lShoulder, lElbow, lWrist] = arm(-1, k.lArm, k.lElbow)
  const [rShoulder, rElbow, rWrist] = arm(1, k.rArm, k.rElbow)
  const [lHip, lKnee, lAnkle] = leg(-1)
  const [rHip, rKnee, rAnkle] = leg(1)
  return {
    head: p(cx, shoulderY - BODY.head * T),
    lShoulder,
    rShoulder,
    lElbow,
    rElbow,
    lWrist,
    rWrist,
    lHip,
    rHip,
    lKnee,
    rKnee,
    lAnkle,
    rAnkle,
  }
}

export const DEMO_FPS = 30

export function referenceFromMove(move: Move, posture: Posture = 'standing'): Reference {
  const end = move.keys[move.keys.length - 1].t
  const poses: Pose[] = []
  for (let i = 0; i <= Math.round(end * DEMO_FPS); i++) poses.push(poseAt(sample(move.keys, i / DEMO_FPS), posture))
  return buildReference(move.name, DEMO_FPS, DEMO_ASPECT, poses, posture)
}
