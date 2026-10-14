import { i as getReact } from './framework-D_rUT4EX.js';
import {
  formatTimestamp, parseTimestamp, localDateKey, localDateTimeToUTC,
  viewingSummary, transcriptionSummary, logViewing, upsertStudySession,
  upsertTranscriptionSegment, saveLecturePlan, deleteStudyRecord,
} from '../../lib/study.js';

const React = getReact();
const h = React.createElement;
const { useState, useEffect, useId, useRef } = React;
const clone = (value) => structuredClone(value);
const id = () => crypto.randomUUID();
const EN = {
  title: 'Lecture study', intro: 'Record what you watched or wrote. These are activity records, separate from evidence of understanding.',
  lecture: 'Lecture', choose: 'Choose a lecture', noLectures: 'Add a lecture in your library to start recording study activity.',
  course: 'Course', viewing: 'Viewing and revisits', log: 'Log viewing', fast: 'Complete viewing today',
  confirmFast: 'Confirm complete viewing', cancel: 'Cancel', save: 'Save', saving: 'Saving…', edit: 'Edit', delete: 'Delete', undo: 'Undo',
  completed: 'Complete viewings', targeted: 'Targeted revisits', sessions: 'Viewing sessions', coverage: 'Unique viewed coverage',
  baseline: 'Historical complete viewings (undated)', baselineHelp: 'Use a simple count when old sessions are unknown. This is kept separate from dated logs and excluded from period statistics.',
  duration: 'Lecture duration', durationHelp: 'Use MM:SS or HH:MM:SS. Leave blank when unknown.', plan: 'Lecture plan',
  date: 'Session date and time', ranges: 'Source ranges', rangesHelp: 'MM:SS–MM:SS, one range per line. Disjoint ranges are supported.',
  pass: 'Viewing pass', newPass: 'Begin a new intentional pass', resume: 'Resume incomplete pass', first: 'First viewing', rewatch: 'Full rewatch', revisit: 'Targeted revisit',
  complete: 'Confirm this whole viewing pass is complete', completeHelp: 'Known 100% source coverage can complete a pass; otherwise completion requires your confirmation. A targeted revisit stays separate.',
  details: 'Optional details', reason: 'Reason', noReason: 'No reason recorded', unclear: 'Unclear concept', forgetting: 'Forgetting', apply: 'Preparing to apply', review: 'General review',
  note: 'Note', effort: 'Elapsed effort (minutes)', effortHelp: 'Optional. One sitting with watching and writing records this time once.',
  shared: 'I also transcribed or wrote during this sitting', sharedMethod: 'Writing method during this sitting',
  card: 'Linked card', gap: 'Linked gap', concept: 'Linked concept', none: 'None',
  transcript: 'Manual transcription', scope: 'Transcription plan', notPlanned: 'Not planned', full: 'Full lecture', selected: 'Selected source ranges',
  method: 'Writing method', verbatim: 'Verbatim transcription', 'own-words': 'Notes in my own words', memory: 'Writing from memory',
  target: 'Selected target ranges', written: 'Written (including verified)', verified: 'Verified against source', unknown: 'Unknown target length',
  current: 'Current, unique source coverage · lifetime', next: 'Next unfinished range', continue: 'Continue from here',
  record: 'Record written progress', status: 'Current status', 'not-started': 'Not started', start: 'Range start', end: 'Range end',
  reference: 'Notebook, page or slide reference', attachment: 'Existing local attachment', noAttachment: 'No attachment reference',
  sharedSession: 'Link to an existing study sitting', standalone: 'Record without a shared sitting',
  segmentDate: 'Work date and time', segmentHelp: 'Record work done on paper or in another app. Uploading or typing a transcript is optional.',
  evidence: 'Record recall, gaps or application evidence', evidenceHelp: 'Watching and writing do not establish mastery. Record explicitly assessed ideas and outcomes in Statistics.',
  noViews: 'No dated viewing activity recorded for this lecture.', noSegments: 'No manual writing ranges recorded. Imported source documents do not count as manual work.',
  noNext: 'All known target ranges are written.', noTarget: 'No transcription work is planned. This does not create overdue work.',
  unknownHelp: 'Record ranges now; no percentage is shown until a target denominator is known.',
  saved: 'Saved on this device.', removed: 'Deleted. You can undo this change.', restored: 'Change undone.',
  last: 'Last viewed', undated: 'undated baseline', dated: 'dated complete passes', partial: 'Incomplete pass', passHistory: 'Viewing passes',
  history: 'Dated viewing sessions', editPass: 'Edit pass', passStarted: 'Pass started', passFinished: 'Completed on',
  segmentHistory: 'Manual writing ranges', modified: 'Last changed', noEffort: 'Effort not recorded', writtenStatus: 'Written / draft',
  verify: 'I checked this range against the source after these edits', verifyHelp: 'Changing verified work removes its old verification unless you explicitly confirm a fresh check.',
  deleteConfirm: 'Delete this record?', errorRange: 'Enter valid source ranges, for example 00:00–20:00. End must be after start.',
  invalidEffort: 'Effort must be a finite, nonnegative number of minutes.', requiredRange: 'Enter at least one source range for a partial viewing.',
  staleUndo: 'This record changed after your action. Undo is unavailable; edit the latest record instead.',
  fastHelp: 'Starts a new complete pass with today’s date. Earlier incomplete passes stay available to resume.',
  linkedRecords: 'Related records retain their own dates and writing progress when a session or pass is removed.', noRanges: 'Source ranges not recorded',
};
const AR = {
  title: 'دراسة المحاضرات', intro: 'سجّل ما شاهدته أو كتبته. سجلات النشاط مستقلة عن أدلة الفهم.',
  lecture: 'المحاضرة', choose: 'اختر محاضرة', noLectures: 'أضف محاضرة في المكتبة لبدء تسجيل نشاط الدراسة.',
  viewing: 'المشاهدة والمراجعات', log: 'سجّل مشاهدة', fast: 'مشاهدة كاملة اليوم', confirmFast: 'تأكيد المشاهدة الكاملة',
  cancel: 'إلغاء', save: 'حفظ', saving: 'جارٍ الحفظ…', edit: 'تعديل', delete: 'حذف', undo: 'تراجع',
  completed: 'مشاهدات كاملة', targeted: 'مراجعات جزئية', sessions: 'جلسات مشاهدة', coverage: 'التغطية الفريدة للمشاهدة',
  baseline: 'مشاهدات كاملة سابقة بلا تواريخ', baselineHelp: 'سجّل عددًا بسيطًا عندما تكون تفاصيل الجلسات القديمة مجهولة. يُعرض منفصلًا ويُستبعد من إحصاءات الفترات.',
  duration: 'مدة المحاضرة', durationHelp: 'استخدم MM:SS أو HH:MM:SS، أو اتركها فارغة إن كانت مجهولة.', plan: 'خطة المحاضرة',
  date: 'تاريخ ووقت الجلسة', ranges: 'مقاطع المصدر', rangesHelp: 'MM:SS–MM:SS، مقطع في كل سطر. يمكن تسجيل مقاطع منفصلة.',
  pass: 'دورة المشاهدة', newPass: 'ابدأ دورة مشاهدة جديدة', resume: 'تابع دورة غير مكتملة', first: 'المشاهدة الأولى', rewatch: 'إعادة مشاهدة كاملة', revisit: 'مراجعة مقطع محدد',
  complete: 'أؤكد اكتمال دورة مشاهدة المحاضرة كلها', completeHelp: 'يمكن لتغطية 100% من مدة معلومة إكمال الدورة؛ خلاف ذلك يلزم تأكيدك. المراجعة الجزئية تُحسب منفصلة.',
  details: 'تفاصيل اختيارية', reason: 'السبب', noReason: 'السبب غير مسجل', unclear: 'فكرة غير واضحة', forgetting: 'نسيان', apply: 'الاستعداد للتطبيق', review: 'مراجعة عامة',
  note: 'ملاحظة', effort: 'وقت الجهد بالدقائق', effortHelp: 'اختياري. وقت جلسة مشتركة للمشاهدة والكتابة يُحسب مرة واحدة.',
  shared: 'كتبت أو فرّغت أيضًا في هذه الجلسة', sharedMethod: 'طريقة الكتابة في الجلسة',
  card: 'بطاقة مرتبطة', gap: 'فجوة مرتبطة', concept: 'مفهوم مرتبط', none: 'لا يوجد',
  transcript: 'التفريغ والكتابة اليدوية', scope: 'خطة التفريغ', notPlanned: 'غير مخطط', full: 'المحاضرة كاملة', selected: 'مقاطع محددة',
  method: 'طريقة الكتابة', verbatim: 'تفريغ حرفي', 'own-words': 'ملاحظات بكلماتي', memory: 'كتابة من الذاكرة',
  target: 'المقاطع المستهدفة', written: 'مكتوب، بما فيه المتحقق منه', verified: 'تم التحقق مقابل المصدر', unknown: 'مدة الهدف مجهولة',
  current: 'التغطية الحالية الفريدة · جميع الفترات', next: 'المقطع التالي غير المكتوب', continue: 'تابع من هنا',
  record: 'سجّل تقدم الكتابة', status: 'الحالة الحالية', 'not-started': 'لم يبدأ', start: 'بداية المقطع', end: 'نهاية المقطع',
  reference: 'مرجع الدفتر أو الصفحة أو الشريحة', attachment: 'مرفق محلي موجود', noAttachment: 'بلا مرجع مرفق',
  sharedSession: 'اربط بجلسة دراسة موجودة', standalone: 'سجّل بدون جلسة مشتركة', segmentDate: 'تاريخ ووقت العمل',
  segmentHelp: 'سجّل العمل على الورق أو في تطبيق آخر؛ رفع التفريغ أو كتابته هنا اختياري.',
  evidence: 'سجّل الاسترجاع والفجوات وأدلة التطبيق', evidenceHelp: 'المشاهدة والكتابة لا تثبت الإتقان. سجّل الأفكار المقيمة والنتائج في الإحصاءات.',
  noViews: 'لا توجد مشاهدة مؤرخة مسجلة للمحاضرة.', noSegments: 'لا توجد مقاطع كتابة يدوية مسجلة. استيراد ملفات المصدر لا يُحسب عملًا يدويًا.',
  noNext: 'كل المقاطع المستهدفة المعلومة مكتوبة.', noTarget: 'التفريغ غير مخطط، ولا ينشئ عملًا متأخرًا.', unknownHelp: 'سجّل المقاطع الآن؛ لا تظهر نسبة حتى تُعرف مدة الهدف.',
  saved: 'تم الحفظ على هذا الجهاز.', removed: 'تم الحذف. يمكنك التراجع.', restored: 'تم التراجع عن التغيير.',
  last: 'آخر مشاهدة', undated: 'عدد سابق بلا تواريخ', dated: 'دورات كاملة مؤرخة', partial: 'دورة غير مكتملة', passHistory: 'دورات المشاهدة',
  history: 'جلسات المشاهدة المؤرخة', editPass: 'تعديل دورة المشاهدة', passStarted: 'بدء الدورة', passFinished: 'اكتملت في',
  segmentHistory: 'مقاطع الكتابة اليدوية', modified: 'آخر تعديل', noEffort: 'وقت الجهد غير مسجل', writtenStatus: 'مكتوب / مسودة',
  verify: 'تحققت من هذا المقطع مقابل المصدر بعد هذه التعديلات', verifyHelp: 'تعديل عمل متحقق منه يزيل التحقق السابق ما لم تؤكد تحققًا جديدًا.', deleteConfirm: 'حذف هذا السجل؟',
  errorRange: 'أدخل مقاطع صحيحة مثل 00:00–20:00، مع نهاية بعد البداية.', invalidEffort: 'يجب أن يكون الجهد عدد دقائق صالحًا وغير سالب.', requiredRange: 'أدخل مقطع مصدر واحدًا على الأقل للمشاهدة الجزئية.',
  staleUndo: 'تغير السجل بعد هذه العملية؛ التراجع غير متاح. عدّل النسخة الحالية بدلًا من ذلك.',
  fastHelp: 'تبدأ دورة مكتملة جديدة بتاريخ اليوم. تبقى الدورات غير المكتملة متاحة للمتابعة.',
  linkedRecords: 'تحتفظ السجلات المرتبطة بتواريخها وتقدم الكتابة عند إزالة جلسة أو دورة مشاهدة.', noRanges: 'مقاطع المصدر غير مسجلة',
};

function localInput(iso, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function formatRanges(ranges = []) { return ranges.map((range) => `${formatTimestamp(range.start)}–${formatTimestamp(range.end)}`).join('\n'); }
function parseRanges(value, errorMessage) {
  if (!value.trim()) return [];
  return value.split(/[\n,;]+/).filter((line) => line.trim()).map((line) => {
    const pieces = line.trim().split(/\s*(?:–|—|-)\s*/);
    if (pieces.length !== 2) throw new Error(errorMessage);
    const start = parseTimestamp(pieces[0]), end = parseTimestamp(pieces[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(errorMessage);
    return { start, end };
  });
}
function effortValue(value, errorMessage) {
  if (value === '' || value === undefined || value === null) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(errorMessage);
  return result;
}
function dateText(value, zone, language) {
  return value ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-JO' : 'en-GB', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}
function minutes(value) { return `${Math.round(value / 6) / 10} min`; }
function Button({ children, primary, danger, ...props }) { return h('button', { type: 'button', className: primary ? 'primary' : danger ? 'danger' : '', ...props }, children); }
function Field({ label, hint, children, wide = false }) {
  const fieldId = useId();
  return h('div', { className: `tracking-field${wide ? ' tracking-wide' : ''}` }, h('label', { htmlFor: fieldId }, label), React.cloneElement(children, { id: fieldId, 'aria-describedby': hint ? `${fieldId}-hint` : undefined }), hint && h('small', { id: `${fieldId}-hint` }, hint));
}
function Checkbox({ label, checked, onChange, disabled }) {
  return h('label', { className: 'tracking-checkbox' }, h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked), disabled }), label);
}
function options(items) { return items.map(([value, label]) => h('option', { key: value, value }, label)); }
function TextInput({ value, onChange, ...props }) { return h('input', { ...props, value: value ?? '', onChange: (event) => onChange(event.target.value) }); }
function Area({ value, onChange, ...props }) { return h('textarea', { ...props, value: value ?? '', onChange: (event) => onChange(event.target.value), dir: 'auto' }); }
function Select({ value, onChange, items, ...props }) { return h('select', { ...props, value, onChange: (event) => onChange(event.target.value) }, options(items)); }

// Undo only the records changed by this action. It never replaces a newer whole workspace.
function changesBetween(before, after) {
  const result = [];
  for (const key of Object.keys(after)) {
    if (!Array.isArray(before[key]) || !Array.isArray(after[key])) continue;
    const old = new Map(before[key].filter((x) => x && x.id).map((x) => [x.id, x]));
    const next = new Map(after[key].filter((x) => x && x.id).map((x) => [x.id, x]));
    for (const recordId of new Set([...old.keys(), ...next.keys()])) {
      if (JSON.stringify(old.get(recordId)) !== JSON.stringify(next.get(recordId))) result.push({ collection: key, id: recordId, before: old.get(recordId) ?? null, after: next.get(recordId) ?? null });
    }
  }
  return result;
}

export function StudyTracking({ workspace, onSave, onNavigate, selectedLectureId, onSelectLecture, language = 'en', logViewingRequested = false }) {
  const t = language === 'ar' ? { ...EN, ...AR } : EN;
  const timezone = workspace.studySettings?.find((record) => record.id === 'preferences')?.timezone || 'Asia/Amman';
  const [localLectureId, setLocalLectureId] = useState('');
  const lectureId = selectedLectureId || localLectureId || workspace.lectures?.[0]?.id || '';
  const lecture = workspace.lectures?.find((record) => record.id === lectureId);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [undo, setUndo] = useState(null);
  const [viewEditor, setViewEditor] = useState(null), [segmentEditor, setSegmentEditor] = useState(null), [passEditor, setPassEditor] = useState(null), [fastConfirm, setFastConfirm] = useState(false);
  const [planDraft, setPlanDraft] = useState(null);
  const editorRef = useRef(null);
  const plan = workspace.lecturePlans?.find((record) => record.lectureId === lectureId);
  const summary = lecture ? viewingSummary(workspace, lectureId) : null;
  const transcription = lecture ? transcriptionSummary(workspace, lectureId) : null;
  const sessions = (workspace.studySessions || []).filter((record) => record.lectureId === lectureId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const viewSessions = sessions.filter((record) => record.activities.includes('viewing'));
  const segments = (workspace.transcriptionSegments || []).filter((record) => record.lectureId === lectureId).sort((a, b) => a.start - b.start || b.modifiedAt.localeCompare(a.modifiedAt));
  const unfinishedPasses = (workspace.viewingPasses || []).filter((record) => record.lectureId === lectureId && record.status !== 'complete' && record.kind !== 'targeted');
  const methods = ['verbatim', 'own-words', 'memory'].map((value) => [value, t[value]]);
  const currentWorkspace = useRef(workspace);
  currentWorkspace.current = workspace;

  useEffect(() => { setViewEditor(null); setSegmentEditor(null); setPassEditor(null); setFastConfirm(false); setPlanDraft(null); setError(''); }, [lectureId]);
  useEffect(() => { if (logViewingRequested && lectureId) setFastConfirm(true); }, [logViewingRequested, lectureId]);
  useEffect(() => { if (viewEditor || segmentEditor || passEditor || fastConfirm) editorRef.current?.focus(); }, [!!viewEditor, !!segmentEditor, !!passEditor, fastConfirm]);

  function chooseLecture(value) { setLocalLectureId(value); onSelectLecture?.(value); }
  async function mutate(build, message = t.saved) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const before = clone(currentWorkspace.current), next = build(before);
      const changes = changesBetween(before, next);
      await onSave(next);
      setUndo(changes.length ? changes : null); setNotice(message);
      return true;
    } catch (failure) { setError(failure.message || String(failure)); return false; }
    finally { setBusy(false); }
  }
  async function undoChange() {
    const remembered = undo;
    const saved = await mutate((latest) => {
      for (const change of remembered) {
        const current = latest[change.collection].find((record) => record.id === change.id) ?? null;
        if (JSON.stringify(current) !== JSON.stringify(change.after)) throw new Error(t.staleUndo);
      }
      for (const change of remembered) {
        latest[change.collection] = latest[change.collection].filter((record) => record.id !== change.id);
        if (change.before) latest[change.collection].push(clone(change.before));
      }
      return latest;
    }, t.restored);
    if (saved) setUndo(null);
  }
  function startViewing(record = null) {
    setFastConfirm(false); setSegmentEditor(null); setPassEditor(null); setError('');
    const linkedPass = record && workspace.viewingPasses?.find((p) => p.id === record.passId);
    setViewEditor({ id: record?.id || '', passId: record?.passId || unfinishedPasses[0]?.id || '', passKind: linkedPass?.kind || (summary?.completedPassCount ? 'rewatch' : 'first'),
      occurredAt: localInput(record?.occurredAt || new Date().toISOString(), timezone), ranges: formatRanges(record?.ranges || []), complete: false,
      reason: record?.reason || '', note: record?.note || '', effortMinutes: record?.effortMinutes ?? '', shared: record?.activities?.some((value) => ['transcription', 'notes', 'memory'].includes(value)) || false,
      sharedMethod: record?.activities?.includes('memory') ? 'memory' : record?.activities?.includes('notes') ? 'own-words' : 'verbatim',
      cardId: record?.cardIds?.[0] || '', gapId: record?.gapIds?.[0] || '', conceptId: record?.conceptIds?.[0] || '', original: record,
    });
  }
  function startSegment(record = null, next = null) {
    setViewEditor(null); setPassEditor(null); setFastConfirm(false); setError('');
    setSegmentEditor({ id: record?.id || '', start: formatTimestamp(record?.start ?? next?.start ?? 0), end: record?.end !== undefined || next?.end !== undefined ? formatTimestamp(record?.end ?? next.end) : '',
      status: record?.status || 'written', method: record?.method || plan?.transcriptionMethod || 'verbatim', occurredAt: localInput(record?.occurredAt || new Date().toISOString(), timezone),
      sessionId: record?.sessionId || '', note: record?.note || '', reference: record?.reference || '', attachmentId: record?.attachmentId || '', verifyConfirmed: false, original: record,
    });
  }
  async function fastViewing() {
    const succeeded = await mutate((latest) => logViewing(latest, { lectureId, startNewPass: true, passKind: summary.completedPassCount ? 'rewatch' : 'first', complete: true,
      occurredAt: new Date().toISOString(), ranges: plan?.durationSeconds ? [{ start: 0, end: plan.durationSeconds }] : [], activities: ['viewing'], effortMinutes: null,
    }));
    if (succeeded) setFastConfirm(false);
  }
  async function saveViewing(event) {
    event.preventDefault();
    const succeeded = await mutate((latest) => {
      const ranges = parseRanges(viewEditor.ranges, t.errorRange);
      if (!ranges.length && !viewEditor.complete) throw new Error(t.requiredRange);
      const activity = viewEditor.sharedMethod === 'memory' ? 'memory' : viewEditor.sharedMethod === 'own-words' ? 'notes' : 'transcription';
      const occurredAt = viewEditor.original && localInput(viewEditor.original.occurredAt, timezone) === viewEditor.occurredAt ? viewEditor.original.occurredAt : localDateTimeToUTC(viewEditor.occurredAt, timezone);
      const input = { ...viewEditor.original, id: viewEditor.id || undefined, lectureId, passId: viewEditor.passId, passKind: viewEditor.passKind, startNewPass: !viewEditor.passId,
        complete: viewEditor.complete, occurredAt, ranges, reason: viewEditor.reason, note: viewEditor.note, effortMinutes: effortValue(viewEditor.effortMinutes, t.invalidEffort),
        activities: [...new Set(['viewing', ...(viewEditor.shared ? [activity] : []), ...(viewEditor.original?.activities || []).filter((value) => !['viewing', 'transcription', 'notes', 'memory'].includes(value))])],
        cardIds: [...new Set([...(viewEditor.original?.cardIds || []).slice(1), ...(viewEditor.cardId ? [viewEditor.cardId] : [])])],
        gapIds: [...new Set([...(viewEditor.original?.gapIds || []).slice(1), ...(viewEditor.gapId ? [viewEditor.gapId] : [])])],
        conceptIds: [...new Set([...(viewEditor.original?.conceptIds || []).slice(1), ...(viewEditor.conceptId ? [viewEditor.conceptId] : [])])],
      };
      return logViewing(latest, input);
    });
    if (succeeded) setViewEditor(null);
  }
  async function saveSegment(event) {
    event.preventDefault();
    const succeeded = await mutate((latest) => {
      const start = parseTimestamp(segmentEditor.start), end = parseTimestamp(segmentEditor.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(t.errorRange);
      const occurredAt = segmentEditor.original && localInput(segmentEditor.original.occurredAt, timezone) === segmentEditor.occurredAt ? segmentEditor.original.occurredAt : localDateTimeToUTC(segmentEditor.occurredAt, timezone);
      let next = upsertTranscriptionSegment(latest, { ...segmentEditor.original, id: segmentEditor.id || undefined, lectureId, start, end, status: segmentEditor.status, method: segmentEditor.method,
        occurredAt, modifiedAt: new Date().toISOString(), sessionId: segmentEditor.sessionId, reference: segmentEditor.reference, note: segmentEditor.note, attachmentId: segmentEditor.attachmentId, verifyConfirmed: segmentEditor.verifyConfirmed });
      // One shared sitting carries multiple labels, rather than duplicating elapsed effort.
      if (segmentEditor.sessionId) {
        const session = next.studySessions.find((record) => record.id === segmentEditor.sessionId);
        const activity = segmentEditor.method === 'memory' ? 'memory' : segmentEditor.method === 'own-words' ? 'notes' : 'transcription';
        next = upsertStudySession(next, { ...session, activities: [...new Set([...session.activities, activity])] });
      }
      return next;
    });
    if (succeeded) setSegmentEditor(null);
  }
  async function savePlan(event) {
    event.preventDefault();
    const succeeded = await mutate((latest) => {
      const durationSeconds = planDraft.duration.trim() ? parseTimestamp(planDraft.duration) : null;
      if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) throw new Error(t.errorRange);
      return saveLecturePlan(latest, { ...plan, id: plan?.id || id(), lectureId, durationSeconds, baselineCompleteCount: Number(planDraft.baseline),
        transcriptionScope: planDraft.scope, targetRanges: planDraft.scope === 'selected' ? parseRanges(planDraft.targetRanges, t.errorRange) : [], transcriptionMethod: planDraft.method });
    });
    if (succeeded) setPlanDraft(null);
  }
  function editPlan() { setPlanDraft({ duration: plan?.durationSeconds ? formatTimestamp(plan.durationSeconds) : '', baseline: plan?.baselineCompleteCount || 0, scope: plan?.transcriptionScope || 'none', targetRanges: formatRanges(plan?.targetRanges || []), method: plan?.transcriptionMethod || 'verbatim' }); }
  async function removeRecord(collection, recordId) {
    if (!window.confirm(`${t.deleteConfirm}\n${t.linkedRecords}`)) return;
    await mutate((latest) => deleteStudyRecord(latest, collection, recordId), t.removed);
  }
  function editPass(record) { setViewEditor(null); setSegmentEditor(null); setFastConfirm(false); setPassEditor({ ...record, started: localInput(record.startedAt, timezone), finished: localInput(record.completedAt || new Date().toISOString(), timezone) }); }
  async function savePass(event) {
    event.preventDefault();
    const succeeded = await mutate((latest) => {
      const old = latest.viewingPasses.find((record) => record.id === passEditor.id);
      const complete = passEditor.status === 'complete';
      const record = { ...old, kind: passEditor.kind, status: complete ? 'complete' : 'in-progress',
        startedAt: localInput(old.startedAt, timezone) === passEditor.started ? old.startedAt : localDateTimeToUTC(passEditor.started, timezone),
        completedAt: complete ? old.completedAt && localInput(old.completedAt, timezone) === passEditor.finished ? old.completedAt : localDateTimeToUTC(passEditor.finished, timezone) : null, completion: complete ? 'manual' : null };
      latest.viewingPasses = latest.viewingPasses.map((entry) => entry.id === old.id ? record : entry);
      return latest;
    });
    if (succeeded) setPassEditor(null);
  }
  const setView = (key) => (value) => setViewEditor((draft) => ({ ...draft, [key]: value }));
  const setSegment = (key) => (value) => setSegmentEditor((draft) => ({ ...draft, [key]: value }));
  const setPlan = (key) => (value) => setPlanDraft((draft) => ({ ...draft, [key]: value }));
  const setPass = (key) => (value) => setPassEditor((draft) => ({ ...draft, [key]: value }));
  const optionalReferences = viewEditor && h('div', { className: 'tracking-fields' },
    h(Field, { label: t.card }, h(Select, { value: viewEditor.cardId, onChange: setView('cardId'), items: [['', t.none], ...(workspace.cards || []).filter((record) => record.lectureId === lectureId).map((record) => [record.id, record.question.slice(0, 120)])] })),
    h(Field, { label: t.gap }, h(Select, { value: viewEditor.gapId, onChange: setView('gapId'), items: [['', t.none], ...(workspace.gaps || []).filter((record) => record.lectureId === lectureId).map((record) => [record.id, record.text.slice(0, 120)])] })),
    h(Field, { label: t.concept }, h(Select, { value: viewEditor.conceptId, onChange: setView('conceptId'), items: [['', t.none], ...(workspace.concepts || []).filter((record) => record.courseId === lecture?.courseId && (!record.lectureId || record.lectureId === lectureId)).map((record) => [record.id, record.title])] })),
  );

  const viewingForm = viewEditor && h('form', { className: 'tracking-editor', onSubmit: saveViewing },
    h('h3', { ref: editorRef, tabIndex: -1 }, viewEditor.id ? `${t.edit}: ${t.log}` : t.log),
    h('div', { className: 'tracking-fields' },
      h(Field, { label: t.date, hint: timezone }, h(TextInput, { type: 'datetime-local', value: viewEditor.occurredAt, onChange: setView('occurredAt'), required: true })),
      h(Field, { label: t.pass }, h(Select, { value: viewEditor.passId, onChange: setView('passId'), items: [['', t.newPass], ...unfinishedPasses.map((record) => [record.id, `${t.resume} · ${dateText(record.startedAt, timezone, language)}`]), ...(viewEditor.id && viewEditor.passId && !unfinishedPasses.some((record) => record.id === viewEditor.passId) ? [[viewEditor.passId, t.completed]] : [])] })),
      !viewEditor.passId && h(Field, { label: t.pass }, h(Select, { value: viewEditor.passKind, onChange: setView('passKind'), items: [['first', t.first], ['rewatch', t.rewatch], ['targeted', t.revisit]] })),
      h(Field, { label: t.ranges, hint: t.rangesHelp, wide: true }, h(Area, { value: viewEditor.ranges, onChange: setView('ranges'), placeholder: '00:00–20:00\n30:00–40:00', spellCheck: false })),
    ),
    viewEditor.passKind !== 'targeted' && h(Checkbox, { label: t.complete, checked: viewEditor.complete, onChange: setView('complete') }),
    h('p', { className: 'tracking-muted' }, t.completeHelp),
    h('details', null, h('summary', null, t.details),
      h('div', { className: 'tracking-fields' },
        h(Field, { label: t.reason }, h(Select, { value: viewEditor.reason, onChange: setView('reason'), items: [['', t.noReason], ['unclear-concept', t.unclear], ['forgetting', t.forgetting], ['preparing-to-apply', t.apply], ['general-review', t.review]] })),
        h(Field, { label: t.effort, hint: t.effortHelp }, h(TextInput, { type: 'number', min: 0, step: 'any', value: viewEditor.effortMinutes, onChange: setView('effortMinutes') })),
        h(Field, { label: t.note, wide: true }, h(Area, { value: viewEditor.note, onChange: setView('note'), maxLength: 20000 })),
      ),
      h(Checkbox, { label: t.shared, checked: viewEditor.shared, onChange: setView('shared') }),
      viewEditor.shared && h(Field, { label: t.sharedMethod }, h(Select, { value: viewEditor.sharedMethod, onChange: setView('sharedMethod'), items: methods })),
      optionalReferences,
    ),
    h('div', { className: 'tracking-actions' }, h(Button, { primary: true, type: 'submit', disabled: busy }, busy ? t.saving : t.save), h(Button, { onClick: () => setViewEditor(null), disabled: busy }, t.cancel)),
  );

  const segmentForm = segmentEditor && h('form', { className: 'tracking-editor', onSubmit: saveSegment },
    h('h3', { ref: editorRef, tabIndex: -1 }, segmentEditor.id ? `${t.edit}: ${t.record}` : t.record), h('p', { className: 'tracking-muted' }, t.segmentHelp),
    h('div', { className: 'tracking-fields' },
      h(Field, { label: t.start }, h(TextInput, { value: segmentEditor.start, onChange: setSegment('start'), required: true, placeholder: '00:00', dir: 'ltr' })),
      h(Field, { label: t.end }, h(TextInput, { value: segmentEditor.end, onChange: setSegment('end'), required: true, placeholder: '15:00', dir: 'ltr' })),
      h(Field, { label: t.status }, h(Select, { value: segmentEditor.status, onChange: setSegment('status'), items: [['not-started', t['not-started']], ['written', t.writtenStatus], ['verified', t.verified]] })),
      h(Field, { label: t.method }, h(Select, { value: segmentEditor.method, onChange: setSegment('method'), items: methods })),
      h(Field, { label: t.segmentDate, hint: timezone }, h(TextInput, { type: 'datetime-local', value: segmentEditor.occurredAt, onChange: setSegment('occurredAt'), required: true })),
      h(Field, { label: t.sharedSession }, h(Select, { value: segmentEditor.sessionId, onChange: setSegment('sessionId'), items: [['', t.standalone], ...sessions.map((record) => [record.id, `${dateText(record.occurredAt, timezone, language)} · ${record.activities.map((x) => t[x] || x).join(' + ')}`])] })),
    ),
    segmentEditor.status === 'verified' && segmentEditor.original?.status === 'verified' && h('div', null, h(Checkbox, { label: t.verify, checked: segmentEditor.verifyConfirmed, onChange: setSegment('verifyConfirmed') }), h('p', { className: 'tracking-muted' }, t.verifyHelp)),
    h('details', null, h('summary', null, t.details), h('div', { className: 'tracking-fields' },
      h(Field, { label: t.reference }, h(TextInput, { value: segmentEditor.reference, onChange: setSegment('reference'), maxLength: 500, dir: 'auto' })),
      h(Field, { label: t.attachment }, h(Select, { value: segmentEditor.attachmentId, onChange: setSegment('attachmentId'), items: [['', t.noAttachment], ...(lecture.fileId ? [[lecture.fileId, lecture.fileName || lecture.fileId]] : []), ...(segmentEditor.attachmentId && segmentEditor.attachmentId !== lecture.fileId ? [[segmentEditor.attachmentId, segmentEditor.attachmentId]] : [])] })),
      h(Field, { label: t.note, wide: true }, h(Area, { value: segmentEditor.note, onChange: setSegment('note'), maxLength: 20000 })),
    )),
    h('div', { className: 'tracking-actions' }, h(Button, { primary: true, type: 'submit', disabled: busy }, busy ? t.saving : t.save), h(Button, { onClick: () => setSegmentEditor(null), disabled: busy }, t.cancel)),
  );

  const planForm = planDraft && h('form', { className: 'tracking-editor', onSubmit: savePlan },
    h('div', { className: 'tracking-fields' },
      h(Field, { label: t.duration, hint: t.durationHelp }, h(TextInput, { value: planDraft.duration, onChange: setPlan('duration'), dir: 'ltr', placeholder: '60:00' })),
      h(Field, { label: t.baseline, hint: t.baselineHelp }, h(TextInput, { type: 'number', min: 0, step: 1, value: planDraft.baseline, onChange: setPlan('baseline'), required: true })),
      h(Field, { label: t.scope }, h(Select, { value: planDraft.scope, onChange: setPlan('scope'), items: [['none', t.notPlanned], ['full', t.full], ['selected', t.selected]] })),
      h(Field, { label: t.method }, h(Select, { value: planDraft.method, onChange: setPlan('method'), items: methods })),
      planDraft.scope === 'selected' && h(Field, { label: t.target, hint: t.rangesHelp, wide: true }, h(Area, { value: planDraft.targetRanges, onChange: setPlan('targetRanges'), required: true, placeholder: '00:00–15:00\n30:00–40:00', spellCheck: false })),
    ), h('div', { className: 'tracking-actions' }, h(Button, { primary: true, type: 'submit', disabled: busy }, busy ? t.saving : t.save), h(Button, { disabled: busy, onClick: () => setPlanDraft(null) }, t.cancel)),
  );

  const passForm = passEditor && h('form', { className: 'tracking-editor', onSubmit: savePass }, h('h3', { ref: editorRef, tabIndex: -1 }, t.editPass),
    h('div', { className: 'tracking-fields' },
      h(Field, { label: t.pass }, h(Select, { value: passEditor.kind, onChange: setPass('kind'), items: [['first', t.first], ['rewatch', t.rewatch], ['targeted', t.revisit]] })),
      h(Field, { label: t.status }, h(Select, { value: passEditor.status, onChange: setPass('status'), items: [['in-progress', t.partial], ['complete', t.completed]] })),
      h(Field, { label: t.passStarted, hint: timezone }, h(TextInput, { type: 'datetime-local', value: passEditor.started, onChange: setPass('started'), required: true })),
      passEditor.status === 'complete' && h(Field, { label: t.passFinished, hint: timezone }, h(TextInput, { type: 'datetime-local', value: passEditor.finished, onChange: setPass('finished'), required: true })),
    ), h('div', { className: 'tracking-actions' }, h(Button, { primary: true, type: 'submit', disabled: busy }, busy ? t.saving : t.save), h(Button, { onClick: () => setPassEditor(null), disabled: busy }, t.cancel)),
  );

  function progress(label, seconds, percentage) {
    return h('div', { className: 'tracking-progress' }, h('div', { className: 'tracking-row' }, h('strong', null, label),
      h('span', { className: 'tracking-range' }, transcription.targetSeconds === null ? minutes(seconds) : `${minutes(seconds)} / ${minutes(transcription.targetSeconds)}${percentage === null ? '' : ` · ${Math.round(percentage * 10) / 10}%`}`)),
    percentage !== null && h('progress', { max: 100, value: percentage, 'aria-label': label }, `${percentage}%`));
  }

  return h('main', { className: 'study-tracking', dir: language === 'ar' ? 'rtl' : 'ltr' },
    h('div', { className: 'tracking-heading' }, h('div', null, h('h1', null, t.title), h('p', { className: 'tracking-muted' }, t.intro)),
      h(Field, { label: t.lecture }, h(Select, { value: lectureId, onChange: chooseLecture, items: [['', t.choose], ...(workspace.lectures || []).map((record) => [record.id, `${workspace.courses?.find((course) => course.id === record.courseId)?.title || ''} · ${record.title}`])] }))),
    error && h('div', { className: 'tracking-error', role: 'alert' }, error),
    notice && h('div', { className: 'tracking-notice', role: 'status' }, notice, undo && h(Button, { className: 'tracking-undo', onClick: undoChange, disabled: busy }, t.undo)),
    !lecture ? h('div', { className: 'tracking-empty' }, t.noLectures) : h(React.Fragment, null,
      h('section', { className: 'tracking-card', 'aria-label': t.plan }, h('div', { className: 'tracking-heading' }, h('div', null,
        h('h2', { dir: 'auto' }, lecture.title), h('p', { className: 'tracking-muted' }, `${t.duration}: ${plan?.durationSeconds ? formatTimestamp(plan.durationSeconds) : '—'} · ${t.scope}: ${t[plan?.transcriptionScope === 'full' ? 'full' : plan?.transcriptionScope === 'selected' ? 'selected' : 'notPlanned']} · ${timezone}`)),
        h(Button, { onClick: editPlan, disabled: busy }, t.plan)), planForm,
      ),
      h('div', { className: 'tracking-grid' },
        h('section', { className: 'tracking-card', 'aria-label': t.viewing },
          h('h2', null, t.viewing), h('div', { className: 'tracking-stats' },
            h('div', { className: 'tracking-stat' }, h('strong', null, summary.completedPassCount), h('span', null, t.completed)),
            h('div', { className: 'tracking-stat' }, h('strong', null, summary.targetedRevisitCount), h('span', null, t.targeted)),
            h('div', { className: 'tracking-stat' }, h('strong', null, summary.sessionCount), h('span', null, t.sessions)),
            h('div', { className: 'tracking-stat' }, h('strong', null, viewSessions.length && !viewSessions.some((session) => session.ranges.length) ? '—' : minutes(summary.uniqueCoverageSeconds)), h('span', null, t.coverage)),
          ), h('p', { className: 'tracking-muted' }, `${summary.datedCompletedPassCount} ${t.dated} · ${summary.baselineCompleteCount} ${t.undated}${summary.lastViewedAt ? ` · ${t.last}: ${dateText(summary.lastViewedAt, timezone, language)}` : ''}`),
          h('div', { className: 'tracking-actions' }, h(Button, { primary: true, disabled: busy, onClick: () => { setFastConfirm(true); setViewEditor(null); setSegmentEditor(null); setPassEditor(null); } }, t.fast), h(Button, { disabled: busy, onClick: () => startViewing() }, t.log)),
          fastConfirm && h('div', { className: 'tracking-editor' }, h('h3', { ref: editorRef, tabIndex: -1 }, t.confirmFast), h('p', null, t.fastHelp), h('p', { className: 'tracking-muted' }, `${localDateKey(new Date().toISOString(), timezone)} · ${timezone}`),
            h('div', { className: 'tracking-actions' }, h(Button, { primary: true, onClick: fastViewing, disabled: busy }, busy ? t.saving : t.save), h(Button, { onClick: () => setFastConfirm(false), disabled: busy }, t.cancel))),
          viewingForm, passForm,
        ),
        h('section', { className: 'tracking-card', 'aria-label': t.transcript },
          h('h2', null, t.transcript), h('p', { className: 'tracking-muted' }, `${t.current} · ${t[transcription.method] || t.verbatim}`),
          progress(t.written, transcription.writtenSeconds, transcription.writtenPercent), progress(t.verified, transcription.verifiedSeconds, transcription.verifiedPercent),
          !transcription.planned && h('p', { className: 'tracking-muted' }, t.noTarget),
          transcription.unknownDenominator && h('p', { className: 'tracking-muted' }, t.unknownHelp),
          transcription.nextUnfinishedRange && h('div', { className: 'tracking-preview' }, h('strong', null, t.next), h('div', { className: 'tracking-range' }, formatRanges([transcription.nextUnfinishedRange])), h(Button, { onClick: () => startSegment(null, transcription.nextUnfinishedRange), disabled: busy }, t.continue)),
          transcription.planned && !transcription.unknownDenominator && !transcription.nextUnfinishedRange && h('p', { className: 'tracking-muted' }, t.noNext),
          h('div', { className: 'tracking-actions' }, h(Button, { primary: true, onClick: () => startSegment(), disabled: busy }, t.record)), segmentForm,
        ),
      ),
      h('section', { className: 'tracking-card', 'aria-label': t.passHistory }, h('h2', null, t.passHistory),
        summary.passes.length ? h('ul', { className: 'tracking-log' }, summary.passes.map((pass) => h('li', { key: pass.id },
          h('div', { className: 'tracking-log-title' }, h('div', null, h('strong', null, t[pass.kind === 'targeted' ? 'revisit' : pass.kind]), ' · ', pass.status === 'complete' ? t.completed : t.partial,
            h('p', { className: 'tracking-muted' }, `${pass.sessionCount} ${t.sessions} · ${pass.coverageRanges.length ? minutes(pass.coverageSeconds) : t.noRanges} · ${dateText(pass.startedAt, timezone, language)}`)),
            h('div', { className: 'tracking-row' }, pass.status !== 'complete' && pass.kind !== 'targeted' && h(Button, { onClick: () => { startViewing(); setViewEditor((draft) => ({ ...draft, passId: pass.id, passKind: pass.kind })); }, disabled: busy }, t.resume), h(Button, { onClick: () => editPass(pass), disabled: busy }, t.edit), h(Button, { danger: true, onClick: () => removeRecord('viewingPasses', pass.id), disabled: busy }, t.delete))),
          pass.coverageRanges.length > 0 && h('div', { className: 'tracking-range' }, formatRanges(pass.coverageRanges)),
        ))) : h('p', { className: 'tracking-empty' }, t.noViews),
      ),
      h('section', { className: 'tracking-card', 'aria-label': t.history }, h('h2', null, t.history),
        viewSessions.length ? h('ul', { className: 'tracking-log' }, viewSessions.map((session) => h('li', { key: session.id },
          h('div', { className: 'tracking-log-title' }, h('div', null, h('strong', null, dateText(session.occurredAt, timezone, language)),
            h('p', { className: 'tracking-muted' }, session.effortMinutes === null ? t.noEffort : `${session.effortMinutes} min`),
            session.activities.map((activity) => h('span', { key: activity, className: 'tracking-pill' }, t[activity] || activity))),
            h('div', { className: 'tracking-row' }, h(Button, { onClick: () => startViewing(session), disabled: busy }, t.edit), h(Button, { danger: true, onClick: () => removeRecord('studySessions', session.id), disabled: busy }, t.delete))),
          session.ranges.length > 0 && h('p', { className: 'tracking-range' }, formatRanges(session.ranges)),
          session.reason && h('p', { className: 'tracking-muted' }, session.reason), session.note && h('p', { dir: 'auto' }, session.note),
        ))) : h('p', { className: 'tracking-empty' }, t.noViews),
      ),
      h('section', { className: 'tracking-card', 'aria-label': t.segmentHistory }, h('h2', null, t.segmentHistory),
        segments.length ? h('div', { className: 'tracking-table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, t.ranges), h('th', { scope: 'col' }, t.status), h('th', { scope: 'col' }, t.method), h('th', { scope: 'col' }, t.date), h('th', { scope: 'col' }, t.edit))),
          h('tbody', null, segments.map((segment) => h('tr', { key: segment.id },
            h('td', null, h('span', { className: 'tracking-range' }, formatRanges([segment])), segment.reference && h('div', { dir: 'auto' }, segment.reference), segment.note && h('div', { dir: 'auto', className: 'tracking-muted' }, segment.note), segment.attachmentId && h('div', { className: 'tracking-muted tracking-attachment' }, `${t.attachment}: ${lecture.fileName && lecture.fileId === segment.attachmentId ? lecture.fileName : segment.attachmentId}`)),
            h('td', null, segment.status === 'written' ? t.writtenStatus : t[segment.status]), h('td', null, t[segment.method]), h('td', null, dateText(segment.occurredAt, timezone, language), h('div', { className: 'tracking-muted' }, `${t.modified}: ${dateText(segment.modifiedAt, timezone, language)}`)),
            h('td', null, h('div', { className: 'tracking-actions' }, h(Button, { onClick: () => startSegment(segment), disabled: busy }, t.edit), h(Button, { danger: true, onClick: () => removeRecord('transcriptionSegments', segment.id), disabled: busy }, t.delete))),
          ))),
        )) : h('p', { className: 'tracking-empty' }, t.noSegments),
      ),
      h('section', { className: 'tracking-card', 'aria-label': t.evidence }, h('h2', null, t.evidence), h('p', { className: 'tracking-muted' }, t.evidenceHelp), h(Button, { onClick: () => onNavigate?.('statistics', { lectureId, tab: 'evidence' }) }, t.evidence)),
    ),
  );
}
