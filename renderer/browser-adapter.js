import { GitHubSyncClient, validateGitHubConfig } from '../lib/github.js';
import {
  emptyWorkspaceDocument, validateWorkspaceDocument, createWorkspaceDocument,
  mergeWorkspaceDocuments, resolveWorkspaceConflicts, MAX_WORKSPACE_BYTES, STUDY_COLLECTIONS,
} from '../lib/workspace.js';
import { applyWorkspaceReview } from '../lib/review.js';
import { mergeWorkspaceImport, prepareWorkspaceImport } from '../lib/workspace-import.js';
import { analyzeCardImage, cardImageBytes, verifyCardImageBytes, enumerateReferencedCardMedia, CardMediaError } from '../lib/card-media.js';
import { synchronizeCardImages } from '../lib/card-media-sync.js';
import { createFullWorkspaceBackup, parseFullWorkspaceBackup } from '../lib/card-media-backup.js';

// The desktop preload owns this API in Electron. Browser mode keeps data in this
// origin's IndexedDB and credentials in memory for the current tab only.
if (!window.recall) {
  // Capture the transport before the original site's offline-resource shim.
  // Only the validated, fixed GitHub API clients receive this function.
  const githubFetch = globalThis.fetch.bind(globalThis);
  const DEFAULT_GITHUB = { owner: 'MOHA77776568', repo: 'Recall-labs', branch: 'main', path: 'data/workspace.json' };
  const client = new GitHubSyncClient({ fetchImpl: githubFetch, validateDocument: validateWorkspaceDocument, mergeDocuments: mergeWorkspaceDocuments, emptyDocument: emptyWorkspaceDocument, maxDocumentBytes: MAX_WORKSPACE_BYTES });
  let credential;
  let tail = Promise.resolve();
  const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('recall-labs-local', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      if (!request.result.objectStoreNames.contains('backups')) request.result.createObjectStore('backups', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('cardImages')) request.result.createObjectStore('cardImages', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error('أغلق نوافذ Recall Labs القديمة ثم أعد فتح التطبيق لإكمال تحديث التخزين المحلي.'));
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
  const imageStore = {
    save: async (input) => {
      const content = cardImageBytes(input);
      const metadata = await analyzeCardImage(content);
      const db = await dbPromise;
      const tx = db.transaction('cardImages', 'readwrite'); const done = transactionDone(tx);
      tx.objectStore('cardImages').put({ ...metadata, bytes: content.slice() }); await done;
      return metadata;
    },
    read: async (id) => {
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new CardMediaError('INVALID_MEDIA', 'معرّف صورة البطاقة غير صالح.');
      const db = await dbPromise;
      const value = await requestValue(db.transaction('cardImages').objectStore('cardImages').get(id));
      if (!value) throw new CardMediaError('LOCAL_IMAGE_MISSING', 'هذه الصورة غير موجودة على الجهاز؛ أعد المزامنة أو إرفاق الصورة الأصلية.');
      const metadata = await verifyCardImageBytes(value.bytes, value);
      return { ...metadata, bytes: value.bytes };
    },
  };
  const fresh = () => ({
    storeVersion: 2, workspaceDocument: emptyWorkspaceDocument(), baseWorkspaceDocument: emptyWorkspaceDocument(),
    pendingWorkspaceDocument: null, workspaceConflicts: [], workspaceConflictSource: null, revision: 0,
    updatedAt: new Date().toISOString(), operationIds: [],
    settings: { github: { ...DEFAULT_GITHUB }, allowPublicSync: false },
  });
  function checked(input) {
    if (!input || ![1, 2].includes(input.storeVersion) || !Number.isSafeInteger(input.revision) || input.revision < 0 || !Array.isArray(input.operationIds) || input.operationIds.length > 200 || input.operationIds.some((id) => typeof id !== 'string' || !id.length || id.length > 100) || !Array.isArray(input.workspaceConflicts) || input.workspaceConflicts.length > 20_000) throw new Error('صيغة البيانات المحلية غير صالحة أو تتطلب إصدارًا أحدث. لم يتم حذفها أو استبدالها.');
    const value = structuredClone(input);
    value.storeVersion = 2;
    value.workspaceDocument = validateWorkspaceDocument(value.workspaceDocument);
    value.baseWorkspaceDocument = validateWorkspaceDocument(value.baseWorkspaceDocument);
    if (value.pendingWorkspaceDocument) value.pendingWorkspaceDocument = validateWorkspaceDocument(value.pendingWorkspaceDocument);
    for (const conflict of value.workspaceConflicts) {
      if (!conflict || typeof conflict.id !== 'string' || conflict.id.length > 240) throw new Error('تعارض مساحة العمل المحفوظ غير صالح.');
      if (conflict.context) for (const side of ['local', 'remote', 'base']) {
        if (conflict.context[side]) conflict.context[side] = validateWorkspaceDocument(conflict.context[side]);
      }
    }
    value.workspaceConflictSource ??= value.workspaceConflicts.length ? 'sync' : null;
    if (![null, 'sync', 'import'].includes(value.workspaceConflictSource)) throw new Error('مصدر تعارض مساحة العمل غير صالح.');
    if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('تاريخ مساحة العمل غير صالح.');
    value.settings.github = validateGitHubConfig(value.settings.github);
    if (typeof value.settings.allowPublicSync !== 'boolean') throw new Error('إعداد الخصوصية المحفوظ غير صالح.');
    return value;
  }
  async function load() {
    const db = await dbPromise;
    // Reading and migrating in one transaction makes the version guard atomic
    // even when a second browser tab opens before the first migration finishes.
    const tx = db.transaction(['state', 'backups'], 'readwrite');
    const done = transactionDone(tx);
    let state;
    let failure;
    const request = tx.objectStore('state').get('current');
    request.onsuccess = () => {
      try {
        const previous = request.result;
        if (previous === undefined) { state = fresh(); return; }
        state = checked(previous);
        if (JSON.stringify(previous) !== JSON.stringify(state)) {
          tx.objectStore('backups').put({
            id: globalThis.crypto.randomUUID(), created_at: new Date().toISOString(),
            revision: previous.revision, reason: 'migration',
            state: previous.workspaceDocument.workspace, originalState: previous,
          });
          tx.objectStore('state').put(state, 'current');
          pruneBackups(tx);
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure || error; }
    return state;
  }
  function pruneBackups(tx) {
    const all = tx.objectStore('backups').getAll();
    all.onsuccess = () => {
      const older = all.result.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(20);
      for (const backup of older) tx.objectStore('backups').delete(backup.id);
    };
  }
  async function persist(next, previous, images = []) {
    const value = checked(next);
    const db = await dbPromise;
    const tx = db.transaction(['state', 'backups', 'cardImages'], 'readwrite');
    const done = transactionDone(tx);
    let failure;
    const current = tx.objectStore('state').get('current');
    current.onsuccess = () => {
      try {
        // The tab lock is advisory; this protects browsers without Locks API too.
        if (previous && current.result !== undefined && JSON.stringify(checked(current.result)) !== JSON.stringify(previous)) {
          const error = new Error('تغيّرت البيانات في نافذة أخرى. أعد تحميل مساحة العمل قبل الحفظ.');
          error.code = 'REVISION_CONFLICT'; throw error;
        }
        tx.objectStore('state').put(value, 'current');
        for (const image of images) tx.objectStore('cardImages').put(image);
        if (previous && JSON.stringify(previous.workspaceDocument) !== JSON.stringify(value.workspaceDocument)) {
          tx.objectStore('backups').put({ id: globalThis.crypto.randomUUID(), created_at: new Date().toISOString(), revision: previous.revision, state: previous.workspaceDocument.workspace });
        }
        pruneBackups(tx);
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure || error; }
  }
  const publicState = (state, extra = {}) => ({
    workspaceDocument: structuredClone(state.workspaceDocument), workspaceConflicts: structuredClone(state.workspaceConflicts),
    settings: { ...structuredClone(state.settings), tokenConfigured: Boolean(credential) },
    runtime: 'browser', revision: state.revision, updatedAt: state.updatedAt,
    update: { status: 'unsupported', message: 'التحديث الداخلي متاح في نسخة Windows المثبتة. حدّث ملفات نسخة المتصفح من GitHub.' }, ...extra,
  });
  const workspaceState = (state) => ({ state: structuredClone(state.workspaceDocument.workspace), revision: state.revision, updatedAt: state.updatedAt, hasWorkspaceExtras: STUDY_COLLECTIONS.some((collection) => state.workspaceDocument.workspace[collection].length > 0) });
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
  const downloadZip = (bytes, filename) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { path: filename };
  };

  const api = {
    getState: () => run(async () => publicState(await load())),
    getWorkspace: () => run(async () => workspaceState(await load())),
    saveWorkspace: (payload) => run(async () => {
      const state = await load(); noConflicts(state);
      if (!payload || typeof payload !== 'object' || typeof payload.operationId !== 'string' || !payload.operationId.length || payload.operationId.length > 100) throw new Error('طلب حفظ غير صالح.');
      if (state.operationIds.includes(payload.operationId)) return workspaceState(state);
      if (payload.revision !== state.revision) {
        const error = new Error('تغيّرت البيانات في نافذة أخرى. أعد تحميل مساحة العمل قبل الحفظ.'); error.code = 'REVISION_CONFLICT'; throw error;
      }
      let workspace;
      if (payload.action === 'review') workspace = applyWorkspaceReview(state.workspaceDocument.workspace, { cardId: payload.cardId, rating: payload.rating, operationId: payload.operationId, context: payload.context });
      else if (payload.action === undefined) workspace = payload.state;
      else throw new Error('عملية مساحة عمل غير مدعومة.');
      const next = structuredClone(state);
      next.workspaceDocument = createWorkspaceDocument(workspace, state.workspaceDocument);
      next.operationIds = [...next.operationIds, payload.operationId].slice(-200);
      changed(next); await persist(next, state); return workspaceState(next);
    }),
    saveSettings: (input) => run(async () => {
      const state = await load(); const next = structuredClone(state);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['github', 'token', 'allowPublicSync'].includes(key))) throw new Error('الإعدادات غير صالحة.');
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
      const preparedImages = await synchronizeCardImages({ config: state.settings.github, token: credential, mediaRecords: enumerateReferencedCardMedia(state.workspaceDocument.workspace), store: imageStore, phase: 'upload', fetchImpl: githubFetch });
      if (!preparedImages.complete) return publicState(state, { syncStatus: { pushed: false, complete: false, media: preparedImages, message: 'لم تكتمل مزامنة صور البطاقات. حُفظت بياناتك المحلية؛ أعد المزامنة بعد استعادة الاتصال أو إرفاق الصورة المفقودة.' } });
      const result = await client.sync({ config: state.settings.github, document: state.workspaceDocument, baseDocument: state.baseWorkspaceDocument, token: credential, allowPublicSync: state.settings.allowPublicSync, message: 'Sync Recall Lab workspace' });
      const next = structuredClone(state); next.workspaceDocument = result.document; next.workspaceConflicts = result.conflicts;
      next.workspaceConflictSource = result.conflicts.length ? 'sync' : null;
      next.pendingWorkspaceDocument = result.conflicts.length ? result.remoteDocument : null;
      if (!result.conflicts.length) next.baseWorkspaceDocument = result.document;
      changed(next); await persist(next, state);
      const downloadedImages = await synchronizeCardImages({ config: state.settings.github, token: credential, mediaRecords: enumerateReferencedCardMedia(next.workspaceDocument.workspace), store: imageStore, phase: 'download', fetchImpl: githubFetch });
      const media = { ...downloadedImages, uploaded: preparedImages.uploaded, downloaded: preparedImages.downloaded + downloadedImages.downloaded };
      return publicState(next, { syncStatus: { sha: result.sha, pushed: result.pushed, complete: media.complete && !result.conflicts.length, media, message: result.conflicts.length ? 'اختر نسخة كل تعارض ثم أعد المزامنة.' : !media.complete ? 'حُفظت سجلات مساحة العمل، لكن بعض الصور لم تُنزّل. أعد المزامنة لاستكمالها.' : result.pushed ? 'حُفظت بياناتك وصور البطاقات على GitHub.' : 'وصلت أحدث نسخة و صور البطاقات من GitHub.' } });
    }),
    resolveWorkspaceConflict: ({ id, choice }) => run(async () => {
      const state = await load(); const conflict = state.workspaceConflicts.find((entry) => entry.id === id);
      if (!conflict) throw new Error('هذا التعارض لم يعد موجودًا.');
      const next = structuredClone(state);
      const resolved = resolveWorkspaceConflicts(next.workspaceDocument, next.workspaceConflicts, id, choice);
      next.workspaceDocument = resolved.document;
      next.workspaceConflicts = resolved.conflicts;
      if (!next.workspaceConflicts.length && next.pendingWorkspaceDocument) {
        if (next.workspaceConflictSource !== 'import') next.baseWorkspaceDocument = next.pendingWorkspaceDocument;
        next.pendingWorkspaceDocument = null; next.workspaceConflictSource = null;
      }
      changed(next); await persist(next, state); return publicState(next);
    }),
    getWorkspaceBackups: () => run(async () => {
      const db = await dbPromise; const values = await requestValue(db.transaction('backups').objectStore('backups').getAll());
      return { backups: values.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(({ state, originalState, ...metadata }) => metadata) };
    }),
    getWorkspaceBackup: (id) => run(async () => {
      const db = await dbPromise; const value = await requestValue(db.transaction('backups').objectStore('backups').get(id));
      if (!value) throw new Error('النسخة الاحتياطية غير موجودة.'); return { state: prepareWorkspaceImport(value).workspace };
    }),
    restoreWorkspaceBackup: (id) => run(async () => {
      const state = await load(); noConflicts(state);
      const db = await dbPromise; const value = await requestValue(db.transaction('backups').objectStore('backups').get(id));
      if (!value) throw new Error('النسخة الاحتياطية غير موجودة.');
      const next = structuredClone(state);
      next.workspaceDocument = createWorkspaceDocument(prepareWorkspaceImport(value).workspace, state.workspaceDocument);
      changed(next); await persist(next, state); return workspaceState(next);
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
    storeCardImage: (input) => run(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('صورة البطاقة غير صالحة.');
      return imageStore.save(input.bytes);
    }),
    readCardImage: (id) => run(() => imageStore.read(id)),
    exportWorkspace: () => run(async () => {
      const state = await load(); return download(state.workspaceDocument, 'recall-workspace-sync.json');
    }),
    importWorkspace: (input) => run(async () => {
      const state = await load(); noConflicts(state); const next = structuredClone(state);
      const merged = mergeWorkspaceImport(state.workspaceDocument, input, state.baseWorkspaceDocument);
      next.workspaceDocument = merged.document; next.workspaceConflicts = merged.conflicts;
      next.pendingWorkspaceDocument = merged.conflicts.length ? merged.importedDocument : null;
      next.workspaceConflictSource = merged.conflicts.length ? 'import' : null;
      changed(next); await persist(next, state); return publicState(next);
    }),
    exportFullWorkspace: () => run(async () => {
      const state = await load();
      const backup = await createFullWorkspaceBackup(state.workspaceDocument, imageStore);
      return { ...downloadZip(backup.bytes, 'recall-labs-full-backup.zip'), complete: true, images: backup.images };
    }),
    importFullWorkspace: (input) => run(async () => {
      const state = await load(); noConflicts(state);
      const backup = await parseFullWorkspaceBackup(input?.bytes ?? input);
      const merged = mergeWorkspaceImport(state.workspaceDocument, backup.document, state.baseWorkspaceDocument);
      const next = structuredClone(state);
      next.workspaceDocument = merged.document; next.workspaceConflicts = merged.conflicts;
      next.pendingWorkspaceDocument = merged.conflicts.length ? merged.importedDocument : null;
      next.workspaceConflictSource = merged.conflicts.length ? 'import' : null;
      changed(next);
      // Images and workspace replacement commit together only after full ZIP
      // validation, preserving the previous data if the transaction fails.
      await persist(next, state, backup.images);
      return publicState(next, { importStatus: { complete: !merged.conflicts.length, images: backup.images.length, message: merged.conflicts.length ? 'أُعيدت الصور؛ حل تعارضات استيراد مساحة العمل لإكمال العملية.' : 'استُعيدت مساحة العمل وصور البطاقات.' } });
    }),
    checkForUpdates: async () => ({ status: 'unsupported', message: 'التحديث الداخلي متاح في نسخة Windows المثبتة فقط.' }),
    downloadUpdate: async () => { throw new Error('نزّل تحديث نسخة المتصفح من مستودع GitHub.'); },
    installUpdate: async () => { throw new Error('التثبيت الداخلي متاح في Electron فقط.'); },
    onUpdateStatus: () => () => {},
  };
  window.recall = Object.freeze(api);
}
