import { GitHubSyncClient, GitHubSyncError, validateGitHubConfig } from './github.js';
import {
  MAX_CARD_IMAGE_BYTES, validateCardMediaRecord, verifyCardImageBytes,
  encodeCardImageBase64, decodeCardImageBase64, CardMediaError,
} from './card-media.js';

const API_ROOT = 'https://api.github.com';
const BLOB_SHA = /^[a-f0-9]{40}$/;
const MAX_CONTENTS_RESPONSE_BYTES = Math.ceil(MAX_CARD_IMAGE_BYTES / 3) * 4 + 16_384;
const encoder = new TextEncoder();

/** Images follow the user's actual JSON directory, repository and branch. */
export function cardImageRepositoryPath(configInput, recordInput) {
  const config = validateGitHubConfig(configInput);
  const record = validateCardMediaRecord(recordInput);
  const parts = config.path.split('/');
  parts.pop();
  return [...parts, 'media', record.fileName].join('/');
}

async function boundedResponseBytes(response, maximum) {
  const announced = Number(response.headers?.get?.('content-length'));
  if (announced > maximum) throw new CardMediaError('REMOTE_IMAGE_TOO_LARGE', 'The remote card image response exceeds the safety limit.');
  if (!response.body?.getReader) {
    const bytes = response.arrayBuffer ? new Uint8Array(await response.arrayBuffer()) : encoder.encode(await response.text());
    if (bytes.length > maximum) throw new CardMediaError('REMOTE_IMAGE_TOO_LARGE', 'The remote card image response exceeds the safety limit.');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new CardMediaError('REMOTE_IMAGE_TOO_LARGE', 'The remote card image response exceeds the safety limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function boundedJson(response) {
  const bytes = await boundedResponseBytes(response, MAX_CONTENTS_RESPONSE_BYTES);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new CardMediaError('INVALID_IMAGE_RESPONSE', 'GitHub returned malformed image metadata.'); }
}

function httpError(status) {
  if (status === 401) return new GitHubSyncError('AUTH_REQUIRED', 'GitHub authentication failed. Check the saved token.', status);
  if (status === 403) return new GitHubSyncError('ACCESS_DENIED', 'GitHub denied image access or its rate limit was reached. Check repository access and token permissions.', status);
  if (status === 404) return new GitHubSyncError('REMOTE_IMAGE_MISSING', 'The card image is not available in the configured repository.', status);
  return new GitHubSyncError('IMAGE_SYNC_HTTP', `GitHub returned HTTP ${status} for a card image.`, status);
}

function safeFailure(id, error) {
  // Transport/store exceptions may contain credentials or absolute paths. Only
  // errors produced by these bounded modules have user-facing messages.
  const trusted = error instanceof CardMediaError || error instanceof GitHubSyncError;
  return { id, code: trusted ? error.code : 'IMAGE_SYNC_FAILED', message: trusted ? error.message : 'This card image could not be synchronized. Retry Sync; the card and local files were preserved.' };
}

/**
 * Synchronize binary dependencies separately from JSON. Upload phase repairs
 * missing local images from GitHub first; callers must only push JSON when
 * complete is true. Download failures leave incoming cards intact and retryable.
 */
export async function synchronizeCardImages({
  config: configInput, token, mediaRecords = [], store, phase,
  fetchImpl = globalThis.fetch, timeoutMs = 20_000, maxRetries = 2,
} = {}) {
  const config = validateGitHubConfig(configInput);
  if (!['upload', 'download'].includes(phase)) throw new CardMediaError('INVALID_IMAGE_PHASE', 'Choose an image upload or download phase.');
  if (!store || typeof store.read !== 'function' || typeof store.save !== 'function') throw new CardMediaError('INVALID_IMAGE_STORE', 'Local card image storage is unavailable.');
  if (!Array.isArray(mediaRecords) || mediaRecords.length > 5000) throw new CardMediaError('INVALID_MEDIA', 'Too many card image dependencies.');
  const byId = new Map();
  for (const input of mediaRecords) {
    const record = validateCardMediaRecord(input);
    if (byId.has(record.id) && JSON.stringify(byId.get(record.id)) !== JSON.stringify(record)) throw new CardMediaError('INVALID_MEDIA', 'The same card image hash has conflicting metadata.');
    byId.set(record.id, record);
  }
  const result = { complete: true, uploaded: 0, downloaded: 0, missing: [], failures: [] };
  if (!byId.size) return result;
  const client = new GitHubSyncClient({ fetchImpl, timeoutMs, maxRetries });

  async function request(url, options = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await client.request(url, { ...options, token });
        if (response.status >= 500 && attempt < maxRetries) continue;
        return response;
      } catch (error) {
        if (error.code !== 'NETWORK_ERROR' || attempt === maxRetries) throw error;
      }
    }
    throw new GitHubSyncError('NETWORK_ERROR', 'GitHub image synchronization could not complete. Retry Sync.');
  }

  function contentsUrl(record) {
    const filePath = cardImageRepositoryPath(config, record).split('/').map(encodeURIComponent).join('/');
    return `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${filePath}`;
  }

  async function readRemote(record) {
    const response = await request(`${contentsUrl(record)}?ref=${encodeURIComponent(config.branch)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw httpError(response.status);
    const payload = await boundedJson(response);
    if (!payload || payload.type !== 'file' || !BLOB_SHA.test(payload.sha) || !Number.isSafeInteger(payload.size)
      || payload.size !== record.byteLength || !['base64', 'none'].includes(payload.encoding) || typeof payload.content !== 'string') {
      throw new CardMediaError('INVALID_IMAGE_RESPONSE', 'GitHub returned invalid card image metadata or length.');
    }
    let bytes;
    if (payload.encoding === 'none') {
      // Immutable API blob reads avoid branch races and external raw-content domains.
      const response = await request(`${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/blobs/${payload.sha}`, { raw: true });
      if (!response.ok) throw httpError(response.status);
      bytes = await boundedResponseBytes(response, MAX_CARD_IMAGE_BYTES);
    } else bytes = decodeCardImageBase64(payload.content);
    if (bytes.length !== payload.size) throw new CardMediaError('IMAGE_INTEGRITY', 'The remote card image length does not match its metadata.');
    await verifyCardImageBytes(bytes, record);
    return bytes;
  }

  async function readLocal(record) {
    try {
      const local = await store.read(record.id);
      await verifyCardImageBytes(local.bytes, record);
      return local.bytes;
    } catch (error) {
      if (['LOCAL_IMAGE_MISSING', 'IMAGE_NOT_FOUND', 'NOT_FOUND'].includes(error.code)) return null;
      throw error;
    }
  }

  if (phase === 'upload') {
    try {
      const repository = await client.repositoryInfo({ ...config, token });
      if (!repository.private) throw new GitHubSyncError('PUBLIC_IMAGE_REPOSITORY', 'Card images can only be uploaded to a private repository. Select your private data repository before syncing.');
    } catch (error) {
      result.complete = false;
      result.failures = [...byId.keys()].map((id) => safeFailure(id, error));
      return result;
    }
  }

  for (const record of byId.values()) {
    try {
      let local = await readLocal(record);
      if (phase === 'download' && local) continue;
      let remote = await readRemote(record);
      if (remote) {
        if (!local) {
          const saved = validateCardMediaRecord(await store.save(remote));
          if (saved.id !== record.id) throw new CardMediaError('IMAGE_INTEGRITY', 'Downloaded card image could not be saved with its expected content hash.');
          result.downloaded += 1;
        }
        continue;
      }
      if (!local || phase === 'download') {
        result.missing.push(record.id);
        throw new CardMediaError('REMOTE_IMAGE_MISSING', 'This card image is missing locally and from the configured repository. Reattach it or restore a full backup.');
      }
      if (!token) throw new GitHubSyncError('AUTH_REQUIRED', 'A GitHub token with private repository Contents read/write permission is required to upload card images.');
      // A hash path is immutable. Never overwrite an existing file; after a
      // concurrent create or interrupted PUT, reread and verify before retrying.
      let uploaded = false;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        let response;
        try {
          response = await client.request(contentsUrl(record), {
            token, method: 'PUT',
            body: { message: 'Add Recall Labs card image', branch: config.branch, content: encodeCardImageBase64(local) },
          });
        } catch (error) {
          if (error.code !== 'NETWORK_ERROR' || attempt === maxRetries) throw error;
        }
        if (response?.ok) {
          const payload = await boundedJson(response);
          if (!payload?.content || !BLOB_SHA.test(payload.content.sha)) throw new CardMediaError('INVALID_IMAGE_RESPONSE', 'GitHub did not confirm the uploaded card image. Retry Sync before treating it as uploaded.');
          result.uploaded += 1;
          uploaded = true;
          break;
        }
        if (response && ![409, 422].includes(response.status) && response.status < 500) throw httpError(response.status);
        remote = await readRemote(record);
        if (remote) { uploaded = true; break; }
        if (attempt === maxRetries) throw new GitHubSyncError('IMAGE_SYNC_RACE', 'The card image upload could not be confirmed. Local files were preserved; retry Sync.');
      }
      if (!uploaded) throw new GitHubSyncError('IMAGE_SYNC_RACE', 'The card image upload could not complete. Retry Sync.');
    } catch (error) {
      result.complete = false;
      result.failures.push(safeFailure(record.id, error));
    }
  }
  return result;
}
