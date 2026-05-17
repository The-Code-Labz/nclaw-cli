declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';
  // The package exports a factory that returns a MarkedExtension.
  // Signature: markedTerminal(options?, highlightOptions?) => MarkedExtension
  export function markedTerminal(options?: Record<string, unknown>, highlightOptions?: Record<string, unknown>): MarkedExtension;
  const _default: typeof markedTerminal;
  export default _default;
}
