import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyWorkspace, emptyWorkspaceDocument, createWorkspaceDocument, migrateWorkspace,
  migrateWorkspaceDocument, validateWorkspace, validateWorkspaceDocument,
  serializeWorkspaceDocument, parseWorkspaceDocument, mergeWorkspaceDocuments,
  resolveWorkspaceConflicts, LEGACY_WORKSPACE_COLLECTIONS, STUDY_COLLECTIONS,
} from '../lib/workspace.js';

const FIRST = '2026-10-01T10:00:00.000Z';
const SECOND = '2026-10-02T10:00:00.000Z';
const THIRD = '2026-10-03T10:00:00.000Z';
const copy = (value) => structuredClone(value);
function fixture() {
  const workspace = emptyWorkspace();
  workspace.courses.push({ id: 'course-a', title: 'Synthetic course', description: '', color: 'blue' });
  workspace.lectures.push({ id: 'lecture-a', courseId: 'course-a', title: 'عربي / Synthetic lecture', topic: '', notes: 'Preserved notes', pages: [] });
  workspace.cards.push({ id: 'card-a', courseId: 'course-a', lectureId: 'lecture-a', question: 'Q?', answer: 'A', tags: ['concept-tag'], source: '', createdAt: FIRST,
    schedule: { due: SECOND, stability: 5, difficulty: 4, elapsed_days: 1, scheduled_days: 5, reps: 3, lapses: 0, state: 2, learning_steps: 0, last_review: FIRST } });
  workspace.recalls.push({ id: 'recall-a', lectureId: 'lecture-a', title: '', body: 'Synthetic old recall', gaps: '', checked: true, updatedAt: FIRST });
  workspace.reviews.push({ id: 'review-a', cardId: 'card-a', rating: 3, at: FIRST, preservedExtension: { label: 'legacy' } });
  return workspace;
}
function richFixture() {
  const workspace = fixture();
  workspace.lecturePlans.push({ id: 'plan-a', lectureId: 'lecture-a', durationSeconds: 3600, baselineCompleteCount: 2, transcriptionScope: 'full', targetRanges: [], transcriptionMethod: 'verbatim' });
  workspace.viewingPasses.push({ id: 'pass-a', lectureId: 'lecture-a', kind: 'first', status: 'in-progress', startedAt: FIRST });
  workspace.studySessions.push({ id: 'session-a', lectureId: 'lecture-a', occurredAt: FIRST, activities: ['viewing', 'transcription'], passId: 'pass-a', ranges: [{ start: 0, end: 1200 }], effortMinutes: 45, conceptIds: ['concept-a'], cardIds: ['card-a'], gapIds: ['gap-a'] });
  workspace.transcriptionSegments.push({ id: 'segment-a', lectureId: 'lecture-a', start: 0, end: 900, status: 'verified', method: 'own-words', occurredAt: FIRST, modifiedAt: SECOND, sessionId: 'session-a', reference: 'دفتر 2، صفحة 3' });
  workspace.concepts.push({ id: 'concept-a', courseId: 'course-a', lectureId: 'lecture-a', title: 'Synthetic concept', tag: 'concept-tag' });
  workspace.gaps.push({ id: 'gap-a', lectureId: 'lecture-a', conceptId: 'concept-a', recallAttemptId: 'attempt-a', text: 'Synthetic observation', occurredAt: FIRST });
  workspace.recallAttempts.push({ id: 'attempt-a', lectureId: 'lecture-a', recallId: 'recall-a', occurredAt: FIRST, body: 'Synthetic attempt', expectedIdeas: [{ id: 'idea-a', text: 'Expected synthetic idea' }], studySessionIds: ['session-a'] });
  workspace.assessments.push({ id: 'assessment-a', lectureId: 'lecture-a', conceptId: 'concept-a', recallAttemptId: 'attempt-a', expectedIdeaId: 'idea-a', cardId: 'card-a', kind: 'recall-idea', outcome: 'partial', occurredAt: SECOND, studySessionIds: ['session-a'] });
  workspace.studySettings.push({ id: 'preferences', timezone: 'Asia/Amman', dismissedInsightIds: ['viewed:no-recall:lecture-a'] });
  return validateWorkspace(workspace);
}
const doc = (workspace = richFixture()) => createWorkspaceDocument(workspace, emptyWorkspaceDocument(), FIRST);
const edit = (document, change, now = SECOND) => { const workspace = copy(document.workspace); change(workspace); return createWorkspaceDocument(workspace, document, now); };

test('explicit legacy migration is lossless, idempotent, and does not invent activity or review provenance', () => {
  const workspace = fixture(); workspace.version = 1;
  for (const kind of STUDY_COLLECTIONS) delete workspace[kind];
  workspace.extension = { preserved: ['آمن', { custom: 7 }] };
  const migrated = migrateWorkspace(workspace);
  assert.equal(migrated.version, 2);
  for (const kind of LEGACY_WORKSPACE_COLLECTIONS) assert.deepEqual(migrated[kind], workspace[kind]);
  for (const kind of STUDY_COLLECTIONS) assert.deepEqual(migrated[kind], []);
  assert.deepEqual(migrated.extension, workspace.extension);
  assert.deepEqual(migrateWorkspace(migrated), migrated);
  assert.equal(migrated.reviews[0].preReview, undefined);
  assert.equal(migrated.reviews[0].practiceMode, undefined);
  const legacy = { schemaVersion: 2, workspace, versions: {}, tombstones: {}, safeEnvelopeExtension: { keep: true } };
  for (const kind of LEGACY_WORKSPACE_COLLECTIONS) { legacy.versions[kind] = Object.fromEntries(workspace[kind].map((entry) => [entry.id, FIRST])); legacy.tombstones[kind] = []; }
  const upgraded = migrateWorkspaceDocument(legacy);
  assert.equal(upgraded.schemaVersion, 3);
  assert.deepEqual(upgraded.safeEnvelopeExtension, legacy.safeEnvelopeExtension);
  assert.deepEqual(migrateWorkspaceDocument(upgraded), upgraded);
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(legacy)), upgraded);
  assert.throws(() => validateWorkspace({ ...migrated, version: 3 }), /version/);
  assert.throws(() => validateWorkspaceDocument({ ...upgraded, schemaVersion: 4 }), /schema version/);
  assert.throws(() => validateWorkspaceDocument({ ...upgraded, schemaVersion: 2 }), /requires workspace version 1/);
});

test('all first-class study records round-trip with exact stable IDs, timestamps and versions', () => {
  const document = doc();
  assert.equal(document.schemaVersion, 3);
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(document)), document);
  assert.deepEqual(createWorkspaceDocument(document.workspace, document, THIRD), document);
  assert.equal(document.workspace.studySessions[0].effortMinutes, 45);
  assert.equal(document.workspace.viewingPasses[0].completedAt, null);
  assert.equal(document.workspace.recallAttempts[0].confidence, null);
  assert.equal(document.workspace.assessments[0].confidenceTiming, 'none');
  assert.equal(document.versions.studySessions['session-a'], FIRST);
});

test('range bounds, plans, live references, confidence, timezone and source references fail closed', () => {
  const checks = [
    [(workspace) => { workspace.transcriptionSegments[0].start = -1; }, /start/],
    [(workspace) => { workspace.transcriptionSegments[0].end = 0; }, /after its start/],
    [(workspace) => { workspace.studySessions[0].ranges[0].end = 3601; }, /known lecture duration/],
    [(workspace) => { workspace.lecturePlans[0].durationSeconds = Infinity; }, /invalid number/],
    [(workspace) => { workspace.studySessions[0].effortMinutes = -1; }, /effort minutes/],
    [(workspace) => { workspace.studySessions[0].passId = 'missing'; }, /missing course or lecture/],
    [(workspace) => { workspace.assessments[0].expectedIdeaId = 'missing'; }, /missing course or lecture/],
    [(workspace) => { workspace.recallAttempts[0].confidence = 101; }, /confidence/],
    [(workspace) => { workspace.studySettings[0].timezone = 'Not/AZone'; }, /IANA/],
    [(workspace) => { workspace.transcriptionSegments[0].reference = 'C:\\Users\\someone\\transcript.txt'; }, /absolute machine path/],
    [(workspace) => { workspace.lecturePlans.push({ ...workspace.lecturePlans[0], id: 'plan-b' }); }, /one study plan/],
    [(workspace) => { workspace.viewingPasses[0].status = 'complete'; }, /completion time/],
    [(workspace) => { workspace.gaps[0].status = 'addressed'; workspace.gaps[0].addressedAt = '2026-09-01T10:00:00.000Z'; }, /before it was observed/],
    [(workspace) => { workspace.assessments[0].occurredAt = '2026-09-01T10:00:00.000Z'; }, /session cannot occur after|assessment cannot precede/],
    [(workspace) => { workspace.transcriptionSegments[0].modifiedAt = '2026-09-01T10:00:00.000Z'; }, /cannot precede/],
  ];
  for (const [change, expected] of checks) { const workspace = richFixture(); change(workspace); assert.throws(() => validateWorkspace(workspace), expected); }
  const unknownDuration = richFixture(); unknownDuration.lecturePlans[0].durationSeconds = null; unknownDuration.studySessions[0].ranges[0].end = 10_000;
  assert.doesNotThrow(() => validateWorkspace(unknownDuration));
});

test('original snapshots preserve new collections, and actual lecture deletion cascades with tombstones', () => {
  const previous = doc();
  const originalUi = copy(previous.workspace); originalUi.version = 1;
  for (const kind of STUDY_COLLECTIONS) delete originalUi[kind];
  originalUi.lectures[0].notes = 'Edited in original UI';
  const saved = createWorkspaceDocument(originalUi, previous, SECOND);
  for (const kind of STUDY_COLLECTIONS) assert.deepEqual(saved.workspace[kind], previous.workspace[kind]);
  originalUi.lectures = []; originalUi.cards = []; originalUi.recalls = [];
  const removed = createWorkspaceDocument(originalUi, saved, THIRD);
  for (const kind of STUDY_COLLECTIONS.filter((kind) => kind !== 'studySettings')) {
    assert.deepEqual(removed.workspace[kind], []);
    assert.equal(removed.tombstones[kind].length, previous.workspace[kind].length);
  }
  assert.equal(removed.workspace.reviews.length, 1, 'historical reviews survive deletion');
  assert.equal(removed.workspace.studySettings.length, 1, 'preferences are independent');
});

test('deleting current links keeps underlying observations and clears references without resurrecting parents', () => {
  const base = doc();
  const removed = edit(base, (workspace) => { workspace.concepts = []; workspace.viewingPasses = []; workspace.studySessions = []; workspace.recallAttempts = []; });
  assert.equal(removed.workspace.transcriptionSegments[0].sessionId, '');
  assert.equal(removed.workspace.gaps[0].conceptId, '');
  assert.equal(removed.workspace.gaps[0].recallAttemptId, '');
  assert.equal(removed.workspace.assessments[0].recallAttemptId, '');
  assert.equal(removed.workspace.assessments[0].expectedIdeaId, '');
  assert.deepEqual(removed.workspace.assessments[0].studySessionIds, []);
  assert.equal(removed.workspace.assessments[0].outcome, 'partial');
  const missingIdea = edit(base, (workspace) => { workspace.recallAttempts[0].expectedIdeas = []; });
  assert.equal(missingIdea.workspace.assessments[0].expectedIdeaId, '');
  assert.equal(missingIdea.workspace.assessments[0].outcome, 'partial');
});

test('original lecture moves retain lecture-scoped concepts without rewriting historical review provenance', () => {
  const base = doc();
  const moved = edit(base, (workspace) => {
    workspace.courses.push({ id: 'course-b', title: 'Other synthetic course', description: '', color: 'teal' });
    workspace.lectures[0].courseId = 'course-b'; workspace.cards[0].courseId = 'course-b';
  });
  assert.equal(moved.workspace.concepts[0].courseId, 'course-b');
  assert.equal(moved.workspace.studySessions[0].lectureId, 'lecture-a');
  assert.deepEqual(moved.workspace.reviews, base.workspace.reviews);
  assert.equal(moved.versions.concepts['concept-a'], SECOND);
});

test('two-device study additions merge, repeated sync is stable, and conflicting edits remain visible', () => {
  const baseline = doc();
  const left = edit(baseline, (workspace) => { workspace.studySessions.push({ ...workspace.studySessions[0], id: 'session-left', occurredAt: SECOND, ranges: [{ start: 1200, end: 2400 }] }); });
  const right = edit(baseline, (workspace) => { workspace.studySessions.push({ ...workspace.studySessions[0], id: 'session-right', occurredAt: THIRD, ranges: [{ start: 2400, end: 3600 }] }); }, THIRD);
  const merged = mergeWorkspaceDocuments(left, right, baseline);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.document.workspace.studySessions.length, 3);
  const repeat = mergeWorkspaceDocuments(merged.document, merged.document, merged.document);
  assert.deepEqual(repeat.document, merged.document);
  const local = edit(baseline, (workspace) => { workspace.transcriptionSegments[0].note = 'Local'; });
  const remote = edit(baseline, (workspace) => { workspace.transcriptionSegments[0].note = 'Remote'; }, THIRD);
  const conflict = mergeWorkspaceDocuments(local, remote, baseline);
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.conflicts[0].id, 'transcriptionSegments:segment-a');
  const choice = resolveWorkspaceConflicts(conflict.document, conflict.conflicts, conflict.conflicts[0].id, 'local', THIRD);
  assert.equal(choice.document.workspace.transcriptionSegments[0].note, 'Local');
});

test('lecture deletion racing new study evidence exposes recoverable group choices and cannot resurrect deletion', () => {
  const baseline = doc();
  const local = edit(baseline, (workspace) => { workspace.lectures = []; workspace.cards = []; workspace.recalls = []; });
  const remote = edit(baseline, (workspace) => { workspace.studySessions.push({ ...workspace.studySessions[0], id: 'remote-new-session', occurredAt: THIRD }); workspace.gaps[0].text = 'Remote edited gap'; }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].id, 'lectures:lecture-a');
  assert.doesNotThrow(() => validateWorkspaceDocument(merged.conflicts[0].context.remote));
  const deleted = resolveWorkspaceConflicts(merged.document, merged.conflicts, merged.conflicts[0].id, 'local', THIRD);
  assert.equal(deleted.conflicts.length, 0);
  assert.equal(deleted.document.workspace.studySessions.length, 0);
  assert.ok(deleted.document.tombstones.studySessions.some((entry) => entry.id === 'remote-new-session'));
  const repeat = mergeWorkspaceDocuments(deleted.document, remote, remote);
  assert.equal(repeat.conflicts.length, 0);
  assert.equal(repeat.document.workspace.lectures.length, 0);
  const retained = resolveWorkspaceConflicts(merged.document, merged.conflicts, merged.conflicts[0].id, 'remote', THIRD);
  assert.equal(retained.document.workspace.studySessions.length, 2);
  assert.equal(retained.document.workspace.gaps[0].text, 'Remote edited gap');
});

test('review provenance validates known fields while retaining historical associations after deletion', () => {
  const workspace = richFixture();
  workspace.reviews.push({ id: 'review-new', cardId: 'deleted-card', rating: 1, at: THIRD,
    practiceMode: 'closed-book', preReview: { state: 2, lastReviewAt: FIRST, dueAt: SECOND, scheduledDays: 5, stability: 5, difficulty: 4 },
    association: { courseId: 'deleted-course', lectureId: 'deleted-lecture', conceptIds: ['deleted-concept'], tags: ['old-tag'] },
    studySessionIds: ['deleted-session'], confidence: 60, confidenceTiming: 'before-answer', durationSeconds: 12,
    contentRevision: 'fnv1a32:01234567', snapshotLabels: { courseTitle: 'Historical course', lectureTitle: 'Historical lecture', cardQuestion: 'Historical question?' },
  });
  assert.doesNotThrow(() => validateWorkspace(workspace));
  const bad = copy(workspace); bad.reviews.at(-1).preReview.state = 4;
  assert.throws(() => validateWorkspace(bad), /previous state/);
  const unknownMode = copy(workspace); unknownMode.reviews.at(-1).practiceMode = 'assumed';
  assert.throws(() => validateWorkspace(unknownMode), /practice mode/);
  const zeroDuration = copy(workspace); zeroDuration.reviews.at(-1).durationSeconds = 0;
  assert.throws(() => validateWorkspace(zeroDuration), /duration seconds/);
});
