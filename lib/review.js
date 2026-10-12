import { advanceSchedule } from '../renderer/site/fsrs-original.js';

/** Keep the original site's FSRS rules and append the original review log format. */
export function applyWorkspaceReview(workspace, { cardId, rating, now = new Date(), operationId } = {}) {
  if (typeof cardId !== 'string' || !Number.isInteger(rating) || rating < 1 || rating > 4) throw new Error('A card and a rating from 1 to 4 are required.');
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid review date.');
  const index = workspace.cards.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error('The reviewed card no longer exists.');
  const cards = structuredClone(workspace.cards);
  const card = cards[index];
  card.schedule = advanceSchedule(card.schedule, rating, date);
  card.updatedAt = date.toISOString();
  const review = { id: operationId || globalThis.crypto.randomUUID(), cardId, rating, at: date.toISOString() };
  return { ...structuredClone(workspace), cards, reviews: [...workspace.reviews, review] };
}
