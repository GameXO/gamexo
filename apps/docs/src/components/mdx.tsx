import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import type { MDXComponents } from 'mdx/types';

/**
 * `Steps` is registered globally rather than imported per-page.
 *
 * The integration pages describe request sequences, and a mermaid fence is not an
 * option here: this site is a static export with no diagram runtime, so a
 * ```mermaid block renders as its own source code — which is worse than plain prose
 * for the partner engineer reading it.
 */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Steps,
    Step,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
