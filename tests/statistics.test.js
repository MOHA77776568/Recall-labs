import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatistics, delayedRecallObservations } from '../lib/statistics.js';
import { logViewing } from '../lib/study.js';

const NOW = '2026-10-14T09:00:00.000Z';
function workspace() {
  return { version: 2, courses: [{ id: 'course', title: 'Synthetic course' }, { id: 'other', title: 'Other synthetic course' }], lectures: [{ id: 'lecture', courseId: 'course', title: 'Synthetic lecture' }, { id: 'other-lecture', courseId: 'other', title: 'Other synthetic lecture' }], cards: [], recalls: [], reviews: [], lecturePlans: [{ id: 'plan', lectureId: 'lecture', durationSeconds: 3600, baselineCompleteCount: 0, transcriptionScope: 'none', targetRanges: [], transcriptionMethod: 'verbatim' }], viewingPasses: [], studySessions: [], transcriptionSegments: [], concepts: [], gaps: [], recallAttempts: [], assessments: [], studySettings: [] };
}
function review(id, at, rating = 3, input = {}) {
  return { id, cardId: 'card', rating, at, practiceMode: 'closed-book', preReview: { state: 2, lastReviewAt: '2026-10-01T08:00:00.000Z', dueAt: at, scheduledDays: 5, stability: 4, difficulty: 6 }, association: { courseId: 'course', lectureId: 'lecture', conceptIds: [], tags: [] }, ...input };
}
function card(id, due, input = {}) { return { id, courseId: 'course', lectureId: 'lecture', question: 'Synthetic question', tags: [], schedule: { due }, ...input }; }
function session(id, at, activities = ['viewing'], input = {}) { return { id, lectureId: 'lecture', occurredAt: at, activities, passId: '', ranges: [], effortMinutes: null, reason: '', note: '', conceptIds: [], cardIds: [], gapIds: [], ...input }; }
function assessment(id, outcome, input = {}) { return { id, lectureId: 'lecture', conceptId: '', recallAttemptId: '', expectedIdeaId: '', cardId: '', kind: 'application', outcome, occurredAt: '2026-10-13T09:00:00.000Z', note: '', confidence: null, confidenceTiming: 'none', studySessionIds: [], ...input }; }

test('shared watching and transcription effort is counted once with two activity labels', () => {
  const value = workspace(); value.studySessions = [session('shared', NOW, ['viewing', 'transcription'], { effortMinutes: 45 }), session('unknown', NOW, ['notes'])];
  const result = buildStatistics(value, { now: NOW });
  assert.equal(result.activity.sessionCount, 2); assert.equal(result.activity.effortMinutes, 45); assert.equal(result.activity.activityCounts.viewing, 1); assert.equal(result.activity.activityCounts.transcription, 1);
  assert.equal(result.activity.knownEffortSessionCount, 1); assert.equal(result.activity.unknownEffortSessionCount, 1); assert.equal(result.activity.calendar[0].sessionCount, 2);
});

test('failed first eligible delayed review cannot be inflated by same-day successes', () => {
  const value = workspace(); value.reviews = [review('failed', '2026-10-13T08:00:00.000Z', 1), review('success', '2026-10-13T09:00:00.000Z', 3), review('learning', '2026-10-13T09:05:00.000Z', 4, { preReview: { state: 3, lastReviewAt: '2026-10-13T09:00:00.000Z' } })];
  const result = buildStatistics(value, { now: NOW });
  assert.equal(result.reviews.totalAttempts, 3); assert.equal(result.reviews.delayed.denominator, 1); assert.equal(result.reviews.delayed.numerator, 0); assert.equal(result.reviews.delayed.percent, 0);
  assert.equal(result.reviews.delayed.records[0].id, 'failed'); assert.equal(result.reviews.delayed.excludedCounts['later-same-day-eligible'], 1);
});

test('legacy, learning, short-delay, and open-book reviews have explicit exclusion reasons', () => {
  const value = workspace(); value.reviews = [{ id: 'legacy', cardId: 'card', rating: 3, at: '2026-10-13T08:00:00.000Z' }, review('initial', '2026-10-13T09:00:00.000Z', 3, { cardId: 'initial', preReview: { state: 0, lastReviewAt: null } }), review('short', '2026-10-13T09:00:00.000Z', 3, { cardId: 'short', preReview: { state: 2, lastReviewAt: '2026-10-12T10:00:00.000Z' } }), review('open', '2026-10-13T09:00:00.000Z', 3, { cardId: 'open', practiceMode: 'open-book' }), review('unknown', '2026-10-13T09:00:00.000Z', 3, { cardId: 'unknown', preReview: { state: 2, lastReviewAt: null } })];
  const result = buildStatistics(value, { now: NOW });
  assert.equal(result.reviews.totalAttempts, 5); assert.equal(result.reviews.legacyCount, 1); assert.equal(result.reviews.delayed.denominator, 0); assert.equal(result.reviews.delayed.percent, null);
  assert.deepEqual(result.reviews.delayed.excludedCounts, { 'unknown-context': 1, 'initial-learning-or-relearning': 1, 'less-than-24-hours': 1, 'open-book-or-revealed': 1, 'unknown-previous-review': 1 });
});

test('24 hours is eligible exactly and local days split at Amman midnight', () => {
  const reviews = [review('a', '2026-10-12T20:59:59.000Z', 1, { preReview: { state: 2, lastReviewAt: '2026-10-11T20:59:59.000Z' } }), review('b', '2026-10-12T21:00:00.000Z', 3, { preReview: { state: 2, lastReviewAt: '2026-10-11T20:59:59.000Z' } })];
  const result = delayedRecallObservations(reviews);
  assert.equal(result.records.length, 2); assert.deepEqual(result.records.map((entry) => entry.localDate), ['2026-10-12', '2026-10-13']);
});

test('calendar filters are inclusive in configured timezone and snapshots disclose independent scope', () => {
  const value = workspace(); value.studySessions = [session('before', '2026-10-12T20:59:59.000Z'), session('inside', '2026-10-12T21:00:00.000Z'), session('end', '2026-10-13T20:59:59.000Z'), session('after', '2026-10-13T21:00:00.000Z')]; value.cards = [card('due', '2026-10-14T10:00:00.000Z')];
  const result = buildStatistics(value, { from: '2026-10-13', to: '2026-10-13', now: NOW });
  assert.deepEqual(result.activity.sessions.map((entry) => entry.id), ['inside', 'end']); assert.equal(result.schedule.dueNext7, 1); assert.equal(result.schedule.currentSnapshot, true); assert.equal(result.matrix[0].currentSnapshot, true);
});

test('historical review snapshots survive moved and deleted cards without attributing legacy history', () => {
  const value = workspace(); value.cards = [card('card', NOW, { courseId: 'other', lectureId: 'other-lecture' })]; value.reviews = [review('snapshot', '2026-10-13T08:00:00.000Z'), { id: 'legacy', cardId: 'card', rating: 3, at: '2026-10-13T09:00:00.000Z' }];
  let result = buildStatistics(value, { courseId: 'course', now: NOW }); assert.equal(result.reviews.totalAttempts, 1); assert.equal(result.reviews.records[0].id, 'snapshot'); assert.equal(result.reviews.unknownAssociationCount, 1);
  value.cards = []; result = buildStatistics(value, { lectureId: 'lecture', now: NOW }); assert.equal(result.reviews.delayed.denominator, 1); assert.equal(result.schedule.records.length, 0);
});

test('course, lecture, and concept filters count the same contributing sessions and outcomes', () => {
  const value = workspace(); value.concepts = [{ id: 'concept', courseId: 'course', lectureId: 'lecture', title: 'Synthetic idea', tag: 'idea' }]; value.studySessions = [session('linked', NOW, ['memory'], { conceptIds: ['concept'] }), session('unlinked', NOW)]; value.reviews = [review('linked-review', '2026-10-13T08:00:00.000Z', 3, { association: { courseId: 'course', lectureId: 'lecture', conceptIds: ['concept'], tags: ['idea'] } }), review('unlinked-review', '2026-10-13T08:00:00.000Z', 1, { cardId: 'other-card' })];
  const result = buildStatistics(value, { courseId: 'course', lectureId: 'lecture', conceptId: 'concept', now: NOW });
  assert.equal(result.activity.sessionCount, 1); assert.equal(result.reviews.totalAttempts, 1); assert.equal(result.reviews.delayed.numerator, 1); assert.equal(result.reviews.delayed.denominator, 1); assert.equal(result.matrix.length, 1);
});

test('expected idea coverage requires an explicit denominator and never turns unassessed into failure', () => {
  const value = workspace(); value.recallAttempts = [{ id: 'attempt', lectureId: 'lecture', occurredAt: '2026-10-13T08:00:00.000Z', expectedIdeas: [{ id: 'one', text: 'Idea one' }, { id: 'two', text: 'Idea two' }, { id: 'three', text: 'Idea three' }], confidence: null, confidenceTiming: 'none' }]; value.assessments = [assessment('one', 'correct', { recallAttemptId: 'attempt', expectedIdeaId: 'one', kind: 'recall-idea' }), assessment('two', 'partial', { recallAttemptId: 'attempt', expectedIdeaId: 'two', kind: 'recall-idea' })];
  let result = buildStatistics(value, { now: NOW }); assert.equal(result.evidence.expectedIdeas.numerator, 1); assert.equal(result.evidence.expectedIdeas.denominator, 3); assert.equal(result.evidence.expectedIdeas.notAssessedCount, 1); assert.equal(result.evidence.assessedCount, 2);
  value.recallAttempts[0].expectedIdeas = []; result = buildStatistics(value, { now: NOW }); assert.equal(result.evidence.expectedIdeas.percent, null); assert.equal(result.evidence.assessments.length, 2);
});

test('confidence needs a corresponding outcome captured before checking, not after-study clarity', () => {
  const value = workspace(); value.reviews = [review('before', '2026-10-13T08:00:00.000Z', 1, { confidence: 90, confidenceTiming: 'before-answer' }), review('after', '2026-10-13T09:00:00.000Z', 4, { cardId: 'other-card', confidence: 90, confidenceTiming: 'none' }), review('open', '2026-10-13T09:00:00.000Z', 3, { cardId: 'open', confidence: 90, confidenceTiming: 'before-answer', practiceMode: 'revealed' })]; value.assessments = [assessment('unknown', 'not-assessed', { confidence: 80, confidenceTiming: 'before' }), assessment('scored', 'correct', { confidence: 24.5, confidenceTiming: 'before' })];
  const result = buildStatistics(value, { now: NOW }); assert.equal(result.confidence.sampleSize, 2); assert.equal(result.confidence.buckets[0].sampleSize, 1); assert.equal(result.confidence.buckets[3].passPercent, 0);
});

test('free-recall confidence pairs only once all explicitly expected ideas have scored observations', () => {
  const value = workspace(); value.recallAttempts = [{ id: 'attempt', lectureId: 'lecture', occurredAt: '2026-10-13T08:00:00.000Z', expectedIdeas: [{ id: 'one', text: 'Idea one' }, { id: 'two', text: 'Idea two' }], confidence: 75, confidenceTiming: 'before' }]; value.assessments = [assessment('one', 'correct', { recallAttemptId: 'attempt', expectedIdeaId: 'one' })];
  assert.equal(buildStatistics(value, { now: NOW }).confidence.sampleSize, 0);
  value.assessments.push(assessment('two', 'partial', { recallAttemptId: 'attempt', expectedIdeaId: 'two' }));
  const result = buildStatistics(value, { now: NOW }); assert.equal(result.confidence.sampleSize, 1); assert.equal(result.confidence.pairs[0].outcomeScore, 0.75);
});

test('expected ideas without any assessment have no performance percentage', () => {
  const value = workspace(); value.recallAttempts = [{ id: 'attempt', lectureId: 'lecture', occurredAt: '2026-10-13T08:00:00.000Z', expectedIdeas: [{ id: 'one', text: 'Idea one' }], confidence: null, confidenceTiming: 'none' }];
  const result = buildStatistics(value, { now: NOW });
  assert.equal(result.evidence.expectedIdeas.denominator, 1); assert.equal(result.evidence.expectedIdeas.notAssessedCount, 1); assert.equal(result.evidence.expectedIdeas.assessedCount, 0); assert.equal(result.evidence.expectedIdeas.percent, null);
});

test('method comparisons require explicit prior links and preserve mixed labels and test delay', () => {
  const value = workspace(); value.studySessions = [session('shared', '2026-10-10T09:00:00.000Z', ['viewing', 'transcription'], { effortMinutes: 45 }), session('memory', '2026-10-11T09:00:00.000Z', ['memory'])]; value.reviews = [review('linked', '2026-10-13T09:00:00.000Z', 3, { studySessionIds: ['shared', 'memory'] }), review('unlinked', '2026-10-13T09:00:00.000Z', 1, { cardId: 'other-card' })];
  const result = buildStatistics(value, { now: NOW }); assert.equal(result.methods.groups.length, 1); assert.equal(result.methods.groups[0].method, 'mixed:memory+transcription+viewing'); assert.equal(result.methods.groups[0].meanDelayHours, 48); assert.equal(result.methods.groups[0].sampleSize, 1); assert.equal(result.methods.missingLinkedOutcomes, 1); assert.equal(result.methods.observational, true);
  assert.equal(result.methods.groups[0].records[0].difficulty, 6);
});

test('application outcomes have a separate linked analysis path from flashcard self-ratings', () => {
  const value = workspace(); value.studySessions = [session('application', '2026-10-12T09:00:00.000Z', ['application'])]; value.assessments = [assessment('new-problem', 'correct', { studySessionIds: ['application'] }), assessment('not-assessed', 'not-assessed', { studySessionIds: ['application'] })];
  const result = buildStatistics(value, { now: NOW }); assert.equal(result.methods.groups.length, 1); assert.equal(result.methods.groups[0].outcomeType, 'assessment'); assert.equal(result.methods.groups[0].sampleSize, 1); assert.equal(result.methods.groups[0].meanDelayHours, 24); assert.equal(result.evidence.notAssessedCount, 1);
});

test('upcoming schedule uses current due dates, 7/30 local dates, and disclosed overdue groups', () => {
  const value = workspace(); value.cards = [card('overdue', '2026-10-01T08:00:00.000Z'), card('today', '2026-10-14T10:00:00.000Z'), card('seventh', '2026-10-20T20:59:59.000Z'), card('eighth', '2026-10-20T21:00:00.000Z'), card('thirtieth', '2026-11-12T20:59:59.000Z'), card('later', '2026-11-12T21:00:00.000Z')];
  const result = buildStatistics(value, { now: NOW }); assert.equal(result.schedule.overdue, 1); assert.equal(result.schedule.dueNext7, 2); assert.equal(result.schedule.dueNext30, 4); assert.equal(result.schedule.overdueBreakdown.find((entry) => entry.label === '7–30 days').count, 1);
});

test('forgotten-card rule needs 3 failures across 2 local days; insights are explainable and dismissible', () => {
  let value = workspace(); value.cards = [card('card', NOW)]; value.reviews = [review('one', '2026-10-12T08:00:00.000Z', 1), review('two', '2026-10-12T09:00:00.000Z', 1), review('three', '2026-10-13T08:00:00.000Z', 1)];
  value = logViewing(value, { lectureId: 'lecture', occurredAt: NOW, complete: true });
  let result = buildStatistics(value, { now: NOW }); assert.equal(result.reviews.forgottenCards.length, 1); assert.equal(result.reviews.forgottenCards[0].dayCount, 2); assert.equal(result.insights.some((entry) => entry.type === 'unrecorded-recall'), true);
  value.studySettings = [{ id: 'preferences', timezone: 'Asia/Amman', dismissedInsightIds: ['forgotten-card:card', 'unrecorded-recall:lecture'] }]; result = buildStatistics(value, { now: NOW }); assert.equal(result.insights.length, 0);
});

test('period activity excludes undated historical baseline; current progress is explicitly labeled', () => {
  let value = workspace(); value.lecturePlans[0].baselineCompleteCount = 3;
  value = logViewing(value, { lectureId: 'lecture', occurredAt: '2026-09-01T09:00:00.000Z', complete: true });
  const result = buildStatistics(value, { from: '2026-10-01', to: '2026-10-14', now: NOW });
  assert.equal(result.activity.sessionCount, 0); assert.equal(result.matrix[0].viewing.completedPassCount, 4); assert.equal(result.matrix[0].period.sessionCount, 0); assert.equal(result.matrix[0].currentSnapshot, true);
});

test('empty workspaces have null evidence percentages and no invented insight', () => {
  const value = workspace(); const result = buildStatistics(value, { now: NOW });
  assert.equal(result.reviews.delayed.percent, null); assert.equal(result.evidence.expectedIdeas.percent, null); assert.equal(result.confidence.sampleSize, 0); assert.equal(result.methods.groups.length, 0); assert.equal(result.insights.length, 0);
  assert.equal(result.matrix[0].viewing.completedPassCount, 0); assert.equal(result.matrix[0].transcription.writtenPercent, null);
});

test('current open gaps and dated evidence are distinct, and addressed does not imply rechecked', () => {
  const value = workspace(); value.gaps = [{ id: 'open', lectureId: 'lecture', text: 'Synthetic gap', status: 'open', occurredAt: '2026-09-01T09:00:00.000Z', addressedAt: null, recheckedAt: null }, { id: 'addressed', lectureId: 'lecture', text: 'Another synthetic gap', status: 'addressed', occurredAt: '2026-09-01T09:00:00.000Z', addressedAt: '2026-10-13T09:00:00.000Z', recheckedAt: null }];
  const result = buildStatistics(value, { from: '2026-10-13', to: '2026-10-13', now: NOW }); assert.equal(result.matrix[0].openGapCount, 1); assert.equal(result.matrix[0].unrecheckedGapCount, 2); assert.equal(result.activity.history.filter((entry) => entry.type === 'gap-addressed').length, 1); assert.equal(result.insights.filter((entry) => entry.type === 'unrechecked-gap').length, 2);
});
