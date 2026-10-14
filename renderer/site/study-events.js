// Same-origin UI coordination only. Storage remains behind the narrow preload API.
let originalCommand = null;

export function requestStudyNavigation(view, options = {}) {
  const request = new CustomEvent('recall:navigate-request', { cancelable: true, detail: { view, options } });
  if (!window.dispatchEvent(request)) return false;
  window.dispatchEvent(new CustomEvent('recall:study-navigate', { detail: { view, options } }));
  return true;
}

export function setOriginalCommand(command) { originalCommand = command; }
export function takeOriginalCommand() { const result = originalCommand; originalCommand = null; return result; }
export function announceWorkspaceChange() { window.dispatchEvent(new Event('recall:workspace-change')); }
