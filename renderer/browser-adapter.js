import { GitHubSyncClient, validateGitHubConfig } from '../lib/github.js';
import {
  emptyWorkspaceDocument, validateWorkspaceDocument, createWorkspaceDocument,
  mergeWorkspaceDocuments, resolveWorkspaceConflicts, validateWorkspace, MAX_WORKSPACE_BYTES,
} from '../lib/workspace.js';
import { applyWorkspaceReview } from '../lib/review.js';

// The desktop preload owns this API in Electron. Browser mode keeps data in this
// origin's IndexedDB and credentials in memory for the current tab only.
if (!window.recall) {
  const DEFAULT_GITHUB = { owner: 'MOHA77776568', repo: 'Recall-labs', branch: 'main', path: 'data/workspace.json' };
  const client = new GitHubSyncClient({ validateDocument: validateWorkspaceDocument, mergeDocuments: mergeWorkspaceDocuments, emptyDocument: emptyWorkspaceDocument, maxDocumentBytes: MAX_WORKSPACE_BYTES });
  let credential;
  let tail = Promise.resolve();
  const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('recall-labs-local', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state');
      request.result.createObjectStore('backups', { keyPath: 'id' });
      request.result.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('تعذّر فتح قاعدة البيانات المحلية؛ تأكد أن المتصفح يسمح بالتخزين.'));
  });
  const requestValue = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transactionDone = (transaction) => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('تعذّر حفظ البيانات المحلية.'));
    transaction.onabort = () => reject(transaction.error || new Error('أُلغي حفظ البيانات المحلية.'));
  });
  const fresh = () => ({
    storeVersion: 1, workspaceDocument: emptyWorkspaceDocument(), baseWorkspaceDocument: emptyWorkspaceDocument(),
    pendingWorkspaceDocument: null, workspaceConflicts: [], revision: 0,
    updatedAt: new Date().toISOString(), operationIds: [],
    settings: { github: { ...DEFAULT_GITHUB }, allowPublicSync: false },
  });
  function checked(value) {
    if (!value || value.storeVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.operationIds) || value.operationIds.length > 200 || !Array.isArray(value.workspaceConflicts)) throw new Error('صيغة البيانات المحلية غير صالحة. لم يتم حذفها أو استبدالها.');
    value.workspaceDocument = validateWorkspaceDocument(value.workspaceDocument);
    value.baseWorkspaceDocument = validateWorkspaceDocument(value.baseWorkspaceDocument);
    if (value.pendingWorkspaceDocument) value.pendingWorkspaceDocument = validateWorkspaceDocument(value.pendingWorkspaceDocument);
    value.settings.github = validateGitHubConfig(value.settings.github);
    if (typeof value.settings.allowPublicSync !== 'boolean') throw new Error('إعداد الخصوصية المحفوظ غير صالح.');
    return value;
  }
  async function load() {
    const db = await dbPromise;
    const value = await requestValue(db.transaction('state').objectStore('state').get('current'));
    return value === undefined ? fresh() : checked(value);
  }
  async function persist(next, previous) {
    checked(next);
    const db = await dbPromise;
    const tx = db.transaction(['state', 'backups'], 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore('state').put(next, 'current');
    if (previous && JSON.stringify(previous.workspaceDocument) !== JSON.stringify(next.workspaceDocument)) {
      tx.objectStore('backups').put({ id: globalThis.crypto.randomUUID(), created_at: new Date().toISOString(), revision: previous.revision, state: previous.workspaceDocument.workspace });
    }
    const all = tx.objectStore('backups').getAll();
    all.onsuccess = () => {
      const older = all.result.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(20);
      for (const backup of older) tx.objectStore('backups').delete(backup.id);
    };
    await done;
  }
  const publicState = (state, extra = {}) => ({
    workspaceDocument: structuredClone(state.workspaceDocument), workspaceConflicts: structuredClone(state.workspaceConflicts),
    settings: { ...structuredClone(state.settings), tokenConfigured: Boolean(credential) },
    runtime: 'browser', revision: state.revision, updatedAt: state.updatedAt,
    update: { status: 'unsupported', message: 'التحديث الداخلي متاح في نسخة Windows المثبتة. حدّث ملفات نسخة المتصفح من GitHub.' }, ...extra,
  });
  const workspaceState = (state) => ({ state: structuredClone(state.workspaceDocument.workspace), revision: state.revision, updatedAt: state.updatedAt });
  function run(action) {
    const perform = () => navigator.locks ? navigator.locks.request('recall-labs-data', () => action()) : action();
    const result = tail.then(perform);
    tail = result.catch(() => {});
    return result;
  }
  function noConflicts(state) {
    if (state.workspaceConflicts.length) throw new Error('حلّ تعارضات المزامنة في الإعدادات قبل التعديل أو المزامنة مجددًا.');
  }
  function changed(next) { next.revision += 1; next.updatedAt = new Date().toISOString(); }
  const download = (value, filename) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { path: filename };
  };

  const api = {
    getState: () => run(async () => publicState(await load())),
    getWorkspace: () => run(async () => workspaceState(await load())),
    saveWorkspace: (payload) => run(async () => {
      const state = await load(); noConflicts(state);
      if (!payload || typeof payload !== 'object' || typeof payload.operationId !== 'string' || payload.operationId.length > 100) throw new Error('طلب حفظ غير صالح.');
      if (state.operationIds.includes(payload.operationId)) return workspaceState(state);
      if (payload.revision !== state.revision) {
        const error = new Error('تغيّرت البيانات في نافذة أخرى. أعد تحميل مساحة العمل قبل الحفظ.'); error.code = 'REVISION_CONFLICT'; throw error;
      }
      let workspace;
      if (payload.action === 'review') workspace = applyWorkspaceReview(state.workspaceDocument.workspace, { cardId: payload.cardId, rating: payload.rating });
      else if (payload.action === undefined) workspace = validateWorkspace(payload.state);
      else throw new Error('عملية مساحة عمل غير مدعومة.');
      const next = structuredClone(state);
      next.workspaceDocument = createWorkspaceDocument(workspace, state.workspaceDocument);
      next.operationIds = [...next.operationIds, payload.operationId].slice(-200);
      changed(next); await persist(next, state); return workspaceState(next);
    }),
    saveSettings: (input) => run(async () => {
      const state = await load(); const next = structuredClone(state);
      if (!input || typeof input !== 'object') throw new Error('الإعدادات غير صالحة.');
      if (input.github !== undefined) {
        const github = validateGitHubConfig(input.github);
        if (JSON.stringify(github) !== JSON.stringify(state.settings.github)) {
          noConflicts(state); next.settings.github = github; next.settings.allowPublicSync = false;
          next.baseWorkspaceDocument = emptyWorkspaceDocument(); next.pendingWorkspaceDocument = null;
        }
      }
      if (input.allowPublicSync !== undefined) {
        if (typeof input.allowPublicSync !== 'boolean') throw new Error('الموافقة على نشر البيانات يجب أن تكون صريحة.');
        next.settings.allowPublicSync = input.allowPublicSync;
      }
      let nextCredential = credential;
      if (input.token !== undefined) {
        if (typeof input.token !== 'string' || input.token.length > 512 || /\s|[\u0000-\u001f\u007f]/.test(input.token)) throw new Error('صيغة رمز GitHub غير صالحة.');
        nextCredential = input.token || undefined;
      }
      await persist(next, state); credential = nextCredential; return publicState(next);
    }),
    syncWorkspace: () => run(async () => {
      const state = await load(); noConflicts(state);
      const result = await client.sync({ config: state.settings.github, document: state.workspaceDocument, baseDocument: state.baseWorkspaceDocument, token: credential, allowPublicSync: state.settings.allowPublicSync, message: 'Sync Recall Lab workspace' });
      const next = structuredClone(state); next.workspaceDocument = result.document; next.workspaceConflicts = result.conflicts;
      next.pendingWorkspaceDocument = result.conflicts.length ? result.remoteDocument : null;
      if (!result.conflicts.length) next.baseWorkspaceDocument = result.document;
      changed(next); await persist(next, state);
      return publicState(next, { syncStatus: { sha: result.sha, pushed: result.pushed, message: result.conflicts.length ? 'اختر نسخة كل تعارض ثم أعد المزامنة.' : result.pushed ? 'حُفظت تغييراتك على GitHub.' : 'وصلت أحدث نسخة من GitHub.' } });
    }),
    resolveWorkspaceConflict: ({ id, choice }) => run(async () => {
      const state = await load(); const conflict = state.workspaceConflicts.find((entry) => entry.id === id);
      if (!conflict) throw new Error('هذا التعارض لم يعد موجودًا.');
      const next = structuredClone(state);
      const resolved = resolveWorkspaceConflicts(next.workspaceDocument, next.workspaceConflicts, id, choice);
      next.workspaceDocument = resolved.document;
      next.workspaceConflicts = resolved.conflicts;
      if (!next.workspaceConflicts.length && next.pendingWorkspaceDocument) { next.baseWorkspaceDocument = next.pendingWorkspaceDocument; next.pendingWorkspaceDocument = null; }
      changed(next); await persist(next, state); return publicState(next);
    }),
    getWorkspaceBackups: () => run(async () => {
      const db = await dbPromise; const values = await requestValue(db.transaction('backups').objectStore('backups').getAll());
      return { backups: values.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(({ state, ...metadata }) => metadata) };
    }),
    getWorkspaceBackup: (id) => run(async () => {
      const db = await dbPromise; const value = await requestValue(db.transaction('backups').objectStore('backups').get(id));
      if (!value) throw new Error('النسخة الاحتياطية غير موجودة.'); return { state: validateWorkspace(value.state) };
    }),
    storeSourceFile: ({ name, mimeType, bytes }) => run(async () => {
      if (typeof name !== 'string' || name.length > 200 || /[\/\\\u0000-\u001f]/.test(name) || !/\.(pdf|txt|md|srt|vtt)$/i.test(name)) throw new Error('اختر ملف PDF أو TXT أو MD أو SRT أو VTT باسم صالح.');
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (data.byteLength > 15 * 1024 * 1024) throw new Error('الحد الأقصى للملف 15 MB.');
      const file = { id: globalThis.crypto.randomUUID(), name, mimeType: /\.pdf$/i.test(name) ? 'application/pdf' : 'text/plain', bytes: data };
      const db = await dbPromise; const tx = db.transaction('files', 'readwrite'); const done = transactionDone(tx); tx.objectStore('files').put(file); await done;
      return { id: file.id, name: file.name };
    }),
    readSourceFile: (id) => run(async () => {
      if (typeof id !== 'string') throw new Error('معرّف الملف غير صالح.');
      const db = await dbPromise; const file = await requestValue(db.transaction('files').objectStore('files').get(id));
      if (!file) throw new Error('هذا الملف غير موجود على الجهاز؛ أعد إرفاقه من المصادر.'); return file;
    }),
    exportWorkspace: () => run(async () => {
      const state = await load(); return download(state.workspaceDocument, 'recall-workspace-sync.json');
    }),
    importWorkspace: (input) => run(async () => {
      const state = await load(); noConflicts(state); const next = structuredClone(state);
      next.workspaceDocument = input?.schemaVersion === 2 ? validateWorkspaceDocument(input) : createWorkspaceDocument(validateWorkspace(input?.state || input), state.workspaceDocument);
      changed(next); await persist(next, state); return publicState(next);
    }),
    checkForUpdates: async () => ({ status: 'unsupported', message: 'التحديث الداخلي متاح في نسخة Windows المثبتة فقط.' }),
    downloadUpdate: async () => { throw new Error('نزّل تحديث نسخة المتصفح من مستودع GitHub.'); },
    installUpdate: async () => { throw new Error('التثبيت الداخلي متاح في Electron فقط.'); },
    onUpdateStatus: () => () => {},
  };
  window.recall = Object.freeze(api);
}
