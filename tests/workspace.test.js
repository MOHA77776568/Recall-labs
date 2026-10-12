import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceDocument, emptyWorkspace, emptyWorkspaceDocument, MAX_WORKSPACE_BYTES,
  mergeWorkspaceDocuments, mergeWorkspaces, parseWorkspaceDocument, resolveWorkspaceConflict, resolveWorkspaceConflicts,
  serializeWorkspaceDocument, validateWorkspace, validateWorkspaceDocument,
} from '../lib/workspace.js';

const FIRST = '2026-10-01T10:00:00.000Z';
const SECOND = '2026-10-02T10:00:00.000Z';
const THIRD = '2026-10-03T10:00:00.000Z';
const FOURTH = '2026-10-04T10:00:00.000Z';
const copy = (input) => structuredClone(input);
function course(id = 'course-a') { return { id, title: `Course ${id}`, description: '', color: 'violet' }; }
function lecture(id = 'lecture-a', courseId = 'course-a') { return { id, courseId, title: `Lecture ${id}`, topic: '', notes: 'عربي\nMy original notes.', pages: [{ label: 'Page 1', text: 'Source text.' }], fileId: 'source-file', fileName: 'lecture.pdf' }; }
function card(id = 'card-a', courseId = 'course-a', lectureId = 'lecture-a') {
  return { id, courseId, lectureId, question: 'كيف؟', answer: 'Original answer.', tags: ['Arabic'], source: 'Page 1', createdAt: FIRST,
    schedule: { due: THIRD, stability: 12.25, difficulty: 6.4, elapsed_days: 3, scheduled_days: 12, reps: 4, lapses: 1, state: 2, learning_steps: 0, last_review: FIRST },
    customMetadata: { nested: { unicode: 'محفوظ', score: 0.8 }, labels: ['original', 'extension'] },
  };
}
function fixture() {
  return { ...emptyWorkspace(), courses: [course()], lectures: [lecture()], cards: [card()],
    recalls: [{ id: 'recall-a', lectureId: 'lecture-a', title: 'My recall', body: 'Remembered facts.', gaps: 'What remains?', checked: true, updatedAt: FIRST }],
    reviews: [{ id: 'review-a', cardId: 'card-a', rating: 3, at: FIRST }],
    preferences: { language: 'ar', custom: ['keep', 'these'] },
  };
}
const doc = (workspace = fixture()) => createWorkspaceDocument(workspace, emptyWorkspaceDocument(), FIRST);
const edit = (baseline, change, now = SECOND) => { const workspace = copy(baseline.workspace); change(workspace); return createWorkspaceDocument(workspace, baseline, now); };
function removeCourse(workspace, courseId = 'course-a') {
  const lectureIds = new Set(workspace.lectures.filter((entry) => entry.courseId === courseId).map((entry) => entry.id));
  workspace.courses = workspace.courses.filter((entry) => entry.id !== courseId);
  workspace.lectures = workspace.lectures.filter((entry) => !lectureIds.has(entry.id));
  workspace.cards = workspace.cards.filter((entry) => entry.courseId !== courseId);
  workspace.recalls = workspace.recalls.filter((entry) => !lectureIds.has(entry.lectureId));
}

test('complete original workspace and FSRS schedules round-trip without losing extension fields', () => {
  const original = fixture();
  const result = doc(original);
  assert.deepEqual(result.workspace, original);
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(result)), result);
  assert.deepEqual(validateWorkspace(result.workspace), original);
  assert.equal(MAX_WORKSPACE_BYTES, 10_000_000);
  const notes = 'text '.repeat(100_000);
  const large = fixture();
  large.lectures[0].notes = notes;
  large.lectures.push({ ...lecture('lecture-b'), notes });
  const largeDocument = doc(large);
  assert.ok(Buffer.byteLength(serializeWorkspaceDocument(largeDocument)) > 900_000);
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(largeDocument)), largeDocument);
});

test('invalid original schema, duplicate IDs, references, metadata and unsafe JSON fail closed', () => {
  const original = fixture();
  assert.throws(() => validateWorkspace({ ...original, version: 2 }), /version/);
  assert.throws(() => validateWorkspace({ ...original, cards: [...original.cards, original.cards[0]] }), /Duplicate/);
  const orphan = copy(original); orphan.cards[0].lectureId = 'missing';
  assert.throws(() => validateWorkspace(orphan), /missing course or lecture/);
  const mismatch = copy(original); mismatch.courses.push(course('course-b')); mismatch.cards[0].courseId = 'course-b';
  assert.throws(() => validateWorkspace(mismatch), /another course/);
  const badSchedule = copy(original); badSchedule.cards[0].schedule.difficulty = 11;
  assert.throws(() => validateWorkspace(badSchedule), /difficulty/);
  const date = copy(original); date.reviews[0].at = '2026-02-30T10:00:00Z';
  assert.throws(() => validateWorkspace(date), /invalid/);
  assert.throws(() => validateWorkspace(JSON.parse('{"version":1,"courses":[],"lectures":[],"cards":[],"recalls":[],"reviews":[],"__proto__":{}}')), /unsafe/);
  const tooDeep = copy(original); let target = tooDeep.extension = {}; for (let i = 0; i < 26; i++) target = target.child = {};
  assert.throws(() => validateWorkspace(tooDeep), /deeply nested/);
  const invalidDocument = doc(); delete invalidDocument.versions.cards['card-a'];
  assert.throws(() => validateWorkspaceDocument(invalidDocument), /match the live records/);
  const duplicateTombstone = doc(); duplicateTombstone.tombstones.cards.push({ id: 'card-a', updatedAt: SECOND });
  assert.throws(() => validateWorkspaceDocument(duplicateTombstone), /simultaneously live/);
  assert.throws(() => parseWorkspaceDocument('garbage'), /valid JSON/);
  assert.throws(() => parseWorkspaceDocument(' '.repeat(MAX_WORKSPACE_BYTES + 1)), /too large/);
});

test('saving original UI snapshots stamps only edits and persists deletion tombstones outside arrays', () => {
  const baseline = doc();
  const unchanged = createWorkspaceDocument(copy(baseline.workspace), baseline, THIRD);
  assert.deepEqual(unchanged, baseline);
  const changed = edit(baseline, (workspace) => { workspace.cards[0].answer = 'Changed'; workspace.recalls = []; });
  assert.equal(changed.versions.cards['card-a'], SECOND);
  assert.equal(changed.versions.lectures['lecture-a'], FIRST);
  assert.deepEqual(changed.tombstones.recalls, [{ id: 'recall-a', updatedAt: SECOND }]);
  assert.deepEqual(changed.workspace.recalls, []);
  const repeat = createWorkspaceDocument(changed.workspace, changed, THIRD);
  assert.deepEqual(repeat.tombstones, changed.tombstones);
  const clockBehind = edit(changed, (workspace) => { workspace.cards[0].answer = 'Again'; }, FIRST);
  assert.equal(clockBehind.versions.cards['card-a'], '2026-10-02T10:00:00.001Z');
});

test('independent new courses, original records, recall edits and review histories all merge', () => {
  const baseline = doc();
  const local = edit(baseline, (workspace) => {
    workspace.courses.push(course('course-local'));
    workspace.lectures.push(lecture('lecture-local', 'course-local'));
    workspace.cards.push(card('card-local', 'course-local', 'lecture-local'));
    workspace.recalls[0].body = 'Local recall edit.';
  });
  const remote = edit(baseline, (workspace) => {
    workspace.courses.push(course('course-remote'));
    workspace.lectures.push(lecture('lecture-remote', 'course-remote'));
    workspace.cards.push(card('card-remote', 'course-remote', 'lecture-remote'));
    workspace.reviews.push({ id: 'review-remote', cardId: 'card-a', rating: 4, at: SECOND });
  }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(new Set(merged.document.workspace.cards.map((entry) => entry.id)), new Set(['card-a', 'card-local', 'card-remote']));
  assert.equal(merged.document.workspace.recalls[0].body, 'Local recall edit.');
  assert.equal(merged.document.workspace.reviews.length, 2);
  assert.deepEqual(merged.document.workspace.cards[0].customMetadata, baseline.workspace.cards[0].customMetadata);
  assert.deepEqual(merged.document.workspace.preferences, baseline.workspace.preferences);
});

test('three-way independent fields merge, but divergent edits retain both full alternatives', () => {
  const baseline = doc();
  const question = edit(baseline, (workspace) => { workspace.cards[0].question = 'Updated question?'; });
  const answer = edit(baseline, (workspace) => { workspace.cards[0].answer = 'Updated answer.'; }, THIRD);
  const independent = mergeWorkspaceDocuments(question, answer, baseline);
  assert.equal(independent.conflicts.length, 0);
  assert.equal(independent.document.workspace.cards[0].question, 'Updated question?');
  assert.equal(independent.document.workspace.cards[0].answer, 'Updated answer.');
  const alternate = edit(baseline, (workspace) => { workspace.cards[0].question = 'Other question?'; }, THIRD);
  const merged = mergeWorkspaceDocuments(question, alternate, baseline);
  assert.equal(merged.conflicts.length, 1);
  const conflict = merged.conflicts[0];
  assert.equal(conflict.id, 'cards:card-a');
  assert.deepEqual(conflict.local, question.workspace.cards[0]);
  assert.deepEqual(conflict.remote, alternate.workspace.cards[0]);
  assert.deepEqual(conflict.base, baseline.workspace.cards[0]);
  assert.equal(conflict.context, undefined, 'ordinary conflicts must not duplicate large source notes');
  const resolved = resolveWorkspaceConflict(merged.document, conflict, 'local', FOURTH);
  assert.equal(resolved.workspace.cards[0].question, 'Updated question?');
  assert.ok(resolved.versions.cards['card-a'] > THIRD);
  const after = mergeWorkspaceDocuments(resolved, alternate, alternate);
  assert.equal(after.conflicts.length, 0);
  assert.equal(after.document.workspace.cards[0].question, 'Updated question?');
});

test('stale devices cannot resurrect tombstones; omission alone does not erase base records', () => {
  const baseline = doc();
  const deleted = edit(baseline, (workspace) => { workspace.cards = []; });
  const merged = mergeWorkspaceDocuments(baseline, deleted, baseline);
  assert.equal(merged.conflicts.length, 0);
  assert.deepEqual(merged.document.workspace.cards, []);
  assert.deepEqual(merged.document.tombstones.cards, [{ id: 'card-a', updatedAt: SECOND }]);
  assert.equal(merged.document.workspace.reviews[0].cardId, 'card-a');
  const noBaseline = mergeWorkspaceDocuments(baseline, deleted);
  assert.equal(noBaseline.document.workspace.cards.length, 0);
  assert.equal(noBaseline.conflicts[0].reason, 'delete-edit');
  const sparse = mergeWorkspaceDocuments(emptyWorkspaceDocument(), emptyWorkspaceDocument(), baseline);
  assert.equal(sparse.document.workspace.cards.length, 1);
  assert.equal(sparse.conflicts.length, 0);
});

test('explicit delete/edit conflict resolution supports both deletion and deliberate restoration', () => {
  const baseline = doc();
  const local = edit(baseline, (workspace) => { workspace.cards = []; });
  const remote = edit(baseline, (workspace) => { workspace.cards[0].answer = 'New remote answer.'; }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  const conflict = merged.conflicts[0];
  assert.equal(conflict.reason, 'delete-edit');
  assert.equal(conflict.local, null);
  assert.equal(conflict.remote.answer, 'New remote answer.');
  const restore = resolveWorkspaceConflict(merged.document, conflict, 'remote', FOURTH);
  assert.equal(restore.workspace.cards[0].answer, 'New remote answer.');
  assert.deepEqual(restore.tombstones.cards, []);
  const keepDeletion = resolveWorkspaceConflict(merged.document, conflict, 'local', FOURTH);
  assert.deepEqual(keepDeletion.workspace.cards, []);
  assert.ok(keepDeletion.tombstones.cards[0].updatedAt > THIRD);
  const nextSync = mergeWorkspaceDocuments(restore, remote, remote);
  assert.equal(nextSync.conflicts.length, 0);
  assert.equal(nextSync.document.workspace.cards.length, 1);
});

test('a course deletion racing a new lecture/card is diagnosed and keeps recoverable dependency alternatives', () => {
  const baseline = doc();
  const local = edit(baseline, removeCourse);
  const remote = edit(baseline, (workspace) => {
    workspace.lectures.push(lecture('lecture-new'));
    workspace.cards.push(card('card-new', 'course-a', 'lecture-new'));
    workspace.courses.push(course('unrelated'));
    workspace.cards.push(card('unrelated-card', 'unrelated', ''));
  }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  const conflict = merged.conflicts.find((entry) => entry.reason === 'reference-integrity');
  assert.ok(conflict);
  assert.equal(conflict.id, 'courses:course-a');
  assert.equal(conflict.local, null);
  assert.equal(conflict.context.remote.workspace.cards.some((entry) => entry.id === 'card-new'), true);
  assert.doesNotThrow(() => validateWorkspaceDocument(merged.document));
  const keepRemote = resolveWorkspaceConflict(merged.document, conflict, 'remote', FOURTH);
  assert.equal(keepRemote.workspace.cards.some((entry) => entry.id === 'card-new'), true);
  assert.equal(keepRemote.workspace.cards.some((entry) => entry.id === 'unrelated-card'), true);
  const keepDeletion = resolveWorkspaceConflict(merged.document, conflict, 'local', FOURTH);
  assert.equal(keepDeletion.workspace.courses.some((entry) => entry.id === 'course-a'), false);
  assert.equal(keepDeletion.workspace.cards.some((entry) => entry.id === 'card-new'), false);
  assert.equal(keepDeletion.workspace.cards.some((entry) => entry.id === 'unrelated-card'), true);
  assert.ok(keepDeletion.tombstones.cards.some((entry) => entry.id === 'card-new'));
  assert.doesNotThrow(() => validateWorkspaceDocument(keepDeletion));
});

test('moving a lecture between courses racing a new card produces a reference conflict, not dropped data', () => {
  const original = fixture(); original.courses.push(course('course-b'));
  const baseline = doc(original);
  const local = edit(baseline, (workspace) => {
    workspace.lectures[0].courseId = 'course-b';
    workspace.cards[0].courseId = 'course-b';
  });
  const remote = edit(baseline, (workspace) => { workspace.cards.push(card('new-old-course-card')); }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  const conflict = merged.conflicts.find((entry) => entry.reason === 'reference-integrity');
  assert.ok(conflict);
  assert.equal(conflict.id, 'lectures:lecture-a');
  const selectedRemote = resolveWorkspaceConflict(merged.document, conflict, 'remote', FOURTH);
  assert.equal(selectedRemote.workspace.lectures[0].courseId, 'course-a');
  assert.equal(selectedRemote.workspace.cards.length, 2);
  const selectedLocal = resolveWorkspaceConflict(merged.document, conflict, 'local', FOURTH);
  assert.equal(selectedLocal.workspace.lectures[0].courseId, 'course-b');
  assert.equal(selectedLocal.workspace.cards.length, 1);
  assert.ok(selectedLocal.tombstones.cards.some((entry) => entry.id === 'new-old-course-card'));
  assert.doesNotThrow(() => validateWorkspaceDocument(selectedLocal));
  const later = mergeWorkspaceDocuments(selectedLocal, remote, remote);
  assert.equal(later.conflicts.length, 0);
  assert.equal(later.document.workspace.cards.some((entry) => entry.id === 'new-old-course-card'), false);
});

test('restoring a concurrently edited deleted course restores its associated notes and preserves independent courses', () => {
  const original = fixture(); original.courses.push(course('course-independent'));
  original.cards.push(card('independent-card', 'course-independent', ''));
  const baseline = doc(original);
  const local = edit(baseline, removeCourse);
  const remote = edit(baseline, (workspace) => {
    workspace.courses[0].title = 'Remote course title';
    workspace.courses[1].title = 'Independent title edit';
  }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  const conflict = merged.conflicts.find((entry) => entry.id === 'courses:course-a');
  assert.equal(conflict.reason, 'delete-edit');
  const restored = resolveWorkspaceConflict(merged.document, conflict, 'remote', FOURTH);
  assert.equal(restored.workspace.lectures.some((entry) => entry.id === 'lecture-a'), true);
  assert.equal(restored.workspace.recalls.some((entry) => entry.id === 'recall-a'), true);
  assert.equal(restored.workspace.cards.some((entry) => entry.id === 'card-a'), true);
  assert.equal(restored.workspace.courses.find((entry) => entry.id === 'course-independent').title, 'Independent title edit');
});

test('parent reference conflicts coalesce edited children, and resolving the group cannot resurrect a chosen deletion', () => {
  const baseline = doc();
  const local = edit(baseline, removeCourse);
  const remote = edit(baseline, (workspace) => {
    workspace.cards[0].answer = 'Remote edited answer';
    workspace.cards.push(card('card-new'));
  }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].id, 'courses:course-a');
  assert.equal(merged.conflicts[0].context.remote.workspace.cards.find((entry) => entry.id === 'card-a').answer, 'Remote edited answer');
  const deleted = resolveWorkspaceConflicts(merged.document, merged.conflicts, 'courses:course-a', 'local', FOURTH);
  assert.equal(deleted.conflicts.length, 0);
  assert.equal(deleted.document.workspace.courses.length, 0);
  assert.equal(deleted.document.workspace.cards.length, 0);
  assert.ok(deleted.document.tombstones.cards.some((entry) => entry.id === 'card-new'));
  assert.throws(() => resolveWorkspaceConflicts(deleted.document, deleted.conflicts, 'cards:card-a', 'remote'), /no longer pending/);
  const nextSync = mergeWorkspaceDocuments(deleted.document, remote, remote);
  assert.equal(nextSync.conflicts.length, 0);
  assert.equal(nextSync.document.workspace.cards.length, 0);
  const restored = resolveWorkspaceConflicts(merged.document, merged.conflicts, 'courses:course-a', 'remote', FOURTH);
  assert.equal(restored.conflicts.length, 0);
  assert.equal(restored.document.workspace.cards.length, 2);
  assert.equal(restored.document.workspace.cards.find((entry) => entry.id === 'card-a').answer, 'Remote edited answer');
});

test('list resolution consumes legacy child conflicts but keeps unrelated record choices pending', () => {
  const original = fixture(); original.courses.push(course('independent'));
  const baseline = doc(original);
  const local = edit(baseline, (workspace) => { removeCourse(workspace); workspace.courses[0].title = 'Local independent title'; });
  const remote = edit(baseline, (workspace) => {
    workspace.cards[0].answer = 'Remote edited answer';
    workspace.cards.push(card('card-new'));
    workspace.courses[1].title = 'Remote independent title';
  }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  assert.equal(merged.conflicts.length, 2);
  const legacyChild = {
    id: 'cards:card-a', entityId: 'card-a', entityType: 'cards', kind: 'cards', reason: 'delete-edit',
    local: null, remote: remote.workspace.cards[0], base: baseline.workspace.cards[0], localVersion: SECOND, remoteVersion: THIRD,
  };
  const pending = [...merged.conflicts, legacyChild];
  const resolved = resolveWorkspaceConflicts(merged.document, pending, 'courses:course-a', 'local', FOURTH);
  assert.deepEqual(resolved.conflicts.map((entry) => entry.id), ['courses:independent']);
  assert.equal(resolved.document.workspace.cards.length, 0);
  assert.throws(() => resolveWorkspaceConflicts(resolved.document, resolved.conflicts, 'cards:card-a', 'remote'), /no longer pending/);
  const independent = resolveWorkspaceConflicts(resolved.document, resolved.conflicts, 'courses:independent', 'remote', FOURTH);
  assert.equal(independent.conflicts.length, 0);
  assert.equal(independent.document.workspace.courses[0].title, 'Remote independent title');
  assert.equal(independent.document.workspace.cards.length, 0);
});

test('connected group contexts include both lecture references when a card moves between lectures', () => {
  const baseline = doc();
  const local = edit(baseline, (workspace) => { workspace.lectures = []; workspace.cards = []; workspace.recalls = []; });
  const remote = edit(baseline, (workspace) => {
    workspace.lectures.push(lecture('lecture-b'));
    workspace.cards[0].lectureId = 'lecture-b';
    workspace.cards.push(card('card-new'));
  }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].id, 'lectures:lecture-a');
  assert.doesNotThrow(() => validateWorkspaceDocument(merged.conflicts[0].context.remote));
  const resolved = resolveWorkspaceConflicts(merged.document, merged.conflicts, 'lectures:lecture-a', 'remote', FOURTH);
  assert.equal(resolved.conflicts.length, 0);
  assert.equal(resolved.document.workspace.cards.find((entry) => entry.id === 'card-a').lectureId, 'lecture-b');
  assert.equal(resolved.document.workspace.lectures.length, 2);
});

test('schedules remain atomic during concurrent reviews; malformed resolutions are rejected', () => {
  const baseline = doc();
  const local = edit(baseline, (workspace) => { workspace.cards[0].schedule.stability = 20; workspace.cards[0].schedule.reps = 5; });
  const remote = edit(baseline, (workspace) => { workspace.cards[0].schedule.stability = 7; workspace.cards[0].schedule.reps = 5; }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(merged.conflicts[0].local.schedule, local.workspace.cards[0].schedule);
  assert.deepEqual(merged.conflicts[0].remote.schedule, remote.workspace.cards[0].schedule);
  assert.throws(() => resolveWorkspaceConflict(merged.document, merged.conflicts[0], 'latest'), /valid local or remote/);
  const altered = copy(merged.conflicts[0]); altered.local.id = 'different-card';
  assert.throws(() => resolveWorkspaceConflict(merged.document, altered, 'local'), /different entity ID/);
});

test('simple workspace helper derives UI snapshot deletions and returns the original array schema', () => {
  const base = fixture();
  const local = copy(base); local.cards[0].question = 'Independent local edit.';
  const remote = copy(base); remote.recalls = [];
  const merged = mergeWorkspaces(local, remote, base);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.document.version, 1);
  assert.equal(merged.document.cards[0].question, 'Independent local edit.');
  assert.equal(merged.document.recalls.length, 0);
});
