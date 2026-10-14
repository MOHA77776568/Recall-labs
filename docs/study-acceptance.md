# متطلبات التنفيذ ووسائل التحقق

كل بيانات الاختبار مصطنعة؛ لم تُقرأ أو تُنسخ مساحة المستخدم الخاصة أو صوره أو رموزه. لا توجد بيانات شخصية في القوالب العامة. يجري تسليم العمل في فرع/PR للمراجعة دون دمج أو نشر إصدار تلقائي.

| المطلب | التنفيذ | التحقق |
| --- | --- | --- |
| مرور 60 دقيقة في ثلاث جلسات؛ مشاهدتان + ثلاث مراجعات جزئية | `lib/study.js`, `study-tracking.js` | اختبارات study + واجهة localhost فعلية |
| اتحاد أجزاء متداخلة للمشاهدة والتفريغ | union / status sweep | اختبارات 0–20 و10–30، حالات متساوية التاريخ |
| المكتوب 50% والمتحقق 25%؛ فجوات وهدف مختار ومقام مجهول | خطط ومقاطع فعالة ونطاق الاستكمال | study tests + تعديل تحقق وإعادة تحميل حقيقية |
| جلسة مشاهدة/تفريغ 45 دقيقة دون مضاعفة الوقت | studySessions متعددة الوسوم | statistics tests + واجهة ومخزن Electron |
| تحرير وحذف وتراجع وتاريخ سابق وخط أساس غير مؤرخ | واجهة Tracking، tombstones | tests study/schema + تحذير التراجع عن تعديل أحدث |
| Statistics ومصفوفة المحاضرات والتاريخ والتقويم والمرشحات | `study-statistics.js`, `lib/statistics.js` | 6 تبويبات فعلية + اختبارات نطاق وتوقيت Amman |
| أول مراجعة مؤجلة مؤهلة فقط؛ فشل ثم نجاحات اليوم نفسه | provenance قبل FSRS + delayedRecallObservations | tests review/statistics: حالة/تأخر/مصدر/يوم محلي |
| سياق قديم مجهول دون نسب مصطنعة | migrations، null samples، legacy classification | tests schema/statistics + مساحة فارغة فعلية |
| مفاهيم وفجوات وقائمة أفكار متوقعة وتقييم شرح/مثال/تطبيق | concepts/gaps/recallAttempts/assessments | اختبارات المراجع والحسابات + حفظ تقييم فكرة فعلي |
| محاولة الاسترجاع مستقلة عن تعديل المسودة | أول حفظ جديد فقط + محاولة ثابتة المعرف | اختبار original recall + reflection في الواجهة |
| ثقة اختيارية قبل الكشف ومقارنة نتيجة المحاولة نفسها | مراجعة + evidence preflight + pairs | review/statistics tests + واجهة ثقة/تقييم متطابق |
| مقارنة طرق صريحة ومختلطة ورصدية مع التأخر | relatedSessionIds + descriptive groups | statistics tests لحالات غياب الرابط وتعدد الطرق |
| مواعيد 7/30 الحالية وإشارات قابلة للتجاهل | schedule snapshots + insights/dismissals | statistics tests وروابط إجراء في الواجهة |
| ترحيل وفقدان صفر للمعرفات/الجدولة/التاريخ/الإعدادات | schema3/workspace2 + raw backups | schema tests + migration IndexedDB + Electron restart |
| تصدير/استيراد بلا ازدواج وتعارضات ظاهرة وحذف لا يعود | codec + three-way merge لكل السجلات | workspace/import/sync tests، parent/reference races |
| تحقق مدخلات ومراجع ومدد وأحجام وإصدارات مستقبلية | bounded validators | tests invalid ranges/imports/size/version guards |
| اللصق والرفع والسحب PNG/JPEG/WebP وصور بلا نص | `card-images.js`, content-addressed store | اختبار حقيقي Ctrl+V وupload/drop + ثلاث صيغ |
| صور الجواب غير مكشوفة قبل Reveal | mount guard + أصل الواجهة + FocusedReview | localhost + Electron native + packaged smoke |
| إخفاء نسبي: رسم/نقل/تغيير حجم/حذف/تكبير | OcclusionEditor + relative overlays | pointer/keyboard + محاذاة عرض 390 بكسل |
| بطاقات إخفاء مستقلة مع ملف مشترك وحفظ التقدم عند تعديلها | generation by stable region/card IDs | UI generation/review/regeneration + media/schema tests |
| مزامنة الصور الخاصة وعدم التكرار وإعادة المحاولة | image API transport + hash integrity | جهازا متصفح مصطنعان + stores mock + interruption |
| صورة مفقودة وحماية الملفات المشتركة | placeholder + no implicit file deletion | missing/partial tests + واجهة missing فعليًا |
| نسخة ZIP كاملة آمنة واستعادة الصورة والبيانات | stored ZIP + CRC/path/hash validation | ZIP roundtrip/tamper/truncation + IndexedDB restore |
| البطاقات القديمة والمعادلات وPDF والاعتمادات وFSRS | الأصل محفوظ + مصدر دمج مقفل + نفس المجدول | tests legacy/math/review + native PDF/security smoke |
| عمل محلي دون خدمات خارجية في Electron وlocalhost | ملفات محلية + مخازن محلية | browser no-external-requests + native restarts |
| تطبيق Windows قابل للتنزيل دون نشر إصدار | CI NSIS/ZIP artifact + silent-install smoke | مهمة windows-package في PR |

## أوامر التحقق

```text
npm test
npm run test:browser
npm run test:images-browser
npm run test:desktop
npm run pack -- --publish never
npm run dist:win -- --publish never
```

يمكن تعيين `RECALL_BROWSER_EXECUTABLE` لمسار Chromium محلي لاختبارات المتصفح. يحتاج اختبار Electron شاشة سطح مكتب. علم `RECALL_TEST_NO_SANDBOX=1` مخصص فقط لحاوية اختبار Linux المقيدة؛ إعدادات sandbox وcontextIsolation وnodeIntegration للإنتاج لم تُضعف. مهمة Windows تختبر الحماية المعتادة دون ذلك العلم.

فحص browser لا يثبت نجاح مثبت Windows. Windows CI يبني المثبت ثم يشغّله صامتًا في جهاز اختبار مؤقت ويختبر التطبيق المثبت والصورة/الجدولة/إعادة التشغيل. الحزمة الناتجة artifact للمراجعة، وليست إصدارًا منشورًا، وليست اختبارًا على جهاز المستخدم أو ضمانًا لتجاوز SmartScreen.

لا تتضمن الإضافة تشغيل فيديو مضمّنًا أو مراقبة متصفح أو OCR أو تصحيح AI، ولا مزامنة PDF ثنائية. هذه حدود الطلب؛ المشاهدة والتفريغ والتقييمات يدوية، والنتائج الرصدية لا تقيس الإتقان تلقائيًا.
