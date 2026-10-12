import { DataValidationError } from './data.js';

export const MAX_WORKSPACE_BYTES = 10_000_000;
export const WORKSPACE_COLLECTIONS = ['courses', 'lectures', 'cards', 'recalls', 'reviews'];
const LIMITS = { courses: 200, lectures: 500, cards: 3_000, recalls: 500, reviews: 10_000 };
const EPOCH = '1970-01-01T00:00:00.000Z';
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(value).byteLength;
const clone = (value) => structuredClone(value);
const fail = (message) => { throw new DataValidationError(message); };

function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`);
  if (keys && Object.keys(value).some((key) => !keys.includes(key))) fail(`${label} contains unsupported fields.`);
  return value;
}
function text(value, label, maximum, minimum = 0, trim = false) {
  if (typeof value !== 'string' || value.length > maximum || CONTROLS.test(value)) fail(`${label} must be text of at most ${maximum} characters.`);
  if ((trim ? value.trim() : value).length < minimum) fail(`${label} cannot be empty.`);
  return value;
}
function id(value, label) {
  text(value, label, 100, 1);
  if (UNSAFE.has(value)) fail(`${label} is reserved.`);
  return value;
}
function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) fail(`${label} must be an ISO UTC timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0 || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(`${label} is invalid.`);
  return new Date(parsed).toISOString();
}
function number(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, integer = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value))) fail(`${label} is out of range.`);
}

// Preserve existing and future workspace fields while rejecting unsafe or unbounded JSON.
function json(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 1_000_000 || depth > 24) fail('Workspace JSON is too deeply nested or complex.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, 'Workspace text', 500_000);
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Workspace contains an invalid number.'); return value; }
  if (Array.isArray(value)) return value.map((entry) => json(entry, depth + 1, budget));
  object(value, 'Workspace JSON');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (UNSAFE.has(key) || key.length > 200 || CONTROLS.test(key)) fail('Workspace contains an unsafe field name.');
    result[key] = json(value[key], depth + 1, budget);
  }
  return result;
}
function schedule(value) {
  object(value, 'Card schedule');
  timestamp(value.due, 'Schedule due');
  for (const key of ['stability', 'elapsed_days', 'scheduled_days']) number(value[key], `Schedule ${key}`);
  number(value.difficulty, 'Schedule difficulty', 0, 10);
  for (const key of ['reps', 'lapses']) number(value[key], `Schedule ${key}`, 0, Number.MAX_SAFE_INTEGER, true);
  number(value.state, 'Schedule state', 0, 3, true);
  if (value.learning_steps !== undefined) number(value.learning_steps, 'Schedule learning_steps', 0, Number.MAX_SAFE_INTEGER, true);
  if (value.last_review !== undefined) timestamp(value.last_review, 'Schedule last_review');
}
function record(value, collection) {
  object(value, `${collection} record`);
  id(value.id, `${collection} id`);
  if (collection === 'courses') {
    text(value.title, 'Course title', 150, 1, true);
    text(value.description, 'Course description', 500);
    if (!['violet', 'blue', 'teal', 'orange'].includes(value.color)) fail('Unsupported course color.');
  } else if (collection === 'lectures') {
    id(value.courseId, 'Lecture courseId');
    text(value.title, 'Lecture title', 200, 1, true);
    text(value.topic, 'Lecture topic', 150);
    text(value.notes, 'Lecture notes', 500_000);
    if (!Array.isArray(value.pages) || value.pages.length > 300) fail('A lecture can contain at most 300 pages.');
    for (const page of value.pages) { object(page, 'Lecture page'); text(page.label, 'Page label', 100); text(page.text, 'Page text', 100_000); }
    if (value.fileId !== undefined) text(value.fileId, 'Lecture fileId', 100);
    if (value.fileName !== undefined) text(value.fileName, 'Lecture fileName', 200);
  } else if (collection === 'cards') {
    id(value.courseId, 'Card courseId');
    text(value.lectureId, 'Card lectureId', 100);
    if (value.lectureId) id(value.lectureId, 'Card lectureId');
    text(value.question, 'Card question', 4_000, 1, true);
    text(value.answer, 'Card answer', 12_000, 1, true);
    if (!Array.isArray(value.tags) || value.tags.length > 20) fail('A card can contain at most 20 tags.');
    for (const tag of value.tags) text(tag, 'Card tag', 80);
    text(value.source, 'Card source', 200);
    schedule(value.schedule);
    timestamp(value.createdAt, 'Card createdAt');
  } else if (collection === 'recalls') {
    id(value.lectureId, 'Recall lectureId');
    text(value.title, 'Recall title', 200);
    text(value.body, 'Recall body', 100_000);
    text(value.gaps, 'Recall gaps', 20_000);
    if (typeof value.checked !== 'boolean') fail('Recall checked must be a boolean.');
    timestamp(value.updatedAt, 'Recall updatedAt');
  } else {
    id(value.cardId, 'Review cardId');
    number(value.rating, 'Review rating', 1, 4, true);
    timestamp(value.at, 'Review at');
  }
  const normalized = json(value);
  if (collection === 'cards' && normalized.schedule.learning_steps === undefined) normalized.schedule.learning_steps = 0;
  return normalized;
}

export function emptyWorkspace() {
  return { version: 1, courses: [], lectures: [], cards: [], recalls: [], reviews: [] };
}
function referenceIssues(workspace) {
  const courses = new Set(workspace.courses.map((entry) => entry.id));
  const lectures = new Map(workspace.lectures.map((entry) => [entry.id, entry]));
  const issues = [];
  for (const lecture of workspace.lectures) if (!courses.has(lecture.courseId)) issues.push({ collection: 'lectures', id: lecture.id, targetCollection: 'courses', targetId: lecture.courseId });
  for (const card of workspace.cards) {
    if (!courses.has(card.courseId)) issues.push({ collection: 'cards', id: card.id, targetCollection: 'courses', targetId: card.courseId });
    if (card.lectureId && lectures.get(card.lectureId)?.courseId !== card.courseId) issues.push({ collection: 'cards', id: card.id, targetCollection: 'lectures', targetId: card.lectureId });
  }
  for (const recall of workspace.recalls) if (!lectures.has(recall.lectureId)) issues.push({ collection: 'recalls', id: recall.id, targetCollection: 'lectures', targetId: recall.lectureId });
  // Review history deliberately survives card deletion, matching the original app.
  return issues;
}
export function validateWorkspace(input) {
  object(input, 'Workspace');
  if (input.version !== 1) fail('Unsupported workspace version; update Recall Lab before opening this data.');
  const result = json(input);
  for (const collection of WORKSPACE_COLLECTIONS) {
    if (!Array.isArray(input[collection]) || input[collection].length > LIMITS[collection]) fail(`Workspace allows at most ${LIMITS[collection]} ${collection}.`);
    result[collection] = input[collection].map((entry) => record(entry, collection));
    if (new Set(result[collection].map((entry) => entry.id)).size !== result[collection].length) fail(`Duplicate ${collection} IDs are not allowed.`);
  }
  if (referenceIssues(result).length) fail('A card or note references a missing course or lecture, or a lecture in another course.');
  if (bytes(JSON.stringify(result)) > MAX_WORKSPACE_BYTES) fail(`Workspace exceeds the ${MAX_WORKSPACE_BYTES}-byte limit.`);
  return result;
}
function collections(factory) { return Object.fromEntries(WORKSPACE_COLLECTIONS.map((collection) => [collection, factory()])); }
export function emptyWorkspaceDocument() {
  return { schemaVersion: 2, workspace: emptyWorkspace(), versions: collections(() => ({})), tombstones: collections(() => []) };
}
export function validateWorkspaceDocument(input) {
  object(input, 'Workspace document', ['schemaVersion', 'workspace', 'versions', 'tombstones']);
  if (input.schemaVersion !== 2) fail('Unsupported workspace document schema version.');
  const result = { schemaVersion: 2, workspace: validateWorkspace(input.workspace), versions: {}, tombstones: {} };
  object(input.versions, 'Workspace versions', WORKSPACE_COLLECTIONS);
  object(input.tombstones, 'Workspace tombstones', WORKSPACE_COLLECTIONS);
  for (const collection of WORKSPACE_COLLECTIONS) {
    object(input.versions[collection], `${collection} versions`);
    const entries = Object.entries(input.versions[collection]);
    if (entries.length > LIMITS[collection]) fail(`Too many ${collection} version entries.`);
    result.versions[collection] = Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, stamp]) => [id(key, 'Version id'), timestamp(stamp, 'Version updatedAt')]));
    const live = new Set(result.workspace[collection].map((entry) => entry.id));
    if (live.size !== entries.length || [...live].some((key) => !Object.hasOwn(result.versions[collection], key))) fail(`${collection} versions must match the live records exactly.`);
    if (!Array.isArray(input.tombstones[collection]) || input.tombstones[collection].length > 20_000) fail(`Too many ${collection} tombstones.`);
    result.tombstones[collection] = input.tombstones[collection].map((entry) => {
      object(entry, 'Deletion tombstone', ['id', 'updatedAt']);
      return { id: id(entry.id, 'Tombstone id'), updatedAt: timestamp(entry.updatedAt, 'Tombstone updatedAt') };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const deleted = new Set(result.tombstones[collection].map((entry) => entry.id));
    if (deleted.size !== result.tombstones[collection].length || [...deleted].some((key) => live.has(key))) fail('Duplicate or simultaneously live deletion tombstones are not allowed.');
  }
  if (bytes(JSON.stringify(result)) > MAX_WORKSPACE_BYTES) fail(`Workspace document exceeds the ${MAX_WORKSPACE_BYTES}-byte limit.`);
  return result;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function nowTime(now) { return timestamp(new Date(now).toISOString(), 'Timestamp'); }
function nextTime(now, previous = EPOCH) { return new Date(Math.max(Date.parse(nowTime(now)), Date.parse(previous) + 1)).toISOString(); }
function states(document, collection) {
  const result = new Map(document.tombstones[collection].map((entry) => [entry.id, { record: null, updatedAt: entry.updatedAt }]));
  for (const entry of document.workspace[collection]) result.set(entry.id, { record: entry, updatedAt: document.versions[collection][entry.id] });
  return result;
}
export function createWorkspaceDocument(workspaceInput, previousInput = emptyWorkspaceDocument(), now = new Date()) {
  const workspace = validateWorkspace(workspaceInput);
  const previous = validateWorkspaceDocument(previousInput);
  const result = emptyWorkspaceDocument();
  result.workspace = workspace;
  for (const collection of WORKSPACE_COLLECTIONS) {
    const old = states(previous, collection);
    const live = new Set(workspace[collection].map((entry) => entry.id));
    for (const entry of workspace[collection]) {
      const before = old.get(entry.id);
      result.versions[collection][entry.id] = before?.record && same(before.record, entry) ? before.updatedAt : nextTime(now, before?.updatedAt);
    }
    for (const [key, before] of old) if (!live.has(key)) result.tombstones[collection].push({ id: key, updatedAt: before.record ? nextTime(now, before.updatedAt) : before.updatedAt });
  }
  return validateWorkspaceDocument(result);
}
export function parseWorkspaceDocument(value) {
  if (typeof value !== 'string' || bytes(value) > MAX_WORKSPACE_BYTES) fail('Workspace file is too large.');
  let input;
  try { input = JSON.parse(value); } catch { fail('Workspace file is not valid JSON.'); }
  return validateWorkspaceDocument(input);
}
export function serializeWorkspaceDocument(input) {
  const value = `${JSON.stringify(validateWorkspaceDocument(input), null, 2)}\n`;
  if (bytes(value) > MAX_WORKSPACE_BYTES) fail('Formatted workspace file is too large.');
  return value;
}
function equalState(a, b) { return a === b || Boolean(a && b && same(a.record, b.record)); }
function chooseState(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.record === null || b.record === null) return a.record === null ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return JSON.stringify(a.record) >= JSON.stringify(b.record) ? a : b;
}
function mergedFields(local, remote, base) {
  const result = {};
  for (const field of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    const leftChanged = !same(local[field], base[field]);
    const rightChanged = !same(remote[field], base[field]);
    if (leftChanged && rightChanged && !same(local[field], remote[field])) return null;
    const value = leftChanged ? local[field] : remote[field];
    if (value !== undefined) result[field] = value;
  }
  return result;
}
function setState(document, collection, key, state) {
  const index = document.workspace[collection].findIndex((entry) => entry.id === key);
  if (index !== -1) document.workspace[collection].splice(index, 1);
  document.tombstones[collection] = document.tombstones[collection].filter((entry) => entry.id !== key);
  delete document.versions[collection][key];
  if (state?.record) {
    document.workspace[collection].push(clone(state.record));
    document.versions[collection][key] = state.updatedAt;
  } else if (state) document.tombstones[collection].push({ id: key, updatedAt: state.updatedAt });
}
function relatedIds(collection, key, documents) {
  const group = collections(() => new Set());
  group[collection].add(key);
  const all = collections(() => []);
  for (const document of documents) for (const kind of WORKSPACE_COLLECTIONS) all[kind].push(...document.workspace[kind]);
  let changed;
  do {
    const previousSize = WORKSPACE_COLLECTIONS.reduce((size, kind) => size + group[kind].size, 0);
    if (collection === 'courses') {
      for (const entry of all.lectures) if (entry.courseId === key) group.lectures.add(entry.id);
      for (const entry of all.cards) if (entry.courseId === key) group.cards.add(entry.id);
    }
    for (const entry of all.cards) {
      if (group.lectures.has(entry.lectureId)) group.cards.add(entry.id);
      if (group.cards.has(entry.id)) {
        if (entry.lectureId) group.lectures.add(entry.lectureId);
        group.courses.add(entry.courseId);
      }
    }
    for (const entry of all.recalls) {
      if (group.lectures.has(entry.lectureId)) group.recalls.add(entry.id);
      if (group.recalls.has(entry.id)) group.lectures.add(entry.lectureId);
    }
    for (const entry of all.lectures) if (group.lectures.has(entry.id)) group.courses.add(entry.courseId);
    changed = previousSize !== WORKSPACE_COLLECTIONS.reduce((size, kind) => size + group[kind].size, 0);
  } while (changed);
  return group;
}
function contextFor(document, group) {
  const context = emptyWorkspaceDocument();
  for (const collection of WORKSPACE_COLLECTIONS) for (const [key, state] of states(document, collection)) if (group[collection].has(key)) setState(context, collection, key, state);
  return context;
}
function makeConflict(collection, key, local, remote, base, reason, documents) {
  const chosen = chooseState(local, remote);
  const conflict = {
    id: `${collection}:${key}`, entityType: collection, entityId: key, kind: collection,
    local: clone(local?.record ?? null), remote: clone(remote?.record ?? null), base: clone(base?.record ?? null),
    localVersion: local?.updatedAt ?? EPOCH, remoteVersion: remote?.updatedAt ?? EPOCH,
    winner: chosen === local ? 'local' : 'remote', reason,
  };
  const relationshipFields = collection === 'lectures' ? ['courseId'] : collection === 'cards' ? ['courseId', 'lectureId'] : collection === 'recalls' ? ['lectureId'] : [];
  const relationshipsDiffer = relationshipFields.some((field) => local?.record?.[field] !== remote?.record?.[field]);
  // Ordinary question, answer and schedule conflicts need only their records.
  // Avoid duplicating whole lecture notes for every conflicted sibling card.
  if (reason === 'reference-integrity' || !local?.record || !remote?.record || relationshipsDiffer) {
    const group = relatedIds(collection, key, documents);
    conflict.related = Object.fromEntries(WORKSPACE_COLLECTIONS.map((kind) => [kind, [...group[kind]].sort()]));
    conflict.context = { local: contextFor(documents[0], group), remote: contextFor(documents[1], group), base: contextFor(documents[2], group) };
  }
  return conflict;
}
function applyContext(document, context, group, stamp, root) {
  for (const collection of WORKSPACE_COLLECTIONS) {
    const current = states(document, collection);
    const selected = states(context, collection);
    for (const key of group[collection]) {
      const state = selected.get(key);
      // Dependency courses are ancestors, not a choice to remove another
      // independent course or overwrite its concurrently edited title/notes.
      if (collection === 'courses' && root && (root.collection !== 'courses' || root.id !== key)) {
        if (!current.get(key)?.record && state?.record) setState(document, collection, key, { ...state, updatedAt: stamp ?? state.updatedAt });
        continue;
      }
      if (state) setState(document, collection, key, { ...state, updatedAt: stamp ?? state.updatedAt });
      else setState(document, collection, key, stamp ? { record: null, updatedAt: stamp } : undefined);
    }
  }
}
function decidedIds(conflict) {
  const ids = new Set([conflict.id]);
  if (!conflict.related) return ids;
  for (const collection of WORKSPACE_COLLECTIONS) {
    // Existing dependency courses remain independent of a child/group choice.
    if (collection === 'courses') continue;
    for (const key of conflict.related[collection] ?? []) ids.add(`${collection}:${key}`);
  }
  return ids;
}
function coalesceReferenceConflicts(conflicts) {
  const references = conflicts.filter((entry) => entry.reason === 'reference-integrity').sort((a, b) => {
    const priority = (entry) => entry.kind === 'courses' ? 0 : 1;
    return priority(a) - priority(b) || a.id.localeCompare(b.id);
  });
  const covered = new Set();
  const keptReferences = new Set();
  for (const conflict of references) {
    if (covered.has(conflict.id)) continue;
    keptReferences.add(conflict.id);
    for (const key of decidedIds(conflict)) covered.add(key);
  }
  return conflicts.filter((entry) => keptReferences.has(entry.id) || !covered.has(entry.id));
}

/** Three-way merge by stable entity ID; omissions alone never delete saved records. */
export function mergeWorkspaceDocuments(localInput, remoteInput, baseInput = emptyWorkspaceDocument()) {
  const local = validateWorkspaceDocument(localInput);
  const remote = validateWorkspaceDocument(remoteInput);
  const base = validateWorkspaceDocument(baseInput);
  const documents = [local, remote, base];
  const result = emptyWorkspaceDocument();
  const conflicts = new Map();
  // Retain extension fields as well as every original workspace collection.
  const extras = (workspace) => Object.fromEntries(Object.entries(workspace).filter(([key]) => key !== 'version' && !WORKSPACE_COLLECTIONS.includes(key)));
  const extraMerge = mergedFields(extras(local.workspace), extras(remote.workspace), extras(base.workspace));
  if (extraMerge === null) fail('Concurrent workspace extension changes require an explicit import choice.');
  Object.assign(result.workspace, extraMerge);
  for (const collection of WORKSPACE_COLLECTIONS) {
    const left = states(local, collection), right = states(remote, collection), before = states(base, collection);
    const keys = [...new Set([...left.keys(), ...right.keys(), ...before.keys()])];
    for (const key of keys) {
      const baseline = before.get(key), a = left.get(key) ?? baseline, b = right.get(key) ?? baseline;
      let chosen;
      if (equalState(a, b)) chosen = chooseState(a, b);
      else if (equalState(a, baseline)) chosen = b;
      else if (equalState(b, baseline)) chosen = a;
      else if (!a || !b) chosen = a ?? b;
      else {
        const fields = a.record && b.record && baseline?.record ? mergedFields(a.record, b.record, baseline.record) : null;
        if (fields) chosen = { record: record(fields, collection), updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt };
        else {
          chosen = chooseState(a, b);
          const reason = Boolean(a.record) !== Boolean(b.record) ? 'delete-edit' : 'concurrent-edit';
          conflicts.set(`${collection}:${key}`, makeConflict(collection, key, a, b, baseline, reason, documents));
        }
      }
      setState(result, collection, key, chosen);
    }
  }
  // A deletion or a lecture move can collide with a different record's edit.
  // Keep an explicitly selected, valid affected group while retaining both groups
  // in the conflict; never silently drop a newly added card to fix a reference.
  let repairs = 0;
  while (referenceIssues(result.workspace).length) {
    if (++repairs > 100) fail('Workspace has too many overlapping reference conflicts.');
    const issue = referenceIssues(result.workspace)[0];
    const target = issue.targetCollection, key = issue.targetId;
    const alternatives = documents.map((document) => states(document, target).get(key));
    const conflict = makeConflict(target, key, alternatives[0], alternatives[1], alternatives[2], 'reference-integrity', documents);
    conflict.reference = issue;
    conflicts.set(conflict.id, conflict);
    const candidate = alternatives.findIndex((entry, index) => entry?.record && (target !== 'lectures' || issue.collection !== 'cards' || entry.record.courseId === result.workspace.cards.find((card) => card.id === issue.id)?.courseId));
    const index = candidate === -1 ? alternatives.findIndex((entry) => entry?.record) : candidate;
    if (index === -1) fail('A referenced course or lecture has no recoverable alternative.');
    const context = conflict.context[index === 0 ? 'local' : index === 1 ? 'remote' : 'base'];
    applyContext(result, context, conflict.related, undefined, { collection: target, id: key });
    conflict.winner = index === 0 ? 'local' : index === 1 ? 'remote' : 'base';
  }
  return { document: validateWorkspaceDocument(result), conflicts: coalesceReferenceConflicts([...conflicts.values()]) };
}

/** Explicit choices refresh versions, carry deletions, and keep references valid. */
export function resolveWorkspaceConflict(documentInput, conflict, choice, now = new Date()) {
  const document = validateWorkspaceDocument(documentInput);
  if (!['local', 'remote'].includes(choice) || !WORKSPACE_COLLECTIONS.includes(conflict?.kind) || conflict.id !== `${conflict.kind}:${conflict.entityId}`) fail('Choose a valid local or remote workspace conflict alternative.');
  const collection = conflict.kind, key = id(conflict.entityId, 'Conflict id');
  const selected = conflict[choice] === null ? null : record(conflict[choice], collection);
  if (selected && selected.id !== key) fail('Conflict alternative has a different entity ID.');
  const versions = [conflict.localVersion, conflict.remoteVersion, ...WORKSPACE_COLLECTIONS.flatMap((kind) => Object.values(document.versions[kind])), ...WORKSPACE_COLLECTIONS.flatMap((kind) => document.tombstones[kind].map((entry) => entry.updatedAt))].filter(Boolean).map((value) => timestamp(value, 'Conflict version'));
  const stamp = nextTime(now, versions.sort().at(-1) ?? EPOCH);
  setState(document, collection, key, { record: selected, updatedAt: stamp });
  if (conflict.reason === 'reference-integrity') {
    const context = validateWorkspaceDocument(conflict.context?.[choice]);
    const related = conflict.related;
    object(related, 'Conflict related records', WORKSPACE_COLLECTIONS);
    for (const kind of WORKSPACE_COLLECTIONS) {
      if (!Array.isArray(related[kind]) || related[kind].length > LIMITS[kind] + 20_000) fail('Invalid related conflict records.');
      for (const relatedId of related[kind]) id(relatedId, 'Related conflict id');
    }
    applyContext(document, context, related, stamp, { collection, id: key });
    // Sparse contexts must still explicitly keep the chosen target's tombstone.
    setState(document, collection, key, { record: selected, updatedAt: stamp });
  } else if (selected !== null && ['courses', 'lectures'].includes(collection) && (conflict.local === null || conflict.remote === null) && conflict.context?.[choice]) {
    // Restoring a deleted parent restores that side's associated saved content.
    applyContext(document, validateWorkspaceDocument(conflict.context[choice]), conflict.related, stamp, { collection, id: key });
    setState(document, collection, key, { record: selected, updatedAt: stamp });
  } else if (selected === null) {
    const lectures = collection === 'courses' ? new Set(document.workspace.lectures.filter((entry) => entry.courseId === key).map((entry) => entry.id)) : new Set(collection === 'lectures' ? [key] : []);
    for (const lectureId of lectures) setState(document, 'lectures', lectureId, { record: null, updatedAt: stamp });
    for (const card of [...document.workspace.cards]) if ((collection === 'courses' && card.courseId === key) || lectures.has(card.lectureId)) setState(document, 'cards', card.id, { record: null, updatedAt: stamp });
    for (const recall of [...document.workspace.recalls]) if (lectures.has(recall.lectureId)) setState(document, 'recalls', recall.id, { record: null, updatedAt: stamp });
  }
  // A chosen edited card may depend on a parent absent from the tentative merge.
  if (referenceIssues(document.workspace).length && conflict.context?.[choice]) {
    const context = validateWorkspaceDocument(conflict.context[choice]);
    applyContext(document, context, conflict.related, stamp, { collection, id: key });
    setState(document, collection, key, { record: selected, updatedAt: stamp });
  }
  return validateWorkspaceDocument(document);
}
/** Resolve one current choice and consume every record choice that it decides. */
export function resolveWorkspaceConflicts(documentInput, conflictsInput, conflictId, choice, now = new Date()) {
  const before = validateWorkspaceDocument(documentInput);
  if (!Array.isArray(conflictsInput) || conflictsInput.length > 20_000) fail('Invalid workspace conflict list.');
  const conflicts = conflictsInput.map((conflict) => {
    if (!conflict || !WORKSPACE_COLLECTIONS.includes(conflict.kind) || typeof conflict.entityId !== 'string' || conflict.id !== `${conflict.kind}:${conflict.entityId}`) fail('Invalid workspace conflict entry.');
    return clone(conflict);
  });
  if (new Set(conflicts.map((conflict) => conflict.id)).size !== conflicts.length) fail('Duplicate workspace conflicts are not allowed.');
  const selected = conflicts.find((conflict) => conflict.id === conflictId);
  if (!selected) fail('This workspace conflict is no longer pending.');
  const document = resolveWorkspaceConflict(before, selected, choice, now);
  const decided = new Set([selected.id]);
  for (const collection of WORKSPACE_COLLECTIONS) {
    const oldStates = states(before, collection), newStates = states(document, collection);
    for (const key of new Set([...oldStates.keys(), ...newStates.keys()])) {
      // Version changes also mark a same-content group alternative as decided.
      if (!same(oldStates.get(key), newStates.get(key))) decided.add(`${collection}:${key}`);
    }
  }
  return { document, conflicts: conflicts.filter((conflict) => !decided.has(conflict.id)) };
}
export function mergeWorkspaces(local, remote, base = emptyWorkspace()) {
  const baseline = createWorkspaceDocument(base, emptyWorkspaceDocument(), EPOCH);
  const result = mergeWorkspaceDocuments(createWorkspaceDocument(local, baseline), createWorkspaceDocument(remote, baseline), baseline);
  return { ...result, document: result.document.workspace };
}
