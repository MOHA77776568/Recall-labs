import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSchedule } from '../renderer/site/fsrs-original.js';
import { applyWorkspaceReview } from '../lib/review.js';

const now = new Date('2026-10-12T12:00:00.000Z');
const card = { id: 'card-1', courseId: 'course-1', lectureId: '', tags: [], createdAt: now.toISOString(), question: 'What is retrieval practice?', answer: 'Recall the answer before looking.', schedule: createInitialSchedule(now) };
const workspace = { version: 1, courses: [], lectures: [], recalls: [], reviews: [], cards: [card] };

test('original FSRS review preserves content and appends rating history with reproducible due dates', () => {
  const again = applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 1, now, operationId: 'review-1' });
  const easy = applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 4, now, operationId: 'review-4' });
  assert.equal(again.cards[0].schedule.reps, 1);
  assert.equal(again.cards[0].schedule.due, '2026-10-12T12:01:00.000Z');
  assert.equal(easy.cards[0].schedule.due, '2026-10-20T12:00:00.000Z');
  assert.equal(again.reviews[0].id, 'review-1');
  assert.equal(again.reviews[0].cardId, 'card-1');
  assert.equal(again.reviews[0].rating, 1);
  assert.equal(again.reviews[0].at, now.toISOString());
  assert.deepEqual(again.reviews[0].preReview, { state: 0, lastReviewAt: null, dueAt: now.toISOString(), scheduledDays: 0, stability: 0, difficulty: 0 });
  assert.equal(again.cards[0].question, card.question);
  assert.equal(workspace.cards[0].schedule.reps, 0);
  assert.equal(workspace.reviews.length, 0);
});

test('invalid or missing-card review requests leave data intact', () => {
  assert.throws(() => applyWorkspaceReview(workspace, { cardId: 'missing', rating: 3, now }), /no longer exists/);
  assert.throws(() => applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 0, now }), /rating/);
  assert.throws(() => applyWorkspaceReview(workspace, { cardId: 'card-1', rating: 3, now: 'invalid' }), /date/);
  assert.equal(workspace.reviews.length, 0);
});
