import {
  emptyDocument as canonicalEmptyDocument, mergeDocuments as canonicalMergeDocuments,
  validateDocument as canonicalValidateDocument, MAX_DOCUMENT_BYTES,
} from './data.js';

const API_ROOT = 'https://api.github.com';
const MAX_RESPONSE_BYTES = 1_600_000;
export const MAX_SYNC_DOCUMENT_BYTES = 10_000_000;
const SHA = /^[a-f0-9]{40}$/;
const encoder = new TextEncoder();

function encodeBase64(text) {
  const bytes = encoder.encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}
function decodeBase64(encoded) {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

export class GitHubSyncError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'GitHubSyncError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export function validateGitHubConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GitHubSyncError('INVALID_CONFIG', 'GitHub repository settings are missing.');
  const { owner, repo, branch = 'main', path = 'data/flashcards.json' } = input;
  if (typeof owner !== 'string' || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner)) throw new GitHubSyncError('INVALID_CONFIG', 'Invalid GitHub owner.');
  if (typeof repo !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo)) throw new GitHubSyncError('INVALID_CONFIG', 'Invalid GitHub repository name.');
  if (typeof branch !== 'string' || branch.length > 128 || !branch.length || /[\s~^:?*\[\\\u0000-\u001f\u007f]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch.includes('//') || branch.startsWith('-') || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch === '@' || branch.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) throw new GitHubSyncError('INVALID_CONFIG', 'Invalid GitHub branch name.');
  if (typeof path !== 'string' || path.length > 240 || !/^[a-zA-Z0-9._/-]+$/.test(path) || path.startsWith('/') || path.endsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new GitHubSyncError('INVALID_CONFIG', 'Data path must be a relative path without traversal.');
  return { owner, repo, branch, path };
}

function tokenHeader(token) {
  if (token === undefined || token === null || token === '') return {};
  if (typeof token !== 'string' || token.length > 512 || /\s|[\u0000-\u001f\u007f]/.test(token)) throw new GitHubSyncError('INVALID_TOKEN', 'Invalid GitHub token format.');
  return { Authorization: `Bearer ${token}` };
}

function statusError(status) {
  if (status === 401) return new GitHubSyncError('AUTH_REQUIRED', 'GitHub authentication failed. Check the saved token.', status);
  if (status === 403) return new GitHubSyncError('ACCESS_DENIED', 'GitHub denied access or its rate limit was reached. Check repository access and token permissions.', status);
  if (status === 404) return new GitHubSyncError('NOT_FOUND', 'The GitHub repository or requested branch is inaccessible.', status);
  if (status === 429) return new GitHubSyncError('RATE_LIMITED', 'GitHub rate limit reached. Try again later.', status);
  return new GitHubSyncError('GITHUB_ERROR', `GitHub returned HTTP ${status}.`, status);
}

async function boundedBytes(response, maxBytes) {
  const announcedSize = Number(response.headers?.get?.('content-length'));
  if (announcedSize > maxBytes) throw new GitHubSyncError('REMOTE_TOO_LARGE', 'GitHub response exceeds the safety limit.');
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new GitHubSyncError('REMOTE_TOO_LARGE', 'GitHub response exceeds the safety limit.'); }
        chunks.push(value);
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    } finally { reader.releaseLock(); }
  } else {
    const text = await response.text();
    bytes = encoder.encode(text);
    if (bytes.length > maxBytes) throw new GitHubSyncError('REMOTE_TOO_LARGE', 'GitHub response exceeds the safety limit.');
  }
  return bytes;
}

async function boundedJson(response) {
  const bytes = await boundedBytes(response, MAX_RESPONSE_BYTES);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new GitHubSyncError('INVALID_RESPONSE', 'GitHub returned malformed JSON.'); }
}

export class GitHubSyncClient {
  constructor({
    fetchImpl = globalThis.fetch, timeoutMs = 20_000, maxRetries = 2, maxDocumentBytes = MAX_DOCUMENT_BYTES,
    validateDocument = canonicalValidateDocument,
    mergeDocuments = canonicalMergeDocuments,
    emptyDocument = canonicalEmptyDocument,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new TypeError('Invalid GitHub timeout.');
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new TypeError('Invalid GitHub retry count.');
    if (!Number.isInteger(maxDocumentBytes) || maxDocumentBytes < 1 || maxDocumentBytes > MAX_SYNC_DOCUMENT_BYTES) throw new TypeError(`Document byte limit must be between 1 and ${MAX_SYNC_DOCUMENT_BYTES}.`);
    if ([validateDocument, mergeDocuments, emptyDocument].some((hook) => typeof hook !== 'function')) throw new TypeError('Document codec hooks must be functions.');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.maxDocumentBytes = maxDocumentBytes;
    this.validateDocument = validateDocument;
    this.mergeDocuments = mergeDocuments;
    this.emptyDocument = emptyDocument;
  }

  serializeDocument(document) {
    const text = `${JSON.stringify(this.validateDocument(document), null, 2)}\n`;
    if (encoder.encode(text).byteLength > this.maxDocumentBytes) throw new GitHubSyncError('DATA_TOO_LARGE', `Data file exceeds the ${this.maxDocumentBytes}-byte limit.`);
    return text;
  }

  parseDocument(text) {
    if (typeof text !== 'string' || encoder.encode(text).byteLength > this.maxDocumentBytes) throw new GitHubSyncError('REMOTE_TOO_LARGE', 'Remote data file exceeds the safety limit.');
    let document;
    try { document = JSON.parse(text); } catch { throw new GitHubSyncError('INVALID_RESPONSE', 'Remote data file is not valid JSON.'); }
    return this.validateDocument(document);
  }

  async request(url, { token, method = 'GET', body, raw = false } = {}) {
    if (new URL(url).origin !== API_ROOT) throw new GitHubSyncError('INVALID_URL', 'Only api.github.com is supported.');
    const headers = {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...tokenHeader(token),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    };
    try {
      return await this.fetchImpl(url, { method, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(this.timeoutMs), ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch {
      // Avoid echoing fetch errors because transports may include request headers or URLs.
      throw new GitHubSyncError('NETWORK_ERROR', 'GitHub is unreachable. Local data is still available; check your allowed domains and connection.');
    }
  }

  contentsUrl(config) {
    const path = config.path.split('/').map(encodeURIComponent).join('/');
    return `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`;
  }

  async repositoryInfo({ owner, repo, token } = {}) {
    const config = validateGitHubConfig({ owner, repo });
    const response = await this.request(`${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`, { token });
    if (!response.ok) throw statusError(response.status);
    const payload = await boundedJson(response);
    if (!payload || typeof payload.private !== 'boolean' || typeof payload.default_branch !== 'string') throw new GitHubSyncError('INVALID_RESPONSE', 'GitHub did not confirm repository privacy and its default branch.');
    const { branch: defaultBranch } = validateGitHubConfig({ ...config, branch: payload.default_branch });
    return { private: payload.private, defaultBranch };
  }

  async read({ owner, repo, branch = 'main', path = 'data/flashcards.json', token } = {}) {
    const config = validateGitHubConfig({ owner, repo, branch, path });
    const url = `${this.contentsUrl(config)}?ref=${encodeURIComponent(config.branch)}`;
    const response = await this.request(url, { token });
    if (response.status === 404) {
      const branchUrl = `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/branches/${encodeURIComponent(config.branch)}`;
      const branchResponse = await this.request(branchUrl, { token });
      if (branchResponse.status === 404 || branchResponse.status === 409) throw new GitHubSyncError('REMOTE_BRANCH_UNAVAILABLE', 'The repository or branch is inaccessible or has no initial commit. Create the repository branch on GitHub before syncing.', branchResponse.status);
      if (!branchResponse.ok) throw statusError(branchResponse.status);
      return { document: this.validateDocument(this.emptyDocument()), sha: null, missing: true };
    }
    if (!response.ok) throw statusError(response.status);
    const payload = await boundedJson(response);
    if (!payload || payload.type !== 'file' || !['base64', 'none'].includes(payload.encoding) || typeof payload.content !== 'string' || !SHA.test(payload.sha) || !Number.isInteger(payload.size) || payload.size < 0) throw new GitHubSyncError('INVALID_RESPONSE', 'GitHub data path must be a regular JSON file with a valid SHA.');
    if (payload.size > this.maxDocumentBytes) throw new GitHubSyncError('REMOTE_TOO_LARGE', 'Remote data file exceeds the safety limit.');
    let bytes;
    if (payload.encoding === 'none') {
      // Contents omits content for files above 1 MB. Read the immutable blob SHA,
      // rather than a moving branch URL, so bytes and optimistic-update SHA agree.
      const blobUrl = `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/blobs/${payload.sha}`;
      const blobResponse = await this.request(blobUrl, { token, raw: true });
      if (!blobResponse.ok) throw statusError(blobResponse.status);
      bytes = await boundedBytes(blobResponse, this.maxDocumentBytes);
    } else {
      const encoded = payload.content.replace(/[\r\n]/g, '');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new GitHubSyncError('INVALID_RESPONSE', 'GitHub returned invalid file encoding.');
      bytes = decodeBase64(encoded);
    }
    if (bytes.length > this.maxDocumentBytes || bytes.length !== payload.size) throw new GitHubSyncError('INVALID_RESPONSE', 'GitHub file length is invalid.');
    let decoded;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new GitHubSyncError('INVALID_RESPONSE', 'GitHub file is not valid UTF-8.'); }
    return { document: this.parseDocument(decoded), sha: payload.sha, missing: false };
  }

  async sync({ config: configInput, document: documentInput, baseDocument, token, allowPublicSync = false, message = 'Sync Recall Labs data' } = {}) {
    const config = validateGitHubConfig(configInput);
    let local = this.validateDocument(documentInput);
    let base = this.validateDocument(baseDocument === undefined ? this.emptyDocument() : baseDocument);
    if (typeof allowPublicSync !== 'boolean') throw new GitHubSyncError('INVALID_CONFIG', 'Public repository sync consent must be explicit.');
    if (typeof message !== 'string' || !message.trim() || message.length > 200 || /[\u0000-\u001f\u007f]/.test(message)) throw new GitHubSyncError('INVALID_CONFIG', 'Invalid GitHub commit message.');
    tokenHeader(token);
    let privacyConfirmed = allowPublicSync;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const remote = await this.read({ ...config, token });
      const merged = this.mergeDocuments(local, remote.document, base);
      merged.document = this.validateDocument(merged.document);
      if (merged.conflicts.length) return { ...merged, remoteDocument: remote.document, sha: remote.sha, pushed: false };
      const content = this.serializeDocument(merged.document);
      if (this.serializeDocument(remote.document) === content) return { ...merged, remoteDocument: remote.document, sha: remote.sha, pushed: false };
      if (!token) throw new GitHubSyncError('AUTH_REQUIRED', 'A GitHub token with repository Contents read/write permission is required to upload changes.');
      if (!privacyConfirmed) {
        const repository = await this.repositoryInfo({ ...config, token });
        if (!repository.private) throw new GitHubSyncError('PUBLIC_REPOSITORY_PRIVACY', 'This repository is public. Use a private repository or explicitly enable public data sync before uploading.');
        privacyConfirmed = true;
      }
      const response = await this.request(this.contentsUrl(config), {
        token, method: 'PUT',
        body: { message, content: encodeBase64(content), branch: config.branch, ...(remote.sha ? { sha: remote.sha } : {}) },
      });
      if (response.status === 409 || response.status === 422) {
        if (attempt === this.maxRetries) throw new GitHubSyncError('SYNC_RACE', 'GitHub changed repeatedly or rejected the update. Local changes are preserved; retry sync.', response.status);
        // The next merge compares both new sides against the remote just read.
        local = merged.document;
        base = remote.document;
        continue;
      }
      if (!response.ok) throw statusError(response.status);
      const payload = await boundedJson(response);
      if (!payload?.content || !SHA.test(payload.content.sha)) throw new GitHubSyncError('INVALID_RESPONSE', 'GitHub did not confirm the uploaded file SHA. Retry sync before treating changes as uploaded.');
      return { document: merged.document, conflicts: [], remoteDocument: merged.document, sha: payload.content.sha, pushed: true };
    }
    throw new GitHubSyncError('SYNC_RACE', 'Sync could not complete.');
  }
}
