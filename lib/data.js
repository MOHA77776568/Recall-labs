export const SCHEMA_VERSION = 1;
export const MAX_DOCUMENT_BYTES = 900_000;
export const MAX_CARDS = 10_000;

export class DataValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataValidationError';
    this.code = 'INVALID_DATA';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CARD_KEYS = new Set(['id', 'front', 'back', 'deck', 'tags', 'updatedAt', 'deletedAt']);
const PROGRESS_KEYS = new Set(['cardId', 'updatedAt', 'dueAt', 'intervalDays', 'ease', 'repetitions']);
const encoder = new TextEncoder();
function byteLength(text) { return encoder.encode(text).byteLength; }

function fail(message) { throw new DataValidationError(message); }
function object(value, label, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(`${label} contains unsupported fields.`);
}
function plainText(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || CONTROLS.test(value)) fail(`${label} must be plain text of at most ${max} characters.`);
  if (!allowEmpty && !value.trim()) fail(`${label} cannot be empty.`);
  return value;
}
function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) fail(`${label} must be a UUID.`);
  return value.toLowerCase();
}
function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) fail(`${label} must be an ISO UTC timestamp.`);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < 0) fail(`${label} is invalid.`);
  const canonical = new Date(time).toISOString();
  if (canonical.slice(0, 19) !== value.slice(0, 19)) fail(`${label} is invalid.`);
  return canonical;
}
function number(value, label, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${label} is out of range.`);
  return value;
}
function validateCard(value) {
  object(value, 'Card', CARD_KEYS);
  if (!Array.isArray(value.tags) || value.tags.length > 24) fail('Card tags must be an array with at most 24 items.');
  const card = {
    id: uuid(value.id, 'Card id'),
    front: plainText(value.front, 'Card front', 5_000, Boolean(value.deletedAt)),
    back: plainText(value.back, 'Card back', 20_000, Boolean(value.deletedAt)),
    deck: plainText(value.deck, 'Card deck', 120),
    tags: [...new Set(value.tags.map((tag) => plainText(tag, 'Card tag', 80)))].sort(),
    updatedAt: isoDate(value.updatedAt, 'Card updatedAt'),
  };
  if (value.deletedAt !== undefined) {
    card.deletedAt = isoDate(value.deletedAt, 'Card deletedAt');
    if (Date.parse(card.deletedAt) > Date.parse(card.updatedAt)) fail('Card updatedAt cannot precede deletedAt.');
  }
  return card;
}
function validateProgress(value) {
  object(value, 'Progress', PROGRESS_KEYS);
  return {
    cardId: uuid(value.cardId, 'Progress cardId'),
    updatedAt: isoDate(value.updatedAt, 'Progress updatedAt'),
    dueAt: isoDate(value.dueAt, 'Progress dueAt'),
    intervalDays: number(value.intervalDays, 'Progress intervalDays', 0, 36_500),
    ease: number(value.ease, 'Progress ease', 1.3, 5),
    repetitions: number(value.repetitions, 'Progress repetitions', 0, 1_000_000, true),
  };
}

export function emptyDocument() {
  return { schemaVersion: SCHEMA_VERSION, cards: [], progress: [] };
}

/** Validate and clone untrusted data; canonical ordering also makes Git diffs stable. */
export function validateDocument(input) {
  object(input, 'Document', new Set(['schemaVersion', 'cards', 'progress']));
  if (input.schemaVersion !== SCHEMA_VERSION) fail('Unsupported schema version; update Recall Labs before opening this data.');
  if (!Array.isArray(input.cards) || input.cards.length > MAX_CARDS) fail(`Document must contain at most ${MAX_CARDS} cards.`);
  if (!Array.isArray(input.progress) || input.progress.length > MAX_CARDS) fail(`Document must contain at most ${MAX_CARDS} progress entries.`);
  const cards = input.cards.map(validateCard).sort((a, b) => a.id.localeCompare(b.id));
  const progress = input.progress.map(validateProgress).sort((a, b) => a.cardId.localeCompare(b.cardId));
  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) fail('Duplicate card IDs are not allowed.');
  if (new Set(progress.map((entry) => entry.cardId)).size !== progress.length) fail('Duplicate progress entries are not allowed.');
  if (progress.some((entry) => !ids.has(entry.cardId))) fail('Progress references a missing card.');
  const document = { schemaVersion: SCHEMA_VERSION, cards, progress };
  if (byteLength(JSON.stringify(document)) > MAX_DOCUMENT_BYTES) fail(`Document exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`);
  return document;
}

export function parseDocument(text) {
  if (typeof text !== 'string' || byteLength(text) > MAX_DOCUMENT_BYTES) fail('Data file is too large.');
  let input;
  try { input = JSON.parse(text); } catch { fail('Data file is not valid JSON.'); }
  return validateDocument(input);
}

export function serializeDocument(document) {
  const validated = validateDocument(document);
  // The file size limit applies to the actual bytes uploaded, including formatting.
  const text = `${JSON.stringify(validated, null, 2)}\n`;
  if (byteLength(text) > MAX_DOCUMENT_BYTES) fail(`Formatted document exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`);
  return text;
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function laterTimestamp(a, b) {
  return Date.parse(a.updatedAt) > Date.parse(b.updatedAt) ? a.updatedAt : b.updatedAt;
}
function winnerFor(local, remote) {
  // A tombstone stays visible in an edit/delete race until the user explicitly restores it.
  if (Boolean(local.deletedAt) !== Boolean(remote.deletedAt)) return local.deletedAt ? 'local' : 'remote';
  const difference = Date.parse(local.updatedAt) - Date.parse(remote.updatedAt);
  if (difference) return difference > 0 ? 'local' : 'remote';
  return JSON.stringify(local) >= JSON.stringify(remote) ? 'local' : 'remote';
}
function mergeRecord(local, remote, base, kind, id) {
  if (!local) return { value: remote ?? base };
  if (!remote) return { value: local };
  if (same(local, remote)) return { value: local };
  if (base && same(local, base)) return { value: remote };
  if (base && same(remote, base)) return { value: local };

  const deletionRace = kind === 'card' && Boolean(local.deletedAt) !== Boolean(remote.deletedAt);
  if (base && !deletionRace) {
    // Changes to separate fields merge automatically; timestamps alone aren't conflicts.
    const fields = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
    const merged = {};
    let conflictingField = false;
    for (const field of fields) {
      if (field === 'updatedAt') continue;
      const leftChanged = !same(local[field], base[field]);
      const rightChanged = !same(remote[field], base[field]);
      if (leftChanged && rightChanged && !same(local[field], remote[field])) conflictingField = true;
      const value = leftChanged ? local[field] : remote[field];
      if (value !== undefined) merged[field] = value;
    }
    if (!conflictingField) {
      merged.updatedAt = laterTimestamp(local, remote);
      // Canonical field order is important for the next baseline comparison.
      return { value: kind === 'card' ? validateCard(merged) : validateProgress(merged) };
    }
  }
  const winner = winnerFor(local, remote);
  return {
    value: winner === 'local' ? local : remote,
    conflict: {
      id: `${kind}:${id}`, entityType: kind, entityId: id, kind,
      local: structuredClone(local), remote: structuredClone(remote), winner,
      reason: deletionRace ? 'delete-edit' : local.updatedAt === remote.updatedAt ? 'same-timestamp' : 'concurrent-edit',
    },
  };
}

/** Three-way merge. Missing records never mean deletion; deletions require a tombstone. */
export function mergeDocuments(localInput, remoteInput, baseInput = emptyDocument()) {
  const local = validateDocument(localInput);
  const remote = validateDocument(remoteInput);
  const base = validateDocument(baseInput);
  const document = emptyDocument();
  const conflicts = [];
  for (const [collection, key, kind] of [['cards', 'id', 'card'], ['progress', 'cardId', 'progress']]) {
    const left = new Map(local[collection].map((entry) => [entry[key], entry]));
    const right = new Map(remote[collection].map((entry) => [entry[key], entry]));
    const baseline = new Map(base[collection].map((entry) => [entry[key], entry]));
    for (const id of [...new Set([...left.keys(), ...right.keys(), ...baseline.keys()])].sort()) {
      const { value, conflict } = mergeRecord(left.get(id), right.get(id), baseline.get(id), kind, id);
      if (value) document[collection].push(value);
      if (conflict) conflicts.push(conflict);
    }
  }
  return { document: validateDocument(document), conflicts };
}

function time(now = new Date()) { return isoDate(new Date(now).toISOString(), 'Timestamp'); }
function nextTime(previous, now) {
  return new Date(Math.max(Date.parse(time(now)), Date.parse(previous) + 1)).toISOString();
}

export function createCard(fields, now = new Date()) {
  return validateCard({ id: globalThis.crypto.randomUUID(), front: fields.front, back: fields.back, deck: fields.deck ?? 'General', tags: fields.tags ?? [], updatedAt: time(now) });
}
export function updateCard(cardInput, patch, now = new Date()) {
  const card = validateCard(cardInput);
  object(patch, 'Card patch', new Set(['front', 'back', 'deck', 'tags']));
  if (card.deletedAt) fail('Restore a deleted card explicitly before editing it.');
  return validateCard({ ...card, ...patch, updatedAt: nextTime(card.updatedAt, now) });
}
export function deleteCard(cardInput, now = new Date()) {
  const card = validateCard(cardInput);
  const timestamp = nextTime(card.updatedAt, now);
  return validateCard({ ...card, updatedAt: timestamp, deletedAt: timestamp });
}
export function restoreCard(cardInput, now = new Date()) {
  const card = validateCard(cardInput);
  const { deletedAt, ...restored } = card;
  return validateCard({ ...restored, updatedAt: nextTime(card.updatedAt, now) });
}

/** Resolve only the selected record; both alternatives should be kept in local backups. */
export function resolveConflict(documentInput, conflict, choice, now = new Date()) {
  const document = validateDocument(documentInput);
  if (!['local', 'remote'].includes(choice) || !['card', 'progress'].includes(conflict?.kind)) fail('Choose the local or remote conflict alternative.');
  const selected = conflict[choice];
  const validator = conflict.kind === 'card' ? validateCard : validateProgress;
  const record = validator(selected);
  const key = conflict.kind === 'card' ? 'id' : 'cardId';
  if (record[key] !== conflict.entityId || conflict.id !== `${conflict.kind}:${record[key]}`) fail('Conflict ID does not match the selected alternative.');
  const timestamps = [record.updatedAt, conflict.local?.updatedAt, conflict.remote?.updatedAt].filter(Boolean);
  record.updatedAt = new Date(Math.max(Date.parse(time(now)), ...timestamps.map((date) => Date.parse(isoDate(date, 'Conflict timestamp')))) + 1).toISOString();
  const collection = conflict.kind === 'card' ? 'cards' : 'progress';
  const index = document[collection].findIndex((entry) => entry[key] === record[key]);
  if (index >= 0) document[collection][index] = record;
  else document[collection].push(record);
  return validateDocument(document);
}

export function reviewCard(previous, cardId, rating, now = new Date()) {
  uuid(cardId, 'Card id');
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) fail('Unknown review rating.');
  const entry = previous ? validateProgress(previous) : { cardId, intervalDays: 0, ease: 2.5, repetitions: 0 };
  if (entry.cardId !== cardId.toLowerCase()) fail('Progress belongs to another card.');
  let { intervalDays, ease, repetitions } = entry;
  if (rating === 'again') { intervalDays = 0; repetitions = 0; ease = Math.max(1.3, ease - 0.2); }
  if (rating === 'hard') { intervalDays = Math.max(1, intervalDays * 1.2); ease = Math.max(1.3, ease - 0.15); repetitions += 1; }
  if (rating === 'good') { intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 6 : intervalDays * ease; repetitions += 1; }
  if (rating === 'easy') { intervalDays = repetitions === 0 ? 4 : Math.max(4, intervalDays * ease * 1.3); ease = Math.min(5, ease + 0.15); repetitions += 1; }
  intervalDays = Math.min(36_500, Math.round(intervalDays * 100) / 100);
  const updatedAt = previous ? nextTime(previous.updatedAt, now) : time(now);
  const dueAt = new Date(Date.parse(updatedAt) + (rating === 'again' ? 10 * 60_000 : intervalDays * 86_400_000)).toISOString();
  return validateProgress({ cardId: cardId.toLowerCase(), updatedAt, dueAt, intervalDays, ease, repetitions });
}
