/** Prompt intents: the exact strings the controller passes to the prompt builder and recording lookup. */
export const intents = {
  plan: 'plan',
  segment: (n: number): string => `segment:${n}`,
  reteach: (checkId: string, branch: string): string => `reteach:${checkId}:${branch}`,
  solution: (checkId: string): string => `solution:${checkId}`,
  lost: (n: number, k: number): string => `lost:${n}:${k}`,
  answer: (askId: string): string => `answer:${askId}`,
  freeAnswer: (n: number): string => `answer:free:${n}`,
  recap: 'recap',
  review: (id: string): string => `review:${id}`,
  repair: (actionId: string): string => `repair:${actionId}`,
} as const
