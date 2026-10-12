import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from 'electron';
import updaterPackage from 'electron-updater';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  emptyDocument, validateDocument, parseDocument,
} from '../lib/data.js';
import { GitHubSyncClient, validateGitHubConfig } from '../lib/github.js';
import { JsonStore, OperationQueue } from './storage.js';
import { AttachmentStore } from './attachments.js';
import {
  emptyWorkspaceDocument, createWorkspaceDocument, validateWorkspaceDocument,
  parseWorkspaceDocument, serializeWorkspaceDocument, mergeWorkspaceDocuments,
  resolveWorkspaceConflicts, MAX_WORKSPACE_BYTES,
} from '../lib/workspace.js';
import { applyWorkspaceReview } from '../lib/review.js';

const { autoUpdater } = updaterPackage;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'renderer', 'site', 'index.html');
const ENTRY_URL = pathToFileURL(ENTRY).href;
const TRUSTED_URLS = new Set([ENTRY_URL, pathToFileURL(path.join(ROOT, 'renderer', 'index.html')).href]);
const DEFAULT_GITHUB = Object.freeze({ owner: 'MOHA77776568', repo: 'Recall-labs', branch: 'main', path: 'data/workspace.json' });
const UPDATE_FEED = Object.freeze({ provider: 'github', owner: DEFAULT_GITHUB.owner, repo: DEFAULT_GITHUB.repo, private: false });
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
const queue = new OperationQueue();
const workspaceGithub = new GitHubSyncClient({
  emptyDocument: emptyWorkspaceDocument, validateDocument: validateWorkspaceDocument,
  mergeDocuments: mergeWorkspaceDocuments, maxDocumentBytes: MAX_WORKSPACE_BYTES,
});
let mainWindow;
let store;
let state;
let attachments;
let update = { status: 'idle', message: 'Updates are checked only when you request them.' };

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function validateState(input) {
  requireObject(input, 'Saved state');
  if (![1, 2].includes(input.storeVersion)) throw new Error('Unsupported saved state version.');
  const document = validateDocument(input.document);
  const baseDocument = validateDocument(input.baseDocument);
  const pendingRemoteDocument = input.pendingRemoteDocument ? validateDocument(input.pendingRemoteDocument) : null;
  if (!Array.isArray(input.conflicts) || input.conflicts.length > 20_000) throw new Error('Invalid saved conflicts.');
  const conflicts = input.conflicts.map((conflict) => {
    requireObject(conflict, 'Saved conflict');
    if (typeof conflict.id !== 'string' || conflict.id.length > 120 || !['card', 'progress'].includes(conflict.kind)) throw new Error('Invalid saved conflict.');
    requireObject(conflict.local, 'Local conflict alternative');
    requireObject(conflict.remote, 'Remote conflict alternative');
    return structuredClone(conflict);
  });
  if (input.settings?.allowPublicSync !== undefined && typeof input.settings.allowPublicSync !== 'boolean') throw new Error('Invalid public-repository consent.');
  const settings = { github: validateGitHubConfig(input.settings?.github), allowPublicSync: input.settings?.allowPublicSync ?? false };
  const encryptedToken = input.encryptedToken ?? null;
  if (encryptedToken !== null && (typeof encryptedToken !== 'string' || encryptedToken.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encryptedToken))) throw new Error('Invalid encrypted credential.');
  const workspaceDocument = validateWorkspaceDocument(input.workspaceDocument ?? emptyWorkspaceDocument());
  const baseWorkspaceDocument = validateWorkspaceDocument(input.baseWorkspaceDocument ?? emptyWorkspaceDocument());
  const pendingRemoteWorkspaceDocument = input.pendingRemoteWorkspaceDocument ? validateWorkspaceDocument(input.pendingRemoteWorkspaceDocument) : null;
  const workspaceConflicts = input.workspaceConflicts ?? [];
  if (!Array.isArray(workspaceConflicts) || workspaceConflicts.length > 20_000 || workspaceConflicts.some((entry) => !entry || typeof entry.id !== 'string' || entry.id.length > 240)) throw new Error('Invalid saved workspace conflicts.');
  const workspaceRevision = input.workspaceRevision ?? 0;
  if (!Number.isSafeInteger(workspaceRevision) || workspaceRevision < 0) throw new Error('Invalid workspace revision.');
  const workspaceUpdatedAt = input.workspaceUpdatedAt ?? new Date().toISOString();
  if (typeof workspaceUpdatedAt !== 'string' || !Number.isFinite(Date.parse(workspaceUpdatedAt))) throw new Error('Invalid workspace timestamp.');
  const workspaceOperations = input.workspaceOperations ?? [];
  if (!Array.isArray(workspaceOperations) || workspaceOperations.length > 100 || workspaceOperations.some((id) => typeof id !== 'string' || id.length > 100)) throw new Error('Invalid workspace operation history.');
  return { storeVersion: 2, document, baseDocument, pendingRemoteDocument, conflicts, settings, encryptedToken, workspaceDocument, baseWorkspaceDocument, pendingRemoteWorkspaceDocument, workspaceConflicts: structuredClone(workspaceConflicts), workspaceRevision, workspaceUpdatedAt, workspaceOperations };
}

function publicState(extra = {}) {
  return {
    document: structuredClone(state.document),
    conflicts: structuredClone(state.conflicts),
    workspaceDocument: structuredClone(state.workspaceDocument),
    workspaceConflicts: structuredClone(state.workspaceConflicts),
    settings: { github: { ...state.settings.github }, tokenConfigured: Boolean(state.encryptedToken), allowPublicSync: state.settings.allowPublicSync, secureStorageAvailable: encryptionAvailable() },
    runtime: 'electron',
    update: { ...update },
    ...extra,
  };
}

async function commit(next, extra) {
  const checked = validateState(next);
  await store.save(checked);
  state = checked;
  return publicState(extra);
}

function noConflicts() {
  if (state.conflicts.length) throw new Error('Resolve the pending conflicts before editing, importing, changing repositories, or syncing again. Export remains available.');
}

function requireEncryption() {
  if (!encryptionAvailable()) {
    throw new Error('Secure operating-system credential storage is unavailable. A GitHub token cannot be saved in this environment.');
  }
}

function encryptionAvailable() {
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : undefined;
  return safeStorage.isEncryptionAvailable() && backend !== 'basic_text';
}

function tokenValue() {
  if (!state.encryptedToken) return undefined;
  requireEncryption();
  try { return safeStorage.decryptString(Buffer.from(state.encryptedToken, 'base64')); }
  catch { throw new Error('The saved GitHub credential could not be decrypted. Save a new token on this device.'); }
}

function encryptToken(token) {
  if (typeof token !== 'string' || token.length > 512 || /\s|[\u0000-\u001f\u007f]/.test(token)) throw new Error('Invalid GitHub token format.');
  if (!token) return null;
  requireEncryption();
  return safeStorage.encryptString(token).toString('base64');
}

function assertSender(event) {
  const frame = event.senderFrame;
  let url;
  try { url = new URL(frame?.url); url.hash = ''; } catch { throw new Error('Untrusted application frame.'); }
  if (!mainWindow || event.sender !== mainWindow.webContents || frame !== mainWindow.webContents.mainFrame || !TRUSTED_URLS.has(url.href)) {
    throw new Error('This operation is available only to the local application.');
  }
}

function register(operation, handler) {
  ipcMain.handle(`recall:${operation}`, (event, value) => {
    assertSender(event);
    return queue.run(() => handler(value));
  });
}

function registerApplicationOperations() {
  register('getState', () => publicState());
  register('saveSettings', (input) => {
    requireObject(input, 'Settings');
    if (Object.keys(input).some((key) => !['github', 'token', 'allowPublicSync'].includes(key))) throw new Error('Unsupported setting.');
    const next = structuredClone(state);
    if (input.github !== undefined) {
      const config = validateGitHubConfig(input.github);
      if (JSON.stringify(config) !== JSON.stringify(state.settings.github)) {
        noConflicts();
        noWorkspaceConflicts();
        next.settings.github = config;
        next.settings.allowPublicSync = false;
        next.baseDocument = emptyDocument();
        next.pendingRemoteDocument = null;
        next.baseWorkspaceDocument = emptyWorkspaceDocument();
        next.pendingRemoteWorkspaceDocument = null;
      }
    }
    if (input.allowPublicSync !== undefined) {
      if (typeof input.allowPublicSync !== 'boolean') throw new Error('Public-repository consent must be a boolean.');
      next.settings.allowPublicSync = input.allowPublicSync;
    }
    if (input.token !== undefined) next.encryptedToken = encryptToken(input.token);
    return commit(next);
  });
}

function workspaceState() {
  return { state: structuredClone(state.workspaceDocument.workspace), revision: state.workspaceRevision, updatedAt: state.workspaceUpdatedAt };
}

function noWorkspaceConflicts() {
  if (state.workspaceConflicts.length) throw new Error('Resolve the pending workspace conflicts in the local control panel before editing or syncing again.');
}

function advanceWorkspace(next) {
  next.workspaceRevision += 1;
  next.workspaceUpdatedAt = new Date().toISOString();
}

async function restoreWorkspaceBackup(id) {
  noWorkspaceConflicts();
  const backup = await store.readBackup(id);
  const next = structuredClone(state);
  next.workspaceDocument = createWorkspaceDocument(backup.workspaceDocument.workspace, state.workspaceDocument);
  advanceWorkspace(next);
  await commit(next);
  return workspaceState();
}

function registerWorkspaceOperations() {
  register('getWorkspace', () => workspaceState());
  register('saveWorkspace', async (input) => {
    requireObject(input, 'Workspace save');
    noWorkspaceConflicts();
    if (input.operationId !== undefined && (typeof input.operationId !== 'string' || input.operationId.length > 100 || !input.operationId.length)) throw new Error('Invalid operation ID.');
    if (input.operationId && state.workspaceOperations.includes(input.operationId)) return workspaceState();
    if (!Number.isSafeInteger(input.revision) || input.revision !== state.workspaceRevision) throw new Error('REVISION_CONFLICT: The workspace changed since it was loaded. Reload the current workspace before retrying.');
    const workspace = input.action === 'review'
      ? applyWorkspaceReview(state.workspaceDocument.workspace, { cardId: input.cardId, rating: input.rating, operationId: input.operationId })
      : input.state;
    if (input.action !== undefined && input.action !== 'review') throw new Error('Unsupported workspace operation.');
    const next = structuredClone(state);
    next.workspaceDocument = createWorkspaceDocument(workspace, state.workspaceDocument);
    advanceWorkspace(next);
    if (input.operationId) next.workspaceOperations = [...next.workspaceOperations, input.operationId].slice(-100);
    await commit(next);
    return workspaceState();
  });
  register('getWorkspaceBackups', async () => {
    const backups = [];
    for (const metadata of await store.listBackups()) {
      try {
        const backup = await store.readBackup(metadata.id);
        backups.push({ ...metadata, revision: backup.workspaceRevision, created_at: metadata.createdAt });
      } catch { /* Keep damaged backups on disk; omit unreadable entries from preview. */ }
    }
    return { backups };
  });
  register('getWorkspaceBackup', async (id) => ({ state: (await store.readBackup(id)).workspaceDocument.workspace }));
  register('restoreWorkspaceBackup', restoreWorkspaceBackup);
  register('storeSourceFile', (input) => attachments.save(input));
  register('readSourceFile', (id) => attachments.read(id));
  register('syncWorkspace', async () => {
    noWorkspaceConflicts();
    const result = await workspaceGithub.sync({
      config: state.settings.github, document: state.workspaceDocument,
      baseDocument: state.baseWorkspaceDocument, token: tokenValue(),
      allowPublicSync: state.settings.allowPublicSync,
    });
    const next = structuredClone(state);
    next.workspaceDocument = result.document;
    next.workspaceConflicts = result.conflicts;
    if (result.conflicts.length) next.pendingRemoteWorkspaceDocument = result.remoteDocument;
    else {
      next.baseWorkspaceDocument = result.document;
      next.pendingRemoteWorkspaceDocument = null;
    }
    advanceWorkspace(next);
    return commit(next, { syncStatus: { sha: result.sha, pushed: result.pushed, message: result.conflicts.length ? 'Choose how to resolve the workspace conflicts before syncing again.' : result.pushed ? 'Study data uploaded to GitHub.' : 'Workspace synchronized.' } });
  });
  register('resolveWorkspaceConflict', (input) => {
    const { id, choice } = requireObject(input, 'Workspace conflict resolution');
    const conflict = state.workspaceConflicts.find((entry) => entry.id === id);
    if (!conflict) throw new Error('The workspace conflict no longer exists.');
    const next = structuredClone(state);
    const resolved = resolveWorkspaceConflicts(next.workspaceDocument, next.workspaceConflicts, id, choice);
    next.workspaceDocument = resolved.document;
    next.workspaceConflicts = resolved.conflicts;
    if (!next.workspaceConflicts.length && next.pendingRemoteWorkspaceDocument) {
      next.baseWorkspaceDocument = next.pendingRemoteWorkspaceDocument;
      next.pendingRemoteWorkspaceDocument = null;
    }
    advanceWorkspace(next);
    return commit(next);
  });
  register('importWorkspace', async (input) => {
    noWorkspaceConflicts();
    if (input === undefined) {
      const selected = await dialog.showOpenDialog(mainWindow, { title: 'Import Recall Lab workspace', properties: ['openFile'], filters: [{ name: 'JSON workspace', extensions: ['json'] }] });
      if (selected.canceled) return null;
      const text = await readFile(selected.filePaths[0], 'utf8');
      if (Buffer.byteLength(text, 'utf8') > MAX_WORKSPACE_BYTES) throw new Error('Workspace import exceeds the supported size.');
      try { input = JSON.parse(text); } catch { throw new Error('Workspace import is not valid JSON.'); }
    }
    const imported = input?.schemaVersion === 2 ? validateWorkspaceDocument(input) : createWorkspaceDocument(input?.state ?? input, state.workspaceDocument);
    const merged = mergeWorkspaceDocuments(state.workspaceDocument, imported, state.baseWorkspaceDocument);
    const next = structuredClone(state);
    next.workspaceDocument = merged.document;
    next.workspaceConflicts = merged.conflicts;
    advanceWorkspace(next);
    return commit(next);
  });
  register('exportWorkspace', async () => {
    const selected = await dialog.showSaveDialog(mainWindow, { title: 'Export Recall Lab workspace', defaultPath: 'recall-lab-workspace.json', filters: [{ name: 'JSON workspace', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return null;
    await writeFile(selected.filePath, serializeWorkspaceDocument(state.workspaceDocument), { encoding: 'utf8', mode: 0o600 });
    return { path: selected.filePath };
  });
}

function notifyUpdate(status) {
  update = { ...update, ...status };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('recall:updateStatus', { ...update });
}

async function signingConfigured() {
  if (!app.isPackaged) return false;
  try {
    const config = await readFile(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    // Generated electron-builder config is trusted app content. No YAML is evaluated.
    const match = /(?:^|\n)publisherName:[ \t]*([^\r\n]*)(?:\r?\n([ \t]+-[ \t]+[^\r\n]+))?/.exec(config);
    if (!match) return false;
    const name = (match[1] || match[2] || '').trim();
    return Boolean(name && !['null', '~', '[]', "''", '""'].includes(name) && !name.startsWith('#'));
  } catch { return false; }
}

function requireUpdater() {
  if (!app.isPackaged || process.platform !== 'win32') throw new Error('Internal updates are available in packaged Windows builds. Development copies can be updated with git pull and npm ci.');
}

function registerUpdates() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.setFeedURL(UPDATE_FEED);
  autoUpdater.on('checking-for-update', () => notifyUpdate({ status: 'checking', message: 'Checking the Recall-labs GitHub releases.' }));
  autoUpdater.on('update-available', (info) => notifyUpdate({ status: 'available', version: info.version, message: 'An update is available. Download it when ready.' }));
  autoUpdater.on('update-not-available', () => notifyUpdate({ status: 'current', message: 'This installation is up to date.' }));
  autoUpdater.on('download-progress', (info) => notifyUpdate({ status: 'downloading', percent: Math.round(info.percent), message: `Downloading update: ${Math.round(info.percent)}%.` }));
  autoUpdater.on('update-downloaded', (info) => notifyUpdate({ status: 'downloaded', version: info.version, percent: 100, message: 'Update verified by the updater and ready to install. The app will restart.' }));
  autoUpdater.on('error', () => notifyUpdate({ status: 'error', message: 'The update could not be verified or retrieved. Check the allowed GitHub domains, release availability, and signing configuration.' }));
  register('checkForUpdates', async () => {
    requireUpdater();
    update.signingConfigured = await signingConfigured();
    await autoUpdater.checkForUpdates();
    return { ...update };
  });
  register('downloadUpdate', async () => {
    requireUpdater();
    if (update.status !== 'available') throw new Error('Check for an available update before downloading.');
    await autoUpdater.downloadUpdate();
    return { ...update };
  });
  register('installUpdate', () => {
    requireUpdater();
    if (update.status !== 'downloaded') throw new Error('Download and verify an update before installing it.');
    notifyUpdate({ status: 'installing', message: 'Installing the downloaded update. Your library remains in the local application data directory.' });
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ...update };
  });
}

async function loadLibrary() {
  store = new JsonStore(app.getPath('userData'), { validate: validateState });
  attachments = new AttachmentStore(path.join(app.getPath('userData'), 'attachments'));
  const saved = await store.load();
  if (saved) { state = saved; return; }
  let document;
  try { document = parseDocument(await readFile(path.join(ROOT, 'data', 'flashcards.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    document = emptyDocument();
  }
  let workspaceDocument;
  try { workspaceDocument = parseWorkspaceDocument(await readFile(path.join(ROOT, 'data', 'workspace.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    workspaceDocument = emptyWorkspaceDocument();
  }
  state = validateState({ storeVersion: 2, document, baseDocument: emptyDocument(), pendingRemoteDocument: null, conflicts: [], settings: { github: { ...DEFAULT_GITHUB }, allowPublicSync: false }, encryptedToken: null, workspaceDocument, baseWorkspaceDocument: emptyWorkspaceDocument(), pendingRemoteWorkspaceDocument: null, workspaceConflicts: [], workspaceRevision: 0, workspaceUpdatedAt: new Date().toISOString(), workspaceOperations: [] });
  await store.save(state);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240, height: 840, minWidth: 820, minHeight: 600, show: false,
    title: 'Recall Labs', backgroundColor: '#101017',
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, destination) => {
    try { const url = new URL(destination); url.hash = ''; if (!TRUSTED_URLS.has(url.href)) event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const session = mainWindow.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } }));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadFile(ENTRY);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.recalllabs.desktop');
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(async () => {
    try {
      await loadLibrary();
      registerApplicationOperations();
      registerWorkspaceOperations();
      registerUpdates();
      await createWindow();
    } catch (error) {
      dialog.showErrorBox('Recall Labs could not start', `${error.message}\n\nExisting local files have been preserved. Backups are under the application data directory.`);
      app.quit();
    }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!mainWindow && state) void createWindow(); });
}
