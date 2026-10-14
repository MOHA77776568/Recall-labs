import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyWorkspace, emptyWorkspaceDocument, validateWorkspace, createWorkspaceDocument,
  serializeWorkspaceDocument, parseWorkspaceDocument, mergeWorkspaceDocuments, resolveWorkspaceConflicts,
} from '../lib/workspace.js';

const FIRST = '2026-10-01T10:00:00.000Z';
const SECOND = '2026-10-02T10:00:00.000Z';
const THIRD = '2026-10-03T10:00:00.000Z';
const MEDIA = 'a'.repeat(64);
const OTHER_MEDIA = 'b'.repeat(64);
function fixture() {
  const workspace = emptyWorkspace();
  workspace.courses.push({ id: 'course-a', title: 'Synthetic course', description: '', color: 'blue' });
  workspace.lectures.push({ id: 'lecture-a', courseId: 'course-a', title: 'Synthetic lecture', topic: '', notes: '', pages: [] });
  workspace.media.push({ id: MEDIA, mimeType: 'image/png', byteLength: 1_000, width: 800, height: 600, fileName: `${MEDIA}.png` });
  workspace.cards.push({ id: 'card-a', courseId: 'course-a', lectureId: 'lecture-a', question: '', answer: '', questionImages: [{ mediaId: MEDIA, description: 'سؤال / figure' }], answerImages: [{ mediaId: MEDIA }], tags: [], source: '', createdAt: FIRST,
    schedule: { due: SECOND, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0 } });
  return workspace;
}
const doc = (workspace = fixture()) => createWorkspaceDocument(workspace, emptyWorkspaceDocument(), FIRST);
const edit = (document, mutate, now = SECOND) => { const workspace = structuredClone(document.workspace); mutate(workspace); return createWorkspaceDocument(workspace, document, now); };

test('image-only faces and occlusion-only cards validate, normalize and round-trip without altering old text cards', () => {
  const document = doc();
  assert.equal(document.workspace.cards[0].question, '');
  assert.equal(document.workspace.cards[0].answerImages[0].description, '');
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(document)), document);
  const workspace = fixture(); delete workspace.cards[0].questionImages; delete workspace.cards[0].answerImages;
  workspace.cards[0].occlusion = { mediaId: MEDIA, regions: [{ id: 'region-a', x: 0.2, y: 0.3, width: 0.2, height: 0.1 }], targetRegionId: 'region-a' };
  const result = validateWorkspace(workspace);
  assert.equal(result.cards[0].occlusion.hideOthers, false);
  assert.equal(result.cards[0].occlusion.regions[0].label, '');
  const textWorkspace = fixture(); const card = textWorkspace.cards[0]; delete card.questionImages; delete card.answerImages; card.question = 'Q'; card.answer = 'A';
  assert.deepEqual(validateWorkspace(textWorkspace).cards[0], card);
  assert.equal(validateWorkspace(textWorkspace).cards[0].occlusion, undefined);
});

test('invalid media metadata, dangling face references, malformed coordinates and empty faces fail closed', () => {
  const checks = [
    [(workspace) => { workspace.media[0].id = 'not-a-hash'; }, /media metadata/],
    [(workspace) => { workspace.media[0].mimeType = 'image/svg+xml'; }, /media metadata/],
    [(workspace) => { workspace.media[0].fileName = '../../evil.png'; }, /media metadata/],
    [(workspace) => { workspace.media[0].byteLength = 10 * 1024 * 1024 + 1; }, /media metadata/],
    [(workspace) => { workspace.media[0].width = 20_001; }, /media metadata/],
    [(workspace) => { workspace.media[0].height = 0; }, /media metadata/],
    [(workspace) => { workspace.media[0].width = 10_000; workspace.media[0].height = 10_000; }, /media metadata/],
    [(workspace) => { workspace.cards[0].questionImages[0].mediaId = OTHER_MEDIA; }, /missing course or lecture/],
    [(workspace) => { workspace.cards[0].questionImages = []; }, /Card question cannot be empty/],
    [(workspace) => { workspace.cards[0].answerImages = []; }, /Card answer cannot be empty/],
    [(workspace) => { workspace.cards[0].questionImages[0].description = 'x'.repeat(2001); }, /description/],
  ];
  for (const [change, expected] of checks) { const workspace = fixture(); change(workspace); assert.throws(() => validateWorkspace(workspace), expected); }
  const regionChecks = [
    [(region) => { region.x = -0.1; }, /Occlusion x/],
    [(region) => { region.width = 0; }, /Occlusion width/],
    [(region) => { region.x = 0.9; region.width = 0.2; }, /inside the image/],
    [(region) => { region.height = NaN; }, /invalid number/],
  ];
  for (const [change, expected] of regionChecks) {
    const workspace = fixture(); const region = { id: 'region-a', x: 0, y: 0, width: 0.2, height: 0.2, label: '' }; change(region);
    workspace.cards[0].occlusion = { mediaId: MEDIA, regions: [region], targetRegionId: 'region-a', hideOthers: true };
    assert.throws(() => validateWorkspace(workspace), expected);
  }
  const target = fixture(); target.cards[0].occlusion = { mediaId: MEDIA, regions: [{ id: 'region-a', x: 0, y: 0, width: 1, height: 1 }], targetRegionId: 'missing', hideOthers: true };
  assert.throws(() => validateWorkspace(target), /existing region/);
});

test('removing images or cards never implicitly deletes content-addressed shared metadata', () => {
  const base = doc();
  const noImages = edit(base, (workspace) => { workspace.cards[0].question = 'Q'; workspace.cards[0].answer = 'A'; delete workspace.cards[0].questionImages; delete workspace.cards[0].answerImages; });
  assert.equal(noImages.workspace.media.length, 1);
  assert.deepEqual(noImages.tombstones.media, []);
  const noCard = edit(base, (workspace) => { workspace.cards = []; });
  assert.equal(noCard.workspace.media.length, 1);
  assert.deepEqual(noCard.tombstones.media, []);
  const staleOriginalUi = structuredClone(base.workspace); staleOriginalUi.version = 1; delete staleOriginalUi.media;
  const saved = createWorkspaceDocument(staleOriginalUi, base, SECOND);
  assert.deepEqual(saved.workspace.media, base.workspace.media);
});

test('media deletion racing a new referenced card is visible and keeps unrelated lecture edits independent', () => {
  const baseline = doc();
  const local = edit(baseline, (workspace) => { workspace.media = []; workspace.cards = []; });
  const remote = edit(baseline, (workspace) => { workspace.cards.push({ ...workspace.cards[0], id: 'card-new' }); workspace.lectures[0].notes = 'Independent remote lecture edit'; }, THIRD);
  const merged = mergeWorkspaceDocuments(local, remote, baseline);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].id, `media:${MEDIA}`);
  const remove = resolveWorkspaceConflicts(merged.document, merged.conflicts, merged.conflicts[0].id, 'local', THIRD);
  assert.equal(remove.document.workspace.media.length, 0);
  assert.equal(remove.document.workspace.cards.length, 0);
  assert.equal(remove.document.workspace.lectures[0].notes, 'Independent remote lecture edit');
  assert.ok(remove.document.tombstones.cards.some((entry) => entry.id === 'card-new'));
  const repeated = mergeWorkspaceDocuments(remove.document, remote, remote);
  assert.equal(repeated.conflicts.length, 0);
  assert.equal(repeated.document.workspace.media.length, 0);
  const keep = resolveWorkspaceConflicts(merged.document, merged.conflicts, merged.conflicts[0].id, 'remote', THIRD);
  assert.equal(keep.document.workspace.media.length, 1);
  assert.equal(keep.document.workspace.cards.length, 2);
});

test('two-device distinct media additions survive repeated merge and metadata edits expose alternatives', () => {
  const base = doc();
  const local = edit(base, (workspace) => { workspace.media.push({ ...workspace.media[0], id: OTHER_MEDIA, fileName: `${OTHER_MEDIA}.png` }); });
  const merged = mergeWorkspaceDocuments(local, base, base);
  assert.equal(merged.document.workspace.media.length, 2);
  assert.deepEqual(mergeWorkspaceDocuments(merged.document, merged.document, merged.document).document, merged.document);
  const left = edit(base, (workspace) => { workspace.media[0].width = 801; });
  const right = edit(base, (workspace) => { workspace.media[0].width = 802; }, THIRD);
  const conflict = mergeWorkspaceDocuments(left, right, base);
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.conflicts[0].kind, 'media');
});
