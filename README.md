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
- **Shows where you're going.** The teacher is a soft light over your own
  mirrored body, running slightly ahead of you, its hands trailing light
  along where they go next.
- **Answers your form.** Where a limb matches, the teacher's light fuses with
  it and brightens; where it's off, motes drift from your limb toward the
  shape. (The debug panel colours each limb green, amber or red instead.)
- **Qi you can see.** As you practise slowly and in step, a soft sea of
  energy gathers in your body and around it: in the palms, below the navel,
  down to the feet, up through the crown. It follows your real silhouette.
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
body is in view (or choose Seated). The teacher appears as a soft light over
your own body; move the pointer to bring back the move list.
**Watch a simulated student instead** (or `/?sim`) shows it working without a
camera. `?palette=jade` (or `ember`; `dusk` is the default) changes the
energy's colours, and `?qi=0.8` starts with that much qi gathered, for looking
at the view without practising for minutes first.

`/debug.html` is the debug panel for working on the engine: the teacher and
you side by side, a timeline, your pace, the matching sliders and loading a
teacher from a video.

## Develop

See [AGENTS.md](AGENTS.md) for the layout and the test commands
(`npm test`, `npm run check`, `npm run build`).

## License

[MIT](LICENSE)
