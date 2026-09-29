# Sensations

What people report feeling in standing and moving qi gong, and how the qi
model (`src/qi/`) turns practice into values the qi view can draw. The aim is
for the visuals to point at real sensations so a learner notices them, perhaps
for the first time. Visuals and cues invite; they never tell the learner what
they "should" be feeling.

## What the sources agree on

- The first thing most people notice is in the hands: tingling, warmth,
  fullness, often within the first 10–15 minutes of standing practice
  [Shaolin, TaiChiWuji]. Sensations tend to come in a rough order: warmth,
  tingling, heaviness, expansion, pulsing [TaiChiWuji].
- Slowness, relaxation and attention bring them on; trying hard or labelling
  them gets in the way ("just feel it, allow it") [FlowingZen, BHQA].
- A physiological reading that fits: slow, relaxed movement and attention
  raise blood flow to the hands and wake up sensory nerves; relaxation with
  imagery can raise hand temperature by 1–2 °C [TaiChiCa].
- In studies, practitioners report more calm, "perceived body activation",
  body awareness, pleasant body sensations and "sensation of qi" after about 10
  minutes of Ba Duan Jin [Goldbeck 2021]. Qualitative work finds warmth,
  tingling and "energy floating in the body" [Hung 2021], and warmth,
  tingling and release of tension in newcomers [BMC 2025].
- Breath follows movement: inhale while lifting, opening and storing, exhale
  while lowering, closing and releasing. Beginners should breathe naturally
  and let this coupling come by itself [BHQA, quoting the Chinese Health
  Qigong Association's Ba Duan Jin].

## Sensations

Each entry: what people report; when it tends to arise; a suggested visual and
cue; the model value that carries it.

### Palms (laogong): warmth, tingling, fullness

- **Reported:** tingling in the fingers and palms, warmth gathering in the
  centre of the palm, hands feeling "large and full", sometimes pulsing or
  vibrating [Shaolin, TaiChiCa, FlowingZen].
- **When:** usually the first sensation; minutes into slow arm movement or
  standing with the hands held up (hugging the tree, holding the ball). Grows
  over the session.
- **Visual:** a soft glow in the centre of each palm that brightens and widens
  slowly; a faint shimmer at the fingertips.
- **Cue:** "Let your attention rest in the centre of your palms. Is there any
  warmth, or tingling? Whatever is there is fine."
- **Model:** `regions.lPalm` / `rPalm`: fill with flow and with the palm field
  (fill ~6 s, drain ~15 s).

### The qi ball: push and pull between facing palms

- **Reported:** a magnetic or elastic push-pull between the palms, "like
  pulling taffy", commonly the first thing felt between the hands [BalancedLife,
  FlowingZen, Shaolin].
- **When:** palms facing, slightly cupped, roughly 20–30 cm apart, opening a
  little on the inhale and closing on the exhale, slowly [BalancedLife]. Opening
  and closing at the chest is this exercise.
- **Visual:** a translucent sphere between the palms whose surface stretches as
  the hands part and thickens as they close; field lines between the palms.
- **Cue:** "As your hands open and close, notice the space between them. Does it
  feel empty, or is there a little resistance?"
- **Model:** `palmField`: forearms pointing in toward each other, wrists level,
  held between hips and head, close together, and moving slowly. Fast hands
  weaken it. The camera can't see the palms' orientation, so the forearms stand in.

### Lower dantian: warmth and fullness in the belly

- **Reported:** warmth, fullness or an expansive feeling starting below the
  navel [Shaolin]; breathing into the dantian quiets the mind [Wikipedia ZZ].
- **When:** holds and standing post, closing and gathering movements (hands
  folding to the belly), and exhaling as the body sinks. Builds slowly, and is
  said to "store": it lingers after the move.
- **Visual:** a warm ember below the navel that grows and deepens in colour
  with the session, pulsing gently with the breath.
- **Cue:** "As you breathe out and settle, let your attention sink below your
  navel. You might notice warmth there."
- **Model:** `regions.dantian`: fills in holds, on the exhale and with sinking
  (fill ~8 s, drain ~30 s: slow to empty).

### Legs and soles (yongquan): heaviness and rooting

- **Reported:** heaviness, being rooted "like a tree", warmth or tingling in the
  soles; beginners in standing post also feel trembling and burning in the legs,
  which teachers treat as normal [Wikipedia ZZ, Shaolin, BalancedLife BW].
- **When:** standing post and any sinking (horse stance, the knee bend on an
  exhale). Takes longer to notice than the hands.
- **Visual:** roots of light spreading from the soles into the floor, longer
  the longer the learner holds; the floor brightening under the feet.
- **Cue:** "Feel the weight of your body pass down through your legs into the
  floor. Let the ground hold you."
- **Model:** `regions.lFoot` / `rFoot`: fill with sinking, exhaling and holds
  (fill ~8 s, drain ~25 s). Always 0 seated: the feet aren't in the frame and
  the moves don't use them.

### Crown (baihui): lightness and suspension

- **Reported:** the head lightly lifted "as if suspended from the crown",
  lengthening upward while the rest of the body sinks; an openness at the top of
  the head [ScottJeffrey, BalancedLife BW].
- **When:** rising and lengthening moves (Holding up the sky, lifting and
  lowering qi) and in standing post as the posture settles.
- **Visual:** a thin thread of light rising from the crown, brighter as the
  arms rise; a soft halo that lifts on the inhale.
- **Cue:** "Let the crown of your head float up, as if hanging from a thread,
  while everything below it settles."
- **Model:** `regions.crown`: fills on the inhale, with the hands overhead, and a
  little in holds (fill ~6 s, drain ~15 s).

### Currents along the arms

- **Reported:** a faint current, thread-like line, or warmth moving along the
  arms and meridians [TaiChiCa, FlowingZen, Shaolin].
- **When:** during slow, continuous arm movement; momentary, it follows the move.
- **Visual:** light streaming along the arms, out to the fingertips when the
  hands move away from the body, back toward the centre when they gather in.
- **Cue:** "As the hands travel out, let your attention travel with them, all
  the way to the fingertips."
- **Model:** `armFlow.l` / `r`: 1 while that hand moves away from the dantian,
  -1 while it gathers in; `regions.lArm` / `rArm` light with flow × |armFlow|
  (fill ~1.5 s, drain ~3 s).

### Spine: the path between dantian and crown

- **Reported:** energy "rising and sinking" through the centre, from the crown
  down through the dantian to the soles, and back [BalancedLife BW].
- **When:** with the breath: up on rising movements, down on sinking ones.
- **Visual:** a column of light along the spine, a pulse travelling up it on the
  inhale and down on the exhale.
- **Cue:** "Breathing in, notice a rising through your centre; breathing out,
  a settling down."
- **Model:** `regions.spine`: lights with the breath moving (either way), and
  when both dantian and crown are charged.

### Expansion of the body's boundary

- **Reported:** the body or hands feeling larger, the edge of the body becoming
  less definite; often starts at the dantian [Shaolin, TaiChiWuji].
- **When:** later in a session, after sensations in the hands and belly; with
  sustained, unbroken practice.
- **Visual:** a soft aura around the whole figure whose radius grows with the
  session; the frame's edges gathering light.
- **Cue:** "Does the edge of your body feel as clear as when you started?"
- **Model:** `level`: the session's gathered qi. Builds over minutes of in-step
  flow (half full after ~3 minutes of good practice), eases down over minutes
  when lost or idle, never jumps.

### Breath coupling

- **Reported/taught:** inhale while rising and opening, exhale while sinking and
  closing; at the top of a stretch, a short natural pause [BHQA].
- **When:** from the first movement; the coupling becomes effortless with
  familiarity. Beginners should not force it [BHQA].
- **Visual:** everything breathes: glows swell on the inhale and settle on the
  exhale; particles drift up and out on the inhale, down and in on the exhale.
- **Cue:** "No need to control the breath. Notice whether it wants to come in
  as you open, and go out as you close."
- **Model:** `breath`: read from the teacher's movement at the learner's
  position, so it follows the learner's pace. Long holds breathe on their own
  in a slow 8-second cycle.

## Invitations in the primary view

The cues above are offered as invitations (`src/primary/invitations.ts`) when
the model shows the matching state: a strong `palmField`, a charged dantian in
a sustained hold, charged feet while the breath sinks, a charged crown while it
rises, a current along an arm, warm palms, and a high `level`. They wait until
the learner has done the move through once and practised for half a minute,
show one at a time, offer each at most once every four minutes, and never share
the line with the move's own words.

## The model's dynamics

`QiModel.update({ follower, pose, dt })` once per frame; it returns a `QiFrame`.

- **flow** (eases over 0.5 s) = closeness to the teacher × steadiness of pace ×
  slowness. Zero when lost, when nobody is tracked, when the move is done, or
  when the learner stops where the teacher moves; stillness in a hold counts
  fully. Up to the teacher's own speed there is no penalty; faster is penalised
  (about half at 1.5×, under a third at 2×). Waiting in the opening pose gives
  a little.
- **level** fills toward 1 at flow / 240 s and drains at (1 − flow) / 300 s, so
  it settles where the two balance (about 0.83 at flow 0.8), is about half full
  after 3 minutes of good practice, and halves in about 3.5 minutes without
  practice. It can't change by more than dt / 240 in a frame.
- **regions** use the same fill-and-drain store with their own times (above),
  and each also glows a little with `level`.
- **breath** comes from the teacher's openness: hands rising, hands spreading
  (counted less, so arms floating down the sides still exhale) and legs
  straightening. The move is cut into opening and closing runs; each run takes
  the breath from where it was toward 1 (opening) or −1 (closing), in
  proportion to how far it has opened, so a pause mid-run holds the breath.
  Small adjustments move it only part way.
- **palmField** eases over 0.3 s; see the qi ball above.

Rewards come only from slowness, smoothness and staying in step. Speed never
adds anything.

## Sources

- [BHQA] British Health Qigong Association, "Ba Duan Jin: how to do better" (quoting the Chinese Health Qigong Association text). https://healthqigong.org.uk/info/?page_alias=ba_duan_jin_article_01_how_to_do_better
- [Goldbeck 2021] Goldbeck F. et al., "Relaxation or Regulation: The Acute Effect of Mind-Body Exercise on Heart Rate Variability and Subjective State in Experienced Qi Gong Practitioners", 2021. https://pmc.ncbi.nlm.nih.gov/articles/PMC8208883/
- [Hung 2021] Hung, Hwang and Chang, "Is the Qi experience related to the flow experience? Practicing qigong in urban green spaces", PLOS One, 2021. https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0240180
- [BMC 2025] "Experiences with Qi and changes in post-acute sequelae of COVID-19 symptoms with qigong: a qualitative analysis", BMC Complementary Medicine and Therapies, 2025. https://link.springer.com/article/10.1186/s12906-025-05161-w
- [Shaolin] Shaolin Treasure House, "What does Qi feel like?" https://www.shaolintreasurehouse.com/en/blog/what-does-qi-feel-like
- [TaiChiWuji] "How Qi Feels: Common Sensations in Qigong and Tai Chi". https://www.taichiwuji.com/blog/how-qi-feels/
- [FlowingZen] Anthony Korahais, "The Big Secret To Sensing Your Qi Energy". https://flowingzen.com/sensing-your-qi/
- [TaiChiCa] Ji Hong Tai Chi, "The Feeling of Energy from Qi Gong: A Physiological Perspective", 2025. https://www.taichi.ca/2025/12/the-feeling-of-energy-from-qi-gong-a-physiological-perspective/
- [BalancedLife] Balanced Life Tai Chi, "Qi Ball, Energy Ball, or Intention Ball Qigong". https://balancedlifetaichi.com/blog/energy-ball-or-intention-ball-qigong
- [BalancedLife BW] Balanced Life Tai Chi, "What and Where is the Bubbling Well?" https://balancedlifetaichi.com/blog/what-and-where-is-the-bubbling-well
- [Wikipedia ZZ] "Zhan zhuang". https://en.wikipedia.org/wiki/Zhan_zhuang
- [ScottJeffrey] Scott Jeffrey, "Zhan Zhuang: A Complete Guide to Standing Meditation". https://scottjeffrey.com/zhan-zhuang/
