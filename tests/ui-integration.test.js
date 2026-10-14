import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { integrateStudyUI } from '../scripts/integrate-study-ui.js';
import { recordOriginalRecallAttempt, prepareUiImport } from '../renderer/site/workspace-ui.js';
import { emptyWorkspace, createWorkspaceDocument } from '../lib/workspace.js';

test('preserved UI output is exactly reproducible and rejects an unexpected vendor baseline', () => {
  const vendor = readFileSync(new URL('../renderer/site/vendor/recall-app.base.js', import.meta.url), 'utf8');
  const generated = readFileSync(new URL('../renderer/site/recall-app-DZqLhe8P.js', import.meta.url), 'utf8');
  assert.equal(integrateStudyUI(vendor), generated);
  assert.throws(() => integrateStudyUI(vendor + '\n'), /baseline/);
});

test('new original recall saves create one dated attempt; reflections and legacy drafts never invent attempts', () => {
  const previous = emptyWorkspace();
  const draft = { id: 'draft', lectureId: 'lecture', body: 'Synthetic عربي explanation', gaps: '', updatedAt: '2026-10-14T09:00:00.000Z' };
  const next = { ...previous, recalls: [draft] };
  const logged = recordOriginalRecallAttempt(next, draft, previous);
  assert.equal(logged.recallAttempts.length, 1);
  assert.equal(logged.recallAttempts[0].occurredAt, draft.updatedAt);
  assert.equal(logged.recallAttempts[0].confidence, null);
  assert.deepEqual(logged.recallAttempts[0].expectedIdeas, []);
  const reflection = { ...draft, body: 'Later reflection' };
  const updated = recordOriginalRecallAttempt({ ...logged, recalls: [reflection] }, reflection, logged);
  assert.equal(updated.recallAttempts.length, 1);
  assert.equal(updated.recallAttempts[0].body, draft.body);
  const legacy = recordOriginalRecallAttempt(next, draft, next);
  assert.equal(legacy.recallAttempts.length, 0);
  assert.equal(recordOriginalRecallAttempt({ ...previous, recalls: [{ ...draft, body: '' }] }, { ...draft, body: '' }, previous).recallAttempts.length, 0);
});

test('original full JSON importer preserves study records and safe extensions rather than stripping them', () => {
  const workspace = emptyWorkspace(); workspace.safeExtension = { text: 'محفوظ' };
  const doc = createWorkspaceDocument(workspace);
  const parsed = prepareUiImport(JSON.stringify(doc), 'json', emptyWorkspace(), '', {});
  assert.equal(parsed.mode, 'restore'); assert.deepEqual(parsed.state, doc.workspace);
  assert.throws(() => prepareUiImport('{"schemaVersion":999}', 'json', workspace, '', {}), /version|schema/i);
});
