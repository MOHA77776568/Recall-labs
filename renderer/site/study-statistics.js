import { i as getReact } from './framework-D_rUT4EX.js';
import { buildStatistics } from '../../lib/statistics.js';
import { localDateTimeToUTC } from '../../lib/study.js';

const React = getReact();
const h = React.createElement;
const { useMemo, useState, useEffect } = React;
const TABS = ['Overview', 'Activity', 'Recall', 'Evidence', 'Comparisons', 'Schedule'];
const OUTCOMES = ['not-assessed', 'correct', 'partial', 'missing', 'incorrect'];
const RECORD_NAMES = { concepts: 'concept', gaps: 'gap', recallAttempts: 'recall attempt', assessments: 'assessment' };
const uid = () => globalThis.crypto.randomUUID();
const copy = value => structuredClone(value);
const list = value => Array.isArray(value) ? value : [];
const sameRecord = (left, right) => {
  const ordered = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(ordered) : Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
};
const label = value => String(value ?? '').replaceAll('-', ' ');
const percent = (numerator, denominator) => denominator > 0 ? `${Math.round(numerator / denominator * 100)}% (${numerator}/${denominator})` : 'Not enough assessed data';
const minutes = seconds => seconds === null || seconds === undefined ? 'Not recorded' : `${Math.round(seconds / 60 * 10) / 10} min`;
function dateText(value, timezone, dateOnly = false) {
  if (!value) return 'Not recorded';
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', ...(dateOnly ? {} : { timeStyle: 'short' }) }).format(new Date(value)); }
  catch { return 'Unknown date'; }
}
function localDate(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function localInput(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
// Shared timezone conversion rejects impossible local times without using the
// machine timezone. Actual persisted instants are always UTC.
const utcInput = localDateTimeToUTC;
const action = (text, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, text);
const empty = text => h('p', { className: 'study-empty' }, text);
const note = text => h('p', { className: 'study-note' }, text);
function field(text, control, help) { return h('label', { className: 'study-field' }, h('span', null, text), React.cloneElement(control, { 'aria-label': text }), help && h('small', null, help)); }
function input(value, change, props = {}) { return h('input', { value: value ?? '', onChange: event => change(event.target.value), ...props }); }
function textarea(value, change, props = {}) { return h('textarea', { value: value ?? '', onChange: event => change(event.target.value), rows: 3, dir: 'auto', ...props }); }
function select(value, change, options, props = {}) {
  return h('select', { value: value ?? '', onChange: event => change(event.target.value), ...props }, options.map(option => {
    const [id, text] = Array.isArray(option) ? option : [option, label(option)];
    return h('option', { key: id, value: id }, text);
  }));
}
function table(headers, rows, caption) {
  if (!rows.length) return empty('No contributing records match these filters.');
  return h('div', { className: 'study-table-wrap' }, h('table', null,
    caption && h('caption', null, caption),
    h('thead', null, h('tr', null, headers.map(text => h('th', { key: text, scope: 'col' }, text)))),
    h('tbody', null, rows.map((row, index) => h('tr', { key: row.key ?? index }, row.cells.map((cell, i) => h('td', { key: i, dir: 'auto' }, cell)))))));
}
function metric(title, value, description, kind = 'Recorded') {
  return h('article', { className: 'study-metric' }, h('span', { className: 'study-kind' }, kind), h('h3', null, title), h('strong', null, value), h('p', null, description));
}
function section(title, children, description) {
  return h('section', { className: 'study-panel' }, h('h2', null, title), description && note(description), children);
}
function multiSelect(text, options, selected, change, help) {
  return h('fieldset', { className: 'study-multi' }, h('legend', null, text), help && h('small', null, help), options.length ? options.map(([id, name]) => h('label', { key: id }, h('input', { type: 'checkbox', checked: selected.includes(id), onChange: event => change(event.target.checked ? [...selected, id] : selected.filter(value => value !== id)) }), h('span', { dir: 'auto' }, name))) : empty('No records available.'));
}

function EvidenceEditor({ workspace, persist, timezone, onSelectLecture, onNavigate, filters, evidenceStats, initialAttemptId }) {
  const [mode, setMode] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingConfidence, setPendingConfidence] = useState('');
  const [preparedAt, setPreparedAt] = useState('');
  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const lectures = list(workspace.lectures).filter(record => !filters.courseId || record.courseId === filters.courseId);
  const lectureOptions = [['', 'Choose lecture'], ...lectures.map(record => [record.id, record.title])];
  const conceptOptions = [['', 'No concept link'], ...list(workspace.concepts).filter(record => !form.lectureId || !record.lectureId || record.lectureId === form.lectureId).map(record => [record.id, record.title])];
  const relevantSessions = list(workspace.studySessions).filter(record => record.lectureId === form.lectureId);
  function start(kind, record = null) {
    setError(''); setEditing(record?.id || null); setMode(kind); setPreparedAt(''); setPendingConfidence('');
    const capturedAt = new Date().toISOString();
    const lectureId = filters.lectureId || lectures[0]?.id || '';
    if (record) {
      setForm({ ...copy(record), capturedAt, date: localInput(record.occurredAt || capturedAt, timezone), addressedDate: localInput(record.addressedAt || capturedAt, timezone), recheckedDate: localInput(record.recheckedAt || capturedAt, timezone), expectedText: list(record.expectedIdeas).map(idea => idea.text).join('\n'), selectedCardIds: [] });
      return;
    }
    setForm({ lectureId, courseId: filters.courseId || workspace.lectures?.find(record => record.id === lectureId)?.courseId || workspace.courses?.[0]?.id || '', conceptId: '', recallAttemptId: '', cardId: '', expectedIdeaId: '', title: '', tag: '', text: '', evidence: '', status: 'open', body: '', gaps: '', expectedText: '', kind: 'recall-idea', outcome: 'not-assessed', note: '', capturedAt, date: localInput(capturedAt, timezone), addressedDate: localInput(capturedAt, timezone), recheckedDate: localInput(capturedAt, timezone), confidence: '', confidenceTiming: 'none', studySessionIds: [], selectedCardIds: [] });
  }
  useEffect(() => {
    const attempt = workspace.recallAttempts?.find(record => record.id === initialAttemptId);
    if (attempt) start('recallAttempts', attempt);
  }, [initialAttemptId]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const next = copy(workspace);
      const id = editing || uid();
      const preserveInstant = (value, previous) => {
        const instant = previous || form.capturedAt;
        return instant && localInput(instant, timezone) === value ? instant : utcInput(value, timezone);
      };
      if (mode === 'concepts') {
        if (!form.title.trim()) throw new Error('Enter a concept title.');
        const courseId = form.lectureId ? workspace.lectures.find(record => record.id === form.lectureId)?.courseId : form.courseId;
        if (!courseId) throw new Error('Choose a course or lecture.');
        const tag = form.tag.trim() || form.title.trim();
        const record = { ...list(workspace.concepts).find(item => item.id === id), id, courseId, lectureId: form.lectureId || '', title: form.title.trim(), tag };
        next.concepts = [...list(next.concepts).filter(record => record.id !== id), record];
        // A concept is explicit. Linking selected cards adds its user-chosen tag,
        // while preserving their content, associations and scheduler state.
        next.cards = next.cards.map(card => form.selectedCardIds.includes(card.id) && !card.tags.includes(tag) ? { ...card, tags: [...card.tags, tag] } : card);
      } else if (mode === 'gaps') {
        if (!form.lectureId || !form.text.trim()) throw new Error('Choose a lecture and describe the gap.');
        const old = list(workspace.gaps).find(record => record.id === id);
        const occurredAt = preserveInstant(form.date, old?.occurredAt);
        const addressedAt = form.status === 'open' ? null : preserveInstant(form.addressedDate, old?.addressedAt);
        const recheckedAt = form.status === 'rechecked' ? preserveInstant(form.recheckedDate, old?.recheckedAt) : null;
        const record = { ...old, id, lectureId: form.lectureId, conceptId: form.conceptId || '', recallAttemptId: form.recallAttemptId || '', text: form.text.trim(), status: form.status, occurredAt, addressedAt, recheckedAt, evidence: form.evidence };
        next.gaps = [...list(next.gaps).filter(record => record.id !== id), record];
      } else if (mode === 'recallAttempts') {
        if (!form.lectureId) throw new Error('Choose a lecture.');
        const old = list(workspace.recallAttempts).find(record => record.id === id);
        const expectedIdeas = editing ? list(form.expectedIdeas).map(idea => ({ ...idea, text: idea.text.trim() })).filter(idea => idea.text) : form.expectedText.split('\n').map(text => text.trim()).filter(Boolean).map(text => ({ id: uid(), text }));
        const record = { ...old, id, lectureId: form.lectureId, recallId: form.recallId || '', occurredAt: preserveInstant(form.date, old?.occurredAt), body: form.body, gaps: form.gaps, expectedIdeas, confidence: form.confidence === '' || form.confidence === null ? null : Number(form.confidence), confidenceTiming: form.confidenceTiming || 'none', studySessionIds: form.studySessionIds || [] };
        next.recallAttempts = [...list(next.recallAttempts).filter(record => record.id !== id), record];
        // Keep historical observations when an expected idea is removed. They
        // become unlinked observations rather than disappearing from evidence.
        const ideaIds = new Set(expectedIdeas.map(idea => idea.id));
        next.assessments = list(next.assessments).map(record => record.recallAttemptId === id && record.expectedIdeaId && !ideaIds.has(record.expectedIdeaId) ? { ...record, expectedIdeaId: '', note: record.note || old?.expectedIdeas?.find(idea => idea.id === record.expectedIdeaId)?.text || '' } : record);
      } else {
        if (!form.lectureId) throw new Error('Choose a lecture.');
        if (form.kind === 'recall-idea' && !form.expectedIdeaId && !form.note.trim()) throw new Error('Choose an expected idea or write an observation.');
        const old = list(workspace.assessments).find(record => record.id === id);
        const record = { ...old, id, lectureId: form.lectureId, conceptId: form.conceptId || '', recallAttemptId: form.recallAttemptId || '', expectedIdeaId: form.kind === 'recall-idea' ? form.expectedIdeaId || '' : '', cardId: form.cardId || '', kind: form.kind, outcome: form.outcome, occurredAt: preserveInstant(form.date, old?.occurredAt), note: form.note, confidence: form.confidence === '' || form.confidence === null ? null : Number(form.confidence), confidenceTiming: form.confidenceTiming || 'none', studySessionIds: form.studySessionIds || [] };
        next.assessments = [...list(next.assessments).filter(record => record.id !== id), record];
      }
      await persist(next, `${RECORD_NAMES[mode]} saved`); setMode(''); setEditing(null);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function remove(collection, record) {
    if (!globalThis.confirm(`Delete this ${RECORD_NAMES[collection]}? You can undo the last deletion.`)) return;
    try {
      const next = copy(workspace); next[collection] = list(next[collection]).filter(item => item.id !== record.id);
      if (collection === 'recallAttempts') {
        next.assessments = list(next.assessments).map(item => item.recallAttemptId === record.id ? { ...item, recallAttemptId: '', expectedIdeaId: '' } : item);
        next.gaps = list(next.gaps).map(item => item.recallAttemptId === record.id ? { ...item, recallAttemptId: '' } : item);
      }
      if (collection === 'concepts') {
        next.studySessions = list(next.studySessions).map(item => ({ ...item, conceptIds: list(item.conceptIds).filter(id => id !== record.id) }));
        next.cards = list(next.cards).map(item => item.conceptIds ? { ...item, conceptIds: item.conceptIds.filter(id => id !== record.id) } : item);
        next.gaps = list(next.gaps).map(item => item.conceptId === record.id ? { ...item, conceptId: '' } : item);
        next.assessments = list(next.assessments).map(item => item.conceptId === record.id ? { ...item, conceptId: '' } : item);
      }
      if (collection === 'gaps') next.studySessions = list(next.studySessions).map(item => ({ ...item, gapIds: list(item.gapIds).filter(id => id !== record.id) }));
      await persist(next, 'Record deleted');
    } catch (cause) { setError(cause.message); }
  }
  const selectedAttempt = list(workspace.recallAttempts).find(record => record.id === form.recallAttemptId);
  const selectedDraft = list(workspace.recalls).find(record => record.id === form.recallId);
  const visible = collection => {
    const supplied = evidenceStats?.[collection === 'recallAttempts' ? 'attempts' : collection];
    if (Array.isArray(supplied)) return supplied;
    return list(workspace[collection]).filter(record => {
    const lecture = workspace.lectures?.find(lecture => lecture.id === record.lectureId);
    return (!filters.courseId || (record.courseId || lecture?.courseId) === filters.courseId) && (!filters.lectureId || record.lectureId === filters.lectureId) && (!filters.conceptId || record.conceptId === filters.conceptId || (collection === 'concepts' && record.id === filters.conceptId)) && (!record.occurredAt || ((!filters.from || localDate(record.occurredAt, timezone) >= filters.from) && (!filters.to || localDate(record.occurredAt, timezone) <= filters.to)));
    });
  };
  const controls = h('div', { className: 'study-actions' }, action('New concept', () => start('concepts')), action('Record a gap', () => start('gaps')), action('Record recall attempt', () => start('recallAttempts')), action('Assess an idea / application', () => start('assessments')));
  let editor = null;
  if (mode) {
    const shared = h(React.Fragment, null,
      field('Lecture', select(form.lectureId, value => { update('lectureId', value); update('recallAttemptId', ''); update('expectedIdeaId', ''); update('studySessionIds', []); }, mode === 'concepts' ? [['', 'Course-wide concept'], ...lectureOptions.slice(1)] : lectureOptions, { required: mode !== 'concepts' })),
      mode !== 'concepts' && field(`Occurred at (${timezone})`, input(form.date, value => update('date', value), { type: 'datetime-local', required: true }), 'This is the activity date. Later edits do not create another attempt.'));
    let fields;
    if (mode === 'concepts') fields = h(React.Fragment, null,
      field('Course', select(form.courseId, value => update('courseId', value), [['', 'Choose course'], ...list(workspace.courses).map(record => [record.id, record.title])])),
      field('Concept title', input(form.title, value => update('title', value), { required: true, maxLength: 200, dir: 'auto' })),
      field('Card tag', input(form.tag, value => update('tag', value), { maxLength: 80, dir: 'auto' }), 'Uses the title when empty. Matching tagged cards can contribute to concept-filtered review history.'),
      multiSelect('Link cards by this tag', list(workspace.cards).filter(record => (!form.courseId || record.courseId === form.courseId) && (!form.lectureId || record.lectureId === form.lectureId)).map(record => [record.id, record.question]), form.selectedCardIds, value => update('selectedCardIds', value)));
    if (mode === 'gaps') fields = h(React.Fragment, null,
      field('Concept', select(form.conceptId, value => update('conceptId', value), conceptOptions)),
      field('Gap / question', textarea(form.text, value => update('text', value), { required: true, maxLength: 4000 })),
      field('Status', select(form.status, value => update('status', value), ['open', 'addressed', 'rechecked'])),
      form.status !== 'open' && field(`Addressed at (${timezone})`, input(form.addressedDate, value => update('addressedDate', value), { type: 'datetime-local', required: true })),
      form.status === 'rechecked' && field(`Rechecked at (${timezone})`, input(form.recheckedDate, value => update('recheckedDate', value), { type: 'datetime-local', required: true })),
      field('Evidence / recheck notes', textarea(form.evidence, value => update('evidence', value), { maxLength: 12000 }), 'Record what changed and what you checked. Status alone does not prove understanding.'),
      field('Related recall attempt', select(form.recallAttemptId, value => update('recallAttemptId', value), [['', 'No attempt link'], ...list(workspace.recallAttempts).filter(record => record.lectureId === form.lectureId).map(record => [record.id, `${dateText(record.occurredAt, timezone)} — ${record.body.slice(0, 45)}`])])));
    if (mode === 'recallAttempts') fields = h(React.Fragment, null,
      !editing && !preparedAt && h('div', { className: 'study-preflight' }, h('h3', null, 'Optional confidence before checking'),
        note('If you have already checked the answer, leave this blank. Confidence recorded here applies to this attempt; it is not perceived clarity.'),
        field('Before-check confidence (0–100)', input(pendingConfidence, setPendingConfidence, { type: 'number', min: 0, max: 100, disabled: Boolean(preparedAt) })),
        action(preparedAt ? 'Before-check value recorded' : 'Record before-check value, then continue', () => {
          if (pendingConfidence === '' || !Number.isFinite(Number(pendingConfidence)) || Number(pendingConfidence) < 0 || Number(pendingConfidence) > 100) { setError('Enter a confidence from 0 to 100, or continue without confidence.'); return; }
          update('confidence', pendingConfidence); update('confidenceTiming', 'before'); setPreparedAt(new Date().toISOString()); setError('');
        }, { disabled: Boolean(preparedAt) }), action('Continue without confidence', () => { update('confidence', ''); update('confidenceTiming', 'none'); setPreparedAt(new Date().toISOString()); setError(''); })),
      (editing || preparedAt) && h(React.Fragment, null,
      field('Existing free-recall draft (optional)', select(form.recallId || '', value => update('recallId', value), [['', 'New independent attempt'], ...list(workspace.recalls).filter(record => record.lectureId === form.lectureId).map(record => [record.id, record.title || 'Untitled recall draft'])])),
      selectedDraft && action('Copy draft into this attempt', () => { update('body', selectedDraft.body); update('gaps', selectedDraft.gaps); update('confidence', ''); update('confidenceTiming', 'none'); }),
      field('Recall response snapshot', textarea(form.body, value => update('body', value), { rows: 6, maxLength: 100000 }), 'Write what you recalled before checking. Saving a separate attempt records a separate trial.'),
      field('Observed gaps', textarea(form.gaps, value => update('gaps', value), { maxLength: 20000 })),
      editing ? h('fieldset', { className: 'study-multi' }, h('legend', null, 'Expected ideas'), note('Each idea keeps its identity when edited. Removing an idea keeps its historical assessment as an unlinked observation.'), list(form.expectedIdeas).map(idea => h('div', { key: idea.id, className: 'study-expected-row' }, input(idea.text, value => update('expectedIdeas', form.expectedIdeas.map(item => item.id === idea.id ? { ...item, text: value } : item)), { 'aria-label': 'Expected idea', dir: 'auto', maxLength: 2000 }), action('Remove idea', () => update('expectedIdeas', form.expectedIdeas.filter(item => item.id !== idea.id))))), action('Add expected idea', () => update('expectedIdeas', [...list(form.expectedIdeas), { id: uid(), text: '' }]))) : field('Expected ideas: one idea per line', textarea(form.expectedText, value => update('expectedText', value), { rows: 4, maxLength: 12000 }), 'Coverage is reported only against this explicit list. Without a list, observations remain observations.'),
      editing && note(`Saved confidence: ${form.confidence === null || form.confidence === '' ? 'not recorded' : `${form.confidence}/100 (${form.confidenceTiming})`}. Editing this record preserves its attempt identity.`),
      multiSelect('Study sessions explicitly related to this attempt', relevantSessions.map(record => [record.id, `${dateText(record.occurredAt, timezone)} · ${list(record.methods || record.activities).map(label).join(' + ')}`]), form.studySessionIds, value => update('studySessionIds', value), 'Link the actual prior sessions. Comparisons do not guess which method caused an outcome.')));
    if (mode === 'assessments') fields = h(React.Fragment, null,
      field('Evidence kind', select(form.kind, value => update('kind', value), ['recall-idea', 'explanation', 'example', 'application'])),
      field('Concept', select(form.conceptId, value => update('conceptId', value), conceptOptions)),
      field('Related recall attempt', select(form.recallAttemptId, value => { update('recallAttemptId', value); update('expectedIdeaId', ''); }, [['', 'Standalone evidence'], ...list(workspace.recallAttempts).filter(record => record.lectureId === form.lectureId).map(record => [record.id, dateText(record.occurredAt, timezone)])])),
      form.kind === 'recall-idea' && field('Expected idea', select(form.expectedIdeaId, value => update('expectedIdeaId', value), [['', 'Observation without expected idea'], ...list(selectedAttempt?.expectedIdeas).map(idea => [idea.id, idea.text])])),
      !editing && !preparedAt && h('div', { className: 'study-preflight' }, h('h3', null, 'Before assessing this response'),
        note('Optional confidence belongs before checking this same response. If already checked, leave it blank. Post-study clarity belongs in session details.'),
        field('Before-check confidence (0–100, optional)', input(pendingConfidence, setPendingConfidence, { type: 'number', min: 0, max: 100 })),
        action('Continue to assessment', () => {
          if (pendingConfidence !== '' && (!Number.isFinite(Number(pendingConfidence)) || Number(pendingConfidence) < 0 || Number(pendingConfidence) > 100)) { setError('Confidence must be from 0 to 100.'); return; }
          update('confidence', pendingConfidence); update('confidenceTiming', pendingConfidence === '' ? 'none' : 'before'); setPreparedAt(new Date().toISOString()); setError('');
        })),
      (editing || preparedAt) && h(React.Fragment, null,
      field('Outcome', select(form.outcome, value => update('outcome', value), OUTCOMES)),
      field('Evidence / scoring notes', textarea(form.note, value => update('note', value), { maxLength: 12000 }), 'Assess the idea or application explicitly. “Not assessed” is separate from failure.'),
      field('Related card (optional)', select(form.cardId, value => update('cardId', value), [['', 'No card link'], ...list(workspace.cards).filter(record => record.lectureId === form.lectureId).map(record => [record.id, record.question])])),
      note(`Confidence: ${form.confidence === '' || form.confidence === null ? 'not recorded' : `${form.confidence}/100 (${label(form.confidenceTiming)})`}`),
      multiSelect('Explicitly related study sessions', relevantSessions.map(record => [record.id, `${dateText(record.occurredAt, timezone)} · ${list(record.methods || record.activities).map(label).join(' + ')}`]), form.studySessionIds, value => update('studySessionIds', value))));
    editor = h('form', { className: 'study-editor', onSubmit: save }, h('h3', null, `${editing ? 'Edit' : 'New'} ${RECORD_NAMES[mode]}`), shared, fields,
      h('div', { className: 'study-actions' }, h('button', { type: 'submit', disabled: busy || (['assessments', 'recallAttempts'].includes(mode) && !editing && !preparedAt) }, busy ? 'Saving…' : 'Save record'), action('Cancel', () => { setMode(''); setEditing(null); }, { disabled: busy })));
  }
  const recordActions = (collection, record) => h('div', { className: 'study-actions' }, action('Edit', () => start(collection, record)), action('Delete', () => remove(collection, record), { className: 'study-danger' }));
  return h(React.Fragment, null,
    section('Capture evidence', h(React.Fragment, null, controls, error && h('p', { role: 'alert', className: 'study-error' }, error), editor), 'Manual, structured observations. Viewing, confidence, scheduler estimates and evidence of understanding remain separate.'),
    section('Concepts', table(['Concept / tag', 'Scope', 'Actions'], visible('concepts').map(record => ({ key: record.id, cells: [h('div', null, h('strong', null, record.title), h('small', null, record.tag)), workspace.lectures?.find(lecture => lecture.id === record.lectureId)?.title || workspace.courses?.find(course => course.id === record.courseId)?.title || 'Unknown', recordActions('concepts', record)] }))), 'Current concept records; date filters do not turn current tags into historical concept evidence.'),
    section('Gaps', table(['Gap', 'Status and dates', 'Evidence', 'Actions'], visible('gaps').map(record => ({ key: record.id, cells: [record.text, h('div', null, label(record.status), h('small', null, `Observed: ${dateText(record.occurredAt, timezone)}`), record.addressedAt && h('small', null, `Addressed: ${dateText(record.addressedAt, timezone)}`), record.recheckedAt && h('small', null, `Rechecked: ${dateText(record.recheckedAt, timezone)}`)), record.evidence || 'No evidence recorded', h('div', null, recordActions('gaps', record), action('Open lecture', () => onSelectLecture?.(record.lectureId)))] })))),
    section('Recall attempts', table(['Attempt', 'Expected-idea assessment', 'Confidence', 'Actions'], visible('recallAttempts').map(record => {
      const coverage = evidenceStats?.expectedIdeas?.attempts?.find(attempt => attempt.attemptId === record.id);
      const ideaLabel = !record.expectedIdeas.length ? 'No expected list; no coverage percentage' : !coverage?.assessedCount ? `${coverage?.denominator ?? record.expectedIdeas.length} expected ideas; no matching assessments in the selected period` : `${coverage.numerator}/${coverage.denominator} expected ideas correct; ${coverage.assessedCount}/${coverage.denominator} assessed in period; ${coverage.notAssessedCount} not assessed`;
      return { key: record.id, cells: [h('details', null, h('summary', null, `${dateText(record.occurredAt, timezone)} · ${workspace.lectures?.find(lecture => lecture.id === record.lectureId)?.title || 'Lecture'}`), h('p', { className: 'study-response', dir: 'auto' }, record.body || 'No response recorded'), record.gaps && h('p', { dir: 'auto' }, `Gaps: ${record.gaps}`)), ideaLabel, record.confidence === null ? 'Not recorded' : `${record.confidence}/100 (${label(record.confidenceTiming)})`, h('div', null, recordActions('recallAttempts', record), action('Assess idea', () => { start('assessments'); setForm(previous => ({ ...previous, lectureId: record.lectureId, recallAttemptId: record.id, studySessionIds: record.studySessionIds || [] })); }))] };
    })), 'Dated attempts and their matching assessments use the selected period and association filters. Edits/reflections do not add attempts; correct/list coverage is not a mastery score.'),
    section('Idea and application evidence', table(['Date / kind', 'Outcome', 'Observation', 'Actions'], visible('assessments').map(record => ({ key: record.id, cells: [`${dateText(record.occurredAt, timezone)} · ${label(record.kind)}`, label(record.outcome), record.note || list(workspace.recallAttempts).find(attempt => attempt.id === record.recallAttemptId)?.expectedIdeas?.find(idea => idea.id === record.expectedIdeaId)?.text || 'No note recorded', h('div', null, recordActions('assessments', record), record.cardId && action('Edit card', () => onNavigate?.('cards', { cardId: record.cardId })))] }))), 'These are self-assessed outcomes. “Not assessed” does not enter a success/failure denominator.'));
}

function viewingCell(viewing = {}) {
  const complete = viewing.datedCompletedPassCount ?? 0;
  const revisits = viewing.targetedRevisitCount ?? viewing.partialRevisitCount ?? 0;
  const baseline = viewing.baselineCompleteCount ?? viewing.historicalBaselineCount ?? 0;
  return h('div', null, `${complete} logged complete passes · ${revisits} targeted revisits`, h('small', null, `${viewing.sessionCount ?? 0} viewing sessions`), baseline > 0 && h('small', null, `${baseline} historical baseline passes (undated; excluded from period activity)`));
}
function coverageCell(transcription = {}) {
  const written = transcription.writtenSeconds ?? 0;
  const verified = transcription.verifiedSeconds ?? 0;
  const target = transcription.targetSeconds;
  if (!transcription.planned) return h('div', null, 'Not planned', (written > 0 || verified > 0) && h('small', null, `${minutes(written)} written · ${minutes(verified)} verified (recorded optional work)`));
  return h('div', null, !(target > 0) ? `${minutes(written)} written · ${minutes(verified)} verified; target duration unknown` : `${minutes(written)}/${minutes(target)} written (${Math.round(written / target * 100)}%)`, h('small', null, !(target > 0) ? 'No percentage without a known target' : `${minutes(verified)}/${minutes(target)} verified (${Math.round(verified / target * 100)}%)`), h('small', null, `Method: ${label(transcription.method)}`));
}

/** Dedicated readable React statistics route. All aggregates are derived by
 * lib/statistics.js; only first-class input records and preferences are saved. */
export function StudyStatistics({ workspace, onSave, onNavigate, onSelectLecture, language = 'en', initialLectureId = '', initialTab = 'Overview', initialAttemptId }) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const refreshClock = () => { if (!document.hidden) setNow(new Date().toISOString()); };
    const timer = setInterval(refreshClock, 60_000);
    window.addEventListener('focus', refreshClock);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshClock); };
  }, []);
  const [tab, setTab] = useState(TABS.find(tab => tab.toLowerCase() === initialTab.toLowerCase()) || 'Overview');
  const [filters, setFilters] = useState({ from: '', to: '', courseId: workspace.lectures?.find(record => record.id === initialLectureId)?.courseId || '', lectureId: initialLectureId, conceptId: '', tag: '' });
  const preference = list(workspace.studySettings)[0];
  const timezone = preference?.timezone || 'Asia/Amman';
  const [zoneInput, setZoneInput] = useState(timezone);
  const [status, setStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState(null);
  const [historyLectureId, setHistoryLectureId] = useState('');
  const [dismissedExpanded, setDismissedExpanded] = useState(false);
  const computed = useMemo(() => {
    try {
      if (filters.from && filters.to && filters.from > filters.to) return { error: 'The start date must be on or before the end date.' };
      return { data: buildStatistics(workspace, { ...filters, timezone, now }) };
    } catch (cause) { return { error: cause.message }; }
  }, [workspace, filters, timezone, now]);
  const stats = computed.data;
  async function persist(next, message = 'Saved') {
    setSaving(true); setSaveError('');
    try {
      await onSave(next);
      setUndo({ previous: copy(workspace), saved: copy(next), label: message });
      setStatus(message);
    } catch (cause) { setSaveError(cause.message || 'Could not save. Your current records have not been replaced.'); throw cause; }
    finally { setSaving(false); }
  }
  async function undoLast() {
    if (!undo) return;
    try {
      const target = copy(workspace);
      // Undo only the records changed by this action. Unrelated additions survive;
      // a later edit of a touched record is surfaced instead of overwritten.
      for (const collection of Object.keys(undo.saved)) {
        if (!Array.isArray(undo.saved[collection]) || !Array.isArray(undo.previous[collection])) continue;
        const before = new Map(undo.previous[collection].map(record => [record.id, record]));
        const after = new Map(undo.saved[collection].map(record => [record.id, record]));
        const current = new Map(list(target[collection]).map(record => [record.id, record]));
        for (const id of new Set([...before.keys(), ...after.keys()])) {
          if (sameRecord(before.get(id), after.get(id))) continue;
          if (!sameRecord(current.get(id), after.get(id))) throw new Error('This record changed after the last action. Reopen it to make the correction without overwriting newer work.');
          if (before.has(id)) current.set(id, before.get(id)); else current.delete(id);
        }
        target[collection] = [...current.values()];
      }
      await onSave(target); setUndo(null); setStatus('Last change undone'); setSaveError('');
    }
    catch (cause) { setSaveError(cause.message); }
  }
  const applyFilter = (key, value) => setFilters(previous => ({ ...previous, [key]: value, ...(key === 'courseId' ? { lectureId: '', conceptId: '' } : {}), ...(key === 'lectureId' ? { conceptId: '' } : {}) }));
  async function saveTimezone(event) {
    event.preventDefault();
    try {
      new Intl.DateTimeFormat('en', { timeZone: zoneInput.trim() }).format(new Date());
      const next = copy(workspace);
      next.studySettings = [{ ...preference, id: 'preferences', timezone: zoneInput.trim(), dismissedInsightIds: preference?.dismissedInsightIds || [] }];
      await persist(next, 'Display timezone saved');
    } catch (cause) { setSaveError(cause.message || 'Choose a valid IANA timezone, such as Asia/Amman.'); }
  }
  async function dismissInsight(id) {
    try {
      const next = copy(workspace);
      next.studySettings = [{ ...preference, id: 'preferences', timezone, dismissedInsightIds: [...new Set([...(preference?.dismissedInsightIds || []), id])] }];
      await persist(next, 'Suggestion dismissed');
    } catch { /* persist reports this without losing the current suggestion */ }
  }
  function openInsight(insight) {
    if (insight.action === 'review' || insight.action === 'card' || insight.type === 'forgotten-card') onNavigate?.('review', { cardId: insight.cardId });
    else if (insight.action === 'edit-card') onNavigate?.('cards', { cardId: insight.cardId });
    else if (insight.type === 'open-gap' || insight.action === 'gap') { setTab('Evidence'); if (insight.lectureId) applyFilter('lectureId', insight.lectureId); }
    else if (insight.action === 'recall') onNavigate?.('recall', { lectureId: insight.lectureId });
    else onSelectLecture?.(insight.lectureId);
  }
  const period = filters.from || filters.to ? `${filters.from || 'earliest record'} to ${filters.to || 'today'} (${timezone})` : `All dated history (${timezone})`;
  const courses = list(workspace.courses);
  const lectures = list(workspace.lectures).filter(record => !filters.courseId || record.courseId === filters.courseId);
  const concepts = list(workspace.concepts).filter(record => (!filters.courseId || record.courseId === filters.courseId) && (!filters.lectureId || !record.lectureId || record.lectureId === filters.lectureId));
  const tags = [...new Set(list(workspace.cards).filter(record => (!filters.courseId || record.courseId === filters.courseId) && (!filters.lectureId || record.lectureId === filters.lectureId)).flatMap(record => record.tags || []))].sort();
  const toolbar = h('div', { className: 'study-filters' },
    field('From date', input(filters.from, value => applyFilter('from', value), { type: 'date' })),
    field('Through date', input(filters.to, value => applyFilter('to', value), { type: 'date' })),
    field('Course', select(filters.courseId, value => applyFilter('courseId', value), [['', 'All courses'], ...courses.map(record => [record.id, record.title])])),
    field('Lecture', select(filters.lectureId, value => applyFilter('lectureId', value), [['', 'All lectures'], ...lectures.map(record => [record.id, record.title])])),
    field('Concept', select(filters.conceptId, value => applyFilter('conceptId', value), [['', 'All concepts'], ...concepts.map(record => [record.id, record.title])])),
    field('Card tag', select(filters.tag, value => applyFilter('tag', value), [['', 'All tags'], ...tags.map(tag => [tag, tag])]), 'Tags filter records with a known matching association.'),
    action('Reset filters', () => setFilters({ from: '', to: '', courseId: '', lectureId: '', conceptId: '', tag: '' })));
  let content;
  if (stats) {
    const { activity = {}, reviews = {}, evidence = {}, methods = {}, confidence = {}, schedule = {} } = stats;
    const delayed = reviews.delayed || {};
    const matrix = list(stats.matrix);
    const matrixTable = table(['Lecture', 'Viewing (current)', 'Manual transcription (current)', 'Recall attempts in period', 'Current open gaps', 'Latest activity (all dated history)', 'Actions'], matrix.map(row => ({ key: row.lecture.id, cells: [row.lecture.title, viewingCell(row.viewing), coverageCell(row.transcription), row.periodRecallAttemptCount, h('div', null, row.openGapCount, row.unrecheckedGapCount > row.openGapCount && h('small', null, `${row.unrecheckedGapCount} including addressed without recheck`)), dateText(row.latestActivityAt, timezone), h('div', { className: 'study-actions' }, action('Lecture progress', () => onSelectLecture?.(row.lecture.id)), action('History', () => { setHistoryLectureId(row.lecture.id); setTab('Activity'); }))] })), 'Lecture matrix — current coverage/open gaps and latest lifetime activity; recall attempts use the selected period.');
    const insights = list(stats.insights).filter(insight => !list(preference?.dismissedInsightIds).includes(insight.id));
    const worthAttention = section('Worth your attention', insights.length ? h('ul', { className: 'study-insights' }, insights.map(insight => h('li', { key: insight.id }, h('div', null, h('strong', null, insight.title), h('p', null, insight.reason)), h('div', { className: 'study-actions' }, action(insight.action === 'review' || insight.action === 'card' ? 'Review card' : insight.action === 'edit-card' ? 'Edit card' : insight.action === 'recall' ? 'Free recall' : insight.action === 'gap' ? 'Inspect gap' : 'Open lecture', () => openInsight(insight)), insight.cardId && action('Edit card', () => onNavigate?.('cards', { cardId: insight.cardId })), insight.type === 'unrecorded-recall' && action('Free recall', () => onNavigate?.('recall', { lectureId: insight.lectureId })), action('Dismiss', () => dismissInsight(insight.id)))))) : empty('No suggestions from the current records and filters. Unrecorded activity is not proof it never happened.'), 'Suggestions explain their rule and are optional. Opening or dismissing one does not change any card schedule.');
    if (tab === 'Overview') content = h(React.Fragment, null,
      h('div', { className: 'study-metrics' },
        metric('Study sessions', activity.sessionCount ?? 0, `One sitting counts once, including mixed-method sittings. ${period}.`),
        metric('Flashcard review attempts', reviews.totalAttempts ?? 0, `${reviews.distinctCards ?? 0} distinct cards. ${period}.`),
        metric('Delayed self-rated recall', percent(delayed.numerator ?? 0, delayed.denominator ?? 0), `${delayed.denominator ?? 0} eligible first-per-day observations. ${period}.`, 'Self-rated'),
        metric('Cards currently due', schedule.due ?? 0, `${schedule.overdue ?? 0} overdue. Current schedule snapshot; date filters do not change today’s due status.`, 'Scheduled')),
      worthAttention, section('Lecture progress', matrixTable, 'Completed viewings, writing coverage and gaps describe activity/progress. Understanding is documented separately through scored observations.'),
      h('details', { className: 'study-panel' }, h('summary', null, 'What these statistics measure'), note('Recorded activity comes from study sessions and viewing/transcription records. Recall and evidence outcomes are self-rated. Upcoming due dates come from the current FSRS schedule. None of these alone establishes mastery.'), note('Historical baseline viewing counts have no invented dates. They are shown with current lecture progress and excluded from dated activity.')));
    if (tab === 'Activity') {
      const chronological = list(activity.history).filter(record => !historyLectureId || record.lectureId === historyLectureId);
      content = h(React.Fragment, null,
        h('div', { className: 'study-metrics' },
          metric('Unique sessions', activity.sessionCount ?? 0, `${period}. Activity labels may add up to more than this count.`),
          metric('Optional logged effort', `${activity.effortMinutes ?? 0} min`, `${activity.knownEffortSessionCount ?? 0}/${activity.sessionCount ?? 0} sessions have duration; ${activity.unknownEffortSessionCount ?? 0} unknown. Mixed sessions contribute elapsed effort once.`)),
        section('Study methods', table(['Activity label', 'Sessions with this label'], Object.entries(activity.activityCounts || {}).map(([method, count]) => ({ key: method, cells: [label(method), count] }))), 'Each label counts its recorded sessions. One mixed session may appear under several labels.'),
        section('Activity calendar', table(['Local day', 'Unique sessions', 'Recorded effort'], list(activity.calendar).map(day => ({ key: day.date, cells: [day.date, day.sessionCount, `${day.effortMinutes} min (${day.knownEffortSessionCount}/${day.sessionCount} sessions timed)`] }))), `Dated activity grouped in ${timezone}; a blank day means no matching record.`),
        section('Chronological history', h(React.Fragment, null, field('History lecture', select(historyLectureId, setHistoryLectureId, [['', 'All filtered lectures'], ...lectures.map(record => [record.id, record.title])])), table(['Occurred at', 'Lecture', 'Kind', 'Details', 'Actions'], chronological.map(record => ({ key: record.id, cells: [dateText(record.at, timezone), workspace.lectures.find(lecture => lecture.id === record.lectureId)?.title || 'Historical association', label(record.type), h('details', null, h('summary', null, record.label), h('p', { dir: 'auto' }, record.record?.note || record.record?.text || record.record?.body || record.record?.reason || 'No optional note recorded')), record.lectureId && action('Open lecture', () => onSelectLecture?.(record.lectureId))] })))), 'Activity dates are separate from later edits. Undated historical baseline counts do not appear here.'),
        section('Lecture matrix', matrixTable));
    }
    if (tab === 'Recall') {
      const delayedRows = list(delayed.records).map(record => ({ key: record.id, cells: [dateText(record.at, timezone), h('div', null, record.snapshotLabels?.cardQuestion || 'Historical card content not recorded', record.contentRevision && h('small', null, `Content revision recorded: ${record.contentRevision}`)), ['Again', 'Hard', 'Good', 'Easy'][record.rating - 1], record.passed === false || record.rating === 1 ? 'Failed recall' : 'Recalled', workspace.cards.some(card => card.id === record.cardId) ? action('Review current card', () => onNavigate?.('review', { cardId: record.cardId })) : 'Deleted card; history retained'] }));
      const forgottenRows = list(reviews.forgottenCards).map(record => ({ key: record.cardId, cells: [record.card?.question || 'Historical card', h('div', null, `${record.againCount} Again outcomes among ${record.attemptCount} attempts on ${record.dayCount} days`, h('small', null, record.rule)), h('div', { className: 'study-actions' }, action('Review', () => onNavigate?.('review', { cardId: record.cardId })), action('Edit card', () => onNavigate?.('cards', { cardId: record.cardId })))] }));
      const delayedRule = h(React.Fragment, null,
        note(delayed.rule || 'First eligible review per card per local day, known prior review at least 24 hours earlier, and eligible pre-review state; explicitly open-book practice is excluded. Again is failure; Hard/Good/Easy are recalled answers with differing difficulty.'),
        note('This is self-rated delayed recall, not exam accuracy or Anki’s exact True Retention definition. A failure followed by same-day repetitions remains that day’s failed observation.'),
        table(['Exclusion / unknown context', 'Records'], Object.entries(delayed.excludedCounts || {}).map(([reason, count]) => ({ key: reason, cells: [label(reason), count] }))),
        h('details', null, h('summary', null, `Eligible observation drill-down (${delayedRows.length})`), table(['Date', 'Card', 'Rating', 'Outcome', 'Actions'], delayedRows)));
      content = h(React.Fragment, null,
      h('div', { className: 'study-metrics' }, metric('All review attempts', reviews.totalAttempts ?? 0, `${reviews.distinctCards ?? 0} distinct cards in ${period}. Same-day repeats are included in activity.`), metric('Delayed self-rated recall', percent(delayed.numerator ?? 0, delayed.denominator ?? 0), `${delayed.denominator ?? 0} eligible observations in ${period}.`, 'Self-rated'), metric('Legacy/general reviews', reviews.legacyCount ?? 0, 'Missing historical eligibility context remains unknown. These records contribute to general activity only.')),
      section('Delayed recall rule', delayedRule),
      section('All-review rating distribution', table(['Self-rating', 'Attempts / all reviewed attempts'], ['Again', 'Hard', 'Good', 'Easy'].map((rating, index) => ({ key: rating, cells: [rating, `${reviews.ratingCounts?.[rating] ?? reviews.ratingCounts?.[index + 1] ?? reviews.ratingCounts?.[rating.toLowerCase()] ?? 0}/${reviews.totalAttempts ?? 0}`] }))), 'This distribution includes initial learning, relearning and repeated practice. It remains separate from eligible delayed recall.'),
      section('Frequently forgotten cards', forgottenRows.length ? table(['Card', 'Documented pattern', 'Actions'], forgottenRows) : empty('No current cards meet the documented repeated-forgetting rule.'), 'Repeated forgetting is a prompt to inspect a card. It does not automatically delete, suspend or reschedule it. Adding difficult new cards can change the reviewed population.'));
    }
    if (tab === 'Evidence') content = h(React.Fragment, null,
      h('div', { className: 'study-metrics' }, metric('Dated recall attempts', list(evidence.attempts).length, `${period}; edits preserve the same attempt ID.`), metric('Expected-idea coverage', evidence.expectedIdeas?.percent === null && evidence.expectedIdeas?.denominator > 0 ? 'Ideas not assessed yet' : percent(evidence.expectedIdeas?.numerator ?? 0, evidence.expectedIdeas?.denominator ?? 0), `${evidence.expectedIdeas?.assessedCount ?? 0}/${evidence.expectedIdeas?.denominator ?? 0} expected ideas assessed; ${evidence.expectedIdeas?.notAssessedCount ?? 0} not assessed. Correct/list coverage uses the explicit expected list and is not a failure rate. ${period}.`, 'Self-assessed')),
      h(EvidenceEditor, { workspace, persist, timezone, onSelectLecture, onNavigate, filters, evidenceStats: evidence, initialAttemptId }));
    if (tab === 'Comparisons') {
      const confidenceRows = list(confidence.pairs).map(pair => ({ key: `${pair.type}:${pair.id}`, cells: [dateText(pair.at, timezone), `${pair.confidence}/100`, label(pair.outcome), label(pair.type)] }));
      const confidenceBody = h(React.Fragment, null,
        h('div', { className: 'study-metrics' }, metric('Matched before-check confidence', confidence.sampleSize ?? 0, `${period}. Only confidence and scored/self-rated outcome from the same attempt are paired.`, 'Self-reported + self-rated')),
        !confidenceRows.length && empty('No comparable confidence/outcome pairs yet. Capture confidence before checking a new review or assessment, then score that same response.'),
        table(['Confidence band', 'Matched attempts', 'Fully recalled / correct'], list(confidence.buckets).map(bucket => ({ key: bucket.label, cells: [bucket.label, bucket.sampleSize, percent(bucket.passCount, bucket.sampleSize)] }))),
        note(confidence.rule),
        h('details', null, h('summary', null, 'Matched attempt drill-down'), table(['Date', 'Before-check confidence', 'Outcome', 'Kind'], confidenceRows)));
      const methodRows = list(methods.groups).map(group => ({ key: `${group.outcomeType}:${group.method}`, cells: [h('div', null, label(group.label), h('small', null, `Outcome population: ${label(group.outcomeType)}`)), group.sampleSize, percent(group.passCount, group.sampleSize), `${Math.round(group.meanDelayHours * 10) / 10} h mean (${Math.round(group.delayHours.min * 10) / 10}–${Math.round(group.delayHours.max * 10) / 10} h range)`, group.difficultyContext.length ? `${group.difficultyContext.length}/${group.sampleSize} observations have pre-review difficulty/interval context` : 'Difficulty not recorded; inspect individual observations'] }));
      const methodDetails = list(methods.groups).flatMap(group => list(group.records).map(record => ({ key: `${record.kind}:${record.id}`, cells: [label(group.label), dateText(record.at, timezone), `${Math.round(record.delayHours * 10) / 10} h`, label(record.outcome), record.difficulty === null ? 'Difficulty not recorded' : `Pre-review difficulty ${record.difficulty}`] })));
      const methodBody = h(React.Fragment, null,
        note('Observational descriptions only. These records do not establish that one method caused a result or that one method is best.'),
        methodRows.length ? table(['Explicitly linked method pattern', 'Comparable later outcomes', 'Recalled / correct', 'Delay from latest linked session', 'Difficulty / context'], methodRows) : empty('No comparable outcomes with explicitly linked prior study sessions. Log viewing/writing sessions, link them to a later recall attempt or assessment, and record an outcome.'),
        note(`${methods.missingLinkedOutcomes ?? 0} outcomes lack usable explicit study-session links. Mixed sessions stay mixed; the outcome is not attributed to just one method.`),
        note(methods.rule),
        h('details', null, h('summary', null, 'Comparison observation drill-down'), table(['Pattern', 'Test date', 'Delay', 'Outcome', 'Context'], methodDetails)));
      content = h(React.Fragment, null,
        section('Confidence and corresponding outcomes', confidenceBody, 'Post-study perceived clarity stays separate. Missing confidence never becomes zero confidence.'),
        section('Study-method comparisons', methodBody));
    }
    if (tab === 'Schedule') {
      const scheduleRows = list(schedule.records).map(record => ({ key: record.cardId, cells: [record.question, dateText(record.dueAt, timezone), record.overdue ? 'Overdue' : 'Scheduled', action('Review', () => onNavigate?.('review', { cardId: record.cardId }))] }));
      content = h(React.Fragment, null,
        h('div', { className: 'study-metrics' }, metric('Due now', schedule.due ?? 0, 'Current cards whose scheduled due instant is at or before now.', 'Current schedule'), metric('Overdue', schedule.overdue ?? 0, 'Cards whose scheduled due instant is before the current instant.', 'Current schedule'), metric('Scheduled next 7 days', schedule.dueNext7 ?? 0, `From now through today + 6 local days (${timezone}). Later repetitions are not included.`, 'Current schedule'), metric('Scheduled next 30 days', schedule.dueNext30 ?? 0, 'From now through today + 29 local days. Current schedule, not a forecast of all future practice.', 'Current schedule')),
        section('Scheduled due-date calendar', table(['Local scheduled day', 'Current cards scheduled'], list(schedule.calendar).map(day => ({ key: day.date, cells: [day.date, day.count] }))), `Course/lecture/concept/tag filters apply; selected activity date range does not change the current schedule snapshot. Grouping: ${timezone}.`),
        section('Overdue breakdown', table(['Elapsed time past due', 'Current cards'], list(schedule.overdueBreakdown).map(group => ({ key: group.label, cells: [group.label, group.count] }))), 'Elapsed time from the current instant, using the currently scheduled due time.'),
        section('Due-date drill-down', table(['Card', 'Due at', 'Status', 'Actions'], scheduleRows)));
    }
    if (dismissedExpanded) content = h(React.Fragment, null, content, section('Dismissed suggestions', note(`${list(preference?.dismissedInsightIds).length} saved dismissals.`), 'Dismissals are preferences, not changes to study history.'));
  }
  return h('main', { className: 'study-statistics', lang: language === 'ar' ? 'ar' : 'en', dir: 'auto', 'aria-label': 'Study statistics' },
    h('header', { className: 'study-statistics-heading' }, h('div', null, h('h1', null, 'Statistics'), note('Your recorded activity, self-rated recall, assessed ideas and current schedule.')), action('Lecture study tracking', () => onNavigate?.('study'))),
    toolbar,
    h('div', { className: 'study-scope' }, h('strong', null, period), h('span', null, 'Current progress and schedule are labeled separately from dated activity.')),
    h('nav', { className: 'study-tabs', 'aria-label': 'Statistics views' }, TABS.map(name => action(name, () => setTab(name), { key: name, 'aria-current': tab === name ? 'page' : undefined, className: tab === name ? 'is-active' : '' }))),
    h('div', { className: 'study-save-status', role: 'status', 'aria-live': 'polite' }, saving ? 'Saving locally…' : status, undo && action('Undo last change', undoLast, { disabled: saving })),
    (saveError || computed.error) && h('p', { className: 'study-error', role: 'alert' }, saveError || computed.error),
    content,
    h('details', { className: 'study-panel' }, h('summary', null, 'Timezone and dismissed suggestions'), h('form', { className: 'study-timezone', onSubmit: saveTimezone }, field('Calendar/display timezone', input(zoneInput, setZoneInput, { placeholder: 'Asia/Amman', required: true }), 'IANA name, such as Asia/Amman. Stored activity instants remain UTC.'), h('button', { type: 'submit', disabled: saving }, 'Save timezone')), action(dismissedExpanded ? 'Hide dismissals' : 'Show dismissals', () => setDismissedExpanded(value => !value)), list(preference?.dismissedInsightIds).length > 0 && action('Restore dismissed suggestions', async () => { const next = copy(workspace); next.studySettings = [{ ...preference, id: 'preferences', timezone, dismissedInsightIds: [] }]; try { await persist(next, 'Dismissed suggestions restored'); } catch {} })));
}
