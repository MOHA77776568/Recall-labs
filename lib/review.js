import { advanceSchedule } from '../renderer/site/fsrs-original.js';
import { captureReviewProvenance } from './review-context.js';

/** Keep the original FSRS rules; record attempt evidence before advancing it. */
export function applyWorkspaceReview(workspace, options = {}) {
  const { cardId, rating, now = new Date(), operationId, context } = options;
  if (typeof cardId !== 'string' || !Number.isInteger(rating) || rating < 1 || rating > 4) throw new Error('A card and a rating from 1 to 4 are required.');
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid review date.');
  if (operationId !== undefined && (typeof operationId !== 'string' || !operationId || operationId.length > 100 || /[\u0000-\u001f\u007f]/.test(operationId))) throw new Error('Invalid review operation ID.');
  if (operationId) {
    const prior = workspace.reviews.find((entry) => entry.id === operationId || entry.operationId === operationId);
    if (prior) {
      if (prior.cardId !== cardId || prior.rating !== rating) throw new Error('This review operation ID was already used for a different attempt.');
      return structuredClone(workspace);
    }
  }
  const index = workspace.cards.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error('The reviewed card no longer exists.');
  const cards = structuredClone(workspace.cards);
  const card = cards[index];
  // Adapters use nested context; flattened fields remain convenient for callers.
  const reviewContext = context === undefined ? Object.fromEntries(['practiceMode', 'confidence', 'confidenceTiming', 'durationSeconds', 'studySessionIds']
    .filter((key) => options[key] !== undefined).map((key) => [key, options[key]])) : context;
  const provenance = captureReviewProvenance(workspace, card, reviewContext, date);
  card.schedule = advanceSchedule(card.schedule, rating, date);
  card.updatedAt = date.toISOString();
  const review = { id: operationId || globalThis.crypto.randomUUID(), cardId, rating, at: date.toISOString(), ...provenance };
  if (operationId) review.operationId = operationId;
  return { ...structuredClone(workspace), cards, reviews: [...structuredClone(workspace.reviews), review] };
}
