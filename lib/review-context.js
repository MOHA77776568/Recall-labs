const PRACTICE_MODES = new Set(['closed-book', 'open-book', 'revealed']);
const CONTEXT_FIELDS = new Set(['practiceMode', 'confidence', 'confidenceTiming', 'durationSeconds', 'studySessionIds']);
const ID_CONTROLS = /[\u0000-\u001f\u007f]/;

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && !ID_CONTROLS.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value);
}

function reviewDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid review date.');
  return date;
}

/** A portable change fingerprint, not an authentication or security hash. */
export function reviewContentRevision(card) {
  const content = [card.question, card.answer];
  const questionImages = card.questionImages ?? [];
  const answerImages = card.answerImages ?? [];
  if (questionImages.length || answerImages.length || card.occlusion) {
    const face = (images) => images.map((image) => ({ mediaId: image.mediaId, description: image.description ?? '' }));
    content.push(face(questionImages), face(answerImages), card.occlusion ? {
      mediaId: card.occlusion.mediaId,
      regions: card.occlusion.regions.map((region) => ({ id: region.id, x: region.x, y: region.y, width: region.width, height: region.height, label: region.label ?? '' })),
      targetRegionId: card.occlusion.targetRegionId,
      hideOthers: card.occlusion.hideOthers,
    } : null);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function isAssociatedSession(session, card) {
  return Boolean((card.lectureId && session.lectureId === card.lectureId)
    || session.cardIds?.includes(card.id)
    || (card.conceptIds ?? []).some((id) => session.conceptIds?.includes(id)));
}

/**
 * Offer explicitly associated past sessions to the UI. No session is linked by
 * inference: the user still selects IDs. The 30-day window is just a display
 * convenience; recentDays:null includes all recorded prior sessions.
 */
export function eligibleReviewStudySessions(workspace, cardId, { now = new Date(), recentDays = 30 } = {}) {
  const date = reviewDate(now);
  if (recentDays !== null && (!Number.isFinite(recentDays) || recentDays < 0)) throw new Error('Invalid session lookup window.');
  const card = workspace.cards.find((entry) => entry.id === cardId);
  if (!card) return [];
  const earliest = recentDays === null ? -Infinity : date.getTime() - recentDays * 86_400_000;
  return (workspace.studySessions ?? []).filter((session) => {
    const occurredAt = Date.parse(session.occurredAt);
    return Number.isFinite(occurredAt) && occurredAt >= earliest && occurredAt <= date.getTime() && isAssociatedSession(session, card);
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id)).map((session) => structuredClone(session));
}

/** Validate user-provided context separately from scheduler-owned provenance. */
export function normalizeReviewContext(workspace, cardId, context = {}, now = new Date()) {
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(context))) throw new Error('Review context must be an object.');
  if (Object.keys(context).some((key) => !CONTEXT_FIELDS.has(key))) throw new Error('Review context contains unsupported fields.');
  const result = { confidence: null, confidenceTiming: 'none' };
  if (context.practiceMode !== undefined) {
    if (!PRACTICE_MODES.has(context.practiceMode)) throw new Error('Invalid review practice mode.');
    result.practiceMode = context.practiceMode;
  }
  if (context.confidence !== undefined && context.confidence !== null) {
    if (!Number.isFinite(context.confidence) || context.confidence < 0 || context.confidence > 100) throw new Error('Review confidence must be between 0 and 100.');
    if (context.confidenceTiming !== 'before-answer') throw new Error('Confidence must be recorded before revealing or checking the answer.');
    result.confidence = context.confidence;
    result.confidenceTiming = 'before-answer';
  } else if (context.confidenceTiming !== undefined && context.confidenceTiming !== 'none') {
    throw new Error('Missing confidence cannot be marked as recorded before the answer.');
  }
  if (context.durationSeconds !== undefined && context.durationSeconds !== null) {
    if (!Number.isFinite(context.durationSeconds) || context.durationSeconds <= 0) throw new Error('Review duration must be a positive number of seconds.');
    result.durationSeconds = context.durationSeconds;
  }
  if (context.studySessionIds !== undefined) {
    if (!Array.isArray(context.studySessionIds) || context.studySessionIds.length > 100
      || context.studySessionIds.some((id) => !validId(id))
      || new Set(context.studySessionIds).size !== context.studySessionIds.length) throw new Error('Review study session links must be distinct valid IDs.');
    const eligible = new Set(eligibleReviewStudySessions(workspace, cardId, { now, recentDays: null }).map((entry) => entry.id));
    if (context.studySessionIds.some((id) => !eligible.has(id))) throw new Error('A linked study session must exist, precede the review, and relate to this card, lecture, or concept.');
    result.studySessionIds = [...context.studySessionIds];
  }
  return result;
}

/** Preserve the evidence available at the attempt; never reconstruct legacy attempts. */
export function captureReviewProvenance(workspace, card, context, now = new Date()) {
  const date = reviewDate(now);
  const schedule = card.schedule;
  const course = workspace.courses.find((entry) => entry.id === card.courseId);
  const lecture = workspace.lectures.find((entry) => entry.id === card.lectureId);
  const result = {
    ...normalizeReviewContext(workspace, card.id, context, date),
    preReview: {
      state: schedule.state,
      lastReviewAt: schedule.last_review ?? null,
      dueAt: schedule.due,
      scheduledDays: schedule.scheduled_days,
      stability: schedule.stability,
      difficulty: schedule.difficulty,
    },
    association: {
      courseId: card.courseId,
      lectureId: card.lectureId,
      conceptIds: [...(card.conceptIds ?? [])],
      tags: [...card.tags],
    },
    contentRevision: reviewContentRevision(card),
    snapshotLabels: {
      cardQuestion: card.question || (card.occlusion ? '(Image occlusion card)' : '(Image card)'),
      ...(course ? { courseTitle: course.title } : {}),
      ...(lecture ? { lectureTitle: lecture.title } : {}),
    },
  };
  if (card.createdAt) result.cardCreatedAt = card.createdAt;
  return result;
}
