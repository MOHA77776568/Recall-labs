import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteStudyRecord, effectiveTranscriptionRanges, formatTimestamp, localDateKey, localDateTimeToUTC, logViewing, normalizeRanges, parseTimestamp, saveLecturePlan, transcriptionSummary, unionRanges, upsertTranscriptionSegment, viewingSummary } from '../lib/study.js';

function workspace(durationSeconds = 3600) {
  return { version: 2, courses: [{ id: 'course', title: 'Synthetic course' }], lectures: [{ id: 'lecture', courseId: 'course', title: 'Synthetic lecture' }], cards: [], recalls: [], reviews: [], lecturePlans: [{ id: 'plan', lectureId: 'lecture', durationSeconds, baselineCompleteCount: 0, transcriptionScope: 'full', targetRanges: [], transcriptionMethod: 'verbatim' }], viewingPasses: [], studySessions: [], transcriptionSegments: [], concepts: [], gaps: [], recallAttempts: [], assessments: [], studySettings: [] };
}
const when = '2026-10-01T09:00:00.000Z';
const segment = (id, start, end, status, modifiedAt = when, method = 'verbatim') => ({ id, lectureId: 'lecture', start, end, status, method, occurredAt: when, modifiedAt, sessionId: '', reference: '', note: '', attachmentId: '' });

test('a first pass across three sessions auto completes at exactly 100% coverage', () => {
  let value = workspace();
  for (const [index, [start, end]] of [[0, 1200], [1200, 2400], [2400, 3600]].entries()) value = logViewing(value, { lectureId: 'lecture', passKind: 'first', occurredAt: `2026-10-0${index + 1}T09:00:00.000Z`, ranges: [{ start, end }] });
  const summary = viewingSummary(value, 'lecture');
  assert.equal(summary.completedPassCount, 1); assert.equal(summary.sessionCount, 3); assert.equal(value.viewingPasses.length, 1);
  assert.equal(value.viewingPasses[0].completion, 'coverage'); assert.equal(value.viewingPasses[0].completedAt, '2026-10-03T09:00:00.000Z');
});

test('full passes, targeted revisits, and historical baseline stay distinct', () => {
  let value = workspace();
  value = logViewing(value, { lectureId: 'lecture', passKind: 'first', complete: true, occurredAt: when });
  value = logViewing(value, { lectureId: 'lecture', passKind: 'rewatch', complete: true, occurredAt: when, startNewPass: true });
  for (let index = 0; index < 3; index += 1) value = logViewing(value, { lectureId: 'lecture', passKind: 'targeted', occurredAt: when, ranges: [{ start: 0, end: 600 }] });
  let summary = viewingSummary(value, 'lecture');
  assert.equal(summary.completedPassCount, 2); assert.equal(summary.targetedRevisitCount, 3); assert.equal(summary.sessionCount, 5);
  value = saveLecturePlan(value, { lectureId: 'lecture', baselineCompleteCount: 4 }); summary = viewingSummary(value, 'lecture');
  assert.equal(summary.completedPassCount, 6); assert.equal(summary.datedCompletedPassCount, 2); assert.equal(summary.baselineCompleteCount, 4); assert.equal(summary.sessionCount, 5);
});

test('overlapping viewing sessions cover 30 unique minutes, not 40', () => {
  let value = workspace();
  value = logViewing(value, { lectureId: 'lecture', passKind: 'first', occurredAt: when, ranges: [{ start: 0, end: 1200 }] });
  value = logViewing(value, { lectureId: 'lecture', passKind: 'first', occurredAt: when, ranges: [{ start: 600, end: 1800 }] });
  assert.equal(viewingSummary(value, 'lecture').passes[0].coverageSeconds, 1800);
  assert.equal(viewingSummary(value, 'lecture').completedPassCount, 0);
});

test('a 99.9% pass stays incomplete; unknown duration requires manual confirmation', () => {
  const incomplete = logViewing(workspace(), { lectureId: 'lecture', occurredAt: when, ranges: [{ start: 0, end: 3599 }] });
  assert.equal(viewingSummary(incomplete, 'lecture').completedPassCount, 0);
  const unknown = logViewing(workspace(null), { lectureId: 'lecture', occurredAt: when, ranges: [{ start: 0, end: 9999 }] });
  assert.equal(viewingSummary(unknown, 'lecture').passes[0].coveragePercent, null);
  const confirmed = logViewing(unknown, { lectureId: 'lecture', passId: unknown.viewingPasses[0].id, complete: true, occurredAt: when });
  assert.equal(viewingSummary(confirmed, 'lecture').completedPassCount, 1); assert.equal(confirmed.viewingPasses[0].completion, 'manual');
});

test('deleting a contributing session removes automatic completion and supports durable reload', () => {
  let value = logViewing(workspace(), { lectureId: 'lecture', occurredAt: when, ranges: [{ start: 0, end: 3600 }] });
  assert.equal(viewingSummary(value, 'lecture').completedPassCount, 1);
  value = deleteStudyRecord(value, 'studySessions', value.studySessions[0].id);
  const restored = JSON.parse(JSON.stringify(value));
  assert.equal(viewingSummary(restored, 'lecture').completedPassCount, 0); assert.equal(restored.viewingPasses[0].completion, null);
});

test('transcription union and verification denominator match the 60-minute example', () => {
  const value = workspace(); value.transcriptionSegments = [segment('written', 0, 1800, 'written'), segment('verified', 0, 900, 'verified', '2026-10-01T10:00:00.000Z')];
  const summary = transcriptionSummary(value, 'lecture');
  assert.equal(summary.writtenSeconds, 1800); assert.equal(summary.verifiedSeconds, 900); assert.equal(summary.writtenPercent, 50); assert.equal(summary.verifiedPercent, 25);
  value.transcriptionSegments = [segment('a', 0, 1200, 'written'), segment('b', 600, 1800, 'written')];
  assert.equal(transcriptionSummary(value, 'lecture').writtenSeconds, 1800);
});

test('disjoint transcription exposes the earliest unfinished range', () => {
  const value = workspace(); value.transcriptionSegments = [segment('a', 0, 600, 'verified'), segment('b', 1200, 1800, 'written')];
  const summary = transcriptionSummary(value, 'lecture');
  assert.deepEqual(summary.nextUnfinishedRange, { start: 600, end: 1200 }); assert.deepEqual(summary.unfinishedRanges, [{ start: 600, end: 1200 }, { start: 1800, end: 3600 }]);
});

test('selected targets use a union denominator and exclude out-of-target work', () => {
  const value = workspace(); value.lecturePlans[0].transcriptionScope = 'selected'; value.lecturePlans[0].targetRanges = [{ start: 0, end: 1200 }, { start: 600, end: 1800 }, { start: 2400, end: 3000 }];
  value.transcriptionSegments = [segment('a', 0, 3600, 'written')];
  const summary = transcriptionSummary(value, 'lecture');
  assert.equal(summary.targetSeconds, 2400); assert.equal(summary.writtenSeconds, 2400); assert.equal(summary.writtenPercent, 100);
});

test('unknown full duration and not planned never invent a percentage or overdue segment', () => {
  const value = workspace(null); value.transcriptionSegments = [segment('a', 0, 900, 'written')];
  let summary = transcriptionSummary(value, 'lecture'); assert.equal(summary.writtenPercent, null); assert.equal(summary.writtenSeconds, 900); assert.equal(summary.nextUnfinishedRange, null);
  value.lecturePlans[0].transcriptionScope = 'none'; summary = transcriptionSummary(value, 'lecture'); assert.equal(summary.planned, false); assert.equal(summary.nextUnfinishedRange, null);
});

test('latest status removes stale verification; deleting the actual verification removes it', () => {
  const value = workspace(); value.transcriptionSegments = [segment('old', 0, 1800, 'verified'), segment('new', 600, 1200, 'written', '2026-10-02T09:00:00.000Z')];
  let summary = transcriptionSummary(value, 'lecture'); assert.equal(summary.writtenSeconds, 1800); assert.equal(summary.verifiedSeconds, 1200);
  value.transcriptionSegments.push(segment('reset', 0, 600, 'not-started', '2026-10-03T09:00:00.000Z')); summary = transcriptionSummary(value, 'lecture'); assert.equal(summary.writtenSeconds, 1200); assert.equal(summary.verifiedSeconds, 600);
  const removed = deleteStudyRecord(value, 'transcriptionSegments', 'old'); summary = transcriptionSummary(JSON.parse(JSON.stringify(removed)), 'lecture'); assert.equal(summary.verifiedSeconds, 0); assert.equal(summary.writtenSeconds, 600);
});

test('editing a verified range requires a fresh explicit confirmation', () => {
  let value = workspace(); value.transcriptionSegments = [segment('verified', 0, 1200, 'verified')];
  value = upsertTranscriptionSegment(value, { id: 'verified', lectureId: 'lecture', start: 0, end: 900, status: 'verified', occurredAt: when });
  assert.equal(value.transcriptionSegments[0].status, 'written'); assert.equal(transcriptionSummary(value, 'lecture').verifiedSeconds, 0);
  value = upsertTranscriptionSegment(value, { id: 'verified', lectureId: 'lecture', start: 0, end: 900, status: 'verified', occurredAt: when, verifyConfirmed: true });
  assert.equal(transcriptionSummary(value, 'lecture').verifiedSeconds, 900);
});

test('writing in own words and from memory stays separate from verbatim transcription', () => {
  const value = workspace(); value.transcriptionSegments = [segment('notes', 0, 3600, 'verified', when, 'own-words'), segment('memory', 0, 3600, 'written', when, 'memory')];
  assert.equal(transcriptionSummary(value, 'lecture').writtenSeconds, 0); assert.equal(transcriptionSummary(value, 'lecture', { method: 'own-words' }).verifiedSeconds, 3600);
});

test('source ranges reject negative, reversed, nonfinite, and out-of-bounds values', () => {
  for (const range of [{ start: -1, end: 10 }, { start: 10, end: 10 }, { start: 11, end: 10 }, { start: NaN, end: 20 }, { start: 0, end: Infinity }]) assert.throws(() => normalizeRanges([range]));
  assert.throws(() => normalizeRanges([{ start: 0, end: 61 }], 60));
  assert.deepEqual(unionRanges([{ start: 0, end: 20 }, { start: 20, end: 30 }]), [{ start: 0, end: 30 }]);
});

test('timestamp parsing and local Amman dates are independent of UTC date and OS zone', () => {
  assert.equal(parseTimestamp('20:00'), 1200); assert.equal(parseTimestamp('1:05:07'), 3907); assert.equal(formatTimestamp(3907), '1:05:07'); assert.throws(() => parseTimestamp('1:70'));
  assert.equal(localDateKey('2026-10-01T21:30:00.000Z'), '2026-10-02');
  assert.equal(localDateTimeToUTC('2026-10-02T00:30'), '2026-10-01T21:30:00.000Z');
  assert.equal(localDateTimeToUTC('2026-10-02'), '2026-10-01T21:00:00.000Z');
  assert.throws(() => localDateTimeToUTC('2026-02-31')); assert.throws(() => localDateTimeToUTC('2026-10-02T29:00'));
});

test('undefined input IDs generate stable records; mutation does not change its input', () => {
  const value = workspace(), before = JSON.stringify(value);
  const updated = logViewing(value, { id: undefined, lectureId: 'lecture', complete: true, occurredAt: when });
  assert.equal(typeof updated.studySessions[0].id, 'string'); assert.equal(JSON.stringify(value), before); assert.equal('complete' in updated.studySessions[0], false);
  const transcribed = upsertTranscriptionSegment(value, { id: undefined, lectureId: 'lecture', start: 0, end: 120, occurredAt: when }); assert.equal(typeof transcribed.transcriptionSegments[0].id, 'string');
});

test('deleting a viewing pass preserves a shared transcription sitting and unlinks it', () => {
  let value = logViewing(workspace(), { lectureId: 'lecture', occurredAt: when, ranges: [{ start: 0, end: 600 }], activities: ['viewing', 'transcription'], effortMinutes: 45 });
  value = deleteStudyRecord(value, 'viewingPasses', value.viewingPasses[0].id);
  assert.equal(value.studySessions.length, 1); assert.deepEqual(value.studySessions[0].activities, ['transcription']); assert.equal(value.studySessions[0].passId, ''); assert.equal(value.studySessions[0].effortMinutes, 45);
});

test('equal-timestamp overlaps have deterministic current effective status', () => {
  const entries = [segment('a', 0, 600, 'verified'), segment('z', 300, 600, 'written')];
  assert.deepEqual(effectiveTranscriptionRanges(entries), effectiveTranscriptionRanges([...entries].reverse()));
  assert.deepEqual(effectiveTranscriptionRanges(entries).verifiedRanges, [{ start: 0, end: 300 }]);
});

test('deleting or shrinking a correction cannot resurrect stale underlying verification', () => {
  const value = workspace(); value.transcriptionSegments = [segment('old-verified', 0, 1800, 'verified'), segment('correction', 600, 1200, 'written', '2026-10-02T09:00:00.000Z')];
  const removed = deleteStudyRecord(value, 'transcriptionSegments', 'correction');
  const summary = transcriptionSummary(removed, 'lecture');
  assert.equal(summary.verifiedSeconds, 1200); assert.equal(summary.writtenSeconds, 1200); assert.deepEqual(summary.nextUnfinishedRange, { start: 600, end: 1200 });
  const changed = upsertTranscriptionSegment(value, { id: 'correction', lectureId: 'lecture', start: 600, end: 900, status: 'written', occurredAt: when });
  assert.equal(transcriptionSummary(changed, 'lecture').verifiedSeconds, 1200); assert.equal(transcriptionSummary(changed, 'lecture').writtenSeconds, 1500);
});
