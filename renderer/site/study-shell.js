import { i as getReact } from './framework-D_rUT4EX.js';
import { StudyTracking } from './study-tracking.js';
import { StudyStatistics } from './study-statistics.js';
import { CardMediaWorkspace, CardImages } from './card-images.js';
import { ReviewContextPanel, emptyReviewContext, reviewPayload } from './study-integration.js';
import { renderMathText } from './math-text.js';
import { requestStudyNavigation, setOriginalCommand, announceWorkspaceChange } from './study-events.js';
import { includePendingCardMedia } from './workspace-ui.js';
import { reviewContentRevision } from '../../lib/review-context.js';

const React = getReact();
const h = React.createElement;
const math = text => renderMathText(text, (type, props, key) => h(type, { ...props, key }, props.children));

function ArchiveControls({ onRefresh }) {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const perform = async action => {
    setBusy(true); setMessage('');
    try { const result = await action(); if (result) { await onRefresh(); window.dispatchEvent(new CustomEvent('recall:image-ready')); setMessage(result.importStatus?.message || 'Completed. Full backups include card image files; source PDF attachments remain separate.'); } }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return h('section', { className: 'archive-controls', 'aria-label': 'Image backups' },
    h('button', { type: 'button', disabled: busy, onClick: () => perform(() => window.recall.exportFullWorkspace()) }, 'Full backup with images'),
    h('label', { className: 'study-file-button' }, 'Restore full backup', h('input', { type: 'file', accept: '.zip', disabled: busy, onChange: async event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      if (file.size > 64 * 1024 * 1024) { setMessage('Full backups must be under 64 MiB.'); return; }
      if (!window.confirm('Import this complete backup? Your current data is backed up; conflicting edits require a choice.')) return;
      await perform(async () => window.recall.importFullWorkspace({ bytes: new Uint8Array(await file.arrayBuffer()) }));
    } })),
    h('small', null, 'Ordinary JSON exports contain data and image references only.'),
    message && h('p', { role: 'status' }, message),
  );
}

function FocusedReview({ workspace, cardId, onReviewed, onClose }) {
  const card = workspace.cards.find(entry => entry.id === cardId);
  const [revealed, setRevealed] = React.useState(false);
  const [context, setContext] = React.useState(() => emptyReviewContext(cardId));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  if (!card) return h('section', null, h('p', null, 'This card no longer exists.'), h('button', { onClick: onClose }, 'Back'));
  const rate = async rating => {
    setBusy(true); setError('');
    try {
      const snapshot = await window.recall.getWorkspace();
      const currentCard = snapshot.state.cards.find(record => record.id === cardId);
      if (!currentCard || reviewContentRevision(currentCard) !== reviewContentRevision(card) || JSON.stringify(currentCard.schedule) !== JSON.stringify(card.schedule) || currentCard.courseId !== card.courseId || currentCard.lectureId !== card.lectureId) {
        throw new Error('This card changed while you were reviewing it. Reopen it from Statistics or Images before recording a rating.');
      }
      await window.recall.saveWorkspace({ revision: snapshot.revision, operationId: crypto.randomUUID(), action: 'review', cardId, rating, context: reviewPayload(context) });
      announceWorkspaceChange(); await onReviewed(); onClose();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  return h('section', { className: 'focused-review study-surface' },
    h('button', { onClick: onClose }, 'Back to Statistics'),
    h('h1', null, 'Recall first, then reveal'),
    h(ReviewContextPanel, { workspace, card, revealed, value: context, onChange: setContext }),
    h('h2', { dir: 'auto' }, math(card.question)), h(CardImages, { card, workspace, side: 'question', revealed }),
    revealed ? h(React.Fragment, null, h('div', { className: 'revealed-answer', dir: 'auto' }, math(card.answer)), h(CardImages, { card, workspace, side: 'answer', revealed }),
      h('p', null, 'Again = did not recall. Hard / Good / Easy = recalled, with differing difficulty.'),
      h('div', { className: 'study-rating-buttons' }, ...['Again', 'Hard', 'Good', 'Easy'].map((label, index) => h('button', { key: label, disabled: busy, onClick: () => rate(index + 1) }, label))))
      : h('button', { className: 'primary-link', onClick: () => setRevealed(true) }, 'Reveal answer'),
    error && h('p', { role: 'alert' }, error),
  );
}

export function StudyShell({ OriginalApp, userName, userEmail }) {
  const [view, setView] = React.useState('workspace');
  const [options, setOptions] = React.useState({});
  const [snapshot, setSnapshot] = React.useState(null);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const refresh = React.useCallback(async () => {
    try { const next = await window.recall.getWorkspace(); setSnapshot(next); setError(''); return next; }
    catch (cause) { setError(cause.message); return null; }
  }, []);
  React.useEffect(() => {
    refresh();
    const changed = () => refresh();
    const navigate = event => {
      const { view: destination, options: selected = {} } = event.detail;
      if (['cards', 'recall', 'sources', 'dashboard'].includes(destination)) {
        setOriginalCommand({ view: destination, options: selected }); setView('workspace');
      } else setView(destination);
      setOptions(selected); refresh();
    };
    const blocked = event => setError(event.detail);
    window.addEventListener('recall:study-navigate', navigate);
    window.addEventListener('recall:workspace-change', changed);
    window.addEventListener('recall:navigation-blocked', blocked);
    return () => { window.removeEventListener('recall:study-navigate', navigate); window.removeEventListener('recall:workspace-change', changed); window.removeEventListener('recall:navigation-blocked', blocked); };
  }, [refresh]);
  const save = async workspace => {
    if (!snapshot) throw new Error('Workspace is still loading.');
    setSaving(true); setError('');
    try {
      // Use the revision that produced the form, not a new revision that could overwrite another tab.
      const next = await window.recall.saveWorkspace({ revision: snapshot.revision, operationId: crypto.randomUUID(), state: includePendingCardMedia(workspace) });
      setSnapshot(next); announceWorkspaceChange(); return next.state;
    } catch (cause) { setError(cause.message); throw cause; }
    finally { setSaving(false); }
  };
  const workspace = snapshot?.state;
  const nav = (destination, selected) => requestStudyNavigation(destination, selected);
  const selectLecture = lectureId => nav('study', { lectureId });
  const tabs = [['workspace', 'Workspace'], ['study', 'Study tracking / تتبّع الدراسة'], ['statistics', 'Statistics / الإحصاءات'], ['images', 'Images & occlusion / الصور']];
  return h(React.Fragment, null,
    h('nav', { className: 'study-navigation', 'aria-label': 'Study destinations' }, ...tabs.map(([id, label]) => h('button', { key: id, type: 'button', 'aria-current': view === id ? 'page' : undefined, onClick: () => nav(id) }, label)),
      h('span', { role: 'status', 'aria-live': 'polite' }, saving ? 'Saving…' : snapshot ? 'Saved locally' : 'Loading…')),
    error && h('div', { className: 'study-global-error', role: 'alert' }, error, h('button', { onClick: refresh }, 'Reload latest')),
    view === 'workspace' ? h(OriginalApp, { userName, userEmail }) : !workspace ? h('p', { role: 'status' }, 'Loading your local workspace…') :
      h('main', { className: 'study-surface' },
        view === 'study' && h(StudyTracking, { workspace, onSave: save, onNavigate: nav, selectedLectureId: options.lectureId, onSelectLecture: selectLecture, logViewingRequested: options.logViewing }),
        view === 'statistics' && h(StudyStatistics, { key: `${options.lectureId || ''}:${options.tab || ''}:${options.attemptId || ''}`, workspace, onSave: save, onNavigate: nav, onSelectLecture: selectLecture, initialLectureId: options.lectureId, initialTab: options.tab, initialAttemptId: options.attemptId }),
        view === 'images' && h(React.Fragment, null, h(ArchiveControls, { onRefresh: refresh }), h(CardMediaWorkspace, { workspace, onSave: save, onNavigate: nav })),
        view === 'review' && h(FocusedReview, { key: options.cardId, workspace, cardId: options.cardId, onReviewed: refresh, onClose: () => nav('statistics') }),
      ),
  );
}
