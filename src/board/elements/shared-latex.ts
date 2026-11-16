import katex from 'katex'

/** KaTeX output is the only HTML the board injects; KaTeX escapes its input and trust is off. */
export const renderLatex = (latex: string): string =>
  katex.renderToString(latex, { trust: false, throwOnError: false, output: 'html' })
