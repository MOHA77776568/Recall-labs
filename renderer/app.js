import './browser-adapter.js';

const api = window.recall;
const $ = (id) => document.getElementById(id);
const form = $('settings-form');
const numberFormat = new Intl.NumberFormat('ar');
const collections = { courses: 'المقررات', lectures: 'المحاضرات', cards: 'البطاقات', recalls: 'جلسات الاسترجاع', reviews: 'المراجعات' };
let currentState = null;
let busy = false;
let toastTimer;
let confirmAction = null;

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(value ?? '');
  return element;
}

function toast(message, isError = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', isError);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, isError ? 11000 : 5000);
}

function errorMessage(error) {
  const raw = typeof error?.message === 'string' ? error.message : String(error || 'حدث خطأ غير متوقع.');
  // Errors from platform fetches can contain credentials in a URL. Never show these.
  return raw.replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '[رمز محجوب]').replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[محجوب]@').slice(0, 1800);
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll('button').forEach((button) => {
    if (!button.closest('#confirm-dialog')) button.disabled = value;
  });
  $('connection-status').classList.toggle('working', value);
  $('connection-status-label').textContent = value ? 'جارٍ التنفيذ…' : 'وضع محلي';
  form.setAttribute('aria-busy', String(value));
  if (!value) renderUpdate(currentState?.update);
}

async function perform(action, successMessage) {
  if (busy) return null;
  setBusy(true);
  try {
    const result = await action();
    if (result?.workspaceDocument || result?.document) setState(result);
    if (successMessage && result !== null) toast(successMessage);
    return result;
  } catch (error) {
    toast(errorMessage(error), true);
    return null;
  } finally {
    setBusy(false);
  }
}

function workspaceData(state) {
  return state?.workspaceDocument?.workspace || { courses: [], lectures: [], cards: [], recalls: [], reviews: [] };
}

function setState(state, populateForm = false) {
  currentState = state;
  const workspace = workspaceData(state);
  const count = (name) => Array.isArray(workspace[name]) ? workspace[name].filter((item) => !item.deletedAt).length : 0;
  $('stat-cards').textContent = numberFormat.format(count('cards'));
  $('stat-lectures').textContent = numberFormat.format(count('lectures'));
  $('stat-courses').textContent = numberFormat.format(count('courses'));
  const hasData = Object.keys(collections).some((name) => count(name) > 0);
  $('workspace-detail').textContent = hasData
    ? `${numberFormat.format(count('recalls'))} جلسات استرجاع · ${numberFormat.format(count('reviews'))} مراجعات مسجّلة · محفوظة محليًا`
    : 'مساحة جديدة. افتح Recall Lab لإنشاء بياناتك أو استيراد نسخة احتياطية.';
  $('workspace-schema').textContent = 'مساحة العمل المحلية';
  const settings = state.settings || {};
  if (populateForm) {
    const github = settings.github || {};
    $('github-owner').value = github.owner || 'MOHA77776568';
    $('github-repo').value = github.repo || 'Recall-labs';
    $('github-branch').value = github.branch || 'main';
    $('github-path').value = github.path || 'data/workspace.json';
    $('allow-public-sync').checked = settings.allowPublicSync === true;
  }
  $('token-badge').textContent = settings.tokenConfigured ? 'رمز الوصول جاهز' : 'دون رمز وصول';
  $('token-badge').classList.toggle('missing', !settings.tokenConfigured);
  $('clear-token').hidden = !settings.tokenConfigured;
  const browser = state.runtime === 'browser';
  $('runtime-label').textContent = browser ? 'نسخة localhost' : 'تطبيق سطح المكتب';
  $('runtime-detail').textContent = browser ? 'البيانات في هذا المتصفح' : 'البيانات في مجلد التطبيق';
  $('mode-title').textContent = browser ? 'نسخة المتصفح المحلية.' : 'نسخة سطح المكتب المحلية.';
  $('mode-description').textContent = browser
    ? 'تُحفظ البيانات في هذا المتصفح. رمز GitHub يبقى في ذاكرة الجلسة ويُحذف عند إعادة تحميلها. تصدير نسخة احتياطية يساعدك على نقل البيانات إلى تطبيق سطح المكتب.'
    : 'تُحفظ البيانات على هذا الجهاز. الواجهة وملفات تشغيلها محلية. يُستخدم الإنترنت للمزامنة والتحديث عندما تطلب ذلك.';
  $('sync-note').textContent = browser
    ? 'رمز الوصول يبقى لهذه الجلسة فقط. لا توجد مزامنة تلقائية.'
    : settings.secureStorageAvailable === false
      ? 'التخزين الآمن للرمز غير متاح حاليًا. راجع رسالة التطبيق عند حفظه.'
      : 'لا تُجرى اتصالات أو مزامنة تلقائية. الرمز محفوظ محليًا خارج بياناتك.';
  renderConflicts(state.workspaceConflicts || []);
  renderUpdate(state.update);
  if (state.syncStatus?.message) showSyncResult(state.syncStatus.message);
}

function settingsInput() {
  const settings = {
    github: {
      owner: $('github-owner').value.trim(),
      repo: $('github-repo').value.trim(),
      branch: $('github-branch').value.trim(),
      path: $('github-path').value.trim(),
    },
    allowPublicSync: $('allow-public-sync').checked,
  };
  const token = $('github-token').value.trim();
  if (token) settings.token = token;
  return settings;
}

async function saveCurrentSettings() {
  const state = await api.saveSettings(settingsInput());
  $('github-token').value = '';
  setState(state, true);
  return state;
}

function showSyncResult(message) {
  $('sync-result').textContent = message;
  $('sync-result').hidden = false;
}

async function syncWorkspace() {
  if (!form.reportValidity()) {
    $('github-settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  await perform(async () => {
    await saveCurrentSettings();
    const result = await api.syncWorkspace();
    const conflicts = result.workspaceConflicts || [];
    showSyncResult(conflicts.length
      ? `تمت قراءة النسختين. هناك ${numberFormat.format(conflicts.length)} تعارضات تحتاج إلى اختيارك قبل اكتمال المزامنة.`
      : result.syncStatus?.message || 'اكتملت المزامنة مع GitHub. بيانات هذا الجهاز ونسخة المستودع متوافقتان.');
    return result;
  });
}

function recordPreview(record, kind) {
  if (!record || record.deletedAt) return 'هذا العنصر محذوف في هذه النسخة.';
  if (kind === 'cards') return [record.front || record.question || record.title, record.back || record.answer, record.schedule?.due ? `موعد المراجعة: ${record.schedule.due}\nعدد المراجعات: ${record.schedule.reps ?? 0}` : ''].filter(Boolean).join('\n\n');
  if (kind === 'reviews') return [record.cardId ? `البطاقة: ${record.cardId}` : '', record.rating !== undefined ? `التقييم: ${record.rating}` : '', record.at || record.reviewedAt || record.createdAt || record.updatedAt || ''].filter(Boolean).join('\n');
  if (kind === 'recalls') return [record.title, record.body || record.text || record.content || record.response || record.recallText, record.gaps ? `الفجوات:\n${record.gaps}` : ''].filter(Boolean).join('\n\n') || `جلسة الاسترجاع: ${record.id || ''}`;
  if (kind === 'lectures') return [record.title || record.name, record.description, record.notes, record.sourceText || record.content, Array.isArray(record.pages) ? record.pages.map((page) => `${page.label || ''}\n${page.text || ''}`).join('\n\n') : ''].filter(Boolean).join('\n\n');
  return [record.title || record.name, record.description].filter(Boolean).join('\n\n') || `العنصر: ${record.id || ''}`;
}

function renderConflicts(conflicts) {
  const panel = $('conflicts-panel');
  panel.replaceChildren();
  panel.hidden = conflicts.length === 0;
  panel.className = 'conflicts-panel';
  if (!conflicts.length) return;
  panel.append(textElement('h2', '', 'اختر النسخة التي تريد الاحتفاظ بها.'));
  panel.append(textElement('p', '', 'تغيّر بعض المحتوى على الجهاز وفي GitHub. راجع النسختين قبل الاختيار. احتفظ بنسخة احتياطية إذا كنت تحتاج إلى دمجهما يدويًا.'));
  conflicts.forEach((conflict) => {
    const kind = conflict.entityType || conflict.kind;
    const item = textElement('article', 'conflict-item', '');
    const record = conflict.local || conflict.remote || {};
    const title = record.title || record.name || record.front || record.question || conflict.entityId;
    item.append(textElement('h3', '', `${collections[kind] || 'عنصر'}: ${String(title || '').slice(0, 150)}`));
    if (conflict.related) {
      const affected = Object.entries(conflict.related).filter(([, ids]) => ids.length).map(([name, ids]) => `${numberFormat.format(ids.length)} ${collections[name] || name}`).join(' · ');
      item.append(textElement('p', 'conflict-reference-note', `هذا اختيار لمجموعة مترابطة: ${affected}. تُحسم التعارضات التابعة معه؛ راجع البيانات المرتبطة قبل اختيار النسخة.`));
    }
    const options = textElement('div', 'conflict-options', '');
    ['local', 'remote'].forEach((choice) => {
      const option = textElement('div', 'conflict-option', '');
      option.append(textElement('h4', '', choice === 'local' ? 'نسخة هذا الجهاز' : 'نسخة GitHub'));
      option.append(textElement('p', '', recordPreview(conflict[choice], kind).slice(0, 7000)));
      if (conflict[choice]) {
        const details = textElement('details', 'conflict-record', '');
        details.append(textElement('summary', '', 'عرض السجل كاملًا'));
        const record = textElement('pre', '', JSON.stringify(conflict[choice], null, 2));
        record.dir = 'auto';
        details.append(record);
        option.append(details);
      }
      const button = textElement('button', 'button secondary small', choice === 'local' ? 'الاحتفاظ بنسخة الجهاز' : 'الاحتفاظ بنسخة GitHub');
      button.type = 'button';
      button.disabled = busy;
      button.addEventListener('click', () => perform(async () => {
        const result = await api.resolveWorkspaceConflict({ id: conflict.id, choice });
        if (!(result.workspaceConflicts || []).length) showSyncResult('تم حل التعارضات محليًا. اضغط «مزامنة الآن» لحفظ اختياراتك في GitHub.');
        return result;
      }, 'تم حفظ اختيارك على هذا الجهاز.'));
      option.append(button);
      options.append(option);
    });
    item.append(options);
    panel.append(item);
  });
}

function renderUpdate(update = {}) {
  const browser = currentState?.runtime === 'browser';
  const status = update?.status || 'idle';
  const version = update?.version ? ` (${update.version})` : '';
  const messages = {
    idle: 'يتم فحص التحديثات عند طلبك فقط.',
    checking: 'جارٍ البحث عن إصدار أحدث…',
    available: `يتوفر إصدار أحدث${version}. يمكنك تنزيله عندما يكون الاتصال متاحًا.`,
    current: 'أنت تستخدم الإصدار الأحدث المتاح.',
    downloading: `جارٍ تنزيل التحديث${Number.isFinite(update?.percent) ? ` — ${numberFormat.format(Math.round(update.percent))}٪` : ''}…`,
    downloaded: 'التحديث جاهز. احفظ عملك قبل التثبيت وإعادة التشغيل.',
    installing: 'جارٍ تثبيت التحديث وإعادة تشغيل التطبيق…',
    error: update?.message ? errorMessage({ message: update.message }) : 'تعذّر فحص التحديث. تأكد من الاتصال وحاول لاحقًا.',
  };
  $('update-status').textContent = browser
    ? 'تحديثات التطبيق من الداخل متاحة في نسخة Electron على Windows. لتحديث نسخة localhost، نزّل آخر إصدار من المشروع مع الاحتفاظ بنسخة احتياطية لبياناتك.'
    : messages[status] || update?.message || messages.idle;
  $('check-update').disabled = busy || browser || ['checking', 'downloading', 'installing'].includes(status);
  $('download-update').hidden = browser || status !== 'available';
  $('download-update').disabled = busy;
  $('install-update').hidden = browser || status !== 'downloaded';
  $('install-update').disabled = busy;
}

function showConfirmation(title, description, actionLabel, action) {
  $('confirm-title').textContent = title;
  $('confirm-description').textContent = description;
  $('confirm-action').textContent = actionLabel;
  confirmAction = action;
  $('confirm-dialog').showModal();
}

function closeConfirmation() {
  $('confirm-dialog').close();
  confirmAction = null;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  perform(saveCurrentSettings, 'تم حفظ الإعدادات على هذا الجهاز.');
});
['github-owner', 'github-repo'].forEach((id) => {
  $(id).addEventListener('input', () => {
    const github = currentState?.settings?.github;
    if (github && ($('github-owner').value.trim() !== github.owner || $('github-repo').value.trim() !== github.repo)) $('allow-public-sync').checked = false;
  });
});
$('sync-now').addEventListener('click', syncWorkspace);
$('quick-sync').addEventListener('click', syncWorkspace);
$('clear-token').addEventListener('click', () => showConfirmation('حذف رمز الوصول؟', 'سيُحذف رمز GitHub من هذا الجهاز. بياناتك المحلية تبقى محفوظة، ويمكنك إضافة رمز جديد لاحقًا.', 'حذف الرمز', () => perform(async () => {
  const settings = settingsInput();
  settings.token = '';
  const state = await api.saveSettings(settings);
  $('github-token').value = '';
  setState(state, true);
  return state;
}, 'تم حذف رمز الوصول من هذا الجهاز.')));
$('export-workspace').addEventListener('click', () => perform(async () => {
  const result = await api.exportWorkspace();
  if (result) toast('تم تصدير النسخة الاحتياطية. احتفظ بها في مكان آمن.');
  return result;
}));
$('check-update').addEventListener('click', () => perform(async () => {
  const result = await api.checkForUpdates();
  currentState.update = result;
  renderUpdate(result);
  return result;
}));
$('download-update').addEventListener('click', () => perform(async () => {
  const result = await api.downloadUpdate();
  currentState.update = result;
  renderUpdate(result);
  return result;
}));
$('install-update').addEventListener('click', () => showConfirmation('تثبيت التحديث الآن؟', 'سيُغلق التطبيق ويُعاد تشغيله لتثبيت الإصدار الجديد. احفظ أي تغييرات غير محفوظة في Recall Lab قبل المتابعة.', 'تثبيت وإعادة التشغيل', () => perform(() => api.installUpdate())));
$('close-confirm').addEventListener('click', closeConfirmation);
$('cancel-confirm').addEventListener('click', closeConfirmation);
$('confirm-action').addEventListener('click', () => {
  const action = confirmAction;
  closeConfirmation();
  action?.();
});
$('confirm-dialog').addEventListener('cancel', () => { confirmAction = null; });

async function start() {
  try {
    if (!api) throw new Error('تعذّر الاتصال بخدمة البيانات المحلية. أعد تشغيل التطبيق.');
    setState(await api.getState(), true);
    if (typeof api.onUpdateStatus === 'function') {
      const unsubscribe = api.onUpdateStatus((update) => {
        if (currentState) currentState.update = update;
        renderUpdate(update);
      });
      window.addEventListener('pagehide', () => { if (typeof unsubscribe === 'function') unsubscribe(); }, { once: true });
    }
  } catch (error) {
    toast(errorMessage(error), true);
    $('workspace-detail').textContent = 'تعذّر تحميل البيانات المحلية. أعد تشغيل التطبيق قبل إجراء المزامنة.';
    setBusy(true);
    $('connection-status-label').textContent = 'تعذّر التحميل';
  }
}

start();
