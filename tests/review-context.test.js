import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceReview } from '../lib/review.js';
import { eligibleReviewStudySessions, reviewContentRevision } from '../lib/review-context.js';
import { advanceSchedule, createInitialSchedule } from '../renderer/site/fsrs-original.js';

const previousAt = '2026-10-01T12:00:00.000Z';
const at = '2026-10-14T12:00:00.000Z';

function fixture() {
  return {
    version: 1,
    courses: [{ id: 'course-1', title: 'اختبار الذاكرة', description: '', color: 'teal' }],
    lectures: [{ id: 'lecture-1', courseId: 'course-1', title: 'التذكّر Retrieval', topic: '', notes: '', pages: [] }],
    cards: [{
      id: 'card-1', courseId: 'course-1', lectureId: 'lecture-1', tags: ['ذاكرة', 'retrieval'], conceptIds: ['concept-1'],
      question: 'ماذا يعني $P(A)$؟', answer: 'احتمال A؛ استرجع قبل الكشف.', source: '', createdAt: previousAt,
      schedule: advanceSchedule(createInitialSchedule(new Date(previousAt)), 4, new Date(previousAt)),
    }],
    recalls: [], reviews: [], studySessions: [],
  };
}

function session(id, changes = {}) {
  return { id, lectureId: 'lecture-1', occurredAt: '2026-10-13T12:00:00.000Z', activities: ['viewing'], passId: '', ranges: [],
    effortMinutes: null, reason: '', note: '', conceptIds: [], cardIds: [], gapIds: [], ...changes };
}

test('review captures pre-attempt scheduler evidence and historical associations without changing FSRS', () => {
  const workspace = fixture();
  const scheduleBefore = structuredClone(workspace.cards[0].schedule);
  const reviewed = applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 3, now: at, operationId: 'attempt-1', context: { practiceMode: 'closed-book' } });
  const record = reviewed.reviews[0];
  assert.deepEqual(reviewed.cards[0].schedule, advanceSchedule(scheduleBefore, 3, new Date(at)));
  assert.deepEqual(record.preReview, { state: 2, lastReviewAt: previousAt, dueAt: scheduleBefore.due,
    scheduledDays: scheduleBefore.scheduled_days, stability: scheduleBefore.stability, difficulty: scheduleBefore.difficulty });
  assert.deepEqual(record.association, { courseId: 'course-1', lectureId: 'lecture-1', tags: ['ذاكرة', 'retrieval'], conceptIds: ['concept-1'] });
  assert.equal(record.cardCreatedAt, previousAt);
  assert.equal(record.contentRevision, reviewContentRevision(workspace.cards[0]));
  assert.deepEqual(record.snapshotLabels, { courseTitle: 'اختبار الذاكرة', lectureTitle: 'التذكّر Retrieval', cardQuestion: 'ماذا يعني $P(A)$؟' });
  reviewed.cards[0].question = 'Edited later';
  reviewed.cards[0].courseId = 'another-course';
  reviewed.cards[0].tags.push('later');
  reviewed.courses = [];
  reviewed.lectures = [];
  reviewed.cards = [];
  assert.equal(record.association.courseId, 'course-1');
  assert.deepEqual(record.association.tags, ['ذاكرة', 'retrieval']);
  assert.equal(record.snapshotLabels.cardQuestion, 'ماذا يعني $P(A)$؟');
  assert.deepEqual(workspace.cards[0].schedule, scheduleBefore);
  assert.equal(workspace.reviews.length, 0);
});

test('legacy reviews remain unchanged, and unspecified practice mode never becomes known closed-book evidence', () => {
  const workspace = fixture();
  const legacy = { id: 'legacy-1', cardId: 'card-1', rating: 2, at: previousAt };
  workspace.reviews.push(legacy);
  const reviewed = applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 3, now: at });
  assert.deepEqual(reviewed.reviews[0], legacy);
  assert.equal(Object.hasOwn(reviewed.reviews[1], 'practiceMode'), false);
  assert.equal(reviewed.reviews[1].confidence, null);
  assert.equal(reviewed.reviews[1].confidenceTiming, 'none');
  assert.equal(Object.hasOwn(reviewed.reviews[1], 'durationSeconds'), false);
  assert.equal(Object.hasOwn(reviewed.reviews[1], 'studySessionIds'), false);
  reviewed.reviews[0].rating = 4;
  assert.equal(workspace.reviews[0].rating, 2);
});

test('a failure followed by same-day relearning preserves the first delayed failure context', () => {
  const workspace = fixture();
  const failed = applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 1, now: at, operationId: 'failure', context: { practiceMode: 'closed-book' } });
  const succeeded = applyWorkspaceReview(failed, { cardId: 'card-1', rating: 3, now: '2026-10-14T12:05:00.000Z', operationId: 'relearning', context: { practiceMode: 'closed-book' } });
  assert.equal(succeeded.reviews[0].rating, 1);
  assert.equal(succeeded.reviews[0].preReview.state, 2);
  assert.equal(succeeded.reviews[0].preReview.lastReviewAt, previousAt);
  assert.equal(succeeded.reviews[1].preReview.state, 3);
  assert.equal(succeeded.reviews[1].preReview.lastReviewAt, at);
});

test('before-answer confidence accepts zero and 100; unrelated post-answer confidence cannot enter review evidence', () => {
  for (const confidence of [0, 100, 62.5]) {
    const reviewed = applyWorkspaceReview(fixture(), { cardId: 'card-1', rating: 2, now: at, context: { practiceMode: 'closed-book', confidence, confidenceTiming: 'before-answer' } });
    assert.equal(reviewed.reviews[0].confidence, confidence);
    assert.equal(reviewed.reviews[0].confidenceTiming, 'before-answer');
  }
  for (const context of [
    { confidence: -1, confidenceTiming: 'before-answer' }, { confidence: 101, confidenceTiming: 'before-answer' },
    { confidence: NaN, confidenceTiming: 'before-answer' }, { confidence: 50 },
    { confidence: 50, confidenceTiming: 'none' }, { confidence: 50, confidenceTiming: 'after-answer' },
    { confidence: null, confidenceTiming: 'before-answer' }, { confidenceTiming: 'after-answer' },
  ]) assert.throws(() => applyWorkspaceReview(fixture(), { cardId: 'card-1', rating: 3, now: at, context }), /confidence|Confidence/);
});

test('practice mode and duration remain optional context; metadata never changes scheduler output', () => {
  const base = fixture();
  const expected = advanceSchedule(base.cards[0].schedule, 3, new Date(at));
  for (const practiceMode of ['closed-book', 'open-book', 'revealed']) {
    const reviewed = applyWorkspaceReview(base, { cardId: 'card-1', rating: 3, now: at, practiceMode, durationSeconds: 42.5 });
    assert.equal(reviewed.reviews[0].practiceMode, practiceMode);
    assert.equal(reviewed.reviews[0].durationSeconds, 42.5);
    assert.deepEqual(reviewed.cards[0].schedule, expected);
  }
  for (const durationSeconds of [0, -1, NaN, Infinity, '60']) assert.throws(() => applyWorkspaceReview(base, { cardId: 'card-1', rating: 3, now: at, context: { durationSeconds } }), /duration/);
  assert.throws(() => applyWorkspaceReview(base, { cardId: 'card-1', rating: 3, now: at, context: { practiceMode: 'guessed' } }), /practice mode/);
  assert.throws(() => applyWorkspaceReview(base, { cardId: 'card-1', rating: 3, now: at, context: { preReview: { state: 2 } } }), /unsupported fields/);
});

test('session choices are explicit, prior, associated, clone-safe, and support genuine long delays', () => {
  const workspace = fixture();
  workspace.studySessions = [
    session('recent'), session('old', { occurredAt: '2026-01-01T12:00:00.000Z' }),
    session('future', { occurredAt: '2026-10-15T12:00:00.000Z' }),
    session('unrelated', { lectureId: 'other' }),
    session('by-card', { lectureId: 'other', cardIds: ['card-1'] }),
    session('by-concept', { lectureId: 'other', conceptIds: ['concept-1'] }),
  ];
  const recent = eligibleReviewStudySessions(workspace, 'card-1', { now: at });
  assert.deepEqual(recent.map((entry) => entry.id), ['by-card', 'by-concept', 'recent']);
  recent[0].activities.push('memory');
  assert.deepEqual(workspace.studySessions.find((entry) => entry.id === 'by-card').activities, ['viewing']);
  assert.equal(eligibleReviewStudySessions(workspace, 'card-1', { now: at, recentDays: null }).length, 4);
  const selected = applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 3, now: at, context: { studySessionIds: ['old', 'by-card'] } });
  assert.deepEqual(selected.reviews[0].studySessionIds, ['old', 'by-card']);
  const noSelection = applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 3, now: at });
  assert.equal(Object.hasOwn(noSelection.reviews[0], 'studySessionIds'), false);
  for (const studySessionIds of [['future'], ['unrelated'], ['missing'], ['recent', 'recent'], 'recent', ['__proto__']]) {
    assert.throws(() => applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 3, now: at, context: { studySessionIds } }), /study session/);
  }
});

test('retrying an operation never duplicates history or advances the scheduler, including after card deletion', () => {
  const first = applyWorkspaceReview(fixture(), { cardId: 'card-1', rating: 3, now: at, operationId: 'retry-1', context: { practiceMode: 'closed-book' } });
  const retry = applyWorkspaceReview(first, { cardId: 'card-1', rating: 3, now: '2026-10-15T12:00:00.000Z', operationId: 'retry-1' });
  assert.deepEqual(retry, first);
  assert.equal(retry.reviews.length, 1);
  assert.equal(retry.reviews[0].operationId, 'retry-1');
  const deleted = { ...first, cards: [] };
  assert.deepEqual(applyWorkspaceReview(deleted, { cardId: 'card-1', rating: 3, now: at, operationId: 'retry-1' }), deleted);
  assert.throws(() => applyWorkspaceReview(first, { cardId: 'card-1', rating: 1, now: at, operationId: 'retry-1' }), /different attempt/);
  assert.throws(() => applyWorkspaceReview(first, { cardId: 'another-card', rating: 3, now: at, operationId: 'retry-1' }), /different attempt/);
});

test('content revision follows exact question and answer, independently of later tags and associations', () => {
  const card = fixture().cards[0];
  const original = reviewContentRevision(card);
  assert.match(original, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(reviewContentRevision(structuredClone(card)), original);
  assert.equal(reviewContentRevision({ ...card, courseId: 'other', tags: [] }), original);
  assert.notEqual(reviewContentRevision({ ...card, question: `${card.question} الآن` }), original);
  assert.notEqual(reviewContentRevision({ ...card, answer: `${card.answer} revised` }), original);
});

test('image and occlusion revisions include content and image order while preserving text-only fingerprints', () => {
  const card = fixture().cards[0];
  const textOnly = reviewContentRevision(card);
  assert.equal(reviewContentRevision({ ...card, questionImages: [], answerImages: [] }), textOnly);
  const illustrated = { ...card, questionImages: [{ mediaId: 'a'.repeat(64), description: 'رسم' }, { mediaId: 'b'.repeat(64), description: '' }], answerImages: [] };
  const original = reviewContentRevision(illustrated);
  assert.notEqual(original, textOnly);
  assert.notEqual(reviewContentRevision({ ...illustrated, questionImages: [...illustrated.questionImages].reverse() }), original);
  assert.notEqual(reviewContentRevision({ ...illustrated, answerImages: [illustrated.questionImages[0]] }), original);
  assert.notEqual(reviewContentRevision({ ...illustrated, questionImages: [{ ...illustrated.questionImages[0], description: 'new meaning' }, illustrated.questionImages[1]] }), original);
  const occluded = { ...card, question: '', answer: '', occlusion: { mediaId: 'a'.repeat(64), regions: [{ id: 'region-1', x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: 'عضو' }], targetRegionId: 'region-1', hideOthers: false } };
  const masked = reviewContentRevision(occluded);
  assert.notEqual(reviewContentRevision({ ...occluded, occlusion: { ...occluded.occlusion, hideOthers: true } }), masked);
  assert.notEqual(reviewContentRevision({ ...occluded, occlusion: { ...occluded.occlusion, regions: [{ ...occluded.occlusion.regions[0], x: 0.2 }] } }), masked);
  const workspace = fixture();
  workspace.cards = [occluded];
  const reviewed = applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 3, now: at });
  assert.equal(reviewed.reviews[0].snapshotLabels.cardQuestion, '(Image occlusion card)');
  assert.equal(reviewed.reviews[0].contentRevision, masked);
});
