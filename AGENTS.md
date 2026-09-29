# AGENTS.md

At Your Pace: a Vite + TypeScript qi gong trainer. The teacher (a built-in
figure or an imported video) advances only as the learner, tracked by MediaPipe
through the webcam, matches its pose.

## Layout

- `src/skeleton.ts`: poses, segments, features (body shape) and drawing helpers.
  `Posture` ('standing' | 'seated') decides which segments count and how the body is scaled.
  Each pose carries a palm centre per hand (`lPalm`, `rPalm`; `palmCentre` reads it from MediaPipe's wrist,
  index and pinky points, falling back along the forearm). The hands are drawn but not matched (weight 0).
- `src/fit.ts`: fitting the teacher to the learner's own body. `Calibration` / `BodyFit` measure the learner's
  segment lengths (`Proportions`, in body lengths) over the opening-pose wait and the first seconds of practice;
  `retarget` redraws a pose on other proportions (the teacher's directions and foreshortening, the new lengths);
  `fitOnto` lays a fitted teacher on the learner from their own shoulders, so every palm target is within reach.
- `src/follower.ts`: `Reference` (a teacher's move) and `Follower`, which keeps the teacher in step with the learner.
  A reference keeps the teacher's own poses (`teacher`, `teacherBody`); `fitReference` gives the same move fitted
  to a learner's body (`poses`, `feats`), which is what the learner is compared with and guided by. The views
  refit it as the learner's `BodyFit` moves on and swap it into the running `Follower`.
  Holds run at real time while the learner holds the shape; a learner held still in the shape (`stir`, `settled`)
  just short of a hold is carried into it and through it, even when their shape is a little off the teacher's.
- `src/moves.ts`: built-in moves as keyframes, and the figure drawn from them. Each `Move` lists the `postures` it supports.
  Keys are transcribed exactly from `docs/move-catalog.md` (the spec), one line per move.
- `src/energy/`: the qi energy layer, a raw WebGL2 renderer drawn over the camera with `mix-blend-mode: screen`.
  `createEnergyLayer(canvas)` renders a `QiFrame` (imported from `src/qi/`, the one declaration) around the learner's
  pose, optionally with a person mask (`setMask`). It stops on WebGL context loss and rebuilds on restore.
  `shaders.ts` holds the look; `body.ts` lays the pose out as capsules; `auto.ts` fakes a `QiFrame` from motion.
- `src/pose.ts`: MediaPipe pose tracking. With `segmentation` it also keeps a small person mask: `src/mask.ts` shrinks
  CPU masks, `src/maskReader.ts` reads GPU masks back asynchronously (a blit and a pixel buffer, no stall).
  `openCamera()` asks for 1280×720 at 30 fps and takes what the camera offers if it can't; `eachVideoFrame()` runs
  detection once per new camera frame (`requestVideoFrameCallback`, or a per-animation-frame check without it).
  `?model=lite|full|heavy` on either page picks the pose model (`full` by default).
- `src/smoothing.ts`: `LandmarkFilter` steadies the learner's raw MediaPipe landmarks (every one, before
  `poseFromLandmarks`) with a One Euro filter per coordinate on real timestamps; a landmark that drops below
  visibility 0.5 holds its place briefly, then its visibility fades. A detection that can't be a body moving
  (shoulder width or a well-seen torso changing by over 35% in a frame, shoulders swapping sides or leaping) is
  passed over like a frame with no one found; three agreeing ones in a row are a real change and are taken afresh.
  Both pages filter the camera learner; imported videos use `cleanTrack` instead.
- `energy.html` (with `src/energy/harness.ts`): a tuning page for the energy layer, driven by a simulated student,
  with sliders, palettes and an fps / GPU-time readout. URL options are listed on the page.
- `src/qi/`: the qi model. `QiModel` turns practice (the `Follower`, the learner's pose) into energy
  values per frame (`QiFrame`) for the qi view; pure numbers, no drawing. `track.ts` reads what a
  reference implies (breath, reach, sink). The dynamics are grounded in `docs/sensations.md`, the
  research on what practitioners feel; keep the two in step.
- `src/sim.ts`: the simulated student, for working without a webcam. `src/prefs.ts`: the remembered posture.
- `src/session.ts`: recorded practice sessions (pure, tested): `Recorder` keeps the RAW MediaPipe landmarks of each
  detection (all 33, x/y/z/visibility, before any filtering) with real timestamps, the camera aspect, move, posture,
  follower settings and look-ahead, plus changes made while recording (move, posture, begin again, settings);
  `Replayer` plays them back like a camera (advance its clock, read the newest detection). It sits at the input
  boundary: both pages hand camera and replay landmarks to the same `takeLandmarks`, so everything after it
  (filtering, calibration, following, qi) runs on a replay exactly as on the camera. `src/sessionFiles.ts`: download,
  file picker, drop and `?replay=` loading.
  The file is JSON: a readable header (`format: "qigong-pace-session"`, `version`, `move`, `posture`, `aspect`,
  `settings`, `events`) and `frames`, one per line: `[ms, x, y, z, visibility × 33]` as integers (x, y × 10000,
  z × 1000, visibility × 100), or `[ms]` when no one was found. Starting a recording begins the move again.
- `index.html`, `src/primary/`: the primary view. The mirrored webcam full-bleed and graded dark. The guidance
  (`guidance.ts`) is something to trace: for each hand a bright path of where the teacher's palm goes next (from
  `follower.pos`, fitted to the learner's body with `fitOnto`; warm for the screen-left hand, cool for the right),
  a bead where the palm should be now (the follower's lead; it stays put and fills a ring through a hold), and a
  ring on the learner's own palm that locks on to its bead, tethered back to it when off. The teacher's shape is
  only a faint outline. Where a bead or the path ahead would fall outside the picture, the hint up top asks the
  learner to step (or sit) back rather than show an unreachable light (`outOfView`).
  `guidanceMix(reps, flow)` (pure, tested) puts learning first: while a move is new the paths are full and
  the energy only glimmers; as it is learned the energy grows and the paths shorten and soften. Layers, back to
  front: camera, `#energy` (the energy layer, fed by one session-long `QiModel` and the segmentation mask,
  screened, its strength set each frame from the mix), `#guidance` (not screened: its lines carry a dark casing
  so they read over bright energy), chrome.
  `invitations.ts` picks the gentle invitations to notice a sensation (pure, tested; texts from `docs/sensations.md`);
  they share the one line of words with the move's cues and never overlap them.
  `tracking.ts` (pure, tested) says when the camera can't see the learner well (no one found, too close, framed
  too low, a hand unseen), only once it has lasted a moment; its hint sits up top (`#hint`), apart from the move's
  line. Framing is checked against the posture: standing needs head to feet; seated needs the head and the hands
  resting in the lap (estimated from the shoulders when unseen), and says to sit back or tilt the camera down.
  URL options: `?sim` (or `?sim=<speed>`) drives it with the simulated student over a synthetic dark room instead
  of the camera, and `?wander=<torso lengths>` (0.9 by default) sets how far its screen-right hand strays off the
  path. The simulated student is built like a typical person, not like the figure; `?arms=<torso lengths>`
  (shoulder to wrist, 1.15 typically) and `?shoulders=<torso lengths>` (0.8) change its build, to see the teacher
  fitted to other bodies; `?replay=<url>` plays a recorded session in place of the camera (see below);
  `?palette=dusk|jade|ember`; `?qi=<0..1>` starts the session with that much qi and `?reps=<n>` starts each
  move as if already practised n times smoothly (dev aids for looking at higher qi and the grown energy without
  practising for minutes).
- `debug.html`, `src/debug/`: the debug panel for developing the engine: teacher and learner side by side,
  timeline, pace, the live `QiFrame` readout, sliders and video import. With the camera it also shows the
  detection rate in Hz, each joint's visibility (raw → filtered), and the raw landmarks as faint dots under the
  filtered skeleton.
- `vite.config.ts` makes every root-level `*.html` a build entry, so a new page needs no config change.

## Tests and checks

Run each once, after your last edit:

- `npm run check` (`tsc --noEmit`): type-check. Run after any change to `src/`.
- `npm test` (`vitest run`): unit tests in `src/**/*.test.ts`. Run after changing matching, following, moves,
  the body fitting (`src/fit.test.ts`: palm centres, calibration, retargeting, and a learner built unlike the
  teacher following moves to the end with every bead locked on), the qi model, the simulated student, the
  guidance overlay's helpers, the invitations, the tracking hints, the landmark filter (`src/smoothing.ts`), the
  mask shrinking, the energy layer's geometry and auto frame, or recorded sessions (`src/session.ts`).
  Filtering and the tracking hints on a live camera need a real person: check them on `debug.html`, or replay one
  of the owner's recorded sessions (below). Add tests for new behaviour there.
- The energy layer's look has no automated check: open `energy.html` in the dev server (`npx vite`) and look,
  and the primary view at `/?sim&qi=0.8` and `/?sim&qi=0.8&reps=4` (try each `palette`; the hand paths must stay
  legible over the energy). The GPU mask read-back needs a real person in
  front of a camera (or a photo drawn to a canvas and passed to `PoseTracker.detect`, one call per frame).
- `npm run build` (type-check plus `vite build`): run when you touch `index.html`, CSS, imports or build config.

CI (`.github/workflows/ci.yml`) runs the type-check, unit tests and `vite build`
on every PR and on pushes to `main`; it is the final check.

The app itself needs a webcam; without one, open the primary view at `/?sim` or use the debug panel's
"simulated student" button.

## Replaying the owner's sessions

The owner records sessions at the webcam (Record, or R, in either page) and attaches the file to an issue. To debug
one without a camera:

- Save the attachment under `fixtures/replays/` (the dev server serves it; it is not part of the build), then open
  `/debug.html?replay=fixtures/replays/<file>.json` to step through it: Pause, and scrub to the moment in the issue
  (a scrub starts from the session's start and runs through at 30 ticks a second, so the follower and qi there are
  what the session had come to). `/?replay=fixtures/replays/<file>.json` plays it in the primary view over the
  synthetic dark room. Dropping the file on either page, or the debug panel's "Replay a session…", does the same.
- `fixtures/replays/sim-sample.json` is the simulated student through "Holding up the sky", for trying it out.
- For a test, read the file with `parseSession` and feed its decoded frames (`decodeFrame`, or a `Replayer`)
  through a `LandmarkFilter` (timed by each frame's `t`) and `poseFromLandmarks(lm, { aspect, flipX: true,
  facingAway: false })`, as the pages' `takeLandmarks` and `src/session.test.ts` do.
- Replay runs at real speed; the follower's `dt` comes from the display's frames, as it does live, so a replay can
  differ from the original by a frame's worth of easing. The session's qi starts fresh (and `?qi=`/`?reps=` apply).
