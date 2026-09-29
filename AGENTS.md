# AGENTS.md

At Your Pace: a Vite + TypeScript qi gong trainer. The teacher (a built-in
figure or an imported video) advances only as the learner, tracked by MediaPipe
through the webcam, matches its pose.

## Layout

- `src/skeleton.ts`: poses, segments, features (body shape) and drawing helpers.
  `Posture` ('standing' | 'seated') decides which segments count and how the body is scaled.
- `src/follower.ts`: `Reference` (a teacher's move) and `Follower`, which keeps the teacher in step with the learner.
- `src/moves.ts`: built-in moves as keyframes, and the figure drawn from them. Each `Move` lists the `postures` it supports.
  Keys are transcribed exactly from `docs/move-catalog.md` (the spec), one line per move.
- `src/energy/`: the qi energy layer, a raw WebGL2 renderer drawn over the camera with `mix-blend-mode: screen`.
  `createEnergyLayer(canvas)` renders a `QiFrame` (imported from `src/qi/`, the one declaration) around the learner's
  pose, optionally with a person mask (`setMask`). It stops on WebGL context loss and rebuilds on restore.
  `shaders.ts` holds the look; `body.ts` lays the pose out as capsules; `auto.ts` fakes a `QiFrame` from motion.
- `src/pose.ts`: MediaPipe pose tracking. With `segmentation` it also keeps a small person mask: `src/mask.ts` shrinks
  CPU masks, `src/maskReader.ts` reads GPU masks back asynchronously (a blit and a pixel buffer, no stall).
- `energy.html` (with `src/energy/harness.ts`): a tuning page for the energy layer, driven by a simulated student,
  with sliders, palettes and an fps / GPU-time readout. URL options are listed on the page.
- `src/qi/`: the qi model. `QiModel` turns practice (the `Follower`, the learner's pose) into energy
  values per frame (`QiFrame`) for the qi view; pure numbers, no drawing. `track.ts` reads what a
  reference implies (breath, reach, sink). The dynamics are grounded in `docs/sensations.md`, the
  research on what practitioners feel; keep the two in step.
- `src/sim.ts`: the simulated student, for working without a webcam. `src/prefs.ts`: the remembered posture.
- `index.html`, `src/primary/`: the primary view. The mirrored webcam full-bleed and graded dark. The guidance
  (`guidance.ts`) is something to trace: for each hand a bright path of where the teacher's wrist goes next (from
  `follower.pos`, aligned to the learner's body; warm for the screen-left hand, cool for the right), a bead where
  the hand should be now (the follower's lead; it stays put and fills a ring through a hold), and a ring on the
  learner's own hand that locks on to its bead, tethered back to it when off. The teacher's shape is only a faint
  outline. `guidanceMix(reps, flow)` (pure, tested) puts learning first: while a move is new the paths are full and
  the energy only glimmers; as it is learned the energy grows and the paths shorten and soften. Layers, back to
  front: camera, `#energy` (the energy layer, fed by one session-long `QiModel` and the segmentation mask,
  screened, its strength set each frame from the mix), `#guidance` (not screened: its lines carry a dark casing
  so they read over bright energy), chrome.
  `invitations.ts` picks the gentle invitations to notice a sensation (pure, tested; texts from `docs/sensations.md`);
  they share the one line of words with the move's cues and never overlap them.
  URL options: `?sim` (or `?sim=<speed>`) drives it with the simulated student over a synthetic dark room instead
  of the camera, and `?wander=<torso lengths>` (0.9 by default) sets how far its screen-right hand strays off the
  path; `?palette=dusk|jade|ember`; `?qi=<0..1>` starts the session with that much qi and `?reps=<n>` starts each
  move as if already practised n times smoothly (dev aids for looking at higher qi and the grown energy without
  practising for minutes).
- `debug.html`, `src/debug/`: the debug panel for developing the engine: teacher and learner side by side,
  timeline, pace, the live `QiFrame` readout, sliders and video import.
- `vite.config.ts` makes every root-level `*.html` a build entry, so a new page needs no config change.

## Tests and checks

Run each once, after your last edit:

- `npm run check` (`tsc --noEmit`): type-check. Run after any change to `src/`.
- `npm test` (`vitest run`): unit tests in `src/**/*.test.ts`. Run after changing matching, following, moves,
  the qi model, the simulated student, the guidance overlay's helpers, the invitations, the mask shrinking, or
  the energy layer's geometry and auto frame. Add tests for new behaviour there.
- The energy layer's look has no automated check: open `energy.html` in the dev server (`npx vite`) and look,
  and the primary view at `/?sim&qi=0.8` and `/?sim&qi=0.8&reps=4` (try each `palette`; the hand paths must stay
  legible over the energy). The GPU mask read-back needs a real person in
  front of a camera (or a photo drawn to a canvas and passed to `PoseTracker.detect`, one call per frame).
- `npm run build` (type-check plus `vite build`): run when you touch `index.html`, CSS, imports or build config.

CI (`.github/workflows/ci.yml`) runs the type-check, unit tests and `vite build`
on every PR and on pushes to `main`; it is the final check.

The app itself needs a webcam; without one, open the primary view at `/?sim` or use the debug panel's
"simulated student" button.
