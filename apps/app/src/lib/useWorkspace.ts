// Backwards-compatible re-export: the implementation now lives in the context provider
// so the sidebar switcher and pages share one reactive current-workspace.
export { useWorkspace } from "./workspace-provider";
