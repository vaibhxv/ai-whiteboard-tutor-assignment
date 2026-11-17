# How the recorded lessons were made

The three starter lessons (vertex, slope, balance) are real model output captured through a Claude Code subscription with `npm run record` (`scripts/record.ts`, `scripts/record-lib.ts`). The model and capture date are in each file's `meta`.

- **Re-rolling.** Each response was asked for again whenever it failed validation: a rejected line (most often a `say` over 22 words), a failed verification, a missing check on a main segment, or a stop at the length limit. Up to N attempts per response (3 for vertex, 5 for slope, 8 for balance); the attempt count of every response is listed in that file's `meta.selection`. Choosing among runs is the only selection made.
- **Unedited.** The text of each response is stored byte for byte as the model produced it. Nothing was edited, trimmed or repaired.
- **Runs that were discarded or resumed.** `meta.selection` of slope.json says that an earlier complete recording was thrown away and the lesson re-recorded from scratch; balance.json says its run stopped once and was resumed.
- **Answers.** `answer:*` responses were recorded as if asked at the end of their segment, with no pointed-at targets, and with the earlier questions of the lesson already on record.
- **One solution path per check.** `solution:<id>` was recorded for a single path: a wrong answer (the first wrong option), the reteach for it, then a second wrong answer. Other paths replay the same solution.
- **Context.** Every request was built from a real lesson state driven through the reducer on the all-correct main track (reteach, solution and lost from the matching branch of that track), exactly as the app's controller builds it.
