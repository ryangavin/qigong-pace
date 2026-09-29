# At Your Pace

Learn qi gong and tai chi moves with a teacher that moves exactly as fast as you do.

The hard part of learning these forms is the moves themselves. Videos run too
fast, and pausing breaks the flow. Here your webcam tracks your pose, and the
teacher only moves forward as you follow along: slow down and they slow down,
stop and they wait, hold a posture and the hold plays out with you.

## What it does

- **Follows your pace.** Each frame, the teacher's move is searched a little
  way ahead for the shape that matches yours, and the teacher eases there. It
  never goes backwards and waits if you lose the shape.
- **Something to trace.** Over your own mirrored body, each hand gets a
  bright path of where the teacher's hand goes next, with a bead of light
  where your hand should be now. Your hand shows as a ring that locks on
  when it reaches its bead; when it strays, a faint line shows the way back.
  In a hold the bead waits and a thin ring fills for as long as the hold
  lasts. The teacher's body is there too, as a faint outline.
  (The debug panel colours each limb green, amber or red instead.)
- **Qi you can see.** As you practise slowly and in step, a soft sea of
  energy gathers in your body and around it: in the palms, below the navel,
  down to the feet, up through the crown. It follows your real silhouette.
  Learning comes first: while a move is new the energy barely shows, and it
  grows as you come to know the move, while its paths step back.
  Now and then, once you know the move, a quiet line invites you to notice a
  sensation practitioners report (see [docs/sensations.md](docs/sensations.md)).
- **35 built-in moves** from Ba Duan Jin, Shibashi, Yi Jin Jing, Wu Qin Xi,
  Liu Zi Jue and standalone practice. See [docs/move-catalog.md](docs/move-catalog.md).
- **Standing or seated** practice. Seated follows the upper body only.
- **Learn from any video.** Load a video of a teacher; their pose is tracked on
  every frame and the video itself then plays at your pace.

Everything runs in the browser. Pose tracking is Google's
[MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker);
no video leaves your machine.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL, click **Start camera** and step back until your whole
body is in view (or choose Seated), and bring your hands to the two lights;
then follow the paths. Move the pointer to bring back the move list.
**Watch a simulated student instead** (or `/?sim`) shows it working without a
camera. `?palette=jade` (or `ember`; `dusk` is the default) changes the
energy's colours, `?qi=0.8` starts with that much qi gathered and `?reps=4`
as if each move were already well known, for looking at the view without
practising for minutes first; `?wander=2` makes the simulated student's hand
stray further off its path.

`/debug.html` is the debug panel for working on the engine: the teacher and
you side by side, a timeline, your pace, the matching sliders and loading a
teacher from a video.

## Send a session to the developers

When something goes wrong in practice ("I couldn't reach one of the orbs"),
record it so it can be replayed exactly:

1. Choose the move, then click **Record** at the bottom left (or press **R**).
   The move starts again from its opening shape; a small red dot shows while
   recording.
2. Practise until the problem has happened, then click **Stop recording** (or
   press **R** again). A file named like
   `qigong-session-lift-sky-2026-09-29-1830.json` downloads.
3. [Open an issue](https://github.com/ryangavin/qigong-pace/issues/new), say
   what happened and roughly when, and attach the file.

The file holds only the tracked positions of your body's landmarks, their
timings, the move, the posture and the matching settings: no video and no
images. The debug panel records the same way (**Record session**).

To watch a recording yourself, drop the file onto either page, or use
**Replay a session…** in the debug panel, which can also pause and scrub it.

## Calibrate for the developers

The developers can't stand in front of your camera, so a short calibration
tells them how you're built, how far you reach and how well the camera sees
you. It takes about three minutes and needs no qi gong.

1. Click **calibrate** at the bottom right of the practice view (or open
   `/calibrate.html`), choose **Standing** or **Seated**, and click **Begin**.
2. Nine simple tasks follow (eight seated): standing still, hands overhead,
   arms out to the sides, palms together, hands on the belly, arms reaching
   forward, knees bent (standing only), big arm circles, and moving slowly as
   if through water. Each is asked in words and shown in light over your
   mirrored body; a short countdown lets you settle, then hold it (or keep
   moving) until the thin line along the bottom fills. **Skip** passes one by,
   **Again** repeats it, **Back** returns to the one before and **Finish now**
   stops early.
3. At the end you see what was found in plain words, and a file named like
   `qigong-calibration-2026-09-29-1830.json` downloads to your Downloads
   folder. Tell the developers its name; they read it from there.

The file holds the tracked positions of your body's landmarks during each
shape (no video or images), what was measured from them, a check of every
move's lights against your reach, and the camera's and browser's own
description of themselves. `/calibrate.html?sim` runs it with a simulated
student.

## Develop

See [AGENTS.md](AGENTS.md) for the layout and the test commands
(`npm test`, `npm run check`, `npm run build`).

## License

[MIT](LICENSE)
