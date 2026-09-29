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
- **Shows where you're going.** The teacher runs slightly ahead of you (the
  "look ahead" slider), with dots tracing where each hand goes next.
- **Colours your form.** Your skeleton is drawn over the mirrored webcam, each
  limb green, amber or red by how closely it matches.
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
body is in view (or choose Seated). **Try with a simulated student** shows it
working without a camera.

## Develop

See [AGENTS.md](AGENTS.md) for the layout and the test commands
(`npm test`, `npm run check`, `npm run build`).
