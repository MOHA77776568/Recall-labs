import { migrateWorkspace, validateWorkspace } from '../../lib/workspace.js';
import { prepareWorkspaceImport } from '../../lib/workspace-import.js';

const pendingMedia = new Map();
export function rememberCardMedia(record) { pendingMedia.set(record.id, record); }

/** Only the first actual save of a new draft records an attempt. Legacy drafts
 * have no recoverable occurrence instant, and later edits are reflections. */
export function recordOriginalRecallAttempt(next, draft, previous) {
  if (previous.recalls.some(record => record.id === draft.id) || next.recallAttempts?.some(record => record.recallId === draft.id) || (!draft.body.trim() && !draft.gaps.trim())) return next;
  return { ...next, recallAttempts: [...next.recallAttempts || [], {
    id: crypto.randomUUID(), lectureId: draft.lectureId, recallId: draft.id,
    occurredAt: draft.updatedAt, body: draft.body, gaps: draft.gaps, expectedIdeas: [],
    confidence: null, confidenceTiming: 'none', studySessionIds: [],
  }] };
}

export function hasCardFaceContent(card, side) {
  return Boolean(card[side]?.trim() || card[`${side}Images`]?.length || card.occlusion?.mediaId);
}

// A card editor can save the binary before the user confirms its workspace edit.
// Only metadata for referenced images enters the synchronized document.
export function includePendingCardMedia(workspace) {
  const next = structuredClone(workspace);
  const referenced = new Set();
  for (const card of next.cards || []) {
    for (const image of [...card.questionImages || [], ...card.answerImages || []]) referenced.add(image.mediaId);
    if (card.occlusion?.mediaId) referenced.add(card.occlusion.mediaId);
  }
  next.media ||= [];
  for (const id of referenced) {
    if (!next.media.some(record => record.id === id) && pendingMedia.has(id)) next.media.push(structuredClone(pendingMedia.get(id)));
  }
  return next;
}

/** Readable replacement for the preserved UI's older, stripping import parser. */
export function prepareUiImport(text, format, current, courseId, { parseCSV, uuid, schedule }) {
  if (new TextEncoder().encode(text).byteLength > 10_000_000) throw new Error('Import must be under 10 MB.');
  let rows;
  if (format === 'json') {
    const input = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!Array.isArray(input) && (input.schemaVersion || input.version || input.state || input.workspaceDocument)) {
      const document = prepareWorkspaceImport(input);
      return { mode: 'restore', state: document.workspace, count: document.workspace.cards.length };
    }
    rows = Array.isArray(input) ? input : input.cards;
  } else {
    const parsed = parseCSV(text);
    if (parsed.errors.length) throw new Error(`CSV: ${parsed.errors[0].message}`);
    rows = parsed.data;
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 3000) throw new Error('Import 1–3000 cards or a complete workspace backup.');
  const next = structuredClone(migrateWorkspace(current));
  let duplicate = 0;
  for (const [index, row] of rows.entries()) {
    if (!hasCardFaceContent(row, 'question') || !hasCardFaceContent(row, 'answer')) throw new Error(`Row ${index + 1} needs content on both faces.`);
    let course = next.courses.find(entry => entry.id === courseId);
    if (typeof row.course === 'string' && row.course.trim()) {
      course = next.courses.find(entry => entry.title === row.course.trim());
      if (!course) { course = { id: uuid(), title: row.course.trim(), description: '', color: 'blue' }; next.courses.push(course); }
    }
    if (!course) throw new Error('Choose a destination course or include a course column.');
    let lectureId = '';
    if (typeof row.lecture === 'string' && row.lecture.trim()) {
      let lecture = next.lectures.find(entry => entry.courseId === course.id && entry.title === row.lecture.trim());
      if (!lecture) { lecture = { id: uuid(), courseId: course.id, title: row.lecture.trim(), topic: '', notes: '', pages: [] }; next.lectures.push(lecture); }
      lectureId = lecture.id;
    }
    const question = typeof row.question === 'string' ? row.question.trim() : '';
    const answer = typeof row.answer === 'string' ? row.answer.trim() : '';
    if (question && answer && next.cards.some(card => card.courseId === course.id && card.lectureId === lectureId && card.question.trim() === question && card.answer.trim() === answer)) { duplicate++; continue; }
    next.cards.push({
      id: uuid(), courseId: course.id, lectureId, question, answer,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : typeof row.tags === 'string' ? row.tags.split(/[;|]/).map(tag => tag.trim()).filter(Boolean) : [],
      source: String(row.source || row.page || row.timestamp || ''), schedule: schedule(), createdAt: new Date().toISOString(),
      ...(row.questionImages ? { questionImages: row.questionImages } : {}),
      ...(row.answerImages ? { answerImages: row.answerImages } : {}),
      ...(row.occlusion ? { occlusion: row.occlusion } : {}),
    });
  }
  return { mode: 'merge', state: validateWorkspace(next), count: rows.length - duplicate, duplicate };
}
