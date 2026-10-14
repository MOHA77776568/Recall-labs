import { DEFAULT_STUDY_TIMEZONE, intersectRanges, localDateKey, localDayOffset, transcriptionSummary, unionRanges, viewingSummary } from './study.js';

const DAY = 86_400_000;
const list = (workspace, key) => workspace[key] ?? [];
const totalSeconds = (ranges) => ranges.reduce((sum, range) => sum + range.end - range.start, 0);
const percent = (numerator, denominator) => denominator ? numerator / denominator * 100 : null;
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const latest = (instants) => instants.filter(Boolean).sort().at(-1) ?? null;

export const DELAYED_RECALL_RULE = 'First eligible review per card per local calendar day: closed-book, known pre-review state Review (2), and known previous review at least 24 hours earlier. Again fails; Hard/Good/Easy mean self-rated successful recall. This is not objective exam accuracy or Anki exact True Retention.';
export const FORGOTTEN_CARD_RULE = 'At least 3 Again ratings across at least 2 local calendar days in the last 30 days, intersected with the selected period. The rule suggests inspection and never changes the schedule.';

function eligibility(review) {
  if (!review.preReview || !review.practiceMode) return 'unknown-context';
  if (review.practiceMode !== 'closed-book') return 'open-book-or-revealed';
  if (review.preReview.state !== 2) return 'initial-learning-or-relearning';
  const previous = Date.parse(review.preReview.lastReviewAt), at = Date.parse(review.at);
  if (!review.preReview.lastReviewAt || !Number.isFinite(previous) || !Number.isFinite(at)) return 'unknown-previous-review';
  if (at - previous < DAY) return 'less-than-24-hours';
  return null;
}

/** Select before applying filters, so a same-day success never replaces the first eligible failure. */
export function delayedRecallObservations(reviews, timezone = DEFAULT_STUDY_TIMEZONE) {
  const selected = new Map(), excluded = {};
  for (const review of [...reviews].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    let reason = eligibility(review);
    if (!reason) {
      const key = `${review.cardId}\u0000${localDateKey(review.at, timezone)}`;
      if (selected.has(key)) reason = 'later-same-day-eligible';
      else selected.set(key, { ...review, localDate: localDateKey(review.at, timezone), passed: review.rating !== 1 });
    }
    if (reason) excluded[review.id] = reason;
  }
  return { records: [...selected.values()], excluded };
}

function recordHistory(workspace, accept, period) {
  const events = [];
  const add = (record, type, at, label) => { if (at && accept(record) && period(at)) events.push({ id: `${type}:${record.id}:${at}`, type, lectureId: record.lectureId ?? record.association?.lectureId ?? '', at, label, record }); };
  for (const session of list(workspace, 'studySessions')) add(session, 'session', session.occurredAt, session.activities.join(' + '));
  for (const segment of list(workspace, 'transcriptionSegments')) add(segment, 'transcription', segment.occurredAt, `${segment.method}: ${segment.status}`);
  for (const attempt of list(workspace, 'recallAttempts')) add(attempt, 'recall-attempt', attempt.occurredAt, 'Free-recall attempt');
  for (const assessment of list(workspace, 'assessments')) add(assessment, 'assessment', assessment.occurredAt, `${assessment.kind}: ${assessment.outcome}`);
  for (const gap of list(workspace, 'gaps')) {
    add(gap, 'gap', gap.occurredAt, 'Gap recorded');
    if (gap.addressedAt) add(gap, 'gap-addressed', gap.addressedAt, 'Gap addressed');
    if (gap.recheckedAt) add(gap, 'gap-rechecked', gap.recheckedAt, 'Gap rechecked');
  }
  for (const review of list(workspace, 'reviews')) add(review, 'review', review.at, ['Again', 'Hard', 'Good', 'Easy'][review.rating - 1]);
  return events.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

function confidenceAnalysis(reviews, attempts, assessments) {
  const pairs = [];
  for (const review of reviews) if (Number.isFinite(review.confidence) && ['before-answer', 'before'].includes(review.confidenceTiming) && review.practiceMode === 'closed-book') {
    pairs.push({ id: review.id, type: 'review', at: review.at, confidence: review.confidence, passed: review.rating !== 1, outcome: ['Again', 'Hard', 'Good', 'Easy'][review.rating - 1], outcomeScore: review.rating === 1 ? 0 : 1, lectureId: review.association?.lectureId ?? '', cardId: review.cardId, classification: 'self-rated' });
  }
  for (const assessment of assessments) if (Number.isFinite(assessment.confidence) && assessment.confidenceTiming === 'before' && assessment.outcome !== 'not-assessed') {
    pairs.push({ id: assessment.id, type: 'assessment', at: assessment.occurredAt, confidence: assessment.confidence, passed: assessment.outcome === 'correct', outcome: assessment.outcome, outcomeScore: assessment.outcome === 'correct' ? 1 : assessment.outcome === 'partial' ? 0.5 : 0, lectureId: assessment.lectureId, classification: 'self-assessed' });
  }
  for (const attempt of attempts) {
    if (!Number.isFinite(attempt.confidence) || attempt.confidenceTiming !== 'before' || !attempt.expectedIdeas?.length) continue;
    const assessed = new Map();
    for (const assessment of [...assessments].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))) if (assessment.recallAttemptId === attempt.id && assessment.expectedIdeaId) assessed.set(assessment.expectedIdeaId, assessment);
    const outcomes = attempt.expectedIdeas.map((idea) => assessed.get(idea.id)?.outcome);
    // Unassessed ideas are missing evidence, not automatic failures.
    if (outcomes.some((outcome) => !outcome || outcome === 'not-assessed')) continue;
    const score = average(outcomes.map((outcome) => outcome === 'correct' ? 1 : outcome === 'partial' ? 0.5 : 0));
    pairs.push({ id: attempt.id, type: 'recall-attempt', at: attempt.occurredAt, confidence: attempt.confidence, passed: score === 1, outcome: `${outcomes.filter((outcome) => outcome === 'correct').length}/${outcomes.length} correct ideas`, outcomeScore: score, lectureId: attempt.lectureId, classification: 'self-assessed' });
  }
  const buckets = [[0, 24], [25, 49], [50, 74], [75, 100]].map(([from, to]) => {
    const bucket = pairs.filter((pair) => pair.confidence >= from && (to === 100 ? pair.confidence <= 100 : pair.confidence < to + 1));
    return { label: `${from}–${to}%`, from, to, sampleSize: bucket.length, meanConfidence: average(bucket.map((pair) => pair.confidence)), passCount: bucket.filter((pair) => pair.passed).length, passPercent: percent(bucket.filter((pair) => pair.passed).length, bucket.length), meanOutcomePercent: bucket.length ? average(bucket.map((pair) => pair.outcomeScore)) * 100 : null };
  });
  return { pairs, buckets, sampleSize: pairs.length, classification: 'paired self-rated/self-assessed outcomes', rule: 'Only confidence recorded before the corresponding outcome on the same attempt. Free recall requires outcomes for every expected idea. Perceived clarity after studying is excluded.' };
}

function expectedIdeaAnalysis(attempts, assessments, conceptId) {
  const entries = attempts.map((attempt) => {
    const observations = new Map();
    for (const assessment of [...assessments].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))) if (assessment.recallAttemptId === attempt.id && assessment.expectedIdeaId) observations.set(assessment.expectedIdeaId, assessment);
    const ideas = (attempt.expectedIdeas ?? []).filter((idea) => !conceptId || observations.get(idea.id)?.conceptId === conceptId).map((idea) => ({ ...idea, outcome: observations.get(idea.id)?.outcome ?? 'not-assessed', assessmentId: observations.get(idea.id)?.id ?? null }));
    const numerator = ideas.filter((idea) => idea.outcome === 'correct').length;
    const assessedCount = ideas.filter((idea) => idea.outcome !== 'not-assessed').length;
    return { attemptId: attempt.id, lectureId: attempt.lectureId, occurredAt: attempt.occurredAt, numerator, denominator: ideas.length, percent: assessedCount ? percent(numerator, ideas.length) : null, assessedCount, notAssessedCount: ideas.filter((idea) => idea.outcome === 'not-assessed').length, ideas };
  });
  const numerator = entries.reduce((sum, entry) => sum + entry.numerator, 0), denominator = entries.reduce((sum, entry) => sum + entry.denominator, 0);
  const assessedCount = entries.reduce((sum, entry) => sum + entry.assessedCount, 0);
  return { numerator, denominator, percent: assessedCount ? percent(numerator, denominator) : null, assessedCount, notAssessedCount: entries.reduce((sum, entry) => sum + entry.notAssessedCount, 0), attempts: entries, rule: 'Correct explicitly expected ideas / explicitly expected ideas. Partial, missing, incorrect, and not assessed remain separate; no expected list or no scored observation means no coverage percentage.', classification: 'self-assessed' };
}

function methodComparisons(workspace, delayed, assessments) {
  const sessions = new Map(list(workspace, 'studySessions').map((session) => [session.id, session])), groups = new Map();
  let missingLinkedOutcomes = 0;
  const outcomes = [...delayed.map((review) => ({ ...review, outcomeAt: review.at, passed: review.rating !== 1, kind: 'review' })), ...assessments.filter((entry) => entry.outcome !== 'not-assessed').map((assessment) => ({ ...assessment, outcomeAt: assessment.occurredAt, passed: assessment.outcome === 'correct', kind: 'assessment' }))];
  for (const outcome of outcomes) {
    const linked = (outcome.studySessionIds ?? []).map((id) => sessions.get(id)).filter((session) => session && Date.parse(session.occurredAt) < Date.parse(outcome.outcomeAt));
    if (!linked.length) { missingLinkedOutcomes += 1; continue; }
    const methods = [...new Set(linked.flatMap((session) => session.activities))].sort();
    const method = methods.length > 1 ? `mixed:${methods.join('+')}` : methods[0];
    // Keep rating and manual assessment populations separate; their definitions differ.
    const key = `${outcome.kind}:${method}`;
    if (!groups.has(key)) groups.set(key, { method, label: methods.length > 1 ? `Mixed: ${methods.join(' + ')}` : methods[0], outcomeType: outcome.kind, sampleSize: 0, passCount: 0, reviewIds: [], assessmentIds: [], sessionIds: [], records: [], delays: [], difficultyContext: [] });
    const group = groups.get(key), lastSession = latest(linked.map((session) => session.occurredAt));
    group.sampleSize += 1; group.passCount += Number(outcome.passed);
    group[outcome.kind === 'review' ? 'reviewIds' : 'assessmentIds'].push(outcome.id);
    group.sessionIds.push(...linked.map((session) => session.id));
    const delayHours = (Date.parse(outcome.outcomeAt) - Date.parse(lastSession)) / 3_600_000;
    group.delays.push(delayHours);
    group.records.push({ id: outcome.id, at: outcome.outcomeAt, delayHours, passed: outcome.passed, outcome: outcome.kind === 'review' ? ['Again', 'Hard', 'Good', 'Easy'][outcome.rating - 1] : outcome.outcome, difficulty: outcome.preReview?.difficulty ?? null, sessionIds: linked.map((session) => session.id), kind: outcome.kind });
    if (outcome.preReview) group.difficultyContext.push({ reviewId: outcome.id, difficulty: outcome.preReview.difficulty, priorIntervalDays: outcome.preReview.scheduledDays, cardCreatedAt: outcome.cardCreatedAt ?? null, contentRevision: outcome.contentRevision ?? null });
  }
  return { groups: [...groups.values()].map(({ delays, ...group }) => ({ ...group, sessionIds: [...new Set(group.sessionIds)], passPercent: percent(group.passCount, group.sampleSize), meanDelayHours: average(delays), delayHours: { min: Math.min(...delays), max: Math.max(...delays) } })), missingLinkedOutcomes, observational: true,
    rule: 'Only explicit study-session links preceding an observed outcome. Delay is measured from the latest linked session. Multiple labels or sessions form a mixed pattern. These populations are observational and may differ in content, difficulty, and delay.' };
}

/** Statistics derive from authoritative records; aggregates are never synchronized. */
export function buildStatistics(workspace, options = {}) {
  const settings = list(workspace, 'studySettings')[0];
  const timezone = options.timezone ?? settings?.timezone ?? DEFAULT_STUDY_TIMEZONE;
  const now = new Date(options.now ?? new Date()).toISOString();
  const from = options.from || null, to = options.to || null, courseId = options.courseId || null, lectureId = options.lectureId || null, conceptId = options.conceptId || null, tag = options.tag || null;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from) || to && !/^\d{4}-\d{2}-\d{2}$/.test(to) || from && to && from > to) throw new Error('Choose a valid inclusive calendar-date range.');
  // Intl rejects invalid zones instead of silently grouping in the computer timezone.
  const today = localDateKey(now, timezone);
  const period = (instant) => { const day = localDateKey(instant, timezone); return (!from || day >= from) && (!to || day <= to); };
  const lectures = new Map(list(workspace, 'lectures').map((lecture) => [lecture.id, lecture]));
  const cards = new Map(list(workspace, 'cards').map((card) => [card.id, card]));
  const concepts = new Map(list(workspace, 'concepts').map((concept) => [concept.id, concept]));
  const selectedConcept = conceptId ? concepts.get(conceptId) : null;
  const acceptsAssociation = (association, record) => {
    if (courseId && association?.courseId !== courseId) return false;
    if (lectureId && association?.lectureId !== lectureId) return false;
    if (conceptId && !(association?.conceptIds ?? record?.conceptIds ?? []).includes(conceptId) && record?.conceptId !== conceptId) {
      const tags = association?.tags ?? record?.tags ?? [];
      if (!selectedConcept?.tag || !tags.includes(selectedConcept.tag)) return false;
    }
    if (tag && !(association?.tags ?? record?.tags ?? []).includes(tag)) return false;
    return true;
  };
  const associationFor = (record) => {
    if (record.association) return record.association;
    const lecture = lectures.get(record.lectureId);
    return { courseId: record.courseId ?? lecture?.courseId ?? '', lectureId: record.lectureId ?? '', conceptIds: record.conceptIds ?? (record.conceptId ? [record.conceptId] : []), tags: record.tags ?? [] };
  };
  const accept = (record) => {
    // Legacy review relationships are unknown. A current card move must not rewrite history.
    if (record.cardId && record.at && !record.association) return !courseId && !lectureId && !conceptId && !tag;
    if (acceptsAssociation(associationFor(record), record)) return true;
    if (record.expectedIdeas && conceptId && !tag) return list(workspace, 'assessments').some((assessment) => assessment.recallAttemptId === record.id && assessment.conceptId === conceptId && acceptsAssociation(associationFor(assessment), assessment));
    return false;
  };
  const acceptLecture = (lecture) => {
    if (courseId && lecture.courseId !== courseId || lectureId && lecture.id !== lectureId) return false;
    if (conceptId && selectedConcept?.lectureId !== lecture.id && !list(workspace, 'cards').some((card) => card.lectureId === lecture.id && acceptsAssociation(associationFor(card), card)) && !list(workspace, 'studySessions').some((session) => session.lectureId === lecture.id && (session.conceptIds ?? []).includes(conceptId))) return false;
    if (tag && !list(workspace, 'cards').some((card) => card.lectureId === lecture.id && card.tags.includes(tag))) return false;
    return true;
  };
  const selectedLectures = [...lectures.values()].filter(acceptLecture);
  const sessions = list(workspace, 'studySessions').filter((session) => accept(session) && period(session.occurredAt));
  const activityCounts = Object.fromEntries(['viewing', 'transcription', 'notes', 'memory', 'application'].map((activity) => [activity, sessions.filter((session) => session.activities.includes(activity)).length]));
  const knownEffort = sessions.filter((session) => Number.isFinite(session.effortMinutes));
  const calendar = new Map();
  for (const session of sessions) {
    const date = localDateKey(session.occurredAt, timezone);
    if (!calendar.has(date)) calendar.set(date, { date, sessionCount: 0, effortMinutes: 0, knownEffortSessionCount: 0, activities: {}, recordIds: [] });
    const day = calendar.get(date); day.sessionCount += 1; day.recordIds.push(session.id);
    if (Number.isFinite(session.effortMinutes)) { day.effortMinutes += session.effortMinutes; day.knownEffortSessionCount += 1; }
    for (const activity of session.activities) day.activities[activity] = (day.activities[activity] ?? 0) + 1;
  }
  const history = recordHistory(workspace, accept, period);
  const latestActivityByLecture = new Map();
  for (const event of recordHistory(workspace, () => true, () => true)) if (event.lectureId && (!latestActivityByLecture.has(event.lectureId) || event.at > latestActivityByLecture.get(event.lectureId))) latestActivityByLecture.set(event.lectureId, event.at);
  const reviewRecords = list(workspace, 'reviews').filter((review) => accept(review) && period(review.at));
  const delayedAll = delayedRecallObservations(list(workspace, 'reviews'), timezone);
  const delayed = delayedAll.records.filter((review) => accept(review) && period(review.at));
  const numerator = delayed.filter((review) => review.passed).length;
  const excludedCounts = {};
  for (const review of reviewRecords) if (delayedAll.excluded[review.id]) excludedCounts[delayedAll.excluded[review.id]] = (excludedCounts[delayedAll.excluded[review.id]] ?? 0) + 1;
  const forgotten = new Map();
  for (const review of reviewRecords) if (localDateKey(review.at, timezone) >= localDayOffset(today, -29) && Date.parse(review.at) <= Date.parse(now)) {
    if (!forgotten.has(review.cardId)) forgotten.set(review.cardId, { cardId: review.cardId, card: cards.get(review.cardId) ?? null, attemptCount: 0, againCount: 0, days: new Set(), reviewIds: [], rule: FORGOTTEN_CARD_RULE });
    const entry = forgotten.get(review.cardId); entry.attemptCount += 1; entry.reviewIds.push(review.id);
    if (review.rating === 1) { entry.againCount += 1; entry.days.add(localDateKey(review.at, timezone)); }
  }
  const forgottenCards = [...forgotten.values()].filter((entry) => entry.againCount >= 3 && entry.days.size >= 2).map(({ days, ...entry }) => ({ ...entry, dayCount: days.size }));
  const attempts = list(workspace, 'recallAttempts').filter((attempt) => accept(attempt) && period(attempt.occurredAt));
  const assessments = list(workspace, 'assessments').filter((assessment) => accept(assessment) && period(assessment.occurredAt));
  const gaps = list(workspace, 'gaps').filter(accept);
  const legacyRecalls = list(workspace, 'recalls').filter((recall) => accept(recall) && period(recall.updatedAt));
  const matrix = selectedLectures.map((lecture) => {
    const viewing = viewingSummary(workspace, lecture.id), transcription = transcriptionSummary(workspace, lecture.id);
    const scopedSessions = sessions.filter((session) => session.lectureId === lecture.id);
    const periodViewingRanges = unionRanges(scopedSessions.filter((session) => session.activities.includes('viewing')).flatMap((session) => session.ranges));
    const periodSegments = list(workspace, 'transcriptionSegments').filter((segment) => segment.lectureId === lecture.id && segment.method === transcription.method && period(segment.occurredAt));
    const periodWrittenRanges = intersectRanges(unionRanges(periodSegments.filter((segment) => segment.status !== 'not-started').map(({ start, end }) => ({ start, end }))), transcription.writtenRanges);
    return { lecture, viewing, transcription, recallAttemptCount: list(workspace, 'recallAttempts').filter((attempt) => attempt.lectureId === lecture.id).length,
      periodRecallAttemptCount: attempts.filter((attempt) => attempt.lectureId === lecture.id).length,
      legacyRecallCount: list(workspace, 'recalls').filter((recall) => recall.lectureId === lecture.id).length,
      openGapCount: gaps.filter((gap) => gap.lectureId === lecture.id && gap.status === 'open').length,
      unrecheckedGapCount: gaps.filter((gap) => gap.lectureId === lecture.id && gap.status !== 'rechecked').length,
      latestActivityAt: latestActivityByLecture.get(lecture.id) ?? null,
      period: { sessionCount: scopedSessions.length, viewingCoverageSeconds: totalSeconds(periodViewingRanges), currentlyWrittenRangesRecordedInPeriod: periodWrittenRanges, currentlyWrittenSecondsRecordedInPeriod: totalSeconds(periodWrittenRanges), label: 'Selected-period activity; source coverage is distinct from lifetime/current progress' },
      classification: 'Recorded activity and current progress; no mastery inference', currentSnapshot: true,
    };
  });
  const scheduled = [...cards.values()].filter((card) => acceptsAssociation(associationFor(card), card)).map((card) => ({ cardId: card.id, courseId: card.courseId, lectureId: card.lectureId, dueAt: card.schedule.due, date: localDateKey(card.schedule.due, timezone), overdue: Date.parse(card.schedule.due) < Date.parse(now), question: card.question }));
  const due = scheduled.filter((entry) => Date.parse(entry.dueAt) <= Date.parse(now));
  const overdue = scheduled.filter((entry) => entry.overdue);
  // Inclusive local dates: today and the following 6/29 days, excluding past-due instants.
  const upcoming = scheduled.filter((entry) => Date.parse(entry.dueAt) >= Date.parse(now));
  const dueNext7Records = upcoming.filter((entry) => entry.date <= localDayOffset(today, 6));
  const dueNext30Records = upcoming.filter((entry) => entry.date <= localDayOffset(today, 29));
  const scheduleCalendar = new Map();
  for (const entry of dueNext30Records) {
    if (!scheduleCalendar.has(entry.date)) scheduleCalendar.set(entry.date, { date: entry.date, count: 0, cardIds: [] });
    const day = scheduleCalendar.get(entry.date); day.count += 1; day.cardIds.push(entry.cardId);
  }
  const overdueBreakdown = [{ label: 'Less than 1 day', min: 0, max: 1 }, { label: '1–7 days', min: 1, max: 7 }, { label: '7–30 days', min: 7, max: 30 }, { label: '30+ days', min: 30, max: Infinity }].map(({ label, min, max }) => {
    const entries = overdue.filter((entry) => { const days = (Date.parse(now) - Date.parse(entry.dueAt)) / DAY; return days >= min && days < max; });
    return { label, count: entries.length, cardIds: entries.map((entry) => entry.cardId) };
  });
  const dismissed = new Set(settings?.dismissedInsightIds ?? settings?.dismissals ?? []), insights = [];
  for (const row of matrix) {
    if (row.viewing.sessionCount && !row.recallAttemptCount && !row.legacyRecallCount) insights.push({ id: `unrecorded-recall:${row.lecture.id}`, type: 'unrecorded-recall', title: 'Viewed lecture without a recorded free-recall attempt', reason: `${row.viewing.sessionCount} viewing session(s), with no recorded attempt. This does not prove that recall was never practiced.`, action: 'lecture', lectureId: row.lecture.id });
    if (row.transcription.planned && row.transcription.nextUnfinishedRange) insights.push({ id: `unfinished-transcript:${row.lecture.id}`, type: 'unfinished-transcript', title: 'Unfinished planned transcription', reason: `${row.transcription.writtenSeconds}/${row.transcription.targetSeconds} source seconds currently written for the chosen method. No due date or compulsory quota.`, action: 'transcription', lectureId: row.lecture.id });
  }
  for (const entry of forgottenCards) if (entry.card) insights.push({ id: `forgotten-card:${entry.cardId}`, type: 'forgotten-card', title: 'Repeatedly forgotten card worth inspecting', reason: `${entry.againCount} Again ratings on ${entry.dayCount} local days. ${FORGOTTEN_CARD_RULE}`, action: 'card', cardId: entry.cardId, lectureId: entry.card.lectureId });
  for (const gap of gaps) if (gap.status !== 'rechecked') insights.push({ id: `unrechecked-gap:${gap.id}`, type: 'unrechecked-gap', title: 'Gap without a recorded recheck', reason: gap.status === 'addressed' ? 'The gap was marked addressed, with no later recorded recheck.' : 'The gap remains open, with no recorded recheck.', action: 'gap', gapId: gap.id, lectureId: gap.lectureId });
  const selectedConcepts = [...concepts.values()].filter((concept) => (!courseId || concept.courseId === courseId) && (!lectureId || concept.lectureId === lectureId) && (!conceptId || concept.id === conceptId) && (!tag || concept.tag === tag));
  return {
    scope: { from, to, timezone, currentSnapshot: true, periodLabel: from || to ? `${from ?? 'Beginning'} through ${to ?? 'Now'} (inclusive local dates)` : 'All recorded dates', now, snapshotLabel: 'Lecture progress, open gaps, and due schedule are current snapshots; activity and outcomes use the selected period.' },
    activity: { sessions, sessionCount: sessions.length, activityCounts, effortMinutes: knownEffort.reduce((sum, session) => sum + session.effortMinutes, 0), knownEffortSessionCount: knownEffort.length, unknownEffortSessionCount: sessions.length - knownEffort.length, calendar: [...calendar.values()].sort((a, b) => a.date.localeCompare(b.date)), history, classification: 'recorded', rule: 'Sessions count once; a shared session contributes to each activity category but its elapsed effort only once. Optional recorded time is incomplete effort context.' },
    matrix,
    reviews: { records: reviewRecords, totalAttempts: reviewRecords.length, distinctCards: new Set(reviewRecords.map((entry) => entry.cardId)).size, ratingCounts: { Again: reviewRecords.filter((entry) => entry.rating === 1).length, Hard: reviewRecords.filter((entry) => entry.rating === 2).length, Good: reviewRecords.filter((entry) => entry.rating === 3).length, Easy: reviewRecords.filter((entry) => entry.rating === 4).length },
      delayed: { numerator, denominator: delayed.length, percent: percent(numerator, delayed.length), records: delayed, excludedCounts, rule: DELAYED_RECALL_RULE, classification: 'self-rated' }, legacyCount: reviewRecords.filter((entry) => !entry.preReview || !entry.practiceMode).length, unknownAssociationCount: list(workspace, 'reviews').filter((entry) => !entry.association && period(entry.at)).length, forgottenCards,
      population: { cardIds: [...new Set(reviewRecords.map((entry) => entry.cardId))], contentRevisions: [...new Set(reviewRecords.map((entry) => entry.contentRevision).filter(Boolean))], rule: 'Use recorded association snapshots where present. Unknown legacy associations are not assigned to current courses or lectures. Changes in reviewed cards/content can affect comparisons.' } },
    evidence: { attempts, assessments, gaps, legacyRecalls, expectedIdeas: expectedIdeaAnalysis(attempts, assessments, conceptId), concepts: selectedConcepts, assessedCount: assessments.filter((entry) => entry.outcome !== 'not-assessed').length, notAssessedCount: assessments.filter((entry) => entry.outcome === 'not-assessed').length, gapScope: 'Current gap status; dated gap changes appear in period history' },
    confidence: confidenceAnalysis(reviewRecords, attempts, assessments), methods: methodComparisons(workspace, delayed, assessments),
    schedule: { due: due.length, overdue: overdue.length, dueNext7: dueNext7Records.length, dueNext30: dueNext30Records.length, dueRecords: due, overdueRecords: overdue, dueNext7Records, dueNext30Records, calendar: [...scheduleCalendar.values()].sort((a, b) => a.date.localeCompare(b.date)), classification: 'current schedule', records: scheduled, overdueBreakdown, currentSnapshot: true, rule: 'Current scheduled dates only, not a forecast of repetitions or newly added cards. Next 7/30 days includes today and the following 6/29 local dates, from the current instant. Date filters do not change this snapshot.' },
    insights: insights.filter((entry) => !dismissed.has(entry.id)),
  };
}
