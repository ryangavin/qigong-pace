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
  `createEnergyLayer(canvas)` renders a `QiFrame` (declared in `types.ts`, the qi model's output) around the learner's pose.
  `shaders.ts` holds the look; `body.ts` lays the pose out as capsules; `auto.ts` fakes a `QiFrame` from motion.
- `energy.html` (with `src/energy/harness.ts`): a tuning page for the energy layer, driven by a simulated student,
  with sliders, palettes and an fps / GPU-time readout. URL options are listed on the page.
- `src/qi/`: the qi model. `QiModel` turns practice (the `Follower`, the learner's pose) into energy
  values per frame (`QiFrame`) for the qi view; pure numbers, no drawing. `track.ts` reads what a
  reference implies (breath, reach, sink). The dynamics are grounded in `docs/sensations.md`, the
  research on what practitioners feel; keep the two in step.
- `src/sim.ts`: the simulated student, for working without a webcam. `src/prefs.ts`: the remembered posture.
- `index.html`, `src/primary/`: the primary view. The mirrored webcam full-bleed and graded dark, with the teacher
  as a luminous ghost over the learner's own body (`guidance.ts`). Layers, back to front: camera, `#energy`
  (the slot for the qi-energy layer, screened), `#guidance`, chrome. `?sim` (or `?sim=<speed>`) drives it with
  the simulated student over a synthetic dark room instead of the camera.
- `debug.html`, `src/debug/`: the debug panel for developing the engine: teacher and learner side by side,
  timeline, pace, sliders and video import.
- `vite.config.ts` makes every root-level `*.html` a build entry, so a new page needs no config change.

## Tests and checks

Run each once, after your last edit:

- `npm run check` (`tsc --noEmit`): type-check. Run after any change to `src/`.
- `npm test` (`vitest run`): unit tests in `src/**/*.test.ts`. Run after changing matching, following, moves,
  the qi model, the simulated student, the guidance overlay's helpers, or the energy layer's geometry and
  auto frame. Add tests for new behaviour there.
- The energy layer's look has no automated check: open `energy.html` in the dev server (`npx vite`) and look.
- `npm run build` (type-check plus `vite build`): run when you touch `index.html`, CSS, imports or build config.

CI (`.github/workflows/ci.yml`) runs the type-check, unit tests and `vite build`
on every PR and on pushes to `main`; it is the final check.

The app itself needs a webcam; without one, open the primary view at `/?sim` or use the debug panel's
"simulated student" button.
