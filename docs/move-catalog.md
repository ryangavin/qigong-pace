# Move catalog

Researched list of common qi gong moves, with keyframes for the front-on figure
in `src/moves.ts`. Tier 1 and 2 ship as built-ins; tier 3 waits for the model
extensions at the bottom.

## Key format

Keys are `[t, lArm, lElbow, rArm, rElbow, sink]`. `R` stands for the rest arms
`12,70,12,70`. Every move starts `[0,R,0],[1.5,R,0]` and ends on `R` with sink 0.

- The forearm angle is `raise − elbow` and is interpolated literally, so `e` and
  `e ± 360` draw the same pose but travel differently: `168,290` reaches hands
  together overhead up the front, `168,-70` reaches the same pose up the sides.
  To switch between them, two keys share the same `t` (safe: `sample` never
  interpolates a zero-length segment).
- A negative raise draws the arm crossing in front of the body.
- Screen-left arm first for one-sided moves (the teacher's right, facing you).
- Seated "yes" = the common chair version uses the same arms; legs ignored.

Useful poses (arm, elbow): rest 12,70 · dantian 22,115 · hold a ball 30,120 ·
chest 30,150 · hug a tree 35,150 · crossed wrists low 18,125 · prayer 8,145 ·
elbows up, fingers meet at chest 85,180 · hands together overhead 168,290 or
168,-70 · straight up 172,0 / 172,360 · side 90,0 · press down by hip 22,8 ·
fist at waist 18,60 · hands on thighs 15,-10 · hand behind head 150,260 ·
forward proxy 70,180 (wrist right, elbow wrong).

## Tier 1: reads well from the front

| # | Set | Move | Seated | Cue |
|---|---|---|---|---|
| 1 | Ba Duan Jin 1 | Holding up the sky (Liang Shou Tuo Tian Li San Jiao) | yes | Lift the joined hands up the front, press the palms to the sky, open down the sides. |
| 2 | Ba Duan Jin 3 | Separating heaven and earth (Tiao Li Pi Wei Xu Dan Ju) | yes | One palm pushes to the sky, the other presses to the earth; change. |
| 3 | Ba Duan Jin 2 | Drawing the bow to shoot the hawk (Zuo You Kai Gong Si She Diao) | yes | Sink into horse stance, push one hand out, draw the other back like a bowstring. |
| 4 | Standalone | Lifting and lowering qi (Sheng Jiang Kai He) | yes | Scoop the arms up the sides, then let the palms float down the front to the belly. |
| 5 | Standalone | Opening and closing at the chest (Kai He) | yes | Palms face at the chest; breathe in to open, breathe out to close. |
| 6 | Standalone | Standing post, hugging the tree (Zhan Zhuang) | yes | Soften the knees, round the arms as if hugging a tree, breathe. |
| 7 | Shibashi 15 | Flying wild goose (Da Yan Fei Xiang) | yes | Wings rise to shoulder height, then float down as you sink. |
| 8 | Shibashi 4 | Separating the clouds (Lun Bi Fen Yun) | yes | Cross wrists low, lift them overhead, part the clouds down the sides. |
| 9 | Shibashi 3 | Painting a rainbow (Hui Wu Cai Hong) | yes | Shift your weight; one arm floats out palm up while the other arcs over your head. |
| 10 | Closing | Gathering qi to the dantian (Shou Shi) | yes | Arms open, fold the hands onto the belly, rest. |
| 11 | Standalone | Shaking (Dou Dong) | partial | Bounce gently from the knees and let the arms hang loose. |
| 12 | Wu Qin Xi 10 | Bird flying (Niao Fei) | yes | Wings lift to the shoulders, fold in, then rise high overhead. |
| 13 | Wu Qin Xi 1 | Tiger raising paws (Hu Ju) | yes | Claws rise up the front, open and push to the sky, then pull down. |
| 14 | Yi Jin Jing 8 | Three plates falling on the floor (San Pan Luo Di) | partial | Palms lift, then press down as you squat, deeper each time. |
| 15 | Yi Jin Jing 2 | Wei Tuo presents the pestle 2 (Wei Tuo Xian Chu Er) | yes | Elbows up with fingertips meeting at the chest, then spread the arms like a wide beam. |
| 16 | Yi Jin Jing 3 | Wei Tuo presents the pestle 3 (Wei Tuo Xian Chu San) | yes | Hands pass the face and push the sky, then lower down the sides. |
| 17 | Liu Zi Jue 6 | Xi, for the triple burner (Xi Zi Jue) | yes | Backs of the hands lift to the chest, open overhead, fold in, press down and part at the hips, sounding "xi". |

```
1  [0,R,0],[1.5,R,0],[3.5,22,115,22,115,.2],[6,30,150,30,150,0],[8.5,168,290,168,290,0],[10.5,168,290,168,290,0],[10.5,168,-70,168,-70,0],[14,90,0,90,0,.3],[17,30,120,30,120,.3],[19.5,R,0],[21,R,0]
2  [0,R,0],[1.5,R,0],[3.5,22,115,22,115,.25],[6.5,172,360,22,8,0],[8.5,172,360,22,8,0],[11.5,22,115,22,115,.3],[14.5,22,8,172,360,0],[16.5,22,8,172,360,0],[19.5,22,115,22,115,.3],[22,R,0],[23.5,R,0]
3  [0,R,0],[1.5,R,0],[4,25,140,25,140,.15],[7.5,88,5,88,178,.6],[9.5,88,5,88,178,.6],[12,110,0,90,0,.45],[14.5,30,120,30,120,.1],[17,25,140,25,140,.15],[20.5,88,178,88,5,.6],[22.5,88,178,88,5,.6],[25,90,0,110,0,.45],[27.5,30,120,30,120,.1],[29.5,R,0],[31,R,0]
4  [0,R,0],[1.5,R,0],[5,90,0,90,0,0],[8,168,-70,168,-70,0],[9,168,-70,168,-70,0],[9,168,290,168,290,0],[12.5,30,150,30,150,.2],[15,22,115,22,115,.35],[17.5,R,0],[19,R,0]
5  [0,R,0],[1.5,R,0],[4,30,150,30,150,.1],[7,75,150,75,150,0],[10,30,150,30,150,.3],[13,75,150,75,150,0],[16,30,150,30,150,.3],[18.5,R,0],[20,R,0]
6  [0,R,0],[1.5,R,0],[5,35,150,35,150,.25],[25,35,150,35,150,.25],[29,R,0],[30.5,R,0]
7  [0,R,0],[1.5,R,0],[5,95,10,95,10,0],[9,20,10,20,10,.6],[12.5,95,10,95,10,0],[16,20,10,20,10,.6],[19,R,0],[20.5,R,0]
8  [0,R,0],[1.5,R,0],[3.5,18,125,18,125,.35],[7,168,290,168,290,0],[7,168,-70,168,-70,0],[10.5,90,0,90,0,.15],[13.5,18,125,18,125,.35],[16,R,0],[17.5,R,0]
9  [0,R,0],[1.5,R,0],[3.5,30,150,30,150,.2],[6,168,290,168,290,0],[6,168,-70,168,290,0],[9.5,95,0,160,280,.3],[11.5,95,0,160,280,.3],[14,168,-70,168,290,.1],[14,168,-70,168,-70,.1],[17.5,160,-80,95,0,.3],[19.5,160,-80,95,0,.3],[22,168,-70,168,-70,.1],[25.5,90,0,90,0,0],[28.5,R,0],[30,R,0]
10 [0,R,0],[1.5,R,0],[4,45,5,45,5,0],[7,22,115,22,115,0],[12,22,115,22,115,0],[15,R,0],[16.5,R,0]
11 [0,R,0],[1.5,R,0],[2.5,8,15,8,15,.05],[3,8,25,8,25,.2],[3.5,8,15,8,15,.05],[4,8,25,8,25,.2],[4.5,8,15,8,15,.05],[5,8,25,8,25,.2],[5.5,8,15,8,15,.05],[6,8,25,8,25,.2],[6.5,8,15,8,15,.05],[7,8,25,8,25,.2],[7.5,8,15,8,15,.05],[9,R,0],[10.5,R,0]
12 [0,R,0],[1.5,R,0],[3,25,115,25,115,.3],[6,100,15,100,15,0],[8.5,25,115,25,115,.3],[12,168,-70,168,-70,0],[15,25,115,25,115,.3],[17,R,0],[18.5,R,0]
13 [0,R,0],[1.5,R,0],[3.5,22,115,22,115,.1],[6,30,150,30,150,0],[8.5,172,360,172,360,0],[10,172,360,172,360,0],[12.5,30,150,30,150,.1],[14.5,22,115,22,115,.2],[16.5,R,0],[18,R,0]
14 [0,R,0],[1.5,R,0],[4,90,0,90,0,0],[7,35,10,35,10,.35],[9.5,80,15,80,15,.1],[12.5,32,10,32,10,.65],[15,80,15,80,15,.1],[18,28,10,28,10,.9],[21,80,15,80,15,0],[24,R,0],[25.5,R,0]
15 [0,R,0],[1.5,R,0],[4,85,180,85,180,0],[7,90,0,90,0,0],[13,90,0,90,0,0],[16.5,R,0],[18,R,0]
16 [0,R,0],[1.5,R,0],[4,85,180,85,180,0],[7,172,360,172,360,0],[12,172,360,172,360,0],[12,172,0,172,0,0],[15,90,0,90,0,0],[18,R,0],[19.5,R,0]
17 [0,R,0],[1.5,R,0],[3,15,125,15,125,.1],[6,25,155,25,155,0],[9,140,365,140,365,0],[11,80,170,80,170,.1],[14,22,115,22,115,.35],[16.5,30,10,30,10,.35],[19,R,0],[20.5,R,0]
```

## Tier 2: partial (arms read; a turn, lean or depth is lost)

| # | Set | Move | Seated | Lost from the front | Cue |
|---|---|---|---|---|---|
| 18 | Shibashi 10 | Cloud hands (Yun Shou) | yes | waist turn | Upper hand drifts across at face height, lower hand at the belly; swap. |
| 19 | Shibashi 16 | Rotating the flywheel (Zhuan Zhuan Fei Lun) | yes | torso lean | Both arms draw one big wheel in front of you; reverse. |
| 20 | Shibashi 11 | Scooping the sea, looking at the sky (Lao Hai Guan Tian) | yes | forward bend, lean back | Bend and cross the hands low, lift them up the middle and open to the sky. |
| 21 | Shibashi 2 | Opening the chest (Kai Kuo Xiong Huai) | yes | forward arms (proxy) | Arms forward, open wide to the sides, close forward, press down. |
| 21b | Shibashi 13 | Flying dove spreads wings (Fei Ge Zhan Chi) | yes | as 21 | Same keys as 21 with sink .3 on the open key. |
| 22 | Shibashi 17 | Stepping and bouncing the ball (Ta Bu Pai Qiu) | yes | knee lift | Lift a hand and pat the ball down beside you; change sides. |
| 23 | Wu Qin Xi 9 | Bird stretching (Niao Shen) | yes | leg lift, chest arch | Hands stack and rise overhead, press down, then swing back like tail feathers. |
| 24 | Wu Qin Xi 7 | Ape lifting (Yuan Ti) | yes | shrug, heel rise, head turn | Pinch the fingers into hooks and draw them up to the chest, rising tall; release. |
| 25 | Wu Qin Xi 5 | Bear rotating the waist (Xiong Yun) | yes | torso circle | Paws at the belly; the waist draws slow circles. |
| 26 | Liu Zi Jue 3 | Hu, for the spleen (Hu Zi Jue) | yes | forward opening | Hands open from the navel as if holding a ball, sounding "hu"; gather back in. |
| 27 | Liu Zi Jue 2 | He, for the heart (He Zi Jue) | yes | — | Scoop the palms up to the chest, turn them over and press down, sounding "he". |
| 28 | Liu Zi Jue 5 | Chui, for the kidneys (Chui Zi Jue) | partial | hands behind back | Hands to the lower back, slide them down the legs as you squat, sounding "chui"; gather a ball and rise. |
| 29 | Yi Jin Jing 1 | Wei Tuo presents the pestle 1 (Wei Tuo Xian Chu Yi) | yes | forward raise (proxy) | Arms float forward, then palms join in front of the chest. |
| 30 | Yi Jin Jing 4 | Plucking a star (Zhai Xing Huan Dou) | partial | twist, back hand | Swing the hand down across the body, then up to hook a star above your head. |
| 31 | Yi Jin Jing 7 | Nine ghosts drawing sabres (Jiu Gui Ba Ma Dao) | yes | twist | One hand behind the head, the other up the spine; open and close the chest. |
| 32 | Wu Qin Xi 8 | Ape picking fruit (Yuan Zhai) | yes | step, leg lift | Reach high and out to pluck the fruit, then bring it to your face. |
| 33 | Standalone | Twisting arm swing (Zhuan Yao Shuai Shou) | yes | twist | Turn from the waist and let the arms swing and wrap loosely. |
| 34 | Wu Qin Xi 3 | Deer butting antlers (Lu Di) | partial | twist, look back (the point of the move) | Turn and swing the antlers up and back; look to the back heel. |

```
18 [0,R,0],[1.5,R,0],[3.5,40,165,15,115,.3],[7,80,365,12,125,.3],[7,80,5,12,125,.3],[10.5,15,115,40,165,.3],[14,12,125,80,365,.3],[14,12,125,80,5,.3],[17.5,40,165,15,115,.3],[20,R,0],[21.5,R,0]
19 [0,R,0],[1.5,R,0],[3,10,10,-10,10,.3],[6,90,10,-70,10,.3],[9,180,10,-180,10,.1],[12,290,10,-270,10,.3],[15,360,10,-360,10,.3],[15,0,10,0,10,.3],[18,-70,10,90,10,.3],[21,-180,10,180,10,.1],[24,-270,10,290,10,.3],[27,-360,10,360,10,.3],[27,0,10,0,10,.3],[29,R,0],[30.5,R,0]
20 [0,R,0],[1.5,R,0],[4,5,50,5,50,.5],[7,25,140,25,140,.2],[9.5,150,360,150,360,0],[11.5,150,360,150,360,0],[11.5,150,0,150,0,0],[14.5,90,0,90,0,.1],[17.5,R,0],[19,R,0]
21 [0,R,0],[1.5,R,0],[4,70,180,70,180,0],[7,90,0,90,0,0],[10,70,180,70,180,0],[13,22,8,22,8,.4],[15.5,R,0],[17,R,0]
22 [0,R,0],[1.5,R,0],[3.5,75,150,12,70,.1],[5,25,20,12,70,.3],[6.5,75,150,12,70,.1],[8,25,20,12,70,.3],[9.5,12,70,75,150,.1],[11,12,70,25,20,.3],[12.5,12,70,75,150,.1],[14,12,70,25,20,.3],[15.5,R,0],[17,R,0]
23 [0,R,0],[1.5,R,0],[3,20,115,20,115,.3],[6.5,168,290,168,290,0],[8.5,168,290,168,290,0],[11,20,115,20,115,.3],[14,35,0,35,0,0],[16,R,0],[17.5,R,0]
24 [0,R,0],[1.5,R,0],[3,22,115,22,115,.2],[6,20,160,20,160,0],[9,20,160,20,160,0],[12,22,115,22,115,.2],[13.5,R,0],[15,R,0]
25 [0,R,0],[1.5,R,0],[3,25,140,25,140,.3],[5,30,105,5,120,.3],[7,15,90,15,90,.3],[9,5,120,30,105,.3],[11,25,140,25,140,.3],[13,30,105,5,120,.3],[15,15,90,15,90,.3],[17,5,120,30,105,.3],[19,25,140,25,140,.3],[21,R,0],[22.5,R,0]
26 [0,R,0],[1.5,R,0],[3,22,115,22,115,.1],[6,40,95,40,95,.4],[9,22,115,22,115,.1],[12,40,95,40,95,.4],[15,22,115,22,115,.1],[16.5,R,0],[18,R,0]
27 [0,R,0],[1.5,R,0],[3.5,22,115,22,115,.4],[6.5,25,155,25,155,.1],[9.5,22,115,22,115,.35],[11.5,R,0],[13,R,0]
28 [0,R,0],[1.5,R,0],[3.5,45,5,45,5,0],[5.5,30,50,30,50,0],[9,15,5,15,5,.7],[11.5,5,50,5,50,.7],[14,22,115,22,115,.1],[16,R,0],[17.5,R,0]
29 [0,R,0],[1.5,R,0],[4,70,180,70,180,0],[7,8,145,8,145,0],[11,8,145,8,145,0],[12.5,R,0],[14,R,0]
30 [0,R,0],[1.5,R,0],[3.5,-10,20,15,40,.4],[7,150,260,15,40,.1],[9,150,260,15,40,.1],[11.5,R,.1],[14,15,40,-10,20,.4],[17.5,15,40,150,260,.1],[19.5,15,40,150,260,.1],[22,R,0],[23.5,R,0]
31 [0,R,0],[1.5,R,0],[4,150,260,20,120,0],[7,150,260,20,120,.4],[9,150,260,20,120,0],[11.5,R,0],[14,20,120,150,260,0],[17,20,120,150,260,.4],[19,20,120,150,260,0],[21.5,R,0],[23,R,0]
32 [0,R,0],[1.5,R,0],[3.5,30,60,15,40,.4],[6.5,140,10,15,40,0],[8.5,40,165,20,120,.3],[10,R,0],[12.5,15,40,30,60,.4],[15.5,15,40,140,10,0],[17.5,20,120,40,165,.3],[19,R,0],[20.5,R,0]
33 [0,R,0],[1.5,R,0],[2.5,70,20,10,130,.15],[4,10,130,70,20,.15],[5.5,70,20,10,130,.15],[7,10,130,70,20,.15],[8.5,70,20,10,130,.15],[10,10,130,70,20,.15],[11.5,R,0],[13,R,0]
34 [0,R,0],[1.5,R,0],[4,22,115,22,115,.2],[7,150,30,30,90,.4],[9,150,30,30,90,.4],[11.5,22,115,22,115,.2],[14.5,30,90,150,30,.4],[16.5,30,90,150,30,.4],[19,R,0],[20.5,R,0]
```

## Tier 3: poor (defining action is depth, bend or turn)

Not shipped. The front-on proxies would mis-match a learner doing the move
correctly, because the webcam sees real foreshortening. Needs extensions 1–3.

Ba Duan Jin 4 (wise owl gazes backward), 5 (swaying head and tail), 6 (two
hands hold the feet), 7 (thrusting fists); Shibashi 1/18 (commencing, pressing
palms), 5 (rolling arms), 6 (rowing the boat), 7 (lifting the ball), 8 (gazing
at the moon), 9 (turning the waist, pushing the palm), 12 (pushing waves), 14
(punching); Yi Jin Jing 5, 6, 9, 10, 11, 12; Wu Qin Xi 2, 4, 6; Liu Zi Jue Xu
and Si.

## Model extensions, ranked by moves unlocked

1. **Arm forward flexion, per arm** (0–90°, projected arm shortens by cos, wrist
   lifts). ~16 moves. Cheapest change in `poseAt`.
2. **Torso forward bend** (shorten torso, drop head and shoulders). ~11 moves.
3. **Torso turn** (narrow shoulders and hips). ~10 moves.
4. **Heel rise and single-leg lift.** ~8 moves.
5. **Torso side lean.** ~6 moves.
6. **Head turn and tilt.** ~5 moves.

## Notes

- Shibashi follows Lin Housheng's 1979 order; the other sets follow the Chinese
  Health Qigong Association standard order.
- Hand shapes (claws, fists, hooks) aren't modelled or tracked.
- The original built-in "Holding up the sky" drew a wide Y overhead; the tier 1
  keys above bring the palms together as taught.

Sources: earthbalance-taichi.com (Ba Duan Jin), egreenway.com (Ba Duan Jin,
Shibashi), zelmeroz.com Shibashi notes (Lin Housheng), totaltaichi.com
(Shibashi), qigong18.com, mpgtaijiquan.blogspot.com (Yi Jin Jing),
healthqigong.org.uk, Wikipedia (Liu Zi Jue), wulongtaichi.com.au,
chinaeducationaltours.com (Wu Qin Xi), PMC9011802 (Wu Qin Xi).
