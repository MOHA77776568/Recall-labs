import {
  MAX_WORKSPACE_BYTES, emptyWorkspaceDocument, migrateWorkspace,
  validateWorkspaceDocument, createWorkspaceDocument, mergeWorkspaceDocuments,
} from './workspace.js';

// A local backup may contain the current, base, and pending documents. The
// synchronized document itself retains the tighter workspace size limit.
export const MAX_WORKSPACE_IMPORT_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();

function boundedInput(input) {
  let serialized;
  try { serialized = typeof input === 'string' ? input : JSON.stringify(input); }
  catch { throw new Error('Workspace import must contain supported JSON.'); }
  if (typeof serialized !== 'string' || encoder.encode(serialized).byteLength > MAX_WORKSPACE_IMPORT_BYTES) {
    throw new Error('Workspace import exceeds the supported size.');
  }
  if (typeof input === 'string') {
    try { return JSON.parse(input); }
    catch { throw new Error('Workspace import is not valid JSON.'); }
  }
  return input;
}

/** Accept sync exports, original workspace exports, and local backup wrappers. */
export function prepareWorkspaceImport(input, previousDocument = emptyWorkspaceDocument()) {
  const value = boundedInput(input);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace import must be an object.');
  let payload = value;
  if (value.workspaceDocument !== undefined) payload = value.workspaceDocument;
  else if (value.originalState?.workspaceDocument !== undefined) payload = value.originalState.workspaceDocument;
  else if (value.state !== undefined) payload = value.state;
  else if (value.workspace !== undefined && value.schemaVersion === undefined) payload = value.workspace;
  const document = payload?.schemaVersion !== undefined
    ? validateWorkspaceDocument(payload)
    : createWorkspaceDocument(migrateWorkspace(payload), previousDocument);
  if (encoder.encode(JSON.stringify(document)).byteLength > MAX_WORKSPACE_BYTES) throw new Error('Workspace import exceeds the supported size.');
  return document;
}

/** Both runtimes use a visible three-way merge for control-panel imports. */
export function mergeWorkspaceImport(currentDocument, input, baseDocument = emptyWorkspaceDocument()) {
  // Plain workspace exports carry no deletion history. Treat absent records as
  // absent evidence, rather than creating deletions for newer local activity.
  // Sync-document exports retain their explicit tombstones. Full restoration
  // is a separate confirmed UI action using prepareWorkspaceImport + save.
  const importedDocument = prepareWorkspaceImport(input);
  return { ...mergeWorkspaceDocuments(currentDocument, importedDocument, baseDocument), importedDocument };
}
