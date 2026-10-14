# إضافة بيانات بواسطة مساعد أو محرّر

إذا استخدمت حزمة المراجعة قبل دمج التغيير، اطلب من الموديل قراءة تعليمات الكود من فرع `codex/study-progress-statistics`؛ وجهة بياناتك الخاصة تبقى فرعها ومسارها الفعليين كما في إعدادات التطبيق.

المسار الافتراضي للبيانات المشتركة هو `data/workspace.json`. يستطيع مساعد أو نموذج آخر إضافة بطاقات إلى هذا الملف في GitHub، ثم تستقبلها الواجهة المحلية عند الضغط على المزامنة.

## التنسيق المستخدم

يحفظ المصدر الجديد غلافًا بإصدار `schemaVersion: 3` حول `workspace.version: 2`. تقبل دوال القراءة الملفات القديمة `schemaVersion: 2 / workspace.version: 1` عبر ترحيل صريح؛ لا تخفّض تنسيق ملف موجود ولا تسقط السجلات الإضافية.

| الحقل | محتواه |
| --- | --- |
| `workspace` | `version: 2` والمصفوفات الأصلية وسجلات الدراسة والمفاهيم والفجوات والتقييمات و`media`؛ التفاصيل في [نموذج البيانات](study-model.md) |
| `versions` | كائن لكل مصفوفة، يربط معرّف كل عنصر حي بتاريخ تعديله UTC |
| `tombstones` | مصفوفة لكل نوع، تحتوي `{id, updatedAt}` للعناصر المحذوفة |

المحتوى الشخصي يُعدّل في **المستودع الخاص** الذي عيّنته داخل التطبيق، مثل `MOHA77776568/Recall-labs-data`؛ كود الأدوات وتعليمات التنسيق موجودان في مستودع التطبيق العام. عند تشغيل `cards:import` في نسخة مؤقتة من الكود، ضع آخر ملف بيانات من الخاص أولًا، ثم ارفع الناتج إلى الخاص فقط. لكل صورة SHA-256 وملف مستقل بجانب مجلد JSON تحت `media/`؛ ارفع ملفات الصور قبل مراجعها في JSON، وحافظ على metadata وquestionImages/answerImages/occlusion. لا تضف Base64 للصور إلى workspace.json. المصدر في `lib/card-media.js` يحدد النوع والبصمة، و`lib/workspace.js` يتحقق من المراجع.

تعتمد الواجهة الأصلية حقول `question` و`answer` للبطاقة، مع `courseId` و`lectureId` و`tags` و`source` و`createdAt` و`schedule`. جدولة `schedule` تحتفظ بحالة FSRS الأصلية. لا تستخدم تنسيق `front/back/deck` الخاص بنموذج البطاقات المنفصل، ولا ملف `data/flashcards.json`، لإضافة بيانات إلى الواجهة الأصلية.

اقرأ آخر نسخة من الملف قبل التعديل. حافظ على معرّفات العناصر وروابط البطاقات بالمجموعات والمحاضرات وسجلات المراجعة والجدولة. لا تستبدل ملف مساحة العمل بقائمة بطاقات، ولا تصفر تقدم المراجعة عند إضافة محتوى.

## إضافة بطاقة بأداة محلية

الطريقة المباشرة للمساعدات الأخرى: اكتب مصفوفة JSON في ملف، مثل `cards.json`، تحتوي كل بطاقة على `question` و`answer`، ويمكن إضافة `tags` و`source` و`id`. ثم شغّل:

```powershell
npm run cards:import -- cards.json --course "اسم المقرر"
```

تنشئ الأداة المقرر إذا لم يكن موجودًا، وتحافظ على البطاقات السابقة وجدولتها وسجل المراجعة، وتتجاوز التكرارات المطابقة. تحفظ نسخة محلية قبل الكتابة داخل `.local/imports/`. ارفع تغيير `data/workspace.json` إلى GitHub، ثم اضغط المزامنة في التطبيق. لا تستخدم معرف بطاقة موجودة لاستبدالها بواسطة الاستيراد.

استخدم دوال `lib/workspace.js` لتوليد بيانات النسخ والحذف بدل كتابتها يدويًا. يضيف المثال التالي بطاقة إلى أول مجموعة موجودة، ويترك باقي البيانات كما هي. بدّل السؤال والإجابة بمحتواك؛ إذا كانت مساحة العمل فارغة، أنشئ مجموعة من الواجهة أولًا.

```js
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseWorkspaceDocument, createWorkspaceDocument,
  serializeWorkspaceDocument } from './lib/workspace.js';
import { createInitialSchedule } from './renderer/site/fsrs-original.js';

const file = 'data/workspace.json';
const previous = parseWorkspaceDocument(readFileSync(file, 'utf8'));
const workspace = structuredClone(previous.workspace);
const course = workspace.courses[0];
if (!course) throw new Error('Create a course before adding cards.');
const now = new Date();
workspace.cards.push({
  id: randomUUID(), courseId: course.id, lectureId: '',
  question: 'سؤال المراجعة', answer: 'الإجابة', tags: [], source: '',
  createdAt: now.toISOString(), schedule: createInitialSchedule(now)
});
const updated = createWorkspaceDocument(workspace, previous, now);
writeFileSync(file, serializeWorkspaceDocument(updated));
```

هذا مثال توضيحي، ولم نضف بطاقته إلى مكتبتك. عند تعديل بطاقة موجودة، غيّر النص فقط وأبقِ `id` و`schedule` كما هما، ثم مرّر مساحة العمل والغلاف السابق إلى `createWorkspaceDocument`. حذف عنصر من مساحة العمل بهذه الدالة يولّد علامة حذف في الغلاف؛ لا تحذف علامات الحذف يدويًا. إذا كان للعنصر علاقات، احذف أو حدّث العناصر التابعة بما يحافظ على الروابط الصحيحة، أو استخدم الواجهة للحذف.

للتحقق من ملف عدّلته، شغّل من جذر المشروع:

```powershell
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { parseWorkspaceDocument } from './lib/workspace.js'; parseWorkspaceDocument(readFileSync('data/workspace.json', 'utf8')); console.log('Valid');"
```

يُطبق التحقق حدًا قدره 10,000,000 بايت لملف المزامنة JSON، وحدودًا للمجموعات والمحاضرات والبطاقات وسجلات المراجعة. تحفظ المرفقات محليًا ولا تُضمَّن في ملف JSON. إذا كبر الملف أو ظهرت رسالة تنسيق غير صالح، راجع حدود `lib/workspace.js`؛ لا تُلغِ التحقق أو ترفع مستندًا لا يقبله التطبيق.

ملف التصدير من الواجهة الأصلية يحتوي غلاف نسخة احتياطية يختلف عن ملف GitHub المشترك. استورده من **Data & settings** في التطبيق؛ لا ترفع ملف التصدير مكان ملف المزامنة مباشرةً. إذا تغير ملف GitHub أثناء تعديلك، أعد قراءة التغييرات ودمجها قبل الرفع؛ لا تستخدم رفعًا قسريًا فوق تعديل آخر. احتفظ بتصدير احتياطي وشغّل اختبارات المستودع بعد تعديل أدوات البيانات.
