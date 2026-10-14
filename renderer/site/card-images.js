import { i as getReact } from './framework-D_rUT4EX.js';
import { createInitialSchedule } from './fsrs-original.js';
import { MAX_CARD_IMAGE_BYTES, analyzeCardImage } from '../../lib/card-media.js';

const React = getReact();
const h = React.createElement;
const { useState, useEffect, useRef, useId } = React;
const clone = (value) => structuredClone(value);
const freshId = () => crypto.randomUUID();
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EN = {
  title: 'Images and occlusion', intro: 'Make image cards or cover parts of an image. Several cards can share the same image file.',
  editor: 'Card images', question: 'Question images', answer: 'Answer images', side: 'Add to', upload: 'Choose images', paste: 'Paste with Ctrl+V or drop PNG, JPEG or WebP files here.',
  description: 'Image description', descriptionHelp: 'Describe what the image shows for accessibility and when its file is unavailable.', remove: 'Remove', replace: 'Replace image', up: 'Move earlier', down: 'Move later',
  save: 'Save card', saving: 'Saving…', cancel: 'Cancel', edit: 'Edit', new: 'New image card', library: 'Image card library', empty: 'No image cards recorded. Add one using your own local image.',
  questionText: 'Question text (optional with images)', answerText: 'Answer text (optional with images)', course: 'Course', lecture: 'Lecture (optional)', noLecture: 'No lecture', tags: 'Tags (comma separated)', source: 'Source (optional)',
  unsupported: 'Use PNG, JPEG or WebP images.', tooLarge: 'An image must be no larger than 10 MiB.', missing: 'Image file unavailable on this device. Add the same original image here to restore its content reference.',
  loading: 'Loading local image…', zoom: 'Enlarge image', close: 'Close enlarged image', image: 'Card image', cardSaved: 'Card saved locally.',
  occlusion: 'Image occlusion', chooseBase: 'Image to cover', noOcclusion: 'No image occlusion', baseHelp: 'Choose an existing question image. Draw relative rectangles or enter their position and size using the keyboard.',
  draw: 'Draw a region', addRegion: 'Add region using keyboard', region: 'Region', label: 'Region label', target: 'Target region', hideOthers: 'Hide the other regions too',
  x: 'Left (%)', y: 'Top (%)', width: 'Width (%)', height: 'Height (%)', deleteRegion: 'Delete selected region', questionPreview: 'Question preview', answerPreview: 'Answer preview',
  generate: 'Generate one card per region', generated: 'Occlusion cards saved locally.', generateHelp: 'One independent FSRS card is created per region, sharing the original image. Existing cards for the same regions keep their IDs and review schedules.',
  regionHelp: 'Draw on the image. Drag a rectangle to move it, or its lower-right handle to resize it. Numerical controls provide the same operations with a keyboard.',
  insufficient: 'Add an image and at least one region to generate occlusion cards.', pickRegion: 'Choose a region to edit.', invalidRect: 'Each region must have a positive size and stay inside the image.',
  contentRequired: 'The question and answer each need text, an image, or valid image occlusion.', courseRequired: 'Choose a course first.', noCourses: 'Add a course in your library before creating cards.',
  preserve: 'Editing a card preserves its review schedule.', privacy: 'Answer images are shown only after revealing the answer.', pending: 'Images added before saving stay local; remove an unused reference without deleting a shared image file.',
  uploadAgain: 'Restore local image files', generatedCount: 'cards saved', imageOnly: 'Image-only card', reveal: 'Reveal answer', hide: 'Hide answer', reviewCard: 'Review card',
};
const AR = {
  title: 'الصور وإخفاء أجزاء الصورة', intro: 'أنشئ بطاقات صور أو غطِّ أجزاء من صورة. يمكن لبطاقات متعددة مشاركة ملف الصورة نفسه.',
  editor: 'صور البطاقة', question: 'صور السؤال', answer: 'صور الإجابة', side: 'أضف إلى', upload: 'اختر الصور', paste: 'الصق بـ Ctrl+V أو اسحب ملفات PNG أو JPEG أو WebP إلى هنا.',
  description: 'وصف الصورة', descriptionHelp: 'صف محتوى الصورة لتسهيل الوصول وعند غياب الملف.', remove: 'إزالة', replace: 'استبدال الصورة', up: 'تقديم الصورة', down: 'تأخير الصورة',
  save: 'حفظ البطاقة', saving: 'جارٍ الحفظ…', cancel: 'إلغاء', edit: 'تعديل', new: 'بطاقة صورة جديدة', library: 'مكتبة بطاقات الصور', empty: 'لا توجد بطاقات صور مسجلة. أضف صورة محلية من جهازك.',
  questionText: 'نص السؤال، اختياري مع الصور', answerText: 'نص الإجابة، اختياري مع الصور', course: 'المقرر', lecture: 'المحاضرة، اختيارية', noLecture: 'بلا محاضرة', tags: 'الوسوم مفصولة بفاصلة', source: 'المصدر، اختياري',
  unsupported: 'استخدم صور PNG أو JPEG أو WebP.', tooLarge: 'يجب ألا يتجاوز حجم الصورة 10 ميبيبايت.', missing: 'ملف الصورة غير متاح على هذا الجهاز. أضف الصورة الأصلية نفسها لاستعادة المرجع.',
  loading: 'جارٍ تحميل الصورة المحلية…', zoom: 'تكبير الصورة', close: 'إغلاق الصورة المكبرة', image: 'صورة البطاقة', cardSaved: 'تم حفظ البطاقة محليًا.',
  occlusion: 'إخفاء أجزاء الصورة', chooseBase: 'الصورة التي تريد تغطيتها', noOcclusion: 'بلا إخفاء', baseHelp: 'اختر صورة موجودة في السؤال. ارسم مستطيلات نسبية أو أدخل موقعها وحجمها بلوحة المفاتيح.',
  draw: 'ارسم منطقة', addRegion: 'أضف منطقة بلوحة المفاتيح', region: 'المنطقة', label: 'تسمية المنطقة', target: 'المنطقة المستهدفة', hideOthers: 'أخفِ المناطق الأخرى أيضًا',
  x: 'المسافة من اليسار (%)', y: 'المسافة من الأعلى (%)', width: 'العرض (%)', height: 'الارتفاع (%)', deleteRegion: 'حذف المنطقة المحددة', questionPreview: 'معاينة السؤال', answerPreview: 'معاينة الإجابة',
  generate: 'أنشئ بطاقة لكل منطقة', generated: 'تم حفظ بطاقات إخفاء الصورة محليًا.', generateHelp: 'تُنشأ بطاقة FSRS مستقلة لكل منطقة، مع مشاركة الصورة الأصلية. تحتفظ البطاقات الموجودة بمعرّفاتها وجدول مراجعتها.',
  regionHelp: 'ارسم على الصورة. اسحب المستطيل لتحريكه أو المقبض السفلي الأيمن لتغيير حجمه. الحقول الرقمية تتيح ذلك بلوحة المفاتيح.',
  insufficient: 'أضف صورة ومنطقة واحدة على الأقل لإنشاء البطاقات.', pickRegion: 'اختر منطقة لتعديلها.', invalidRect: 'يجب أن تكون أبعاد كل منطقة موجبة وداخل الصورة.',
  contentRequired: 'يحتاج كل وجه نصًا أو صورة أو إخفاء صورة صالحًا.', courseRequired: 'اختر مقررًا أولًا.', noCourses: 'أضف مقررًا في المكتبة قبل إنشاء بطاقات.',
  preserve: 'يحافظ تعديل البطاقة على جدول مراجعتها.', privacy: 'تظهر صور الإجابة بعد كشف الإجابة فقط.', pending: 'تبقى الصور المضافة محلية قبل الحفظ؛ إزالة المرجع لا تحذف ملفًا تشترك فيه بطاقات أخرى.',
  uploadAgain: 'استعادة ملفات الصور المحلية', generatedCount: 'بطاقات محفوظة', imageOnly: 'بطاقة صورة فقط', reveal: 'كشف الإجابة', hide: 'إخفاء الإجابة', reviewCard: 'مراجعة البطاقة',
};
const words = (language) => language === 'ar' ? { ...EN, ...AR } : EN;
function Input({ value, onChange, ...props }) { return h('input', { ...props, value: value ?? '', onChange: (event) => onChange(event.target.value) }); }
function Select({ value, onChange, items, ...props }) { return h('select', { ...props, value, onChange: (event) => onChange(event.target.value) }, items.map(([key, label]) => h('option', { value: key, key }, label))); }
function Field({ label, hint, children, wide = false }) {
  const fieldId = useId();
  return h('div', { className: wide ? 'media-wide' : '' }, h('label', { htmlFor: fieldId }, label), React.cloneElement(children, { id: fieldId, 'aria-describedby': hint ? `${fieldId}-hint` : undefined }), hint && h('small', { id: `${fieldId}-hint`, className: 'media-muted' }, hint));
}
function Button({ children, primary, danger, ...props }) { return h('button', { type: 'button', className: primary ? 'primary' : danger ? 'danger' : '', ...props }, children); }
function Checkbox({ checked, onChange, label }) { return h('label', { className: 'media-checkbox' }, h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }), label); }
function bytesOf(result) {
  const value = result?.bytes ?? result?.data ?? result;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new Error('Local image bytes are unavailable.');
}

/** Create object URLs only for mounted local images and revoke them on replacement/unmount. */
function useLocalImage(mediaId) {
  const [state, setState] = useState({ url: '', loading: true, error: '', metadata: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const ready = event => { if (!event.detail || event.detail === mediaId) setRevision(value => value + 1); };
    window.addEventListener('recall:image-ready', ready);
    return () => window.removeEventListener('recall:image-ready', ready);
  }, [mediaId]);
  useEffect(() => {
    let active = true, url = '';
    setState({ url: '', loading: true, error: '', metadata: null });
    if (!mediaId) { setState({ url: '', loading: false, error: '', metadata: null }); return undefined; }
    Promise.resolve().then(() => window.recall.readCardImage(mediaId)).then((result) => {
      if (!active) return;
      const metadata = result.media ?? result.metadata ?? result;
      if (!IMAGE_TYPES.has(metadata.mimeType)) throw new Error('Unsupported local image type.');
      url = URL.createObjectURL(new Blob([bytesOf(result)], { type: metadata.mimeType }));
      setState({ url, loading: false, error: '', metadata });
    }).catch((error) => { if (active) setState({ url: '', loading: false, error: error.message || String(error), metadata: null }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [mediaId, revision]);
  return state;
}

function ImageStatus({ state, description, language }) {
  const t = words(language);
  return h('div', { className: state.loading ? 'media-muted' : 'media-missing', role: state.loading ? 'status' : undefined }, state.loading ? t.loading : t.missing, description && h('p', { dir: 'auto' }, description));
}
function ImageDialog({ open, onClose, children, language }) {
  const ref = useRef(null), t = words(language);
  useEffect(() => { if (open && ref.current && !ref.current.open) ref.current.showModal(); }, [open]);
  if (!open) return null;
  return h('dialog', { className: 'media-zoom-dialog', ref, onClose, 'aria-label': t.zoom }, h('div', { className: 'media-actions' }, h(Button, { autoFocus: true, onClick: () => ref.current.close() }, t.close)), children);
}
function LocalImage({ mediaId, description = '', language = 'en', thumbnail = false }) {
  const state = useLocalImage(mediaId), t = words(language), [zoom, setZoom] = useState(false);
  if (!state.url) return h(ImageStatus, { state, description, language });
  return h('figure', { className: thumbnail ? 'media-thumbnail' : 'media-image-figure' },
    h('img', { src: state.url, alt: description || t.image, loading: 'lazy' }),
    !thumbnail && h('div', { className: 'media-actions' }, h(Button, { onClick: () => setZoom(true) }, t.zoom)),
    description && !thumbnail && h('figcaption', { dir: 'auto' }, description),
    h(ImageDialog, { open: zoom, onClose: () => setZoom(false), language }, h('img', { src: state.url, alt: description || t.image })),
  );
}
function rectangleStyle(region) { return { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }; }

function OcclusionFace({ occlusion, side, language = 'en', preview = false }) {
  const state = useLocalImage(occlusion.mediaId), t = words(language), [zoom, setZoom] = useState(false);
  if (!state.url) return h(ImageStatus, { state, language });
  const target = occlusion.regions.find((region) => region.id === occlusion.targetRegionId);
  const board = () => h('div', { className: 'media-occlusion-board', style: { aspectRatio: `${state.metadata.width} / ${state.metadata.height}` }, role: 'img', 'aria-label': `${side === 'question' ? t.questionPreview : t.answerPreview}: ${side === 'answer' && target?.label ? target.label : `${t.region} ${occlusion.regions.findIndex((region) => region.id === target?.id) + 1}`}` },
    h('img', { src: state.url, alt: '', 'aria-hidden': true }),
    occlusion.regions.filter((region) => side === 'question' ? region.id === target?.id || occlusion.hideOthers : region.id === target?.id || occlusion.hideOthers).map((region) => {
      const isTarget = region.id === target?.id;
      if (side === 'answer' && !isTarget && !occlusion.hideOthers) return null;
      return h('span', { key: region.id, className: `media-mask${isTarget ? ' target' : ''}${side === 'answer' && isTarget ? ' answer-target' : ''}`, style: rectangleStyle(region) });
    }),
  );
  return h('div', { className: 'card-media-view' }, board(), side === 'answer' && target?.label && h('p', { className: 'media-muted', dir: 'auto' }, target.label),
    !preview && h(Button, { onClick: () => setZoom(true) }, t.zoom), h(ImageDialog, { open: zoom, onClose: () => setZoom(false), language }, board()));
}

/** Returning before child image mounting prevents answer image bytes/DOM before reveal. */
export function CardImages({ card, side = 'question', revealed = false, language = 'en' }) {
  if (side === 'answer' && !revealed) return null;
  const references = (side === 'question' ? card.questionImages : card.answerImages) || [];
  const visible = card.occlusion ? references.filter((reference) => reference.mediaId !== card.occlusion.mediaId) : references;
  if (!visible.length && !card.occlusion) return null;
  return h('div', { className: 'card-media-view', dir: 'auto' },
    visible.map((reference, index) => h(LocalImage, { key: `${reference.mediaId}-${index}`, ...reference, language })),
    card.occlusion && h(OcclusionFace, { occlusion: card.occlusion, side, language }),
  );
}

export function OcclusionEditor({ media, regions = [], targetRegionId = '', hideOthers = false, onChange, language = 'en' }) {
  const t = words(language), state = useLocalImage(media?.id), [selected, setSelected] = useState(targetRegionId || regions[0]?.id || ''), [drawMode, setDrawMode] = useState(false), [error, setError] = useState('');
  const boardRef = useRef(null), dragRef = useRef(null), latest = useRef({ regions, targetRegionId, hideOthers });
  latest.current = { regions, targetRegionId, hideOthers };
  const active = regions.find((region) => region.id === selected);
  useEffect(() => { if (!regions.some((region) => region.id === selected)) setSelected(targetRegionId || regions[0]?.id || ''); }, [regions, selected, targetRegionId]);
  function change(next) { onChange({ ...latest.current, ...next }); }
  function updateRegion(regionId, values) { change({ regions: latest.current.regions.map((region) => region.id === regionId ? { ...region, ...values } : region) }); }
  function addRegion() {
    if (regions.length >= 100) return;
    const region = { id: freshId(), x: 0.1, y: 0.1, width: 0.25, height: 0.15, label: '' };
    change({ regions: [...regions, region], targetRegionId: targetRegionId || region.id }); setSelected(region.id);
  }
  function point(event) {
    const bounds = boardRef.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  }
  function begin(event, type, region = null) {
    if (event.button !== 0 || !state.url) return;
    if (type === 'draw' && !drawMode) return;
    event.preventDefault(); event.stopPropagation();
    boardRef.current.setPointerCapture(event.pointerId);
    const start = point(event);
    if (type === 'draw') {
      if (regions.length >= 100) return;
      start.x = Math.min(start.x, 0.999); start.y = Math.min(start.y, 0.999);
      region = { id: freshId(), x: start.x, y: start.y, width: 0.001, height: 0.001, label: '' };
      change({ regions: [...regions, region], targetRegionId: targetRegionId || region.id });
    }
    setSelected(region.id); dragRef.current = { type, start, region: { ...region }, id: region.id };
  }
  function move(event) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault(); const current = point(event), dx = current.x - drag.start.x, dy = current.y - drag.start.y;
    if (drag.type === 'move') updateRegion(drag.id, { x: Math.max(0, Math.min(1 - drag.region.width, drag.region.x + dx)), y: Math.max(0, Math.min(1 - drag.region.height, drag.region.y + dy)) });
    else if (drag.type === 'resize') updateRegion(drag.id, { width: Math.max(0.001, Math.min(1 - drag.region.x, drag.region.width + dx)), height: Math.max(0.001, Math.min(1 - drag.region.y, drag.region.height + dy)) });
    else updateRegion(drag.id, { x: Math.min(drag.start.x, current.x), y: Math.min(drag.start.y, current.y), width: Math.max(0.001, Math.abs(dx)), height: Math.max(0.001, Math.abs(dy)) });
  }
  function finish() { dragRef.current = null; setDrawMode(false); }
  function numeric(key, value) {
    const next = Number(value) / 100;
    if (!active || value === '' || !Number.isFinite(next)) { setError(t.invalidRect); return; }
    const changed = { ...active, [key]: next };
    if (changed.x < 0 || changed.y < 0 || changed.width <= 0 || changed.height <= 0 || changed.x + changed.width > 1.000001 || changed.y + changed.height > 1.000001) { setError(t.invalidRect); return; }
    setError(''); updateRegion(active.id, { [key]: next });
  }
  function removeRegion() {
    const remaining = regions.filter((region) => region.id !== selected);
    change({ regions: remaining, targetRegionId: selected === targetRegionId ? remaining[0]?.id || '' : targetRegionId }); setSelected(remaining[0]?.id || '');
  }
  const preview = { mediaId: media?.id, regions, targetRegionId, hideOthers };
  return h('section', { className: 'media-occlusion', 'aria-label': t.occlusion }, h('h3', null, t.occlusion), h('p', { className: 'media-muted' }, t.regionHelp),
    h('div', { className: 'media-actions' }, h(Button, { onClick: () => setDrawMode(true), 'aria-pressed': drawMode, disabled: !state.url || regions.length >= 100 }, t.draw), h(Button, { onClick: addRegion, disabled: !state.url || regions.length >= 100 }, t.addRegion)),
    error && h('div', { className: 'media-error', role: 'alert' }, error),
    state.url ? h('div', { className: 'media-occlusion-board', ref: boardRef, style: { aspectRatio: `${state.metadata.width} / ${state.metadata.height}`, cursor: drawMode ? 'crosshair' : 'default' }, onPointerDown: (event) => begin(event, 'draw'), onPointerMove: move, onPointerUp: finish, onPointerCancel: finish },
      h('img', { src: state.url, alt: t.occlusion }), regions.map((region, index) => h('div', { key: region.id, className: `media-rectangle${region.id === selected ? ' selected' : ''}`, style: rectangleStyle(region), onPointerDown: (event) => begin(event, 'move', region), 'aria-hidden': true },
        h('span', { className: 'media-rectangle-label' }, region.label || `${t.region} ${index + 1}`), h('span', { className: 'media-resize-handle', onPointerDown: (event) => begin(event, 'resize', region) }))),
    ) : h(ImageStatus, { state, language }),
    h('div', { className: 'media-region-list', role: 'group', 'aria-label': t.region }, regions.map((region, index) => h(Button, { key: region.id, onClick: () => setSelected(region.id), 'aria-pressed': selected === region.id }, region.label || `${t.region} ${index + 1}`))),
    active ? h('div', null, h('div', { className: 'media-rectangle-controls' }, ['x', 'y', 'width', 'height'].map((key) => h(Field, { key, label: t[key] }, h(Input, { type: 'number', min: key === 'width' || key === 'height' ? 0.1 : 0, max: 100, step: 0.1, value: Math.round(active[key] * 1000) / 10, onChange: (value) => numeric(key, value) })))),
      h(Field, { label: t.label }, h(Input, { value: active.label, onChange: (value) => updateRegion(active.id, { label: value }), maxLength: 200, dir: 'auto' })),
      h('div', { className: 'media-actions' }, h(Button, { danger: true, onClick: removeRegion }, t.deleteRegion)),
    ) : h('p', { className: 'media-muted' }, t.pickRegion),
    regions.length > 0 && h('div', null, h(Field, { label: t.target }, h(Select, { value: targetRegionId, onChange: (value) => change({ targetRegionId: value }), items: regions.map((region, index) => [region.id, region.label || `${t.region} ${index + 1}`]) })),
      h(Checkbox, { label: t.hideOthers, checked: hideOthers, onChange: (value) => change({ hideOthers: value }) }),
      h('div', { className: 'media-preview-grid' }, h('div', null, h('h4', null, t.questionPreview), h(OcclusionFace, { occlusion: preview, side: 'question', language, preview: true })), h('div', null, h('h4', null, t.answerPreview), h(OcclusionFace, { occlusion: preview, side: 'answer', language, preview: true }))),
    ),
  );
}

export function CardImageEditor({ card, workspace, onChange, onMediaAdded, onBusyChange, language = 'en' }) {
  const t = words(language), [side, setSide] = useState('question'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dragging, setDragging] = useState(false), [added, setAdded] = useState([]);
  const latestCard = useRef(card), latestSide = useRef(side), callbacks = useRef({ onChange, onMediaAdded }), busyRef = useRef(false), replaceRef = useRef(null), replacement = useRef(null), inputRef = useRef(null);
  latestCard.current = card; latestSide.current = side; callbacks.current = { onChange, onMediaAdded, onBusyChange };
  useEffect(() => { callbacks.current.onBusyChange?.(busy); }, [busy]);
  useEffect(() => () => callbacks.current.onBusyChange?.(false), []);
  const allMedia = [...(workspace.media || []), ...added];
  function update(next) { latestCard.current = next; callbacks.current.onChange(next); }
  async function addFiles(files, replacing = null) {
    if (busyRef.current || !files.length) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      for (const file of Array.from(files)) {
        if (!IMAGE_TYPES.has(file.type)) throw new Error(t.unsupported);
        if (file.size > MAX_CARD_IMAGE_BYTES) throw new Error(t.tooLarge);
        const imageBytes = new Uint8Array(await file.arrayBuffer());
        await analyzeCardImage(imageBytes); // Bound decoded pixels before asking the image decoder to allocate.
        // Decode locally before accepting a face whose only content is an image.
        // Header/hash validation remains mandatory again in the storage adapter.
        const decoded = await createImageBitmap(file);
        decoded.close();
        const metadata = await window.recall.storeCardImage({ bytes: imageBytes, fileName: file.name });
        window.dispatchEvent(new CustomEvent('recall:image-ready', { detail: metadata.id }));
        setAdded((records) => [...records.filter((record) => record.id !== metadata.id), metadata]);
        await callbacks.current.onMediaAdded?.(metadata);
        const current = latestCard.current, field = replacing?.field || `${latestSide.current}Images`, references = [...(current[field] || [])];
        if (replacing) {
          const oldId = references[replacing.index]?.mediaId;
          references[replacing.index] = { mediaId: metadata.id, description: references[replacing.index]?.description || '' };
          update({ ...current, [field]: references, ...(current.occlusion?.mediaId === oldId ? { occlusion: { ...current.occlusion, mediaId: metadata.id } } : {}) });
        } else update({ ...current, [field]: [...references, { mediaId: metadata.id, description: '' }] });
      }
    } catch (failure) { setError(failure.message || String(failure)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  // Pasting an image while editing the surrounding card form uses the selected face.
  useEffect(() => {
    function paste(event) {
      if (event.defaultPrevented || busyRef.current) return;
      const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file' && IMAGE_TYPES.has(item.type)).map((item) => item.getAsFile()).filter(Boolean);
      if (files.length) { event.preventDefault(); addFiles(files); }
    }
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [language]);
  function referencesChange(field, action) {
    const current = latestCard.current;
    update({ ...current, [field]: action([...(current[field] || [])]) });
  }
  function selectBase(mediaId) {
    if (!mediaId) { const next = { ...card }; delete next.occlusion; update(next); return; }
    update({ ...card, occlusion: card.occlusion?.mediaId === mediaId ? card.occlusion : { mediaId, regions: [], targetRegionId: '', hideOthers: false } });
  }
  const occlusionMedia = card.occlusion && allMedia.find((record) => record.id === card.occlusion.mediaId);
  const baseIds = [...new Set([...(card.questionImages || []).map((reference) => reference.mediaId), ...(card.occlusion ? [card.occlusion.mediaId] : [])])];
  return h('section', { className: 'card-media-editor', dir: language === 'ar' ? 'rtl' : 'ltr', 'aria-label': t.editor }, h('h3', null, t.editor), h('p', { className: 'media-muted' }, `${t.privacy} ${t.pending}`),
    error && h('div', { className: 'media-error', role: 'alert' }, error),
    h('div', { className: `media-drop${dragging ? ' dragging' : ''}`, onDragOver: (event) => { event.preventDefault(); setDragging(true); }, onDragLeave: () => setDragging(false), onDrop: (event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); } },
      h(Field, { label: t.side }, h(Select, { value: side, onChange: setSide, items: [['question', t.question], ['answer', t.answer]], disabled: busy })),
      h('p', { className: 'media-muted' }, t.paste), h('div', { className: 'media-actions' }, h(Button, { onClick: () => inputRef.current.click(), disabled: busy }, busy ? t.saving : t.upload),
        h('input', { ref: inputRef, hidden: true, type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, onChange: (event) => { addFiles(event.target.files); event.target.value = ''; } })),
    ),
    h('input', { ref: replaceRef, hidden: true, type: 'file', accept: 'image/png,image/jpeg,image/webp', onChange: (event) => { if (event.target.files.length) addFiles([event.target.files[0]], replacement.current); event.target.value = ''; replacement.current = null; } }),
    ['question', 'answer'].map((face) => {
      const field = `${face}Images`, references = card[field] || [];
      return references.length > 0 && h('section', { key: face, 'aria-label': t[face] }, h('h4', null, t[face]), h('ol', { className: 'media-image-list' }, references.map((reference, index) => h('li', { key: `${reference.mediaId}-${index}` },
        h(LocalImage, { ...reference, language, thumbnail: true }), h(Field, { label: `${t.description} ${index + 1}`, hint: t.descriptionHelp }, h(Input, { value: reference.description, onChange: (value) => referencesChange(field, (list) => list.map((entry, at) => at === index ? { ...entry, description: value } : entry)), maxLength: 1000, dir: 'auto' })),
        h('div', { className: 'media-actions' },
          h(Button, { onClick: () => referencesChange(field, (list) => { [list[index - 1], list[index]] = [list[index], list[index - 1]]; return list; }), disabled: index === 0 || busy, 'aria-label': `${t.up} ${index + 1}` }, t.up),
          h(Button, { onClick: () => referencesChange(field, (list) => { [list[index], list[index + 1]] = [list[index + 1], list[index]]; return list; }), disabled: index === references.length - 1 || busy, 'aria-label': `${t.down} ${index + 1}` }, t.down),
          h(Button, { onClick: () => { replacement.current = { field, index }; replaceRef.current.click(); }, disabled: busy, 'aria-label': `${t.replace} ${index + 1}` }, t.replace),
          h(Button, { danger: true, onClick: () => referencesChange(field, (list) => list.filter((_, at) => at !== index)), disabled: busy, 'aria-label': `${t.remove} ${index + 1}` }, t.remove),
        ),
      ))));
    }),
    baseIds.length > 0 && h(Field, { label: t.chooseBase, hint: t.baseHelp }, h(Select, { value: card.occlusion?.mediaId || '', onChange: selectBase, items: [['', t.noOcclusion], ...baseIds.map((mediaId, index) => [mediaId, (card.questionImages || []).find((reference) => reference.mediaId === mediaId)?.description || `${t.image} ${index + 1}`])], disabled: busy })),
    card.occlusion && h(OcclusionEditor, { media: occlusionMedia || { id: card.occlusion.mediaId }, ...card.occlusion, onChange: (values) => update({ ...latestCard.current, occlusion: { ...latestCard.current.occlusion, ...values } }), language }),
  );
}

function newCard(courseId = '') {
  const now = new Date();
  return { id: freshId(), courseId, lectureId: '', question: '', answer: '', tags: [], source: '', schedule: createInitialSchedule(now), createdAt: now.toISOString(), questionImages: [], answerImages: [] };
}
function validateFaces(card, t) {
  const occlusion = card.occlusion && card.occlusion.regions.length > 0 && card.occlusion.regions.some((region) => region.id === card.occlusion.targetRegionId);
  if (!card.courseId) throw new Error(t.courseRequired);
  if ((!card.question.trim() && !(card.questionImages || []).length && !occlusion) || (!card.answer.trim() && !(card.answerImages || []).length && !occlusion)) throw new Error(t.contentRequired);
  if (card.occlusion && !occlusion) throw new Error(t.insufficient);
}

/** A readable route for creating/editing image cards, leaving the original card flows intact. */
export function CardMediaWorkspace({ workspace, onSave, onNavigate, language = 'en' }) {
  const t = words(language), [draft, setDraft] = useState(null), [pendingMedia, setPendingMedia] = useState([]), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [revealed, setRevealed] = useState(false), [tagsInput, setTagsInput] = useState('');
  const latestWorkspace = useRef(workspace); latestWorkspace.current = workspace;
  const [imageBusy, setImageBusy] = useState(false);
  const imageCards = (workspace.cards || []).filter((card) => card.occlusion || card.questionImages?.length || card.answerImages?.length);
  const addMedia = (metadata) => setPendingMedia((records) => [...records.filter((record) => record.id !== metadata.id), metadata]);
  function begin(card = null) { setDraft(clone(card || newCard(workspace.courses?.[0]?.id || ''))); setTagsInput(card?.tags?.join(', ') || ''); setPendingMedia([]); setError(''); setRevealed(false); }
  function field(key, value) { setDraft((card) => ({ ...card, [key]: value })); }
  async function save(generate = false) {
    if (busy || imageBusy) return;
    setBusy(true); setError('');
    try {
      validateFaces(draft, t);
      const next = clone(latestWorkspace.current);
      const media = new Map((next.media || []).map((record) => [record.id, record]));
      for (const record of pendingMedia) media.set(record.id, record);
      next.media = [...media.values()];
      let savedCards = [clone(draft)];
      if (generate) {
        if (!draft.occlusion?.regions?.length) throw new Error(t.insufficient);
        savedCards = draft.occlusion.regions.map((region) => {
          const existing = next.cards.find((card) => card.occlusion?.mediaId === draft.occlusion.mediaId && card.occlusion.targetRegionId === region.id);
          const ownDraft = draft.occlusion.targetRegionId === region.id ? next.cards.find((card) => card.id === draft.id) : null;
          const previous = existing || ownDraft;
          return { ...clone(previous || {}), ...clone(draft), id: previous?.id || (region.id === draft.occlusion.targetRegionId ? draft.id : freshId()),
            schedule: previous ? clone(previous.schedule) : createInitialSchedule(new Date()), createdAt: previous?.createdAt || new Date().toISOString(),
            occlusion: { ...clone(draft.occlusion), targetRegionId: region.id } };
        });
      }
      const updates = new Map(savedCards.map((card) => [card.id, card]));
      next.cards = next.cards.map((card) => updates.get(card.id) || card);
      for (const card of savedCards) if (!next.cards.some((entry) => entry.id === card.id)) next.cards.push(card);
      await onSave(next);
      setNotice(generate ? `${t.generated} ${savedCards.length} ${t.generatedCount}.` : t.cardSaved); setDraft(null); setPendingMedia([]);
    } catch (failure) { setError(failure.message || String(failure)); }
    finally { setBusy(false); }
  }
  return h('main', { className: 'card-media-workspace', dir: language === 'ar' ? 'rtl' : 'ltr' }, h('h1', null, t.title), h('p', { className: 'media-muted' }, t.intro),
    error && h('div', { className: 'media-error', role: 'alert' }, error), notice && h('div', { className: 'media-notice', role: 'status' }, notice),
    !workspace.courses?.length ? h('p', { className: 'media-empty' }, t.noCourses) : h('div', { className: 'media-actions' }, h(Button, { primary: true, onClick: () => begin(), disabled: busy }, t.new)),
    draft && h('section', { className: 'media-card', 'aria-label': t.editor }, h('h2', null, nextCardExists(workspace, draft.id) ? t.edit : t.new), h('p', { className: 'media-muted' }, t.preserve),
      h('div', { className: 'media-fields' },
        h(Field, { label: t.course }, h(Select, { value: draft.courseId, onChange: (value) => { field('courseId', value); field('lectureId', ''); }, items: workspace.courses.map((course) => [course.id, course.title]), disabled: busy })),
        h(Field, { label: t.lecture }, h(Select, { value: draft.lectureId, onChange: (value) => field('lectureId', value), items: [['', t.noLecture], ...(workspace.lectures || []).filter((lecture) => lecture.courseId === draft.courseId).map((lecture) => [lecture.id, lecture.title])], disabled: busy })),
        h(Field, { label: t.questionText, wide: true }, h('textarea', { value: draft.question, onChange: (event) => field('question', event.target.value), maxLength: 4000, dir: 'auto', disabled: busy })),
        h(Field, { label: t.answerText, wide: true }, h('textarea', { value: draft.answer, onChange: (event) => field('answer', event.target.value), maxLength: 12000, dir: 'auto', disabled: busy })),
        h(Field, { label: t.tags }, h(Input, { value: tagsInput, onChange: (value) => { setTagsInput(value); field('tags', value.split(/[,،]/).map((tag) => tag.trim()).filter(Boolean)); }, dir: 'auto', disabled: busy })),
        h(Field, { label: t.source }, h(Input, { value: draft.source, onChange: (value) => field('source', value), maxLength: 200, dir: 'auto', disabled: busy })),
      ),
      h(CardImageEditor, { card: draft, workspace: { ...workspace, media: [...(workspace.media || []), ...pendingMedia] }, onChange: setDraft, onMediaAdded: addMedia, onBusyChange: setImageBusy, language }),
      draft.occlusion?.regions?.length > 0 && h('p', { className: 'media-muted' }, t.generateHelp),
      h('div', { className: 'media-actions' }, h(Button, { primary: true, onClick: () => save(false), disabled: busy || imageBusy }, busy ? t.saving : t.save), draft.occlusion?.regions?.length > 0 && h(Button, { onClick: () => save(true), disabled: busy || imageBusy }, t.generate), h(Button, { onClick: () => setDraft(null), disabled: busy || imageBusy }, t.cancel)),
      h('div', { className: 'media-preview-card' }, h('h3', null, t.questionPreview), h('p', { dir: 'auto' }, draft.question), h(CardImages, { card: draft, side: 'question', language }),
        h(Button, { onClick: () => setRevealed(!revealed) }, revealed ? t.hide : t.reveal), revealed && h('div', null, h('h3', null, t.answerPreview), h('p', { dir: 'auto' }, draft.answer), h(CardImages, { card: draft, side: 'answer', revealed: true, language }))),
    ),
    h('section', { className: 'media-card', 'aria-label': t.library }, h('h2', null, t.library), imageCards.length ? h('ul', { className: 'media-library' }, imageCards.map((card) => h('li', { key: card.id },
      h('div', { className: 'media-content' }, h('strong', { dir: 'auto' }, card.question || card.occlusion?.regions.find((region) => region.id === card.occlusion.targetRegionId)?.label || t.imageOnly),
        h('p', { className: 'media-muted', dir: 'auto' }, `${workspace.courses.find((course) => course.id === card.courseId)?.title || ''}${card.occlusion ? ` · ${t.occlusion}` : ''} · ${(card.questionImages || []).length + (card.answerImages || []).length} ${t.image}`)),
      h('div', { className: 'media-actions' }, h(Button, { onClick: () => begin(card), disabled: busy }, t.edit), onNavigate && h(Button, { onClick: () => onNavigate('review', { cardId: card.id }) }, t.reviewCard)),
    ))) : h('p', { className: 'media-empty' }, t.empty)),
  );
}
function nextCardExists(workspace, cardId) { return workspace.cards.some((card) => card.id === cardId); }
