import { i as getReact } from './framework-D_rUT4EX.js';
import { eligibleReviewStudySessions } from '../../lib/review-context.js';
import { CardImageEditor, CardImages } from './card-images.js';
import { rememberCardMedia } from './workspace-ui.js';
import { requestStudyNavigation, takeOriginalCommand } from './study-events.js';

const React = getReact();
const h = React.createElement;
let displayTimezone = 'Asia/Amman';
export function workspaceDate(value, dateOnly = false) {
  return new Date(value).toLocaleString(undefined, { timeZone: displayTimezone, month: 'short', day: 'numeric', ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }) });
}

export function ReviewContextPanel({ card, workspace, revealed, value, onChange }) {
  if (!card) return null;
  const sessions = eligibleReviewStudySessions(workspace, card.id, { recentDays: null });
  const update = patch => onChange({ ...value, ...patch });
  return h('details', { className: 'review-context' },
    h('summary', null, 'Optional review context / سياق المراجعة'),
    h('p', { className: 'muted' }, 'Record confidence before revealing. Hard / Good / Easy mean you recalled the answer; Again means you did not.'),
    h('label', null, 'Practice mode', h('select', { value: value.practiceMode, disabled: revealed, onChange: event => update({ practiceMode: event.target.value }) },
      h('option', { value: 'closed-book' }, 'Closed-book recall'), h('option', { value: 'open-book' }, 'Open-book practice'), h('option', { value: 'revealed' }, 'Answer already known / visible'))),
    h('label', null, 'Confidence before answer (optional, 0–100)', h('input', { type: 'number', min: 0, max: 100, value: value.confidence, disabled: revealed, onChange: event => update({ confidence: event.target.value }) })),
    h('label', null, 'Optional effort seconds', h('input', { type: 'number', min: 0, max: 86400, value: value.durationSeconds, onChange: event => update({ durationSeconds: event.target.value }) })),
    sessions.length ? h('fieldset', null, h('legend', null, 'Explicitly related earlier sessions (optional)'), ...sessions.map(session => h('label', { className: 'inline', key: session.id },
      h('input', { type: 'checkbox', checked: value.studySessionIds.includes(session.id), disabled: revealed, onChange: event => update({ studySessionIds: event.target.checked ? [...value.studySessionIds, session.id] : value.studySessionIds.filter(id => id !== session.id) }) }),
      `${session.occurredAt} · ${session.activities.join(' + ')}`))) : h('p', { className: 'muted' }, 'No related study sessions recorded.'),
  );
}

export const emptyReviewContext = cardId => ({ cardId, practiceMode: 'closed-book', confidence: '', durationSeconds: '', studySessionIds: [] });
export function reviewPayload(value) {
  return {
    practiceMode: value.practiceMode,
    confidence: value.confidence === '' ? null : Number(value.confidence),
    confidenceTiming: value.confidence === '' ? 'none' : 'before-answer',
    ...(value.durationSeconds === '' ? {} : { durationSeconds: Number(value.durationSeconds) }),
    studySessionIds: value.studySessionIds,
  };
}

/** A single explicit hook connects the preserved original component to source modules. */
export function useStudyBridge({ workspace, snapshot, reviewCard, revealed, reload, navigate, editCard, openRecall, isDirty }) {
  displayTimezone = workspace.studySettings?.[0]?.timezone || 'Asia/Amman';
  const [context, setContext] = React.useState(() => emptyReviewContext(reviewCard?.id));
  const [imageBusy, setImageBusy] = React.useState(false);
  const current = React.useRef({ workspace, snapshot, reload, navigate, editCard, openRecall, isDirty });
  current.current = { workspace, snapshot, reload, navigate, editCard, openRecall, isDirty };
  React.useEffect(() => { setContext(emptyReviewContext(reviewCard?.id)); }, [reviewCard?.id]);
  React.useEffect(() => {
    const changed = () => current.current.reload(true);
    const uploadChanged = event => setImageBusy(Boolean(event.detail));
    const leaving = event => {
      if (current.current.isDirty()) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('recall:navigation-blocked', { detail: 'Save or close your current editor before opening study tools.' }));
      }
    };
    window.addEventListener('recall:workspace-change', changed);
    window.addEventListener('recall:image-uploading', uploadChanged);
    window.addEventListener('recall:navigate-request', leaving);
    return () => { window.removeEventListener('recall:workspace-change', changed); window.removeEventListener('recall:image-uploading', uploadChanged); window.removeEventListener('recall:navigate-request', leaving); };
  }, []);
  React.useEffect(() => {
    if (!snapshot) return;
    const command = takeOriginalCommand();
    if (!command) return;
    const card = workspace.cards.find(entry => entry.id === command.options?.cardId);
    if (command.view === 'cards' && card) editCard(card);
    else if (command.view === 'recall' && command.options?.lectureId) openRecall(command.options.lectureId);
    else navigate(command.view || 'dashboard');
  }, [Boolean(snapshot)]);
  const value = context.cardId === reviewCard?.id ? context : emptyReviewContext(reviewCard?.id);
  return {
    controls: h(ReviewContextPanel, { card: reviewCard, workspace, revealed, value, onChange: setContext }),
    context: reviewPayload(value),
    imageBusy,
  };
}

export function LectureStudyActions({ lectureId }) {
  return h('button', { type: 'button', className: 'study-action-link', onClick: () => requestStudyNavigation('study', { lectureId, logViewing: true }) }, 'Log viewing / سجّل مشاهدة');
}
export function RecallEvidenceAction({ lectureId, recallId, workspace }) {
  const attempt = workspace.recallAttempts?.find(record => record.recallId === recallId);
  return h('button', { type: 'button', className: 'study-action-link', onClick: () => requestStudyNavigation('statistics', { lectureId, tab: 'evidence', attemptId: attempt?.id }) }, 'Assess this attempt / تقييم الاسترجاع');
}
export function LegacyCardImageEditor({ card, workspace, onChange }) {
  return h(CardImageEditor, { card, workspace, onChange, onMediaAdded: rememberCardMedia, onBusyChange: busy => window.dispatchEvent(new CustomEvent('recall:image-uploading', { detail: busy })) });
}
export function StudyCardImages(props) { return h(CardImages, props); }
