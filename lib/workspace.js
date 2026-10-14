import { DataValidationError } from './data.js';
import { validateCardMediaRecord } from './card-media.js';

export const MAX_WORKSPACE_BYTES = 10_000_000;
export const LEGACY_WORKSPACE_COLLECTIONS = ['courses', 'lectures', 'cards', 'recalls', 'reviews'];
// These are the additions to the legacy snapshot, including portable image
// metadata. Keeping one exported cohort lets both adapters preserve omitted
// additions when the original interface saves its original five collections.
export const STUDY_COLLECTIONS = ['lecturePlans', 'viewingPasses', 'studySessions', 'transcriptionSegments', 'concepts', 'gaps', 'recallAttempts', 'assessments', 'studySettings', 'media'];
export const WORKSPACE_COLLECTIONS = [...LEGACY_WORKSPACE_COLLECTIONS, ...STUDY_COLLECTIONS];
export const WORKSPACE_VERSION = 2;
export const WORKSPACE_DOCUMENT_VERSION = 3;
const LIMITS = { courses: 200, lectures: 500, cards: 3_000, recalls: 500, reviews: 10_000, lecturePlans: 500, viewingPasses: 10_000, studySessions: 20_000, transcriptionSegments: 20_000, concepts: 5_000, gaps: 10_000, recallAttempts: 10_000, assessments: 20_000, studySettings: 1, media: 10_000 };
const EPOCH = '1970-01-01T00:00:00.000Z';
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(value).byteLength;
const clone = (value) => structuredClone(value);
const fail = (message) => { throw new DataValidationError(message); };

function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`);
  if (keys && Object.keys(value).some((key) => !keys.includes(key))) fail(`${label} contains unsupported fields.`);
  return value;
}
function text(value, label, maximum, minimum = 0, trim = false) {
  if (typeof value !== 'string' || value.length > maximum || CONTROLS.test(value)) fail(`${label} must be text of at most ${maximum} characters.`);
  if ((trim ? value.trim() : value).length < minimum) fail(`${label} cannot be empty.`);
  return value;
}
function id(value, label, maximum = 100) {
  text(value, label, maximum, 1);
  if (UNSAFE.has(value)) fail(`${label} is reserved.`);
  return value;
}
function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) fail(`${label} must be an ISO UTC timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0 || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(`${label} is invalid.`);
  return new Date(parsed).toISOString();
}
function number(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, integer = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value))) fail(`${label} is out of range.`);
}
function choice(value, allowed, label) { if (!allowed.includes(value)) fail(`${label} has an unsupported value.`); }
function ids(value, label, maximum = 500, idMaximum = 100) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} has too many entries.`);
  for (const key of value) id(key, label, idMaximum);
  if (new Set(value).size !== value.length) fail(`${label} contains duplicate IDs.`);
}
function range(value, label) {
  object(value, label);
  number(value.start, `${label} start`, 0, 31_536_000);
  number(value.end, `${label} end`, 0, 31_536_000);
  if (value.end <= value.start) fail(`${label} end must be after its start.`);
}
function ranges(value, label) {
  if (!Array.isArray(value) || value.length > 2_000) fail(`${label} has too many ranges.`);
  for (const entry of value) range(entry, label);
}
function optionalId(value, label) { text(value, label, 100); if (value) id(value, label); }
function confidence(value, label) { if (value !== null) number(value, label, 0, 100); }
function safeReference(value, label, maximum = 2_000) {
  text(value, label, maximum);
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/|file:|data:)/i.test(value.trim())) fail(`${label} cannot contain an absolute machine path or binary data.`);
}
function utcOrNull(value, label) { return value === null ? null : timestamp(value, label); }
function timezone(value) {
  text(value, 'Study timezone', 100, 1);
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); } catch { fail('Study timezone must be a valid IANA timezone.'); }
}

// Preserve existing and future workspace fields while rejecting unsafe or unbounded JSON.
function json(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 1_000_000 || depth > 24) fail('Workspace JSON is too deeply nested or complex.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, 'Workspace text', 500_000);
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Workspace contains an invalid number.'); return value; }
  if (Array.isArray(value)) return value.map((entry) => json(entry, depth + 1, budget));
  object(value, 'Workspace JSON');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (UNSAFE.has(key) || key.length > 200 || CONTROLS.test(key)) fail('Workspace contains an unsafe field name.');
    result[key] = json(value[key], depth + 1, budget);
  }
  return result;
}
function schedule(value) {
  object(value, 'Card schedule');
  timestamp(value.due, 'Schedule due');
  for (const key of ['stability', 'elapsed_days', 'scheduled_days']) number(value[key], `Schedule ${key}`);
  number(value.difficulty, 'Schedule difficulty', 0, 10);
  for (const key of ['reps', 'lapses']) number(value[key], `Schedule ${key}`, 0, Number.MAX_SAFE_INTEGER, true);
  number(value.state, 'Schedule state', 0, 3, true);
  if (value.learning_steps !== undefined) number(value.learning_steps, 'Schedule learning_steps', 0, Number.MAX_SAFE_INTEGER, true);
  if (value.last_review !== undefined) timestamp(value.last_review, 'Schedule last_review');
}
function mediaId(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`${label} must be a lowercase SHA-256 content ID.`);
  return value;
}
function cardImages(input, label) {
  if (!Array.isArray(input) || input.length > 50) fail(`${label} allows at most 50 images.`);
  return input.map((entry) => {
    object(entry, label); mediaId(entry.mediaId, `${label} media ID`);
    const result = json(entry);
    if (result.description === undefined) result.description = '';
    text(result.description, `${label} description`, 2_000);
    return result;
  });
}
function cardOcclusion(input) {
  object(input, 'Card image occlusion');
  const result = json(input); mediaId(result.mediaId, 'Occlusion media ID');
  if (!Array.isArray(result.regions) || !result.regions.length || result.regions.length > 100) fail('An occlusion needs between 1 and 100 regions.');
  for (const region of result.regions) {
    object(region, 'Occlusion region'); id(region.id, 'Occlusion region ID');
    for (const field of ['x', 'y']) number(region[field], `Occlusion ${field}`, 0, 1);
    for (const field of ['width', 'height']) number(region[field], `Occlusion ${field}`, Number.MIN_VALUE, 1);
    if (region.x + region.width > 1 + 1e-9 || region.y + region.height > 1 + 1e-9) fail('Occlusion regions must remain inside the image.');
    if (region.label === undefined) region.label = '';
    text(region.label, 'Occlusion region label', 200);
  }
  if (new Set(result.regions.map((region) => region.id)).size !== result.regions.length) fail('Duplicate occlusion region IDs are not allowed.');
  id(result.targetRegionId, 'Occlusion target region ID');
  if (!result.regions.some((region) => region.id === result.targetRegionId)) fail('The occlusion target must reference an existing region.');
  if (result.hideOthers === undefined) result.hideOthers = false;
  if (typeof result.hideOthers !== 'boolean') fail('Occlusion hideOthers must be a boolean.');
  return result;
}
function record(value, collection) {
  object(value, `${collection} record`);
  if (collection === 'media') {
    const safe = json(value);
    try { return { ...safe, ...validateCardMediaRecord(safe) }; } catch (error) { fail(`Card media metadata is invalid: ${error.message}`); }
  }
  id(value.id, `${collection} id`);
  if (collection === 'courses') {
    text(value.title, 'Course title', 150, 1, true);
    text(value.description, 'Course description', 500);
    if (!['violet', 'blue', 'teal', 'orange'].includes(value.color)) fail('Unsupported course color.');
  } else if (collection === 'lectures') {
    id(value.courseId, 'Lecture courseId');
    text(value.title, 'Lecture title', 200, 1, true);
    text(value.topic, 'Lecture topic', 150);
    text(value.notes, 'Lecture notes', 500_000);
    if (!Array.isArray(value.pages) || value.pages.length > 300) fail('A lecture can contain at most 300 pages.');
    for (const page of value.pages) { object(page, 'Lecture page'); text(page.label, 'Page label', 100); text(page.text, 'Page text', 100_000); }
    if (value.fileId !== undefined) text(value.fileId, 'Lecture fileId', 100);
    if (value.fileName !== undefined) text(value.fileName, 'Lecture fileName', 200);
  } else if (collection === 'cards') {
    id(value.courseId, 'Card courseId');
    text(value.lectureId, 'Card lectureId', 100);
    if (value.lectureId) id(value.lectureId, 'Card lectureId');
    const questionImages = value.questionImages === undefined ? [] : cardImages(value.questionImages, 'Question images');
    const answerImages = value.answerImages === undefined ? [] : cardImages(value.answerImages, 'Answer images');
    const occlusion = value.occlusion === undefined || value.occlusion === null ? null : cardOcclusion(value.occlusion);
    text(value.question, 'Card question', 4_000, questionImages.length || occlusion ? 0 : 1, true);
    text(value.answer, 'Card answer', 12_000, answerImages.length || occlusion ? 0 : 1, true);
    if (!Array.isArray(value.tags) || value.tags.length > 20) fail('A card can contain at most 20 tags.');
    for (const tag of value.tags) text(tag, 'Card tag', 80);
    text(value.source, 'Card source', 200);
    schedule(value.schedule);
    timestamp(value.createdAt, 'Card createdAt');
  } else if (collection === 'recalls') {
    id(value.lectureId, 'Recall lectureId');
    text(value.title, 'Recall title', 200);
    text(value.body, 'Recall body', 100_000);
    text(value.gaps, 'Recall gaps', 20_000);
    if (typeof value.checked !== 'boolean') fail('Recall checked must be a boolean.');
    timestamp(value.updatedAt, 'Recall updatedAt');
  } else if (collection === 'reviews') {
    id(value.cardId, 'Review cardId');
    number(value.rating, 'Review rating', 1, 4, true);
    timestamp(value.at, 'Review at');
    if (value.preReview !== undefined) {
      object(value.preReview, 'Review pre-review context');
      number(value.preReview.state, 'Review previous state', 0, 3, true);
      utcOrNull(value.preReview.lastReviewAt, 'Review previous review time');
      timestamp(value.preReview.dueAt, 'Review previous due time');
      number(value.preReview.scheduledDays, 'Review previous scheduled days');
      number(value.preReview.stability, 'Review previous stability');
      number(value.preReview.difficulty, 'Review previous difficulty', 0, 10);
    }
    if (value.association !== undefined) {
      object(value.association, 'Review historical association');
      id(value.association.courseId, 'Review historical course ID');
      optionalId(value.association.lectureId, 'Review historical lecture ID');
      ids(value.association.conceptIds, 'Review historical concept IDs');
      if (!Array.isArray(value.association.tags) || value.association.tags.length > 20) fail('Review historical tags are invalid.');
      for (const tag of value.association.tags) text(tag, 'Review historical tag', 80);
    }
    if (value.practiceMode !== undefined) choice(value.practiceMode, ['closed-book', 'open-book', 'revealed'], 'Review practice mode');
    if (value.confidence !== undefined) confidence(value.confidence, 'Review confidence');
    if (value.confidenceTiming !== undefined) choice(value.confidenceTiming, ['none', 'before-answer'], 'Review confidence timing');
    if (value.durationSeconds !== undefined) { number(value.durationSeconds, 'Review duration seconds', Number.MIN_VALUE, 604_800); }
    if (value.studySessionIds !== undefined) ids(value.studySessionIds, 'Review study session IDs');
    if (value.cardCreatedAt !== undefined) timestamp(value.cardCreatedAt, 'Review card creation time');
    if (value.contentRevision !== undefined) text(value.contentRevision, 'Review content revision', 200, 1);
    if (value.snapshotLabels !== undefined) {
      object(value.snapshotLabels, 'Review historical labels');
      for (const field of ['courseTitle', 'lectureTitle']) if (value.snapshotLabels[field] !== undefined) text(value.snapshotLabels[field], `Review historical ${field}`, 200);
      if (value.snapshotLabels.cardQuestion !== undefined) text(value.snapshotLabels.cardQuestion, 'Review historical question', 4_000);
    }
    if (value.operationId !== undefined) { id(value.operationId, 'Review operation ID'); if (value.operationId !== value.id) fail('Review operation ID must match its record ID.'); }
  } else {
    return studyRecord(value, collection);
  }
  const normalized = json(value);
  if (collection === 'cards') {
    if (normalized.questionImages !== undefined) normalized.questionImages = cardImages(normalized.questionImages, 'Question images');
    if (normalized.answerImages !== undefined) normalized.answerImages = cardImages(normalized.answerImages, 'Answer images');
    if (normalized.occlusion !== undefined && normalized.occlusion !== null) normalized.occlusion = cardOcclusion(normalized.occlusion);
  }
  if (collection === 'cards' && normalized.schedule.learning_steps === undefined) normalized.schedule.learning_steps = 0;
  if (collection === 'cards' && normalized.conceptIds !== undefined) ids(normalized.conceptIds, 'Card concept IDs');
  return normalized;
}

function studyRecord(input, collection) {
  const value = json(input);
  const defaults = (entries) => { for (const [key, fallback] of Object.entries(entries)) if (value[key] === undefined) value[key] = clone(fallback); };
  if (collection !== 'studySettings' && collection !== 'concepts') id(value.lectureId, `${collection} lecture ID`);
  if (collection === 'lecturePlans') {
    defaults({ durationSeconds: null, baselineCompleteCount: 0, transcriptionScope: 'none', targetRanges: [], transcriptionMethod: 'verbatim' });
    if (value.durationSeconds !== null) number(value.durationSeconds, 'Lecture duration seconds', Number.MIN_VALUE, 31_536_000);
    number(value.baselineCompleteCount, 'Historical complete-viewing count', 0, 100_000, true);
    choice(value.transcriptionScope, ['none', 'full', 'selected'], 'Transcription scope');
    choice(value.transcriptionMethod, ['verbatim', 'own-words', 'memory'], 'Transcription method');
    ranges(value.targetRanges, 'Transcription target');
  } else if (collection === 'viewingPasses') {
    defaults({ kind: 'first', status: 'in-progress', completedAt: null, completion: null });
    choice(value.kind, ['first', 'rewatch', 'targeted'], 'Viewing pass kind');
    choice(value.status, ['in-progress', 'complete'], 'Viewing pass status');
    timestamp(value.startedAt, 'Viewing pass start');
    utcOrNull(value.completedAt, 'Viewing pass completion time');
    choice(value.completion, [null, 'manual', 'coverage'], 'Viewing completion method');
    if (value.status === 'complete' && (value.completedAt === null || value.completion === null)) fail('Completed viewing passes need a completion time and method.');
    if (value.status === 'in-progress' && (value.completedAt !== null || value.completion !== null)) fail('An in-progress viewing pass cannot have completion evidence.');
    if (value.completedAt && Date.parse(value.completedAt) < Date.parse(value.startedAt)) fail('A viewing pass cannot complete before it starts.');
  } else if (collection === 'studySessions') {
    defaults({ activities: [], passId: '', ranges: [], effortMinutes: null, reason: '', note: '', conceptIds: [], cardIds: [], gapIds: [] });
    timestamp(value.occurredAt, 'Study session time');
    if (!Array.isArray(value.activities) || value.activities.length < 1 || value.activities.length > 5 || new Set(value.activities).size !== value.activities.length) fail('Study sessions need distinct activity labels.');
    for (const activity of value.activities) choice(activity, ['viewing', 'transcription', 'notes', 'memory', 'application'], 'Study activity');
    optionalId(value.passId, 'Study session pass ID');
    ranges(value.ranges, 'Study session range');
    if (value.effortMinutes !== null) number(value.effortMinutes, 'Study session effort minutes', 0, 100_000);
    text(value.reason, 'Study session reason', 500); text(value.note, 'Study session note', 20_000);
    for (const key of ['conceptIds', 'cardIds', 'gapIds']) ids(value[key], `Study session ${key}`);
  } else if (collection === 'transcriptionSegments') {
    defaults({ status: 'not-started', method: 'verbatim', sessionId: '', reference: '', note: '', attachmentId: '' });
    range(value, 'Transcription segment');
    choice(value.status, ['not-started', 'written', 'verified'], 'Transcription status');
    choice(value.method, ['verbatim', 'own-words', 'memory'], 'Transcription method');
    timestamp(value.occurredAt, 'Transcription work time'); timestamp(value.modifiedAt, 'Transcription modification time');
    if (Date.parse(value.modifiedAt) < Date.parse(value.occurredAt)) fail('Transcription modification time cannot precede its recorded work.');
    optionalId(value.sessionId, 'Transcription session ID'); optionalId(value.attachmentId, 'Transcription attachment ID');
    safeReference(value.attachmentId, 'Transcription attachment ID', 100);
    safeReference(value.reference, 'Transcription reference'); text(value.note, 'Transcription note', 20_000);
  } else if (collection === 'concepts') {
    defaults({ lectureId: '', tag: '' });
    id(value.courseId, 'Concept course ID'); optionalId(value.lectureId, 'Concept lecture ID');
    text(value.title, 'Concept title', 200, 1, true); text(value.tag, 'Concept tag', 80);
  } else if (collection === 'gaps') {
    defaults({ conceptId: '', recallAttemptId: '', status: 'open', addressedAt: null, recheckedAt: null, evidence: '' });
    optionalId(value.conceptId, 'Gap concept ID'); optionalId(value.recallAttemptId, 'Gap recall attempt ID');
    text(value.text, 'Gap text', 20_000, 1, true); text(value.evidence, 'Gap evidence', 20_000);
    timestamp(value.occurredAt, 'Gap observation time'); utcOrNull(value.addressedAt, 'Gap addressed time'); utcOrNull(value.recheckedAt, 'Gap rechecked time');
    choice(value.status, ['open', 'addressed', 'rechecked'], 'Gap status');
    if (value.status === 'addressed' && value.addressedAt === null) fail('An addressed gap needs an addressed time.');
    if (value.status === 'rechecked' && value.recheckedAt === null) fail('A rechecked gap needs a rechecked time.');
    if (value.addressedAt && Date.parse(value.addressedAt) < Date.parse(value.occurredAt)) fail('A gap cannot be addressed before it was observed.');
    if (value.recheckedAt && Date.parse(value.recheckedAt) < Date.parse(value.addressedAt ?? value.occurredAt)) fail('A gap cannot be rechecked before its observation or addressing.');
  } else if (collection === 'recallAttempts') {
    defaults({ recallId: '', body: '', gaps: '', expectedIdeas: [], confidence: null, confidenceTiming: 'none', studySessionIds: [] });
    optionalId(value.recallId, 'Recall attempt source ID'); timestamp(value.occurredAt, 'Recall attempt time');
    text(value.body, 'Recall attempt body', 100_000); text(value.gaps, 'Recall attempt gaps', 20_000);
    if (!Array.isArray(value.expectedIdeas) || value.expectedIdeas.length > 500) fail('Recall expected ideas are invalid.');
    for (const idea of value.expectedIdeas) { object(idea, 'Expected idea'); id(idea.id, 'Expected idea ID'); text(idea.text, 'Expected idea text', 4_000, 1, true); }
    if (new Set(value.expectedIdeas.map((idea) => idea.id)).size !== value.expectedIdeas.length) fail('Duplicate expected idea IDs are not allowed.');
    confidence(value.confidence, 'Recall attempt confidence'); choice(value.confidenceTiming, ['before', 'after', 'none'], 'Recall confidence timing');
    ids(value.studySessionIds, 'Recall linked study sessions');
  } else if (collection === 'assessments') {
    defaults({ conceptId: '', recallAttemptId: '', expectedIdeaId: '', cardId: '', note: '', confidence: null, confidenceTiming: 'none', studySessionIds: [] });
    for (const key of ['conceptId', 'recallAttemptId', 'expectedIdeaId', 'cardId']) optionalId(value[key], `Assessment ${key}`);
    choice(value.kind, ['recall-idea', 'explanation', 'example', 'application'], 'Assessment kind');
    choice(value.outcome, ['correct', 'partial', 'missing', 'incorrect', 'not-assessed'], 'Assessment outcome');
    timestamp(value.occurredAt, 'Assessment time'); text(value.note, 'Assessment note', 20_000);
    confidence(value.confidence, 'Assessment confidence'); choice(value.confidenceTiming, ['before', 'after', 'none'], 'Assessment confidence timing');
    ids(value.studySessionIds, 'Assessment linked study sessions');
  } else if (collection === 'studySettings') {
    if (value.id !== 'preferences') fail('Study settings ID must be preferences.');
    defaults({ timezone: 'Asia/Amman', dismissedInsightIds: [] }); timezone(value.timezone);
    ids(value.dismissedInsightIds, 'Dismissed insight IDs', 5_000, 300);
  }
  return value;
}

export function emptyWorkspace() {
  return { version: WORKSPACE_VERSION, ...collections(() => []) };
}
const RELATIONS = {
  lectures: [['courseId', 'courses']], cards: [['courseId', 'courses'], ['lectureId', 'lectures'], ['conceptIds', 'concepts', true]],
  recalls: [['lectureId', 'lectures']], lecturePlans: [['lectureId', 'lectures']], viewingPasses: [['lectureId', 'lectures']],
  studySessions: [['lectureId', 'lectures'], ['passId', 'viewingPasses'], ['conceptIds', 'concepts', true], ['cardIds', 'cards', true], ['gapIds', 'gaps', true]],
  transcriptionSegments: [['lectureId', 'lectures'], ['sessionId', 'studySessions']], concepts: [['courseId', 'courses'], ['lectureId', 'lectures']],
  gaps: [['lectureId', 'lectures'], ['conceptId', 'concepts'], ['recallAttemptId', 'recallAttempts']],
  recallAttempts: [['lectureId', 'lectures'], ['studySessionIds', 'studySessions', true]],
  assessments: [['lectureId', 'lectures'], ['conceptId', 'concepts'], ['recallAttemptId', 'recallAttempts'], ['studySessionIds', 'studySessions', true]],
};
function dependencies(collection, entry) {
  const relations = (RELATIONS[collection] ?? []).flatMap(([field, targetCollection, multiple]) => (multiple ? entry[field] ?? [] : entry[field] ? [entry[field]] : []).map((targetId) => ({ field, targetCollection, targetId })));
  if (collection === 'cards') {
    for (const field of ['questionImages', 'answerImages']) for (const image of entry[field] ?? []) relations.push({ field, targetCollection: 'media', targetId: image.mediaId });
    if (entry.occlusion) relations.push({ field: 'occlusion', targetCollection: 'media', targetId: entry.occlusion.mediaId });
  }
  return relations;
}
function referenceIssues(workspace) {
  const maps = Object.fromEntries(WORKSPACE_COLLECTIONS.map((kind) => [kind, new Map(workspace[kind].map((entry) => [entry.id, entry]))]));
  const issues = [];
  for (const collection of WORKSPACE_COLLECTIONS) for (const entry of workspace[collection]) {
    for (const relation of dependencies(collection, entry)) {
      const target = maps[relation.targetCollection].get(relation.targetId);
      const sourceLecture = maps.lectures.get(entry.lectureId);
      const expectedCourseId = entry.courseId || sourceLecture?.courseId;
      const mismatchedCourse = target && expectedCourseId && ((relation.targetCollection === 'lectures' && target.courseId !== expectedCourseId) || (relation.targetCollection === 'concepts' && target.courseId !== expectedCourseId));
      const mismatchedLecture = target && entry.lectureId && !['courses', 'lectures'].includes(relation.targetCollection) && target.lectureId && target.lectureId !== entry.lectureId;
      if (!target || mismatchedCourse || mismatchedLecture) issues.push({ collection, id: entry.id, ...relation, expectedCourseId, expectedLectureId: entry.lectureId });
    }
    if (collection === 'assessments' && entry.expectedIdeaId && !maps.recallAttempts.get(entry.recallAttemptId)?.expectedIdeas.some((idea) => idea.id === entry.expectedIdeaId)) issues.push({ collection, id: entry.id, targetCollection: 'recallAttempts', targetId: entry.recallAttemptId });
  }
  // Review snapshots and assessment card/source-recall IDs are historical
  // provenance. They deliberately survive deletion of the corresponding item.
  return issues;
}
function validateCurrentWorkspace(input) {
  object(input, 'Workspace');
  if (input.version !== WORKSPACE_VERSION) fail('Unsupported workspace version; update Recall Lab before opening this data.');
  const result = json(input);
  for (const collection of WORKSPACE_COLLECTIONS) {
    if (!Array.isArray(input[collection]) || input[collection].length > LIMITS[collection]) fail(`Workspace allows at most ${LIMITS[collection]} ${collection}.`);
    result[collection] = input[collection].map((entry) => record(entry, collection));
    if (new Set(result[collection].map((entry) => entry.id)).size !== result[collection].length) fail(`Duplicate ${collection} IDs are not allowed.`);
  }
  if (new Set(result.lecturePlans.map((entry) => entry.lectureId)).size !== result.lecturePlans.length) fail('Only one study plan is allowed per lecture.');
  const durationByLecture = new Map(result.lecturePlans.filter((entry) => entry.durationSeconds !== null).map((entry) => [entry.lectureId, entry.durationSeconds]));
  for (const kind of ['lecturePlans', 'studySessions', 'transcriptionSegments']) for (const entry of result[kind]) {
    const duration = durationByLecture.get(entry.lectureId);
    if (duration === undefined) continue;
    const sourceRanges = kind === 'transcriptionSegments' ? [entry] : kind === 'lecturePlans' ? entry.targetRanges : entry.ranges;
    if (sourceRanges.some((item) => item.end > duration)) fail('A study range exceeds the known lecture duration.');
  }
  if (referenceIssues(result).length) fail('A study record, card or note references a missing course or lecture, or a related record in another course or lecture.');
  const sessions = new Map(result.studySessions.map((entry) => [entry.id, entry]));
  const attempts = new Map(result.recallAttempts.map((entry) => [entry.id, entry]));
  for (const kind of ['recallAttempts', 'assessments']) for (const entry of result[kind]) {
    if (entry.studySessionIds.some((key) => Date.parse(sessions.get(key).occurredAt) > Date.parse(entry.occurredAt))) fail('A linked study session cannot occur after its assessed outcome.');
    if (kind === 'assessments' && entry.recallAttemptId && Date.parse(attempts.get(entry.recallAttemptId).occurredAt) > Date.parse(entry.occurredAt)) fail('An assessment cannot precede its linked recall attempt.');
  }
  if (bytes(JSON.stringify(result)) > MAX_WORKSPACE_BYTES) fail(`Workspace exceeds the ${MAX_WORKSPACE_BYTES}-byte limit.`);
  return result;
}
/** Explicit v1 -> v2 migration. Missing activity remains not recorded. */
export function migrateWorkspace(input) {
  object(input, 'Workspace');
  if (![1, WORKSPACE_VERSION].includes(input.version)) fail('Unsupported workspace version; update Recall Lab before opening this data.');
  const result = json(input);
  result.version = WORKSPACE_VERSION;
  for (const collection of STUDY_COLLECTIONS) if (result[collection] === undefined) result[collection] = [];
  return validateCurrentWorkspace(result);
}
export const validateWorkspace = migrateWorkspace;
function collections(factory) { return Object.fromEntries(WORKSPACE_COLLECTIONS.map((collection) => [collection, factory()])); }
export function emptyWorkspaceDocument() {
  return { schemaVersion: WORKSPACE_DOCUMENT_VERSION, workspace: emptyWorkspace(), versions: collections(() => ({})), tombstones: collections(() => []) };
}
export function migrateWorkspaceDocument(input) {
  object(input, 'Workspace document');
  if (![2, WORKSPACE_DOCUMENT_VERSION].includes(input.schemaVersion)) fail('Unsupported workspace document schema version; update Recall Lab before opening this data.');
  if (input.schemaVersion === 2 && input.workspace?.version !== 1) fail('Schema version 2 requires workspace version 1.');
  if (input.schemaVersion === 3 && input.workspace?.version !== 2) fail('Schema version 3 requires workspace version 2.');
  const result = { ...json(input), schemaVersion: WORKSPACE_DOCUMENT_VERSION, workspace: validateWorkspace(input.workspace), versions: {}, tombstones: {} };
  object(input.versions, 'Workspace versions', WORKSPACE_COLLECTIONS);
  object(input.tombstones, 'Workspace tombstones', WORKSPACE_COLLECTIONS);
  for (const collection of WORKSPACE_COLLECTIONS) {
    const legacyOptional = STUDY_COLLECTIONS.includes(collection);
    const versionEntries = input.versions[collection] ?? (legacyOptional ? {} : undefined);
    object(versionEntries, `${collection} versions`);
    const entries = Object.entries(versionEntries);
    if (entries.length > LIMITS[collection]) fail(`Too many ${collection} version entries.`);
    result.versions[collection] = Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, stamp]) => [id(key, 'Version id'), timestamp(stamp, 'Version updatedAt')]));
    const live = new Set(result.workspace[collection].map((entry) => entry.id));
    if (live.size !== entries.length || [...live].some((key) => !Object.hasOwn(result.versions[collection], key))) fail(`${collection} versions must match the live records exactly.`);
    const tombstones = input.tombstones[collection] ?? (legacyOptional ? [] : undefined);
    if (!Array.isArray(tombstones) || tombstones.length > 20_000) fail(`Too many ${collection} tombstones.`);
    result.tombstones[collection] = tombstones.map((entry) => {
      object(entry, 'Deletion tombstone', ['id', 'updatedAt']);
      return { id: id(entry.id, 'Tombstone id'), updatedAt: timestamp(entry.updatedAt, 'Tombstone updatedAt') };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const deleted = new Set(result.tombstones[collection].map((entry) => entry.id));
    if (deleted.size !== result.tombstones[collection].length || [...deleted].some((key) => live.has(key))) fail('Duplicate or simultaneously live deletion tombstones are not allowed.');
  }
  if (bytes(JSON.stringify(result)) > MAX_WORKSPACE_BYTES) fail(`Workspace document exceeds the ${MAX_WORKSPACE_BYTES}-byte limit.`);
  return result;
}
export const validateWorkspaceDocument = migrateWorkspaceDocument;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function nowTime(now) { return timestamp(new Date(now).toISOString(), 'Timestamp'); }
function nextTime(now, previous = EPOCH) { return new Date(Math.max(Date.parse(nowTime(now)), Date.parse(previous) + 1)).toISOString(); }
function states(document, collection) {
  const result = new Map(document.tombstones[collection].map((entry) => [entry.id, { record: null, updatedAt: entry.updatedAt }]));
  for (const entry of document.workspace[collection]) result.set(entry.id, { record: entry, updatedAt: document.versions[collection][entry.id] });
  return result;
}
// The preserved original UI removes original course/lecture arrays. Carry new
// records through those snapshots, then honor real parent deletions and detach
// optional live links. Imported orphan records still fail validation: cleanup
// only applies to IDs known to have been deliberately removed from this base.
function reconcileDeletedReferences(input, previous) {
  const workspace = clone(input);
  const removed = collections(() => new Set());
  for (const kind of WORKSPACE_COLLECTIONS) {
    const live = new Set((workspace[kind] ?? []).map((entry) => entry.id));
    for (const entry of previous[kind]) if (!live.has(entry.id)) removed[kind].add(entry.id);
  }
  for (const entry of workspace.lectures) if (removed.courses.has(entry.courseId)) removed.lectures.add(entry.id);
  workspace.lectures = workspace.lectures.filter((entry) => !removed.lectures.has(entry.id));
  const priorLectures = new Map(previous.lectures.map((entry) => [entry.id, entry]));
  const liveLectures = new Map(workspace.lectures.map((entry) => [entry.id, entry]));
  // Original lecture moves also move lecture-scoped concepts. Keep the course
  // relationship aligned without rewriting historical review associations.
  for (const entry of workspace.concepts) {
    const before = previous.concepts.find((concept) => concept.id === entry.id);
    const oldLecture = priorLectures.get(entry.lectureId), currentLecture = liveLectures.get(entry.lectureId);
    if (before?.lectureId === entry.lectureId && oldLecture && currentLecture && oldLecture.courseId !== currentLecture.courseId && entry.courseId === oldLecture.courseId) entry.courseId = currentLecture.courseId;
  }
  for (const kind of WORKSPACE_COLLECTIONS) {
    if (['courses', 'lectures', 'reviews', 'studySettings', 'media'].includes(kind)) continue;
    workspace[kind] = workspace[kind].filter((entry) => {
      const deletedParent = removed.lectures.has(entry.lectureId) || (['cards', 'concepts'].includes(kind) && removed.courses.has(entry.courseId));
      if (deletedParent) removed[kind].add(entry.id);
      return !deletedParent;
    });
  }
  const detach = (entry, field, kind, multiple = false) => {
    if (multiple && Array.isArray(entry[field])) entry[field] = entry[field].filter((key) => !removed[kind].has(key));
    else if (!multiple && removed[kind].has(entry[field])) entry[field] = '';
  };
  for (const entry of workspace.cards) detach(entry, 'conceptIds', 'concepts', true);
  for (const entry of workspace.studySessions) {
    detach(entry, 'passId', 'viewingPasses');
    for (const [field, kind] of [['conceptIds', 'concepts'], ['cardIds', 'cards'], ['gapIds', 'gaps']]) detach(entry, field, kind, true);
  }
  for (const entry of workspace.transcriptionSegments) detach(entry, 'sessionId', 'studySessions');
  for (const entry of workspace.gaps) { detach(entry, 'conceptId', 'concepts'); detach(entry, 'recallAttemptId', 'recallAttempts'); }
  for (const entry of workspace.recallAttempts) { detach(entry, 'recallId', 'recalls'); detach(entry, 'studySessionIds', 'studySessions', true); }
  const attempts = new Map(workspace.recallAttempts.map((entry) => [entry.id, entry]));
  for (const entry of workspace.assessments) {
    detach(entry, 'conceptId', 'concepts'); detach(entry, 'recallAttemptId', 'recallAttempts'); detach(entry, 'studySessionIds', 'studySessions', true);
    // Removing an expected idea keeps its recorded observation, now unscoped.
    const oldAttempt = previous.recallAttempts.find((attempt) => attempt.id === entry.recallAttemptId);
    if (!entry.recallAttemptId || (oldAttempt?.expectedIdeas.some((idea) => idea.id === entry.expectedIdeaId) && !attempts.get(entry.recallAttemptId)?.expectedIdeas.some((idea) => idea.id === entry.expectedIdeaId))) entry.expectedIdeaId = '';
  }
  return workspace;
}
export function createWorkspaceDocument(workspaceInput, previousInput = emptyWorkspaceDocument(), now = new Date()) {
  const previous = validateWorkspaceDocument(previousInput);
  object(workspaceInput, 'Workspace');
  const snapshot = json(workspaceInput);
  for (const collection of STUDY_COLLECTIONS) if (snapshot[collection] === undefined) snapshot[collection] = clone(previous.workspace[collection]);
  const workspace = validateWorkspace(reconcileDeletedReferences(snapshot, previous.workspace));
  const result = { ...previous, ...emptyWorkspaceDocument() };
  result.workspace = workspace;
  for (const collection of WORKSPACE_COLLECTIONS) {
    const old = states(previous, collection);
    const live = new Set(workspace[collection].map((entry) => entry.id));
    for (const entry of workspace[collection]) {
      const before = old.get(entry.id);
      result.versions[collection][entry.id] = before?.record && same(before.record, entry) ? before.updatedAt : nextTime(now, before?.updatedAt);
    }
    for (const [key, before] of old) if (!live.has(key)) result.tombstones[collection].push({ id: key, updatedAt: before.record ? nextTime(now, before.updatedAt) : before.updatedAt });
  }
  return validateWorkspaceDocument(result);
}
export function parseWorkspaceDocument(value) {
  if (typeof value !== 'string' || bytes(value) > MAX_WORKSPACE_BYTES) fail('Workspace file is too large.');
  let input;
  try { input = JSON.parse(value); } catch { fail('Workspace file is not valid JSON.'); }
  return validateWorkspaceDocument(input);
}
export function serializeWorkspaceDocument(input) {
  const value = `${JSON.stringify(validateWorkspaceDocument(input), null, 2)}\n`;
  if (bytes(value) > MAX_WORKSPACE_BYTES) fail('Formatted workspace file is too large.');
  return value;
}
function equalState(a, b) { return a === b || Boolean(a && b && same(a.record, b.record)); }
function chooseState(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.record === null || b.record === null) return a.record === null ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return JSON.stringify(a.record) >= JSON.stringify(b.record) ? a : b;
}
function mergedFields(local, remote, base) {
  const result = {};
  for (const field of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    const leftChanged = !same(local[field], base[field]);
    const rightChanged = !same(remote[field], base[field]);
    if (leftChanged && rightChanged && !same(local[field], remote[field])) return null;
    const value = leftChanged ? local[field] : remote[field];
    if (value !== undefined) result[field] = value;
  }
  return result;
}
function setState(document, collection, key, state) {
  const index = document.workspace[collection].findIndex((entry) => entry.id === key);
  if (index !== -1) document.workspace[collection].splice(index, 1);
  document.tombstones[collection] = document.tombstones[collection].filter((entry) => entry.id !== key);
  delete document.versions[collection][key];
  if (state?.record) {
    document.workspace[collection].push(clone(state.record));
    document.versions[collection][key] = state.updatedAt;
  } else if (state) document.tombstones[collection].push({ id: key, updatedAt: state.updatedAt });
}
function relatedIds(collection, key, documents) {
  const group = collections(() => new Set());
  group[collection].add(key);
  const all = collections(() => []);
  for (const document of documents) for (const kind of WORKSPACE_COLLECTIONS) all[kind].push(...document.workspace[kind]);
  let changed;
  do {
    const previousSize = WORKSPACE_COLLECTIONS.reduce((size, kind) => size + group[kind].size, 0);
    for (const kind of WORKSPACE_COLLECTIONS) for (const entry of all[kind]) {
      if (collection === 'courses' && entry.courseId === key) group[kind].add(entry.id);
      if (collection === 'media' && kind === 'cards' && dependencies(kind, entry).some((relation) => relation.targetCollection === 'media' && relation.targetId === key)) group.cards.add(entry.id);
      if (collection !== 'media' && kind !== 'reviews' && group.lectures.has(entry.lectureId)) group[kind].add(entry.id);
      // A group includes every live dependency, so both preserved alternatives
      // are independently valid even when an observation links another session.
      if (group[kind].has(entry.id)) for (const relation of dependencies(kind, entry)) group[relation.targetCollection].add(relation.targetId);
    }
    changed = previousSize !== WORKSPACE_COLLECTIONS.reduce((size, kind) => size + group[kind].size, 0);
  } while (changed);
  return group;
}
function contextFor(document, group) {
  const context = emptyWorkspaceDocument();
  for (const collection of WORKSPACE_COLLECTIONS) for (const [key, state] of states(document, collection)) if (group[collection].has(key)) setState(context, collection, key, state);
  return context;
}
function makeConflict(collection, key, local, remote, base, reason, documents) {
  const chosen = chooseState(local, remote);
  const conflict = {
    id: `${collection}:${key}`, entityType: collection, entityId: key, kind: collection,
    local: clone(local?.record ?? null), remote: clone(remote?.record ?? null), base: clone(base?.record ?? null),
    localVersion: local?.updatedAt ?? EPOCH, remoteVersion: remote?.updatedAt ?? EPOCH,
    winner: chosen === local ? 'local' : 'remote', reason,
  };
  const relationshipFields = [...(RELATIONS[collection] ?? []).map(([field]) => field), ...(collection === 'cards' ? ['questionImages', 'answerImages', 'occlusion'] : [])];
  const relationshipsDiffer = relationshipFields.some((field) => !same(local?.record?.[field], remote?.record?.[field]));
  // Ordinary question, answer and schedule conflicts need only their records.
  // Avoid duplicating whole lecture notes for every conflicted sibling card.
  if (reason === 'reference-integrity' || !local?.record || !remote?.record || relationshipsDiffer) {
    const group = relatedIds(collection, key, documents);
    conflict.related = Object.fromEntries(WORKSPACE_COLLECTIONS.map((kind) => [kind, [...group[kind]].sort()]));
    conflict.context = { local: contextFor(documents[0], group), remote: contextFor(documents[1], group), base: contextFor(documents[2], group) };
  }
  return conflict;
}
function applyContext(document, context, group, stamp, root) {
  for (const collection of WORKSPACE_COLLECTIONS) {
    const current = states(document, collection);
    const selected = states(context, collection);
    for (const key of group[collection]) {
      const state = selected.get(key);
      // Dependency courses are ancestors, not a choice to remove another
      // independent course or overwrite its concurrently edited title/notes.
      if (collection === 'courses' && root && (root.collection !== 'courses' || root.id !== key)) {
        if (!current.get(key)?.record && state?.record) setState(document, collection, key, { ...state, updatedAt: stamp ?? state.updatedAt });
        continue;
      }
      if (collection === 'lectures' && root?.collection === 'media') {
        if (!current.get(key)?.record && state?.record) setState(document, collection, key, { ...state, updatedAt: stamp ?? state.updatedAt });
        continue;
      }
      if (state) setState(document, collection, key, { ...state, updatedAt: stamp ?? state.updatedAt });
      else setState(document, collection, key, stamp ? { record: null, updatedAt: stamp } : undefined);
    }
  }
}
function decidedIds(conflict) {
  const ids = new Set([conflict.id]);
  if (!conflict.related) return ids;
  for (const collection of WORKSPACE_COLLECTIONS) {
    // Existing dependency courses remain independent of a child/group choice.
    if (collection === 'courses' || (collection === 'lectures' && conflict.kind === 'media')) continue;
    for (const key of conflict.related[collection] ?? []) ids.add(`${collection}:${key}`);
  }
  return ids;
}
function coalesceReferenceConflicts(conflicts) {
  const references = conflicts.filter((entry) => entry.reason === 'reference-integrity').sort((a, b) => {
    const priority = (entry) => entry.kind === 'courses' ? 0 : 1;
    return priority(a) - priority(b) || a.id.localeCompare(b.id);
  });
  const covered = new Set();
  const keptReferences = new Set();
  for (const conflict of references) {
    if (covered.has(conflict.id)) continue;
    keptReferences.add(conflict.id);
    for (const key of decidedIds(conflict)) covered.add(key);
  }
  return conflicts.filter((entry) => keptReferences.has(entry.id) || !covered.has(entry.id));
}

/** Three-way merge by stable entity ID; omissions alone never delete saved records. */
export function mergeWorkspaceDocuments(localInput, remoteInput, baseInput = emptyWorkspaceDocument()) {
  const local = validateWorkspaceDocument(localInput);
  const remote = validateWorkspaceDocument(remoteInput);
  const base = validateWorkspaceDocument(baseInput);
  const documents = [local, remote, base];
  const result = emptyWorkspaceDocument();
  const conflicts = new Map();
  const documentExtras = (document) => Object.fromEntries(Object.entries(document).filter(([key]) => !['schemaVersion', 'workspace', 'versions', 'tombstones'].includes(key)));
  const documentExtraMerge = mergedFields(documentExtras(local), documentExtras(remote), documentExtras(base));
  if (documentExtraMerge === null) fail('Concurrent document extension changes require an explicit import choice.');
  Object.assign(result, documentExtraMerge);
  // Retain extension fields as well as every original workspace collection.
  const extras = (workspace) => Object.fromEntries(Object.entries(workspace).filter(([key]) => key !== 'version' && !WORKSPACE_COLLECTIONS.includes(key)));
  const extraMerge = mergedFields(extras(local.workspace), extras(remote.workspace), extras(base.workspace));
  if (extraMerge === null) fail('Concurrent workspace extension changes require an explicit import choice.');
  Object.assign(result.workspace, extraMerge);
  for (const collection of WORKSPACE_COLLECTIONS) {
    const left = states(local, collection), right = states(remote, collection), before = states(base, collection);
    const keys = [...new Set([...left.keys(), ...right.keys(), ...before.keys()])];
    for (const key of keys) {
      const baseline = before.get(key), a = left.get(key) ?? baseline, b = right.get(key) ?? baseline;
      let chosen;
      if (equalState(a, b)) chosen = chooseState(a, b);
      else if (equalState(a, baseline)) chosen = b;
      else if (equalState(b, baseline)) chosen = a;
      else if (!a || !b) chosen = a ?? b;
      else {
        const fields = a.record && b.record && baseline?.record ? mergedFields(a.record, b.record, baseline.record) : null;
        if (fields) chosen = { record: record(fields, collection), updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt };
        else {
          chosen = chooseState(a, b);
          const reason = Boolean(a.record) !== Boolean(b.record) ? 'delete-edit' : 'concurrent-edit';
          conflicts.set(`${collection}:${key}`, makeConflict(collection, key, a, b, baseline, reason, documents));
        }
      }
      setState(result, collection, key, chosen);
    }
  }
  // A deletion or a lecture move can collide with a different record's edit.
  // Keep an explicitly selected, valid affected group while retaining both groups
  // in the conflict; never silently drop a newly added card to fix a reference.
  let repairs = 0;
  while (referenceIssues(result.workspace).length) {
    if (++repairs > 100) fail('Workspace has too many overlapping reference conflicts.');
    const issue = referenceIssues(result.workspace)[0];
    const target = issue.targetCollection, key = issue.targetId;
    const alternatives = documents.map((document) => states(document, target).get(key));
    const conflict = makeConflict(target, key, alternatives[0], alternatives[1], alternatives[2], 'reference-integrity', documents);
    conflict.reference = issue;
    conflicts.set(conflict.id, conflict);
    const candidate = alternatives.findIndex((entry) => entry?.record && (!issue.expectedCourseId || !['lectures', 'concepts'].includes(target) || entry.record.courseId === issue.expectedCourseId) && (!issue.expectedLectureId || !entry.record.lectureId || entry.record.lectureId === issue.expectedLectureId));
    const index = candidate === -1 ? alternatives.findIndex((entry) => entry?.record) : candidate;
    if (index === -1) fail('A referenced course or lecture has no recoverable alternative.');
    const context = conflict.context[index === 0 ? 'local' : index === 1 ? 'remote' : 'base'];
    applyContext(result, context, conflict.related, undefined, { collection: target, id: key });
    conflict.winner = index === 0 ? 'local' : index === 1 ? 'remote' : 'base';
  }
  return { document: validateWorkspaceDocument(result), conflicts: coalesceReferenceConflicts([...conflicts.values()]) };
}

/** Explicit choices refresh versions, carry deletions, and keep references valid. */
export function resolveWorkspaceConflict(documentInput, conflict, choice, now = new Date()) {
  const document = validateWorkspaceDocument(documentInput);
  const previousWorkspace = clone(document.workspace);
  if (!['local', 'remote'].includes(choice) || !WORKSPACE_COLLECTIONS.includes(conflict?.kind) || conflict.id !== `${conflict.kind}:${conflict.entityId}`) fail('Choose a valid local or remote workspace conflict alternative.');
  const collection = conflict.kind, key = id(conflict.entityId, 'Conflict id');
  const selected = conflict[choice] === null ? null : record(conflict[choice], collection);
  if (selected && selected.id !== key) fail('Conflict alternative has a different entity ID.');
  const versions = [conflict.localVersion, conflict.remoteVersion, ...WORKSPACE_COLLECTIONS.flatMap((kind) => Object.values(document.versions[kind])), ...WORKSPACE_COLLECTIONS.flatMap((kind) => document.tombstones[kind].map((entry) => entry.updatedAt))].filter(Boolean).map((value) => timestamp(value, 'Conflict version'));
  const stamp = nextTime(now, versions.sort().at(-1) ?? EPOCH);
  setState(document, collection, key, { record: selected, updatedAt: stamp });
  if (conflict.reason === 'reference-integrity') {
    const context = validateWorkspaceDocument(conflict.context?.[choice]);
    const related = conflict.related;
    object(related, 'Conflict related records', WORKSPACE_COLLECTIONS);
    for (const kind of WORKSPACE_COLLECTIONS) {
      if (!Array.isArray(related[kind]) || related[kind].length > LIMITS[kind] + 20_000) fail('Invalid related conflict records.');
      for (const relatedId of related[kind]) id(relatedId, 'Related conflict id');
    }
    applyContext(document, context, related, stamp, { collection, id: key });
    // Sparse contexts must still explicitly keep the chosen target's tombstone.
    setState(document, collection, key, { record: selected, updatedAt: stamp });
  } else if (selected !== null && ['courses', 'lectures'].includes(collection) && (conflict.local === null || conflict.remote === null) && conflict.context?.[choice]) {
    // Restoring a deleted parent restores that side's associated saved content.
    applyContext(document, validateWorkspaceDocument(conflict.context[choice]), conflict.related, stamp, { collection, id: key });
    setState(document, collection, key, { record: selected, updatedAt: stamp });
  } else if (selected === null) {
    const lectures = collection === 'courses' ? new Set(document.workspace.lectures.filter((entry) => entry.courseId === key).map((entry) => entry.id)) : new Set(collection === 'lectures' ? [key] : []);
    for (const lectureId of lectures) setState(document, 'lectures', lectureId, { record: null, updatedAt: stamp });
    for (const card of [...document.workspace.cards]) if ((collection === 'courses' && card.courseId === key) || lectures.has(card.lectureId)) setState(document, 'cards', card.id, { record: null, updatedAt: stamp });
    for (const recall of [...document.workspace.recalls]) if (lectures.has(recall.lectureId)) setState(document, 'recalls', recall.id, { record: null, updatedAt: stamp });
  }
  // A chosen edited card may depend on a parent absent from the tentative merge.
  if (referenceIssues(document.workspace).length && conflict.context?.[choice]) {
    const context = validateWorkspaceDocument(conflict.context[choice]);
    applyContext(document, context, conflict.related, stamp, { collection, id: key });
    setState(document, collection, key, { record: selected, updatedAt: stamp });
  }
  const repaired = reconcileDeletedReferences(document.workspace, previousWorkspace);
  for (const kind of WORKSPACE_COLLECTIONS) {
    const before = new Map(document.workspace[kind].map((entry) => [entry.id, entry]));
    const live = new Set(repaired[kind].map((entry) => entry.id));
    for (const entry of repaired[kind]) if (!same(before.get(entry.id), entry)) setState(document, kind, entry.id, { record: entry, updatedAt: stamp });
    for (const entry of before.values()) if (!live.has(entry.id)) setState(document, kind, entry.id, { record: null, updatedAt: stamp });
  }
  return validateWorkspaceDocument(document);
}
/** Resolve one current choice and consume every record choice that it decides. */
export function resolveWorkspaceConflicts(documentInput, conflictsInput, conflictId, choice, now = new Date()) {
  const before = validateWorkspaceDocument(documentInput);
  if (!Array.isArray(conflictsInput) || conflictsInput.length > 20_000) fail('Invalid workspace conflict list.');
  const conflicts = conflictsInput.map((conflict) => {
    if (!conflict || !WORKSPACE_COLLECTIONS.includes(conflict.kind) || typeof conflict.entityId !== 'string' || conflict.id !== `${conflict.kind}:${conflict.entityId}`) fail('Invalid workspace conflict entry.');
    return clone(conflict);
  });
  if (new Set(conflicts.map((conflict) => conflict.id)).size !== conflicts.length) fail('Duplicate workspace conflicts are not allowed.');
  const selected = conflicts.find((conflict) => conflict.id === conflictId);
  if (!selected) fail('This workspace conflict is no longer pending.');
  const document = resolveWorkspaceConflict(before, selected, choice, now);
  const decided = new Set([selected.id]);
  for (const collection of WORKSPACE_COLLECTIONS) {
    const oldStates = states(before, collection), newStates = states(document, collection);
    for (const key of new Set([...oldStates.keys(), ...newStates.keys()])) {
      // Version changes also mark a same-content group alternative as decided.
      if (!same(oldStates.get(key), newStates.get(key))) decided.add(`${collection}:${key}`);
    }
  }
  return { document, conflicts: conflicts.filter((conflict) => !decided.has(conflict.id)) };
}
export function mergeWorkspaces(local, remote, base = emptyWorkspace()) {
  const baseline = createWorkspaceDocument(base, emptyWorkspaceDocument(), EPOCH);
  const result = mergeWorkspaceDocuments(createWorkspaceDocument(local, baseline), createWorkspaceDocument(remote, baseline), baseline);
  return { ...result, document: result.document.workspace };
}
