import '../browser-adapter.js';
import { i as getReact, t as getReactDOMClient } from './framework-D_rUT4EX.js';
import RecallLab from './recall-app-DZqLhe8P.js';
import { StudyShell } from './study-shell.js';
import { includePendingCardMedia } from './workspace-ui.js';
import { announceWorkspaceChange } from './study-events.js';

const originalFetch = window.fetch.bind(window);
const bridge = window.recall;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });

function requiredMethod(name) {
  if (typeof bridge?.[name] !== 'function') throw new Error(`Local workspace method ${name} is unavailable. Reopen the app after updating.`);
  return bridge[name].bind(bridge);
}

function endpointPath(input) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (raw.startsWith('/api/')) return raw;
  const url = new URL(raw, location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return `${url.pathname}${url.search}`;
  return null;
}

// Keep the original UI's narrow backend contract entirely on this machine.
window.fetch = async (input, options = {}) => {
  const path = endpointPath(input);
  if (!path) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin && url.protocol !== 'blob:') throw new Error('The offline workspace cannot load a remote resource.');
    return originalFetch(input, options);
  }
  try {
    const url = new URL(path, 'http://127.0.0.1');
    if (url.pathname === '/api/workspace') {
      if ((options.method || 'GET').toUpperCase() === 'POST') {
        const payload = JSON.parse(options.body);
        if (payload.state) payload.state = includePendingCardMedia(payload.state);
        const saved = await requiredMethod('saveWorkspace')(payload);
        announceWorkspaceChange();
        return jsonResponse(saved);
      }
      return jsonResponse(await requiredMethod('getWorkspace')());
    }
    if (url.pathname === '/api/backups') {
      if (url.searchParams.has('id')) return jsonResponse(await requiredMethod('getWorkspaceBackup')(url.searchParams.get('id')));
      const result = await requiredMethod('getWorkspaceBackups')();
      const backups = Array.isArray(result) ? result : result.backups || [];
      return jsonResponse({ backups: backups.map(backup => ({ ...backup, created_at: backup.created_at || backup.createdAt })) });
    }
    if (url.pathname === '/api/files' && options.method === 'POST') {
      const file = options.body?.get('file');
      if (!(file instanceof File)) throw new Error('Choose a source file first.');
      if (file.size > 15_000_000) throw new Error('Files must be under 15 MB.');
      return jsonResponse(await requiredMethod('storeSourceFile')({ name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }));
    }
    const match = url.pathname.match(/^\/api\/files\/([^/]+)$/);
    if (match) {
      const file = await requiredMethod('readSourceFile')(decodeURIComponent(match[1]));
      return new Response(file.bytes, { headers: { 'Content-Type': file.mimeType || 'application/octet-stream' } });
    }
    return jsonResponse({ error: 'This operation is unavailable in the local workspace.' }, 404);
  } catch (error) {
    const conflict = error.code === 'REVISION_CONFLICT' || error.status === 409 || /revision|changed on another|conflict/i.test(error.message);
    return jsonResponse({ error: error.message || 'The local operation failed.' }, conflict ? 409 : 400);
  }
};

// Original file links become a local Blob download, never an account request.
document.addEventListener('click', async event => {
  const link = event.target.closest?.('a[href]');
  if (!link) return;
  const href = link.getAttribute('href');
  const match = href.match(/^\/api\/files\/([^/?#]+)$/);
  if (match) {
    event.preventDefault();
    try {
      const file = await requiredMethod('readSourceFile')(decodeURIComponent(match[1]));
      const blobUrl = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType || 'application/octet-stream' }));
      const download = document.createElement('a');
      download.href = blobUrl;
      download.download = file.name || 'source-file';
      download.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    } catch (error) {
      window.alert(error.message);
    }
  } else if (/^https?:\/\//i.test(href)) {
    event.preventDefault();
  }
});

try {
  if (!bridge) throw new Error('The local storage adapter could not load.');
  getReactDOMClient().createRoot(document.getElementById('root')).render(getReact().createElement(StudyShell, { OriginalApp: RecallLab, userName: 'Learner', userEmail: 'Stored on this device' }));
} catch (error) {
  const message = document.createElement('section');
  message.className = 'local-error';
  message.textContent = `Recall Lab could not open: ${error.message}`;
  document.getElementById('root').replaceChildren(message);
}
