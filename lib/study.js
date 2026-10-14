/** Source ranges use seconds. Coverage is a union, never a sum of overlapping work. */
export const DEFAULT_STUDY_TIMEZONE = 'Asia/Amman';
const DAY = 86_400_000;
const copy = (value) => structuredClone(value);
const stamp = (value = new Date()) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('A valid study date is required.');
  return date.toISOString();
};
const freshId = () => globalThis.crypto.randomUUID();
const records = (workspace, name) => workspace[name] ?? [];
const sumRanges = (ranges) => ranges.reduce((sum, range) => sum + range.end - range.start, 0);

export function normalizeRanges(input = [], durationSeconds = null) {
  if (!Array.isArray(input)) throw new Error('Source ranges must be an array.');
  return input.map((range) => {
    const start = Array.isArray(range) ? range[0] : range?.start;
    const end = Array.isArray(range) ? range[1] : range?.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('Each source range needs a nonnegative start and a later end.');
    if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || end > durationSeconds)) throw new Error('A source range exceeds the lecture duration.');
    return { start, end };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}

export function unionRanges(input = [], durationSeconds = null) {
  const result = [];
  for (const range of normalizeRanges(input, durationSeconds)) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

export function intersectRanges(left, right) {
  const a = unionRanges(left), b = unionRanges(right), result = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start), end = Math.min(a[i].end, b[j].end);
    if (end > start) result.push({ start, end });
    if (a[i].end < b[j].end) i += 1; else j += 1;
  }
  return result;
}

export function subtractRanges(targets, covered) {
  const result = [], union = unionRanges(covered);
  for (const target of unionRanges(targets)) {
    let cursor = target.start;
    for (const range of union) {
      if (range.end <= cursor || range.start >= target.end) continue;
      if (range.start > cursor) result.push({ start: cursor, end: Math.min(range.start, target.end) });
      cursor = Math.max(cursor, Math.min(range.end, target.end));
      if (cursor >= target.end) break;
    }
    if (cursor < target.end) result.push({ start: cursor, end: target.end });
  }
  return result;
}

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const value = Math.floor(seconds), hours = Math.floor(value / 3600), minutes = Math.floor((value % 3600) / 60), remainder = value % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function parseTimestamp(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid lecture timestamp.');
    return value;
  }
  const input = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(input)) return Number(input);
  const parts = input.split(':');
  if (![2, 3].includes(parts.length) || parts.some((part) => !/^\d+$/.test(part)) || parts.slice(1).some((part) => Number(part) >= 60)) throw new Error('Use seconds, mm:ss, or hh:mm:ss.');
  return parts.reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

const timezoneFormatters = new Map();
function zonedParts(instant, timezone) {
  if (!timezoneFormatters.has(timezone)) timezoneFormatters.set(timezone, new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  const formatter = timezoneFormatters.get(timezone);
  return Object.fromEntries(formatter.formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function localDateKey(instant, timezone = DEFAULT_STUDY_TIMEZONE) {
  const parts = zonedParts(stamp(instant), timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Interpret a wall-clock input in the configured zone, independently of the OS zone. */
export function localDateTimeToUTC(value, timezone = DEFAULT_STUDY_TIMEZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) throw new Error('Use a calendar date and optional local time.');
  const numbers = match.slice(1).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = numbers;
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) throw new Error('Invalid local date or time.');
  const requested = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(requested).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error('Invalid calendar date.');
  let instant = requested;
  for (let i = 0; i < 5; i += 1) {
    const parts = zonedParts(instant, timezone);
    const interpreted = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const adjustment = requested - interpreted;
    instant += adjustment;
    if (!adjustment) break;
  }
  const parts = zonedParts(instant, timezone);
  if ([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].some((part, index) => Number(part) !== numbers[index])) throw new Error('This local time does not exist in the selected timezone.');
  return new Date(instant).toISOString();
}

export function localDayOffset(key, offset) {
  const date = new Date(`${key}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid calendar date.');
  return new Date(date.getTime() + offset * DAY).toISOString().slice(0, 10);
}

export function lecturePlan(workspace, lectureId) {
  return records(workspace, 'lecturePlans').find((plan) => plan.lectureId === lectureId) ?? { lectureId, durationSeconds: null, baselineCompleteCount: 0, transcriptionScope: 'none', targetRanges: [], transcriptionMethod: 'verbatim' };
}

export function viewingSummary(workspace, lectureId) {
  const plan = lecturePlan(workspace, lectureId);
  const sessions = records(workspace, 'studySessions').filter((session) => session.lectureId === lectureId && session.activities.includes('viewing'));
  const passes = records(workspace, 'viewingPasses').filter((pass) => pass.lectureId === lectureId).map((pass) => {
    const contributing = sessions.filter((session) => session.passId === pass.id);
    const coverageRanges = unionRanges(contributing.flatMap((session) => session.ranges), plan.durationSeconds);
    const coverageSeconds = sumRanges(coverageRanges);
    return { ...pass, sessionCount: contributing.length, sessionIds: contributing.map((session) => session.id), coverageRanges, coverageSeconds, coveragePercent: plan.durationSeconds ? coverageSeconds / plan.durationSeconds * 100 : null };
  });
  const datedCompletedPassCount = passes.filter((pass) => pass.kind !== 'targeted' && pass.status === 'complete').length;
  return {
    completedPassCount: datedCompletedPassCount + (plan.baselineCompleteCount ?? 0), datedCompletedPassCount, baselineCompleteCount: plan.baselineCompleteCount ?? 0,
    targetedRevisitCount: passes.filter((pass) => pass.kind === 'targeted').length, sessionCount: sessions.length,
    uniqueCoverageSeconds: sumRanges(unionRanges(sessions.flatMap((session) => session.ranges), plan.durationSeconds)),
    lastViewedAt: sessions.map((session) => session.occurredAt).sort().at(-1) ?? null, passes, currentCoverage: true,
  };
}

/** Latest current status wins on each source interval; historical verification is not additive. */
export function effectiveTranscriptionRanges(segments, method = 'verbatim') {
  const matching = segments.filter((segment) => segment.method === method);
  const events = new Map(), heap = [];
  const priority = (a, b) => (a.modifiedAt ?? a.occurredAt).localeCompare(b.modifiedAt ?? b.occurredAt) || a.id.localeCompare(b.id);
  function push(segment) {
    heap.push(segment);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (priority(heap[parent], heap[index]) >= 0) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]]; index = parent;
    }
  }
  function pop() {
    const last = heap.pop();
    if (!heap.length) return;
    heap[0] = last;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      const left = index * 2 + 1, right = left + 1;
      const best = right < heap.length && priority(heap[right], heap[left]) > 0 ? right : left;
      if (priority(heap[index], heap[best]) >= 0) break;
      [heap[index], heap[best]] = [heap[best], heap[index]]; index = best;
    }
  }
  for (const segment of matching) {
    if (!events.has(segment.start)) events.set(segment.start, []);
    if (!events.has(segment.end)) events.set(segment.end, []);
    events.get(segment.start).push(segment);
  }
  const endpoints = [...events.keys()].sort((a, b) => a - b);
  const written = [], verified = [];
  for (let index = 0; index < endpoints.length - 1; index += 1) {
    const start = endpoints[index], end = endpoints[index + 1];
    for (const segment of events.get(start)) push(segment);
    // A max-heap with lazy expiry avoids quadratic work for long transcript histories.
    while (heap.length && heap[0].end <= start) pop();
    const effective = heap[0];
    if (effective && ['written', 'verified'].includes(effective.status)) written.push({ start, end });
    if (effective?.status === 'verified') verified.push({ start, end });
  }
  return { writtenRanges: unionRanges(written), verifiedRanges: unionRanges(verified) };
}

export function transcriptionSummary(workspace, lectureId, options = {}) {
  const plan = lecturePlan(workspace, lectureId), method = options.method ?? plan.transcriptionMethod ?? 'verbatim';
  const planned = plan.transcriptionScope !== 'none';
  const targetRanges = plan.transcriptionScope === 'selected' ? unionRanges(plan.targetRanges, plan.durationSeconds) : plan.transcriptionScope === 'full' && plan.durationSeconds ? [{ start: 0, end: plan.durationSeconds }] : [];
  const targetSeconds = targetRanges.length ? sumRanges(targetRanges) : null;
  const segments = records(workspace, 'transcriptionSegments').filter((segment) => segment.lectureId === lectureId);
  const effective = effectiveTranscriptionRanges(segments, method);
  const writtenRanges = targetSeconds === null ? effective.writtenRanges : intersectRanges(effective.writtenRanges, targetRanges);
  const verifiedRanges = targetSeconds === null ? effective.verifiedRanges : intersectRanges(effective.verifiedRanges, targetRanges);
  const writtenSeconds = sumRanges(writtenRanges), verifiedSeconds = sumRanges(verifiedRanges);
  const unfinishedRanges = targetSeconds === null ? [] : subtractRanges(targetRanges, writtenRanges);
  return { planned, method, targetRanges, targetSeconds, writtenRanges, verifiedRanges, writtenSeconds, verifiedSeconds,
    writtenPercent: targetSeconds === null ? null : writtenSeconds / targetSeconds * 100, verifiedPercent: targetSeconds === null ? null : verifiedSeconds / targetSeconds * 100,
    unfinishedRanges, nextUnfinishedRange: unfinishedRanges[0] ?? null, unknownDenominator: targetSeconds === null, currentCoverage: true, segmentIds: segments.filter((segment) => segment.method === method).map((segment) => segment.id),
    otherMethods: ['verbatim', 'own-words', 'memory'].filter((other) => other !== method).map((other) => ({ method: other, ...effectiveTranscriptionRanges(segments, other) })),
  };
}

function put(workspace, collection, record) {
  const result = copy(workspace), list = records(result, collection), index = list.findIndex((entry) => entry.id === record.id);
  result[collection] = index < 0 ? [...list, record] : list.map((entry) => entry.id === record.id ? record : entry);
  return result;
}

/** Coverage completion requires exactly the entire known lecture; manual confirmation remains possible. */
function recalculatePasses(workspace, lectureId) {
  const result = copy(workspace), summary = viewingSummary(result, lectureId), plan = lecturePlan(result, lectureId);
  result.viewingPasses = records(result, 'viewingPasses').map((pass) => {
    if (pass.lectureId !== lectureId || pass.kind === 'targeted' || pass.completion === 'manual') return pass;
    const coverage = summary.passes.find((entry) => entry.id === pass.id);
    const complete = plan.durationSeconds !== null && plan.durationSeconds > 0 && coverage.coverageSeconds === plan.durationSeconds;
    const dates = records(result, 'studySessions').filter((session) => session.passId === pass.id && session.activities.includes('viewing')).map((session) => session.occurredAt).sort();
    return { ...pass, startedAt: dates[0] && dates[0] < pass.startedAt ? dates[0] : pass.startedAt, status: complete ? 'complete' : 'in-progress', completion: complete ? 'coverage' : null, completedAt: complete ? dates.at(-1) ?? null : null };
  });
  return result;
}

export function saveLecturePlan(workspace, input) {
  const existing = records(workspace, 'lecturePlans').find((plan) => plan.lectureId === input.lectureId);
  const plan = { ...lecturePlan(workspace, input.lectureId), ...input, id: existing?.id ?? input.id ?? freshId() };
  if (plan.durationSeconds !== null && (!Number.isFinite(plan.durationSeconds) || plan.durationSeconds <= 0)) throw new Error('Lecture duration must be positive or unknown.');
  if (!Number.isSafeInteger(plan.baselineCompleteCount) || plan.baselineCompleteCount < 0) throw new Error('Historical complete viewings must be a nonnegative whole number.');
  if (!['none', 'full', 'selected'].includes(plan.transcriptionScope) || !['verbatim', 'own-words', 'memory'].includes(plan.transcriptionMethod)) throw new Error('Choose a supported transcription plan and method.');
  plan.targetRanges = unionRanges(plan.targetRanges, plan.durationSeconds);
  if (plan.transcriptionScope === 'selected' && !plan.targetRanges.length) throw new Error('Selected transcription needs at least one target range.');
  // Refuse to hide invalid old ranges after shortening a lecture.
  for (const session of records(workspace, 'studySessions').filter((entry) => entry.lectureId === plan.lectureId)) normalizeRanges(session.ranges, plan.durationSeconds);
  for (const segment of records(workspace, 'transcriptionSegments').filter((entry) => entry.lectureId === plan.lectureId)) normalizeRanges([segment], plan.durationSeconds);
  return recalculatePasses(put(workspace, 'lecturePlans', plan), input.lectureId);
}

export function upsertStudySession(workspace, input) {
  const existing = records(workspace, 'studySessions').find((session) => session.id === input.id);
  const session = { id: input.id ?? freshId(), lectureId: input.lectureId, occurredAt: stamp(input.occurredAt), activities: [], passId: '', ranges: [], effortMinutes: null, reason: '', note: '', conceptIds: [], cardIds: [], gapIds: [], ...existing, ...copy(input) };
  session.id = input.id ?? existing?.id ?? freshId();
  for (const key of ['passKind', 'startNewPass', 'complete']) delete session[key];
  session.occurredAt = stamp(session.occurredAt);
  session.ranges = unionRanges(session.ranges, lecturePlan(workspace, session.lectureId).durationSeconds);
  session.activities = [...new Set(session.activities)];
  if (!session.activities.length || session.activities.some((activity) => !['viewing', 'transcription', 'notes', 'memory', 'application'].includes(activity))) throw new Error('Choose at least one supported study activity.');
  if (session.effortMinutes !== null && (!Number.isFinite(session.effortMinutes) || session.effortMinutes < 0)) throw new Error('Optional effort must be a nonnegative number.');
  let result = put(workspace, 'studySessions', session);
  result = recalculatePasses(result, session.lectureId);
  if (existing && existing.lectureId !== session.lectureId) result = recalculatePasses(result, existing.lectureId);
  return result;
}

export function logViewing(workspace, input) {
  let result = copy(workspace);
  const previousSession = records(result, 'studySessions').find((session) => session.id === input.id);
  let pass = records(result, 'viewingPasses').find((entry) => entry.id === (input.passId || previousSession?.passId));
  if (pass && pass.lectureId !== input.lectureId) throw new Error('The viewing pass belongs to another lecture.');
  const summary = viewingSummary(result, input.lectureId);
  const kind = input.passKind ?? pass?.kind ?? (summary.completedPassCount ? 'rewatch' : 'first');
  if (!['first', 'rewatch', 'targeted'].includes(kind)) throw new Error('Choose a supported viewing kind.');
  if (!pass && !input.startNewPass && kind !== 'targeted') pass = records(result, 'viewingPasses').find((entry) => entry.lectureId === input.lectureId && entry.kind === kind && entry.status === 'in-progress');
  if (!pass || input.startNewPass) {
    pass = { id: freshId(), lectureId: input.lectureId, kind, status: 'in-progress', startedAt: stamp(input.occurredAt), completedAt: null, completion: null };
    result = put(result, 'viewingPasses', pass);
  }
  if (input.complete) {
    const completedAt = stamp(input.occurredAt);
    pass = { ...pass, startedAt: completedAt < pass.startedAt ? completedAt : pass.startedAt, status: 'complete', completion: 'manual', completedAt };
    result = put(result, 'viewingPasses', pass);
  }
  let ranges = input.ranges ?? previousSession?.ranges ?? [];
  const plan = lecturePlan(result, input.lectureId);
  if (input.complete && !ranges.length && plan.durationSeconds && kind !== 'targeted') ranges = [{ start: 0, end: plan.durationSeconds }];
  return upsertStudySession(result, { ...previousSession, ...input, passId: pass.id, ranges, activities: [...new Set(['viewing', ...(input.activities ?? previousSession?.activities ?? [])])] });
}

export function upsertTranscriptionSegment(workspace, input) {
  const existing = records(workspace, 'transcriptionSegments').find((segment) => segment.id === input.id);
  const range = input.range ?? input;
  const segment = { id: input.id ?? freshId(), lectureId: input.lectureId, start: range.start, end: range.end, status: 'written', method: 'verbatim', occurredAt: stamp(input.occurredAt), modifiedAt: stamp(), sessionId: '', reference: '', note: '', attachmentId: '', ...existing, ...copy(input), start: range.start ?? existing?.start, end: range.end ?? existing?.end };
  segment.id = input.id ?? existing?.id ?? freshId();
  delete segment.range; delete segment.verifyConfirmed;
  segment.occurredAt = stamp(segment.occurredAt); segment.modifiedAt = stamp(input.modifiedAt ?? new Date());
  normalizeRanges([segment], lecturePlan(workspace, segment.lectureId).durationSeconds);
  if (!['not-started', 'written', 'verified'].includes(segment.status) || !['verbatim', 'own-words', 'memory'].includes(segment.method)) throw new Error('Choose a supported transcription status and method.');
  // Editing the content/range of previously verified work needs a fresh explicit check.
  if (existing?.status === 'verified' && segment.status === 'verified' && !input.verifyConfirmed && ['start', 'end', 'method', 'reference', 'note'].some((key) => existing[key] !== segment[key])) segment.status = 'written';
  // A changed current range must not uncover an obsolete overlapping status.
  const before = existing ? removeUnderlyingTranscriptionRanges(workspace, existing) : workspace;
  return put(before, 'transcriptionSegments', segment);
}

function removeUnderlyingTranscriptionRanges(workspace, removed) {
  const result = copy(workspace), stampOf = entry => entry.modifiedAt ?? entry.occurredAt;
  result.transcriptionSegments = records(result, 'transcriptionSegments').flatMap((entry) => {
    if (entry.id === removed.id || entry.lectureId !== removed.lectureId || entry.method !== removed.method || stampOf(entry) > stampOf(removed) || (stampOf(entry) === stampOf(removed) && entry.id > removed.id)) return [entry];
    const remaining = subtractRanges([{ start: entry.start, end: entry.end }], [{ start: removed.start, end: removed.end }]);
    return remaining.map((range, index) => ({ ...entry, ...range, id: index === 0 ? entry.id : freshId() }));
  });
  return result;
}

export function deleteStudyRecord(workspace, collection, id) {
  const allowed = ['lecturePlans', 'viewingPasses', 'studySessions', 'transcriptionSegments', 'concepts', 'gaps', 'recallAttempts', 'assessments', 'studySettings'];
  if (!allowed.includes(collection)) throw new Error('Unsupported study record type.');
  const removed = records(workspace, collection).find((entry) => entry.id === id);
  const result = collection === 'transcriptionSegments' && removed ? removeUnderlyingTranscriptionRanges(workspace, removed) : copy(workspace);
  result[collection] = records(result, collection).filter((entry) => entry.id !== id);
  if (collection === 'viewingPasses') {
    result.studySessions = records(result, 'studySessions').flatMap((session) => {
      if (session.passId !== id) return [session];
      const activities = session.activities.filter((activity) => activity !== 'viewing');
      return activities.length ? [{ ...session, activities, passId: '' }] : [];
    });
  }
  if (collection === 'studySessions' || collection === 'viewingPasses') {
    const surviving = new Set(records(result, 'studySessions').map((entry) => entry.id));
    result.transcriptionSegments = records(result, 'transcriptionSegments').map((entry) => surviving.has(entry.sessionId) ? entry : { ...entry, sessionId: '' });
    for (const kind of ['recallAttempts', 'assessments']) result[kind] = records(result, kind).map((entry) => ({ ...entry, studySessionIds: (entry.studySessionIds ?? []).filter((key) => surviving.has(key)) }));
  }
  if (collection === 'recallAttempts') result.assessments = records(result, 'assessments').map((entry) => entry.recallAttemptId === id ? { ...entry, recallAttemptId: '', expectedIdeaId: '' } : entry);
  if (collection === 'recallAttempts') result.gaps = records(result, 'gaps').map((entry) => entry.recallAttemptId === id ? { ...entry, recallAttemptId: '' } : entry);
  if (collection === 'concepts') {
    result.studySessions = records(result, 'studySessions').map((entry) => ({ ...entry, conceptIds: (entry.conceptIds ?? []).filter((key) => key !== id) }));
    result.cards = records(result, 'cards').map((entry) => entry.conceptIds ? { ...entry, conceptIds: entry.conceptIds.filter((key) => key !== id) } : entry);
    result.gaps = records(result, 'gaps').map((entry) => entry.conceptId === id ? { ...entry, conceptId: '' } : entry);
    result.assessments = records(result, 'assessments').map((entry) => entry.conceptId === id ? { ...entry, conceptId: '' } : entry);
  }
  if (collection === 'gaps') result.studySessions = records(result, 'studySessions').map((entry) => ({ ...entry, gapIds: (entry.gapIds ?? []).filter((key) => key !== id) }));
  return removed?.lectureId ? recalculatePasses(result, removed.lectureId) : result;
}
