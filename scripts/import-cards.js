import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceDocument, parseWorkspaceDocument, serializeWorkspaceDocument } from '../lib/workspace.js';
import { createInitialSchedule } from '../renderer/site/fsrs-original.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const source = args.shift();
let courseTitle;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--course' && args[index + 1]) courseTitle = args[++index];
  else throw new Error('Usage: npm run cards:import -- cards.json --course "Course title"');
}
if (!source || !courseTitle?.trim()) throw new Error('Usage: npm run cards:import -- cards.json --course "Course title"');
const input = await readFile(path.resolve(source));
if (input.byteLength > 10_000_000) throw new Error('Card import exceeds 10 MB.');
const cards = JSON.parse(input.toString('utf8'));
if (!Array.isArray(cards) || !cards.length || cards.length > 3000) throw new Error('Input must be a JSON array of 1 to 3000 cards.');
const target = path.join(root, 'data', 'workspace.json');
const previous = parseWorkspaceDocument(await readFile(target, 'utf8'));
const workspace = structuredClone(previous.workspace);
const now = new Date();
let course = workspace.courses.find((entry) => entry.title === courseTitle.trim());
if (!course) {
  course = { id: randomUUID(), title: courseTitle.trim(), description: '', color: 'violet' };
  workspace.courses.push(course);
}
let imported = 0;
let duplicates = 0;
for (const card of cards) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('Each card must be an object.');
  if (Object.keys(card).some((key) => !['id', 'question', 'answer', 'tags', 'source'].includes(key))) throw new Error('Allowed card fields: id, question, answer, tags, source.');
  if (typeof card.question !== 'string' || typeof card.answer !== 'string') throw new Error('Each card needs a question and an answer.');
  const duplicate = workspace.cards.find((entry) => entry.courseId === course.id && entry.question === card.question && entry.answer === card.answer);
  if (duplicate) { duplicates += 1; continue; }
  const id = card.id || randomUUID();
  if (workspace.cards.some((entry) => entry.id === id) || previous.tombstones.cards.some((entry) => entry.id === id)) throw new Error('A card ID already exists or was deleted. Choose a new stable ID; imports never overwrite existing cards.');
  workspace.cards.push({ id, courseId: course.id, lectureId: '', question: card.question, answer: card.answer, tags: card.tags || [], source: card.source || '', schedule: createInitialSchedule(now), createdAt: now.toISOString() });
  imported += 1;
}
if (imported) {
  const document = createWorkspaceDocument(workspace, previous, now);
  const contents = serializeWorkspaceDocument(document);
  const backupDirectory = path.join(root, '.local', 'imports');
  await mkdir(backupDirectory, { recursive: true });
  await copyFile(target, path.join(backupDirectory, `workspace-${randomUUID()}.json`));
  const temporary = path.join(root, 'data', `.workspace-${randomUUID()}.tmp`);
  try { await writeFile(temporary, contents, { flag: 'wx' }); await rename(temporary, target); }
  finally { await import('node:fs/promises').then(({ unlink }) => unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; })); }
}
console.log(`Imported ${imported} cards; skipped ${duplicates} existing duplicates. Commit data/workspace.json to share them through sync.`);
