import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyWorkspaceDocument, createWorkspaceDocument, serializeWorkspaceDocument,
  resolveWorkspaceConflicts,
} from '../lib/workspace.js';
import { prepareWorkspaceImport, mergeWorkspaceImport } from '../lib/workspace-import.js';

const stamp = '2026-10-01T10:00:00.000Z';
function legacyWorkspace() {
  return {
    version: 1,
    courses: [{ id: 'course-a', title: 'مقرر Physics', description: '', color: 'blue' }],
    lectures: [{ id: 'lecture-a', courseId: 'course-a', title: 'محاضرة', topic: '', notes: 'النص الأصلي', pages: [], durationSeconds: 3600 }],
    cards: [{ id: 'card-a', courseId: 'course-a', lectureId: 'lecture-a', question: 'What is $F=ma$?', answer: 'القوة', tags: ['ميكانيكا'], source: '', createdAt: stamp, schedule: { due: stamp, stability: 2, difficulty: 5, elapsed_days: 1, scheduled_days: 3, reps: 2, lapses: 0, state: 2, learning_steps: 0, last_review: stamp }, customMetadata: { preserved: true } }],
    recalls: [{ id: 'recall-a', lectureId: 'lecture-a', title: 'Recall', body: 'نص مختلط English', gaps: '', checked: true, updatedAt: stamp }],
    reviews: [{ id: 'review-a', cardId: 'card-a', rating: 3, at: stamp }],
    safeExtension: { retained: 'yes' },
  };
}
function legacyDocument() {
  const workspace = legacyWorkspace();
  const collections = ['courses', 'lectures', 'cards', 'recalls', 'reviews'];
  return {
    schemaVersion: 2, workspace,
    versions: Object.fromEntries(collections.map((key) => [key, Object.fromEntries(workspace[key].map((entry) => [entry.id, stamp]))])),
    tombstones: Object.fromEntries(collections.map((key) => [key, []])),
  };
}
function studyDocument() {
  const workspace = prepareWorkspaceImport(legacyWorkspace()).workspace;
  workspace.lecturePlans.push({ id: 'plan-a', lectureId: 'lecture-a', durationSeconds: 3600 });
  workspace.viewingPasses.push({ id: 'pass-a', lectureId: 'lecture-a', kind: 'first', status: 'complete', startedAt: stamp, completedAt: '2026-10-01T11:00:00.000Z', completion: 'manual' });
  workspace.studySessions.push({ id: 'session-a', lectureId: 'lecture-a', occurredAt: stamp, activities: ['viewing'], passId: 'pass-a', ranges: [{ start: 0, end: 3600 }], effortMinutes: null, reason: '', note: '', conceptIds: [], cardIds: [], gapIds: [] });
  return createWorkspaceDocument(workspace, emptyWorkspaceDocument(), new Date(stamp));
}

test('legacy exports and backup wrappers migrate without inventing study or review provenance', () => {
  const original = legacyWorkspace();
  for (const input of [original, { state: original }, { workspace: original }, legacyDocument(), { workspaceDocument: legacyDocument() }, { originalState: { workspaceDocument: legacyDocument() } }, JSON.stringify(legacyDocument())]) {
    const migrated = prepareWorkspaceImport(input);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.workspace.version, 2);
    assert.deepEqual(migrated.workspace.cards, original.cards);
    assert.deepEqual(migrated.workspace.recalls, original.recalls);
    assert.deepEqual(migrated.workspace.reviews, original.reviews);
    assert.deepEqual(migrated.workspace.safeExtension, original.safeExtension);
    assert.deepEqual(migrated.workspace.studySessions, []);
    assert.deepEqual(prepareWorkspaceImport(migrated), migrated);
  }
});

test('new exports round-trip sessions, passes, ranges, and explicit deletion metadata', () => {
  const original = studyDocument();
  const changed = structuredClone(original.workspace);
  changed.cards = [];
  const deleted = createWorkspaceDocument(changed, original);
  for (const input of [deleted, deleted.workspace, { state: deleted.workspace }, serializeWorkspaceDocument(deleted)]) {
    const restored = prepareWorkspaceImport(input, deleted);
    assert.deepEqual(restored.workspace, deleted.workspace);
    assert.deepEqual(restored.tombstones, deleted.tombstones);
    assert.equal(restored.workspace.studySessions.length, 1);
  }
});

test('repeated import does not duplicate records and independent device additions survive', () => {
  const base = studyDocument();
  const localWorkspace = structuredClone(base.workspace);
  localWorkspace.studySessions.push({ ...localWorkspace.studySessions[0], id: 'session-local', occurredAt: '2026-10-02T10:00:00.000Z' });
  const local = createWorkspaceDocument(localWorkspace, base);
  const remoteWorkspace = structuredClone(base.workspace);
  remoteWorkspace.studySessions.push({ ...remoteWorkspace.studySessions[0], id: 'session-remote', occurredAt: '2026-10-03T10:00:00.000Z' });
  const remote = createWorkspaceDocument(remoteWorkspace, base);
  const first = mergeWorkspaceImport(local, remote, base);
  assert.deepEqual(first.conflicts, []);
  assert.equal(first.document.workspace.studySessions.length, 3);
  const second = mergeWorkspaceImport(first.document, remote, base);
  assert.deepEqual(second.conflicts, []);
  assert.equal(second.document.workspace.studySessions.length, 3);
});

test('merging a plain legacy export preserves newer activity absent from that export', () => {
  const current = studyDocument();
  const result = mergeWorkspaceImport(current, legacyWorkspace());
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.document.workspace.studySessions.length, 1);
  assert.equal(result.document.workspace.viewingPasses.length, 1);
  // The explicitly confirmed restore path still represents an entire snapshot.
  const replacement = prepareWorkspaceImport(legacyWorkspace(), current);
  assert.deepEqual(replacement.workspace.studySessions, []);
  assert.equal(replacement.tombstones.studySessions[0].id, 'session-a');
});

test('same-record importing edits remain visible until the user chooses a version', () => {
  const base = studyDocument();
  const left = structuredClone(base.workspace); left.studySessions[0].note = 'left edit';
  const right = structuredClone(base.workspace); right.studySessions[0].note = 'right edit';
  const local = createWorkspaceDocument(left, base);
  const remote = createWorkspaceDocument(right, base);
  const merged = mergeWorkspaceImport(local, remote, base);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].entityType, 'studySessions');
  assert.deepEqual(merged.importedDocument, remote);
  const resolved = resolveWorkspaceConflicts(merged.document, merged.conflicts, merged.conflicts[0].id, 'local');
  assert.equal(resolved.document.workspace.studySessions[0].note, 'left edit');
  assert.deepEqual(resolved.conflicts, []);
});

test('future schemas, malformed JSON, invalid ranges, and oversized imports are rejected', () => {
  assert.throws(() => prepareWorkspaceImport({ ...legacyDocument(), schemaVersion: 99 }), /version|schema/i);
  assert.throws(() => prepareWorkspaceImport('{broken'), /JSON/);
  const invalid = studyDocument(); invalid.workspace.studySessions[0].ranges[0].end = 3601;
  assert.throws(() => prepareWorkspaceImport(invalid), /duration|range|bound/i);
  assert.throws(() => prepareWorkspaceImport(' '.repeat(64 * 1024 * 1024 + 1)), /size/);
});
