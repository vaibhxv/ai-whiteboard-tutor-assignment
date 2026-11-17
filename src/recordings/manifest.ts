export type StarterLesson = { slug: string; title: string; blurb: string; file: string }

/** The recorded starter lessons (Task 20); `file` is served from `public/recordings/`. */
export const manifest: StarterLesson[] = [
  {
    slug: 'vertex',
    title: 'Why the vertex is where it is',
    blurb: 'Why is the lowest point of a parabola exactly halfway between its roots?',
    file: '/recordings/vertex.json',
  },
  {
    slug: 'slope',
    title: 'What slope really measures',
    blurb: 'What does slope actually tell you, and why is a higher line not always a steeper one?',
    file: '/recordings/slope.json',
  },
  {
    slug: 'balance',
    title: 'Solving an equation by balancing',
    blurb: 'Why can you do the same thing to both sides of an equation and still keep it true?',
    file: '/recordings/balance.json',
  },
]
