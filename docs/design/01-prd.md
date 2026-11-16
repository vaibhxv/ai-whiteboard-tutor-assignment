# Whyboard — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | Whyboard (working title) — an AI tutor at a whiteboard for school maths |
| **For** | Braynix Studios technical assignment: *AI-Powered Interactive Whiteboard Tutor* |
| **Companion docs** | [FRD](02-frd.md) (what it does, testably) · [Technical blueprint](03-technical-blueprint.md) (how, and the decisions behind it) |
| **Status** | Draft for review, 2026-11-16. Nothing here is built yet. |

## 1. Summary

Whyboard is a tutor that teaches one maths idea at a time on a whiteboard. It draws and talks through the idea step by step. Before it explains, it asks the learner to guess. After each idea, it stops and makes the learner do something on the board. When the learner is wrong, it works out *which* wrong idea led there and re-teaches that, with a different picture. The learner can stop it at any moment and point at anything on the board to ask about it.

Two things sit underneath that:

- **The AI decides how to teach; code guarantees what is true.** Every curve is computed from its formula and every checkable algebra step is checked. The model never draws a graph freehand.
- **The product is honest about what is live.** A badge on every screen says whether the lesson is being generated now or is a recording of real model output.

The scope is deliberately small: school algebra, functions and graphs, for a teenager studying alone.

## 2. The problem

### The learner

**A 14–18 year old who is stuck on a maths concept at home, with nobody to ask.** They have a phone or laptop. They have probably already used a chatbot for homework. What they have not had is someone who notices *why* they are stuck.

Most students do not have a tutor. In India's 2025 national education survey, 27% of students took private coaching, which leaves roughly three in four without it ([NSS CMS: Education 2025, via Careers360](https://news.careers360.com/27-of-students-rely-on-private-coaching-urban-participation-higher-cms-education-survey-2025); all school levels, not secondary only). Meanwhile AI is already where they turn: 54% of US teens have used chatbots for schoolwork ([Pew, Feb 2026](https://www.pewresearch.org/internet/2026/02/24/how-teens-use-and-view-ai/)).

### Why what they have does not work

| What they try | What goes wrong |
|---|---|
| **Re-reading the textbook** | The explanation that failed once fails again. |
| **A video** | Passive. It cannot be asked "wait, why?", and it cannot tell that they are lost. |
| **A step-by-step solver** | Hands over the answer. The homework gets done; the exam does not. |
| **A general chatbot** | Answers in paragraphs, for a subject that lives in pictures. Gives answers too easily. Sometimes wrong, with total confidence. |

The last two are not hypothetical harms. In a field experiment with about 1,000 high-school maths students, those given a plain chatbot did much better during practice and then scored **17% worse** than the control group on the unassisted exam. A version with guardrails (hints, not answers) removed the harm, but did not beat the control group either. Students in both AI groups overestimated how much they had learned ([Bastani et al., 2025, PNAS](https://doi.org/10.1073/pnas.2422633122)).

That result sets the bar for this product. Removing harm is not enough. The design has to make the learner do the thinking, and then check, without help, that it stuck.

### The opportunity

The area where school maths goes wrong most visibly is the link between a formula and its graph. The misconceptions are old and well documented: reading a graph as a literal picture, confusing a curve's height with its slope ([Clement, 1985](https://srri.umass.edu/publications/clement-1985mig); Leinhardt, Zaslavsky & Stein, 1990), and persistent errors with negative signs and variables ([Booth et al., 2014](https://doi.org/10.7771/1932-6246.1161)).

This is a good place to build because three things line up:

1. **It is visual.** The idea *is* the picture. A whiteboard is the right medium, not decoration.
2. **It is checkable.** A program can verify a factorisation or a point on a curve. That makes it possible to keep an AI tutor honest.
3. **The mistakes are predictable.** Known misconceptions mean a wrong answer can be read as a diagnosis, not just a miss.

## 3. Who it is for, and who it is not

**Primary: the stuck solo learner.** "I have a test on quadratics on Thursday. I can do the steps when I copy the example but I don't get why the vertex is where it is."

What they need, in their words:

- *Show me, don't just tell me.*
- *Let me stop you when I'm lost.*
- *Don't just give me the answer; I've tried that.*
- *Tell me if I actually get it.*

**Secondary: the reviewer.** A Braynix evaluator with a few minutes and no API key, who needs to experience the whole loop immediately and to see what is live.

**Not for, in this version:** teachers managing a class, primary-age children, learners who need a subject other than maths taught with the same guarantees, or anyone wanting a homework answer machine.

## 4. Product principles

Each principle is a decision about what to build, with the evidence that led to it. Effect sizes come mostly from short lab studies and should be read as direction, not promise.

**1. Show while telling.** Words and the picture they describe arrive together, one small piece at a time, with the thing being discussed marked. This follows the temporal-contiguity, segmenting and signaling principles of multimedia learning ([Mayer, 2017](https://doi.org/10.1111/jcal.12197)).

> A caution we take seriously: the benefit of *watching something being drawn* has been shown mainly when the instructor's hand is visible ([Fiorella & Mayer, 2016](https://doi.org/10.1037/edu0000065)). We do not claim that effect for an animated pen. We draw step by step because it paces and sequences the idea, not because animation is magic.

**2. Guess before you're told.** Every lesson opens with a prediction. Trying first, even wrongly, improves what is learned from the explanation that follows ([Pan & Carpenter, 2023](https://doi.org/10.1007/s10648-023-09814-5); [Sinha & Kapur, 2021](https://doi.org/10.3102/00346543211019105), g = 0.36 across 53 studies, with the caveat that younger children did better with instruction first).

**3. A wrong answer is information.** Each wrong option is written to correspond to a specific misconception, and the tutor re-teaches that misconception directly. Confronting misconceptions beats clean exposition, especially for learners with low prior knowledge ([Muller et al., 2008](https://doi.org/10.1111/j.1365-2729.2007.00248.x)).

**4. The learner does the work.** Watching is the weakest form of engagement; doing and explaining are stronger ([Chi & Wylie, 2014](https://doi.org/10.1080/00461520.2014.965823)). So the tutor stops at every idea, gives hints before answers, and ends with unassisted practice, because that is where the Bastani study showed the gap ([testing effect: Roediger & Karpicke, 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x)).

**5. Computed, not hallucinated.** Language models make arithmetic and algebra errors in tutoring at rates that matter: one study found only 57% of tutoring dialogues were correct throughout, even when 86% of final answers were ([Gupta et al., 2025](https://arxiv.org/abs/2503.16460)). So the model proposes and code checks. What cannot be checked is labelled.

**6. The learner holds the remote.** Pause, replay, slow down, interrupt, skip. Nothing is timed. Nothing traps them.

**7. Honest about itself.** Live, recorded and computed behaviour are always distinguishable. The tutor says when it is unsure.

**8. Small and finished.** One learner, one subject area, one loop, done properly.

## 5. The experience

A lesson on "why is the vertex of a parabola where it is?", as the learner meets it:

```
┌────────────────────────────────────────────────────────────┬──────────────────┐
│  Whyboard        ①──②──③──④  Recap     RECORDED · sonnet │                  │
├────────────────────────────────────────────────────────────┤  ✋ Raise hand   │
│                                                            │                  │
│   y = x² − 4x + 3                       y│     ╲      ╱    │  😕 I'm lost     │
│   ───────────────                        │      ╲    ╱     │                  │
│   x² − 4x + 3 = (x − 1)(x − 3)  ✓        │       ╲  ╱      │  Ask about:      │
│                                       ───●────────●─── x   │  ▸ Why halfway?  │
│   roots:  x = 1   or   x = 3  ✓          │ 1   ╲╱   3      │  ▸ What if there │
│           ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾              │     (2,−1)      │    are no roots? │
│                                          │       ◯ ← vertex│                  │
│                                                            │                  │
├────────────────────────────────────────────────────────────┤                  │
│ "A parabola is symmetric, so its axis sits exactly         │  Transcript ▸    │
│  halfway between the two roots."                           │                  │
│  ◀◀   ▶ ❙❙   ▶▶     1×     🔊                              │                  │
└────────────────────────────────────────────────────────────┴──────────────────┘
   AI-generated lesson. Maths marked ✓ was checked by code.
```

1. **They type what they are stuck on,** or pick a starter lesson.
2. **The tutor asks for a guess first.** "Before I explain: the curve crosses the x-axis at 1 and 3. Where do you think its lowest point is? Guess; we'll find out." No marking yet.
3. **The tutor teaches one idea.** It writes the equation, factors it, plots the curve, marks the roots, and circles the vertex, speaking one sentence per step. Each line of working gets a small tick once the app has checked it.
4. **The learner interrupts.** They click the vertex and ask "why is it halfway?". The tutor pauses, answers in a different ink in the margin, pointing at the two roots, asks "did that clear it up?", and resumes mid-lesson.
5. **Checkpoint.** "Why is the vertex at x = 2?" They pick "it's half of −4, so −2".
6. **The tutor does not say "wrong, the answer is A".** It says, roughly: "You halved the 4. Good instinct. Look at where the sign goes," and re-teaches with a table of values on both sides of x = 2, not the same factoring again. Then it asks again.
7. **Explore.** A slider changes *a* in y = a(x − 2)² − 1. The learner drags it negative and watches the curve flip. The tutor asks what stayed the same.
8. **Recap.** The key ideas, each linked back to its board. "Earlier you guessed the lowest point was at x = 3. What do you think now?"
9. **Practice.** Three fresh questions, no help, weighted toward what they got wrong. The result is *solid* or *shaky* per idea, not a score.

## 6. Scope

### In the first version (P0)

- Topic entry and starter lessons for school algebra, functions and graphs.
- Lesson plan, warm-up guess, 3–5 taught segments, recap, practice.
- A board that draws text, equations, plots, points, number lines, tables and marks, laid out automatically.
- Narration with captions; full playback control.
- Five kinds of checkpoint, with misconception-mapped feedback and a hint-before-answer ladder.
- Interrupts: raise hand, point at an element, "I'm lost", suggested questions.
- Explore figures with sliders.
- Checked maths, computed graphs, "something looks wrong".
- Four AI sources: recorded lessons, your own API key, Claude Code subscription, Codex subscription.
- On-device history. Keyboard access, captions, reduced motion.

### Designed for, built if time allows (P1)

Learner pen and circling to ask · sketch-a-prediction checkpoint · teach-back ("explain it to me") · best-effort mode for topics outside maths · plan changes mid-lesson · geometry diagrams · export as notes · level selector · usage and cost display.

### Not doing

Accounts and sync · teacher dashboards · photo-of-homework input · collaborative boards · generated video · other languages · streaks and leaderboards. Reasons are in [FRD §8](02-frd.md#8-out-of-scope).

### Anti-goals

Things that would make this a failure even if it worked:

- **A homework answer machine.** If the fastest way to use it is to extract answers, it reproduces the harm in §2.
- **A chatbot with a canvas bolted on.** If the board is decoration and the teaching is in the text, it is the wrong product.
- **A demo that fakes it.** If a reviewer cannot tell recorded from live, the submission has failed on honesty regardless of polish.
- **A confident liar.** A beautiful, wrong graph is worse than no graph.

## 7. Landscape

In 2026, two things became ordinary: chat assistants that generate interactive visuals, and tutors that talk while drawing on a canvas. Neither is a differentiator any more. This table is from public descriptions as of November 2026; none of these products was tested hands-on, and the newer entries are self-described.

| Product | What it does | Where it stops short for this learner |
|---|---|---|
| **Khanmigo** | Socratic chat tied to Khan Academy content; generates interactive diagrams since Aug 2026 ([source](https://blog.khanacademy.org/?p=22106)). | Chat-first. No narrated, step-by-step board. |
| **ChatGPT study mode, Claude learning mode, Gemini Guided Learning** | Socratic prompting; inline interactive visuals and quizzes. | Learner-initiated and open-ended; no lesson structure, and the mode can be switched off. Visuals are not verified. |
| **Photomath, Symbolab, Mathway** | Step-by-step solvers. | Answer-getting tools. |
| **Brilliant** | Hand-authored interactive lessons with an AI helper. | Excellent, but a fixed catalogue: it cannot teach *your* stuck point. |
| **Synthesis Tutor** | Voice-guided manipulatives. | Ages 5–11. |
| **Text-to-animation generators** (Manim-based) | Produce an explainer video from a prompt. | Not interactive; slow; generated animation code often fails. |
| **Penseum, ahaboard, Gauth Digital Canvas** and similar (2026) | Voice plus live drawing on a canvas; some are interruptible. | The closest neighbours. Publicly, none describes misconception-mapped re-teaching or verified maths. |

**Where Whyboard is the same as everyone:** it draws and narrates. That is table stakes.

**Where it is trying to be different:**

1. **The loop, not the drawing.** Guess → teach → act → diagnose → re-teach differently → practise unaided. The checkpoint is compulsory, and a wrong answer changes what happens next.
2. **Misconceptions as first-class data.** Wrong options are authored against named misconceptions, and remediation targets the misconception with a different representation.
3. **Verified maths.** Graphs are computed, steps are checked, unchecked work is labelled.
4. **Pointing.** The board's elements are things the learner can select and ask about, not pixels.
5. **Honesty about the AI.** A permanent live/recorded badge and a recorded mode that disables what it cannot genuinely do.

## 8. Success measures

### For the submission

| Measure | Target |
|---|---|
| A reviewer with no key reaches a drawing board | One click, under two seconds |
| A reviewer can experience guess, teaching, a wrong-answer re-teach, a pointed question, an explore figure, recap and practice | Within one starter lesson, about five minutes |
| A reviewer can tell live from recorded from computed | From the screen alone, at every moment |
| A reviewer with any API key can generate a lesson on their own topic | Under three minutes including setup |
| The walkthrough video shows a live lesson generated with no API key | Through the Claude Code subscription source, visibly labelled |

### If this were a real product

We would not claim learning gains without measuring them. These are the measures we would instrument, and they are proxies:

| Measure | Why it matters |
|---|---|
| **Unaided practice score vs. first-try checkpoint score** on the same ideas | The closest in-product proxy for learning within a session. |
| **Recovery rate:** share of first-wrong answers followed by a correct retry after re-teaching | Whether misconception-targeted re-teaching works. |
| **Delayed check:** performance on two questions a day later | The honest test; retrieval after a delay is where real learning shows. |
| **Warm-up guess revised correctly at recap** | Whether a prior belief actually changed. |
| Lesson completion; interrupts per lesson; "I'm lost" per segment | Engagement and where explanations fail. |

### Quality guardrails

Measured by an automated evaluation run over a fixed topic set: share of board actions valid, share of segments passing verification without regeneration, and number of failed-verification steps shown unflagged (target: zero). Targets are in [FRD §7](02-frd.md#7-non-functional-requirements).

## 9. Risks

| Risk | Likelihood | What we do about it |
|---|---|---|
| **The model teaches something false.** | Certain to happen sometimes | Compute graphs; check steps and answer keys; label what is unchecked; "something looks wrong" button; scope to checkable maths. |
| **The public demo has no live AI by default,** because the owner has no API key. | Certain | Recorded lessons that are real, unedited model output with full branching; paste-your-own-key with a free option; a walkthrough video of live generation. All disclosed. |
| **Layout breaks:** overlapping or overflowing drawings. | High if the model placed things | The model never places anything. A layout engine owns position and size. |
| **Checkpoints with poor wrong answers** make diagnosis meaningless. | Medium | Require a named misconception per wrong option; validate; include known misconceptions in the prompt; review in the evaluation run. |
| **Generation is slow enough to feel broken.** | Medium | Stream actions as they are written; the warm-up guess overlaps the first segment's generation; pre-generate the next segment during each checkpoint. |
| **Learners game it** by guessing through checkpoints. | Medium | "I'm not sure" is offered and costs nothing; unaided practice at the end shows the truth; no score to chase. |
| **Browser speech is poor or missing.** | Medium | Captions carry the lesson; voice is an enhancement; pacing does not depend on it. |
| **Subscription-backed sources depend on third-party CLIs** whose flags and terms can change. | Medium | Local-only, the user's own signed-in CLI, never a hosted route; a preflight check; clear errors; API key remains the default path for anyone else. |
| **The scope grows.** | High | The P0 list in §6 is the contract. Everything else waits. |

## 10. Assumptions and open questions

**Assumptions**

- English only. The learner reads at a secondary-school level.
- A modern browser on a laptop or tablet is the main case; a phone is supported but tighter.
- A lesson of 6–10 minutes is the right unit for a stuck learner.
- The reviewer may not have an API key and will not install anything.

**Open questions for the owner**

1. **Name.** "Whyboard" is a working title. An unrelated older open-source whiteboard app has used the name.
2. **Learner and subject.** This document commits to teenagers and school algebra and graphs. A different choice changes the starter lessons, the misconception lists, and what the verifier checks.
3. **Which three starter lessons** to record. Proposed: *why the vertex is where it is* (quadratics), *what slope really measures* (linear functions, height vs. steepness), *solving a linear equation as balancing* (algebra steps, heavy on checked working).

## 11. Delivery

### Milestones

| # | Milestone | Shows that |
|---|---|---|
| M0 | **Board from a script.** A hand-written action script draws itself with captions. | The board vocabulary, layout and animation work. |
| M1 | **A whole recorded lesson.** Player, checkpoints, feedback ladder, recap, practice. | The learning loop is coherent without any AI. |
| M2 | **Live generation.** Planning and streamed segments through the Claude Code source, then API keys. | The model can drive the board reliably. |
| M3 | **Interrupts and re-teaching.** Raise hand, pointing, "I'm lost", misconception remediation. | The tutor responds to the learner. |
| M4 | **Trust and access.** Verification, flags, error handling, keyboard and screen-reader pass. | It is safe to put in front of a learner. |
| M5 | **Ship.** Record starter lessons, deploy, README, walkthrough video, submission form. | — |

Each milestone leaves something demonstrable. If time runs out after M3, the submission is still a complete product with a shorter trust story.

### What gets submitted

| Item | Content |
|---|---|
| **Repository** | Source, README (idea, learner, how to review, stack, decisions, setup, environment variables, live vs. recorded table, limitations, next steps), these three documents. |
| **Live demo** | Public URL. Opens in recorded mode. Accepts a pasted key for live lessons. |
| **Walkthrough video** | Three to four minutes: a live lesson on an unscripted topic, generated through the owner's Claude Code subscription on their own machine, including a pointed question and a wrong answer. Shot list in the blueprint. |
| **Form** | Links checked. |

### What is live, recorded, or computed

This table goes in the README unchanged.

| Behaviour | Public demo, no key | Public demo, with your key | Run locally with a subscription |
|---|---|---|---|
| Starter lessons | **Recorded** real model output, unedited | Recorded, or generate fresh | Recorded, or generate fresh |
| Lesson on your own topic | Unavailable (says why) | **Live** | **Live** |
| Wrong-answer re-teaching | **Recorded** per wrong option | **Live** | **Live** |
| Suggested questions | **Recorded** | **Live** | **Live** |
| Typed questions, "I'm lost", teach-back | Unavailable (says why) | **Live** | **Live** |
| Graphs, sliders, grading, verification, layout, pacing | **Computed** by the app, no AI | Computed | Computed |
| Voice | Device speech, no AI service | Same | Same |

## 12. Sources

Research was done on 2026-11-16. Items marked † were confirmed against the primary source or its abstract; the rest come from reviews or secondary coverage and should be re-checked before being quoted elsewhere.

**Learning science**

- Bastani, H. et al. (2025). Generative AI without guardrails can harm learning. *PNAS* 122(26). https://doi.org/10.1073/pnas.2422633122 †
- Chi, M. & Wylie, R. (2014). The ICAP framework. *Educational Psychologist* 49(4). https://doi.org/10.1080/00461520.2014.965823 †
- Fiorella, L. & Mayer, R. (2016). Effects of observing the instructor draw diagrams. *J. Educational Psychology* 108(4). https://doi.org/10.1037/edu0000065 †
- Kestin, G. et al. (2025). AI tutoring outperforms in-class active learning. *Scientific Reports* 15:17458. https://doi.org/10.1038/s41598-025-97652-6 † (single course, immediate post-test)
- Mayer, R. (2017). Using multimedia for e-learning. *J. Computer Assisted Learning* 33(5). https://doi.org/10.1111/jcal.12197
- Muller, D. et al. (2008). Saying the wrong thing: improving learning with multimedia by including misconceptions. *J. Computer Assisted Learning* 24(2). https://doi.org/10.1111/j.1365-2729.2007.00248.x
- Pan, S. & Carpenter, S. (2023). Prequestioning and pretesting effects. *Educational Psychology Review* 35:97. https://doi.org/10.1007/s10648-023-09814-5
- Roediger, H. & Karpicke, J. (2006). Test-enhanced learning. *Psychological Science* 17(3).
- Sinha, T. & Kapur, M. (2021). When problem solving followed by instruction works. *Review of Educational Research* 91(5). https://doi.org/10.3102/00346543211019105 †
- Adesope, O. & Nesbit, J. (2012). Verbal redundancy in multimedia learning environments. *J. Educational Psychology*. (Basis for one-line captions, not full on-screen transcripts.)

**Misconceptions and reliability**

- Clement, J. (1985). Misconceptions in graphing. *PME-9*. https://srri.umass.edu/publications/clement-1985mig
- Leinhardt, G., Zaslavsky, O. & Stein, M. (1990). Functions, graphs, and graphing. *Review of Educational Research* 60(1).
- Booth, J. et al. (2014). Persistent and pernicious errors in algebra problem solving. *J. Problem Solving* 7(1). https://doi.org/10.7771/1932-6246.1161
- Gupta, A. et al. (2025). Beyond final answers: evaluating LLMs for math tutoring. https://arxiv.org/abs/2503.16460

**Context**

- Pew Research Center (2026). How teens use and view AI. https://www.pewresearch.org/internet/2026/02/24/how-teens-use-and-view-ai/ †
- NSS Comprehensive Modular Survey: Education 2025 (India), as reported by Careers360. https://news.careers360.com/27-of-students-rely-on-private-coaching-urban-participation-higher-cms-education-survey-2025
