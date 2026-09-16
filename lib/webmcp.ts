export type PageTool = {
  name: string; title: string; description: string; inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown): unknown | Promise<unknown>;
};
declare global {
  interface Document { modelContext?: { registerTool(tool: PageTool, options?: { signal?: AbortSignal }): void | Promise<void> } }
}
export function registerPageTools(tools: PageTool[]) {
  const context = document.modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  for (const tool of tools) {
    try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
    catch { /* Optional browser capability; the ordinary interface stays available. */ }
  }
  return () => lifecycle.abort();
}
