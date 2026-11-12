// =====================================================================
// СКАЗКИ ШЕХЕРЕЗАДЫ — MINI APP
// Все данные идут через наш сервер (API_BASE) с подписью Telegram initData.
// Напрямую в Supabase мини-апп больше не ходит: так никто не сможет
// выдать себе подписку или прочитать чужие данные.
// =====================================================================
const API_BASE = 'https://scheherezade.uz';
// Бот поддержки (тот же, что в кнопках бота и на сайте)
const SUPPORT_BOT_URL = 'https://t.me/ScheherezadeSupport_bot';
// Фраза запуска навыка — одна на всё приложение (Алиса понимает только русский)
const ALICE_SKILL_PHRASE = '«Алиса, запусти навык Сказки Шехерезады»';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const initData = tg ? (tg.initData || '') : '';
if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) { /* старые клиенты Telegram */ }
}
// Словари (на случай, если файл языка не загрузился, — пустые объекты)
const i18n_app = {
    ru: window.langRU || {},
    uz: window.langUZ || {},
    en: window.langEN || {}
};
let currentLang = detectInitialLang();
let allChildren = [];
let userStories = [];
let userExists = false;
let profileData = null;          // ответ /api/app/me
let maxChildren = 5;
let clockOffsetMs = 0;           // поправка на неверные часы телефона (по времени сервера)
let configUrls = { privacy_url: '', offer_url: '', about_url: '', promo_image_url: '', promo_link_url: '' };
let banners = [];
let promoTimerInterval = null;
let awaitingPayment = false;
let paymentSnapshot = null;
let currentStory = null;
// =====================================================================
// ВСПОМОГАТЕЛЬНОЕ
// =====================================================================
function detectInitialLang() {
    const code = String(tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.language_code || '' : '').toLowerCase();
    if (code.startsWith('uz')) return 'uz';
    if (code.startsWith('en')) return 'en';
    return 'ru';
}
// Перевод с подстановкой: tr('tariff_extra_voiceover', { price: '14 500 сум' })
function tr(key, vars) {
    const dict = i18n_app[currentLang] || {};
    let text = dict[key] !== undefined ? dict[key] : (i18n_app.ru[key] !== undefined ? i18n_app.ru[key] : '');
    if (vars) {
        Object.keys(vars).forEach(name => { text = text.split('{' + name + '}').join(vars[name]); });
    }
    return text;
}
function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}
function safeUrl(value) {
    const url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
}
function el(id) { return document.getElementById(id); }
function setText(id, text) { const node = el(id); if (node) node.innerText = text; }
// Иконки интерфейса — свои, в стиле «Шахерезады»: SVG-спрайт встроен в index.html (символы #i-…), без запросов к сети.
// Размер — 1em (растёт вместе с шрифтом контейнера), цвет — цвет текста (currentColor).
function icon(name, cls) {
    return `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}" xlink:href="#i-${name}"></use></svg>`;
}
// Иконка + подпись (подпись экранируется)
function iconText(name, text, cls) { return icon(name, cls) + `<span>${escapeHtml(text)}</span>`; }
function setIconText(id, name, text) { const node = el(id); if (node) node.innerHTML = iconText(name, text); }
function setPlaceholder(id, text) { const node = el(id); if (node) node.placeholder = text; }
function show(id, display) { const node = el(id); if (node) node.style.display = display || 'block'; }
function hide(id) { const node = el(id); if (node) node.style.display = 'none'; }

function localeTag() {
    return currentLang === 'en' ? 'en-GB' : (currentLang === 'uz' ? 'uz-UZ' : 'ru-RU');
}
function formatPrice(tiyin) {
    const sum = Math.round(Number(tiyin) / 100);
    const number = new Intl.NumberFormat(currentLang === 'en' ? 'en-GB' : 'ru-RU').format(sum);
    return `${number} ${tr('currency')}`;
}
function formatDate(iso, options) {
    try {
        const text = new Date(iso).toLocaleDateString(localeTag(), options || { day: 'numeric', month: 'long', year: 'numeric' });
        // В русском формате дата заканчивается на «г.», а в наших фразах после даты уже стоит точка
        return options ? text : text.replace(/\s?г\.$/, '');
    } catch (e) {
        return new Date(iso).toLocaleDateString('ru-RU', options);
    }
}
function serverNow() { return Date.now() + clockOffsetMs; }
function showAlert(message) {
    try {
        if (tg && tg.showAlert) { tg.showAlert(message); return; }
    } catch (e) { /* например, уже открыт другой попап */ }
    alert(message);
}
function showConfirm(message) {
    return new Promise(resolve => {
        try {
            if (tg && tg.showConfirm) { tg.showConfirm(message, ok => resolve(!!ok)); return; }
        } catch (e) { /* fallback ниже */ }
        resolve(window.confirm(message));
    });
}
function openLink(url) {
    const link = safeUrl(url);
    if (!link) return;
    if (tg && tg.openLink) tg.openLink(link);
    else window.open(link, '_blank');
}
// Ссылка из настроек на языке человека. Документы (политика, оферта) загружаются в админке по языкам:
// сервер отдаёт offer_url_ru / offer_url_uz / offer_url_en (и privacy_url_…); нет нужного языка — русский, затем старый ключ без языка.
function configLinkUrl(key) {
    const lang = ['ru', 'uz', 'en'].includes(currentLang) ? currentLang : 'ru';
    return configUrls[key + '_' + lang] || configUrls[key + '_ru'] || configUrls[key] || '';
}
// Ссылки из настроек (политика, оферта, баннер) — через data-атрибуты, без JS в разметке
document.addEventListener('click', (event) => {
    const configLink = event.target.closest('[data-config-link]');
    if (configLink) {
        event.preventDefault();
        openLink(configLinkUrl(configLink.getAttribute('data-config-link')));
        return;
    }
    const directLink = event.target.closest('[data-open-link]');
    if (directLink) {
        event.preventDefault();
        openLink(directLink.getAttribute('data-open-link'));
    }
});
// =====================================================================
// ЗАПРОСЫ К СЕРВЕРУ
// =====================================================================
class ApiError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.data = null;
    }
}
const ERROR_TEXT_KEYS = {
    NO_INIT_DATA: 'error_session',
    ACCOUNT_BLOCKED: 'error_blocked',
    CHILDREN_LIMIT: 'alert_children_limit',
    TARIFF_CHILDREN_LIMIT: 'error_tariff_children',
    CHILD_NAME_REQUIRED: 'alert_enter_child_name',
    PARENT_NAME_REQUIRED: 'alert_enter_parent_name',
    PARENT_ROLE_AGE: 'alert_parent_role_age',
    TERMS_REQUIRED: 'alert_accept_terms',
    LOCKED: 'paywall_text',
    ALICE_CODE_NOT_FOUND: 'alice_code_not_found',
    NO_VOICEOVERS: 'audio_no_voiceovers',
    AUDIO_BUSY: 'audio_busy',
    AUDIO_FAILED: 'audio_error',
    AUDIO_QUEUED: 'audio_queued_desc',
    ACCOUNT_DELETED: 'account_deleted_error',
    RESTORE_TOO_LATE: 'account_restore_too_late',
    FIRST_STORY_DONE: 'first_story_err_done',
    NO_CHILDREN: 'first_story_need_child',
    NO_STORY: 'first_story_err_none',
    TOO_MANY: 'report_too_many',
    TOO_LONG: 'report_too_long',
    EMPTY_FRAGMENT: 'report_hint',
    NETWORK: 'error_network'
};
async function api(path, options) {
    const method = (options && options.method) || 'GET';
    const body = options ? options.body : undefined;
    const headers = { 'X-Telegram-Init-Data': initData };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    async function tryFetch(base) {
        const url = (base ? String(base).replace(/\/$/, '') : '') + path;
        try {
            const res = await fetch(url, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                credentials: 'same-origin'
            });
            return res;
        } catch (e) {
            return { ok: false, status: 0, _fetchError: e };
        }
    }

    let response = await tryFetch(API_BASE);

    if ((!response.ok && (response.status === 0 || response.status === 404 || response.status === 410)) && !path.startsWith('http')) {
        console.warn('API_BASE failed or returned 404; retrying relative path:', API_BASE + path);
        response = await tryFetch('');
    }

    let data = null;
    try { data = await response.json(); } catch (e) { /* не JSON */ }

    if (!response.ok || (data && data.success === false)) {
        const code = (data && data.code) || ('HTTP_' + (response.status || 0));
        const key = ERROR_TEXT_KEYS[code];
        const message = key ? tr(key, { max: maxChildren }) : tr('error_generic');
        const apiError = new ApiError(message, response.status, code);
        apiError.data = data || null;
        throw apiError;
    }

    return data || {};
}
// ====================================================================
// ЭКРАНЫ: загрузка / «откройте в Telegram» / ошибка / анкета / приложение
// =====================================================================
function showScreen(name) {
    ['appLoader', 'openInTelegram', 'appError', 'accountDeleted', 'parentModal', 'mainAppContent'].forEach(hide);
    if (name === 'loading') show('appLoader', 'flex');
    if (name === 'openInTelegram') show('openInTelegram', 'flex');
    if (name === 'error') show('appError', 'flex');
    if (name === 'deleted') show('accountDeleted', 'flex');
    if (name === 'parent') show('parentModal');
    if (name === 'main') show('mainAppContent');
}
function showLoadError(err) {
    // Заблокированному админом: вместо «Повторить» — кнопка «Служба поддержки» (бот поддержки)
    const blocked = !!(err && err.code === 'ACCOUNT_BLOCKED');
    let text = tr('error_load');
    if (blocked) text = tr('error_blocked');
    else if (err && err.code === 'NO_INIT_DATA') text = tr('error_session');
    setText('appErrorText', text);
    setIconText('appErrorSupport', 'support', tr('btn_support'));
    if (blocked) { hide('appErrorRetry'); show('appErrorSupport', 'inline-block'); }
    else { show('appErrorRetry', 'inline-block'); hide('appErrorSupport'); }
    showScreen('error');
}
async function boot() {
    applyTheme();
    applyLanguage();
    window.toggleParentBtn();

    if (!initData) {
        showScreen('openInTelegram');
        return;
    }
    showScreen('loading');
    loadAppConfig();

    try {
        await loadProfile();
    } catch (err) {
        console.error('Ошибка загрузки профиля:', err);
        showLoadError(err);
        return;
    }
    if (isAccountDeleted()) return; // экран «Аккаунт удалён» уже показан (loadProfile)
    // Если бот передал демо-сказку, после настройки профиля автоматически привязываем её
    // к совпадающему профилю ребёнка и запускаем штатную озвучку.
    const claimedDemo = await claimPendingSiteDemo();
    if (claimedDemo && claimedDemo.storyId) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('story_id', claimedDemo.storyId);
        window.history.replaceState({}, '', nextUrl.toString());
    }
    const params = new URLSearchParams(window.location.search);
    const storyId = params.get('story_id');
    if (storyId && profileData && profileData.user && profileData.user.profile_complete) {
        switchAppTab('stories');
        // Кнопка «Поделиться» под сказкой в боте открывает читалку сразу с окном «Поделиться» (share=1).
        // Параметр убираем, чтобы при перезагрузке окно не открывалось снова.
        const wantShare = params.get('share') === '1';
        if (wantShare) {
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('share');
            window.history.replaceState({}, '', cleanUrl.toString());
        }
        openReader(storyId, { share: wantShare });
    } else {
        openChildrenIfEmpty();
    }
    subscribeReturnFromPayment();
}
async function retryBoot() {
    await boot();
}
// =====================================================================
// ТЕМА
// =====================================================================
function applyTheme() {
    if (localStorage.getItem('samba_theme') === 'light') document.body.classList.add('light-theme');
    updateThemeButton();
}

function updateThemeButton() {
    const light = document.body.classList.contains('light-theme');
    setIconText('themeToggleBtn', light ? 'sun' : 'moon', light ? tr('theme_day') : tr('theme_night'));
}

function toggleMiniAppTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    try { localStorage.setItem('samba_theme', isLight ? 'light' : 'dark'); } catch (e) { /* приватный режим */ }
    updateThemeButton();
}
// =====================================================================
// ПРОФИЛЬ
// =====================================================================
async function loadProfile() {
    const data = await api('/api/app/me');
    profileData = data;
    userExists = !!data.user;
    allChildren = data.children || [];
    maxChildren = (data.limits && data.limits.max_children) || 5;
    if (data.server_time) clockOffsetMs = new Date(data.server_time).getTime() - Date.now();

    if (data.user && data.user.bot_language) currentLang = data.user.bot_language;
    const langSelector = el('appLangSelector');
    if (langSelector) langSelector.value = currentLang;

    applyLanguage();

    // Аккаунт удалён по просьбе пользователя: только срок и кнопка «Восстановить аккаунт»
    if (isAccountDeleted()) {
        renderAccountDeleted();
        return;
    }

    if (!data.user || !data.user.profile_complete) {
        prefillParentForm(data.user);
        showScreen('parent');
    } else {
        showScreen('main');
    }

    updateStatusUI();
    updateAliceUI(!!(data.user && data.user.alice_connected));
    renderChildren();
    renderParentCard();
    renderTariffCard();
    renderFirstStory();
    maybeShowTermsModal();
}
// Привязка сказки, созданной на сайте. Токен не нужен: сервер связывает pending-сессию
// с Telegram ID из проверенного initData и разрешает только принадлежащие пользователю профили.
let siteDemoClaimChecked = false;
async function claimPendingSiteDemo() {
    if (siteDemoClaimChecked || !initData || !profileData || !profileData.user ||
        !profileData.user.profile_complete || !Array.isArray(allChildren)) return null;
    siteDemoClaimChecked = true;
    let hadMismatch = false;
    let mismatchSessionId = null;
    const childrenToTry = allChildren.length ? allChildren : [null];
    for (const child of childrenToTry) {
        try {
            const result = await api('/api/site-story-demo/claim', {
                method: 'POST',
                body: child ? { childId: child.id } : {}
            });
            if (result && result.success && result.story_id) {
                const statusKey = result.voiceover_status === 'no_balance'
                    ? 'site_demo_no_voiceovers'
                    : result.voiceover_status === 'retry_needed'
                        ? 'site_demo_audio_retry'
                        : 'site_demo_audio_queued';
                showAlert(result.voiceover_status === 'not_requested' ? tr('site_demo_saved') : tr(statusKey));
                return { storyId: result.story_id, status: result.voiceover_status };
            }
        } catch (err) {
            if (err && err.code === 'DEMO_NOT_FOUND') return null;
            if (err && err.code === 'CHILDREN_LIMIT') {
                const max = Number(err.data && err.data.max_children) || maxChildren;
                const current = Number(err.data && err.data.current_children);
                const currentText = Number.isFinite(current) ? current : allChildren.length;
                showAlert(tr('site_demo_children_limit', { max, count: currentText }));
                return null;
            }
            if (err && err.code === 'CHILD_MISMATCH') {
                hadMismatch = true;
                mismatchSessionId = (err.data && err.data.demo_session_id) || mismatchSessionId;
                continue;
            }
            if (err && err.code === 'ALREADY_CLAIMED') return null;
            console.error('Не удалось привязать сказку с сайта:', err);
            return null;
        }
    }
    if (hadMismatch) {
        // Не показываем модальное предупреждение при каждом открытии Mini App для одной и той же старой демо-сказки.
        const mismatchKey = mismatchSessionId ? 'site_demo_mismatch_notified_' + mismatchSessionId : null;
        let alreadyNotified = false;
        if (mismatchKey) {
            try { alreadyNotified = localStorage.getItem(mismatchKey) === '1'; } catch (_) {}
        }
        if (!alreadyNotified) {
            if (mismatchKey) {
                try { localStorage.setItem(mismatchKey, '1'); } catch (_) {}
            }
            showAlert(tr('site_demo_profile_mismatch'));
        }
    }
    return null;
}

// Если Mini App остался открытым, а пользователь переключился в бот и вернулся, проверяем ожидающую сказку ещё раз.
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !initData || !profileData ||
        !profileData.user || !profileData.user.profile_complete || !allChildren.length) return;
    siteDemoClaimChecked = false;
    const claimedDemo = await claimPendingSiteDemo();
    if (claimedDemo && claimedDemo.storyId) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('story_id', claimedDemo.storyId);
        window.history.replaceState({}, '', nextUrl.toString());
        switchAppTab('stories');
        await openReader(claimedDemo.storyId);
    }
});

// =====================================================================
// АККАУНТ УДАЛЁН (кнопка «Удалить мои данные аккаунта» в боте)
// 10 дней аккаунт можно восстановить — здесь или в боте; потом данные удаляются навсегда.
// =====================================================================
function isAccountDeleted() {
    return !!(profileData && profileData.account && profileData.account.deleted);
}

function formatRestoreDate(value) {
    const locale = currentLang === 'uz' ? 'uz-Latn-UZ' : currentLang === 'en' ? 'en-GB' : 'ru-RU';
    try {
        return new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'Asia/Tashkent' });
    } catch (e) {
        return String(value || '').slice(0, 10);
    }
}

function renderAccountDeleted() {
    setText('accountDeletedTitle', tr('account_deleted_title'));
    setText('accountDeletedText', tr('account_deleted_text', { date: formatRestoreDate(profileData.account.purge_after) }));
    const button = el('accountRestoreBtn');
    if (button) { button.innerHTML = iconText('restore', tr('account_restore_btn')); button.disabled = false; }
    showScreen('deleted');
}

async function restoreAccount() {
    const button = el('accountRestoreBtn');
    if (button) { button.innerText = tr('account_restoring'); button.disabled = true; }
    try {
        await api('/api/app/restore-account', { method: 'POST', body: {} });
        await boot();
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
        if (button) { button.innerHTML = iconText('restore', tr('account_restore_btn')); button.disabled = false; }
    }
}

// =====================================================================
// ОБНОВЛЁННЫЕ ДОКУМЕНТЫ: мягкая просьба согласиться заново
// Сервер (GET /api/app/me → terms) присылает reconsent: true, когда оферту или политику обновили, а человек согласился с прежней
// редакцией, и новые PDF уже загружены. Окно ничего не блокирует: сказки, подписка и оплата работают как раньше.
// «Напомнить позже» прячет окно на 3 дня (в браузере; нет хранилища — до следующего открытия).
// =====================================================================
const TERMS_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
let termsPromptShown = false;
function termsSnoozed() {
    try {
        const until = Number(localStorage.getItem('samba_terms_snooze_until') || 0);
        return until > Date.now();
    } catch (e) { return false; /* приватный режим: просто покажем */ }
}
function maybeShowTermsModal() {
    const terms = profileData && profileData.terms;
    if (!terms || !terms.reconsent || termsPromptShown || termsSnoozed()) return;
    const changed = Array.isArray(terms.changed) ? terms.changed : [];
    const both = changed.includes('offer') && changed.includes('privacy');
    const docsKey = both ? 'termsDocsBoth' : (changed.includes('privacy') ? 'termsDocsPrivacy' : 'termsDocsOffer');
    setText('termsModalTitle', tr('termsModalTitle'));
    setText('termsModalText', tr('termsModalText', { docs: tr(docsKey) }));
    setText('termsAcceptBtn', tr('termsAcceptBtn'));
    setText('termsLaterBtn', tr('termsLaterBtn'));
    // Ссылки на новые документы на языке человека (обработчик data-config-link выше берёт их из настроек)
    const links = [];
    if (changed.includes('offer')) links.push(`<a href="#" data-config-link="offer_url" style="color:#c4b5fd;">${escapeHtml(tr('footer_offer'))}</a>`);
    if (changed.includes('privacy')) links.push(`<a href="#" data-config-link="privacy_url" style="color:#c4b5fd;">${escapeHtml(tr('footer_privacy'))}</a>`);
    const box = el('termsModalLinks');
    if (box) box.innerHTML = links.map(link => `<div>${link}</div>`).join('');
    termsPromptShown = true;
    show('termsModal', 'flex');
}
function snoozeTerms() {
    try { localStorage.setItem('samba_terms_snooze_until', String(Date.now() + TERMS_SNOOZE_MS)); } catch (e) { /* без хранилища — до следующего открытия */ }
    hide('termsModal');
}
async function acceptTerms() {
    const button = el('termsAcceptBtn');
    if (button) button.disabled = true;
    try {
        await api('/api/app/accept-terms', { method: 'POST', body: { accepted: true } });
        if (profileData) profileData.terms = { reconsent: false, changed: [] };
        try { localStorage.removeItem('samba_terms_snooze_until'); } catch (e) { /* не страшно */ }
        hide('termsModal');
    } catch (err) {
        console.error(err);
        showAlert(tr('termsError'));
    } finally {
        if (button) button.disabled = false;
    }
}
window.acceptTerms = acceptTerms;
window.snoozeTerms = snoozeTerms;

// =====================================================================
// АНКЕТА РОДИТЕЛЯ
// =====================================================================
function prefillParentForm(user) {
    if (!user) return;
    const nameInput = el('parentNameInput');
    if (nameInput && !nameInput.value) nameInput.value = user.parent_name || '';
    const ageInput = el('parentAgeInput');
    if (ageInput && !ageInput.value && user.parent_age) ageInput.value = user.parent_age;
}

function checkCustomRole(value) {
    const input = el('customParentRole');
    if (input) input.style.display = value === 'Другое' ? 'block' : 'none';
}

window.toggleParentBtn = function () {
    const privacy = el('cbPrivacy');
    const offer = el('cbOffer');
    const button = el('saveParentBtn');
    if (!privacy || !offer || !button) return;
    const enabled = privacy.checked && offer.checked;
    button.disabled = !enabled;
    button.style.background = enabled ? '#9333ea' : '#4b5563';
    button.style.cursor = enabled ? 'pointer' : 'not-allowed';
};
async function saveParentInfo() {
    const parentName = (el('parentNameInput') ? el('parentNameInput').value : '').trim();
    let role = el('parentRoleSelect') ? el('parentRoleSelect').value : '';
    if (role === 'Другое') role = (el('customParentRole') ? el('customParentRole').value : '').trim();
    const age = parseInt(el('parentAgeInput') ? el('parentAgeInput').value : '', 10);
    const agreedPrivacy = !!(el('cbPrivacy') && el('cbPrivacy').checked);
    const agreedOffer = !!(el('cbOffer') && el('cbOffer').checked);

    if (!parentName) return showAlert(tr('alert_enter_parent_name'));
    if (!role || isNaN(age) || age < 10 || age > 100) return showAlert(tr('alert_parent_role_age'));
    if (!agreedPrivacy || !agreedOffer) return showAlert(tr('alert_accept_terms'));

    const button = el('saveParentBtn');
    if (button) { button.innerText = tr('saving'); button.disabled = true; }

    try {
        await api('/api/app/parent', {
            method: 'POST',
            body: { parentName, role, age, agreedPrivacy, agreedOffer, language: currentLang }
        });
        await loadProfile();
        openChildrenIfEmpty();
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
    } finally {
        if (button) { button.innerText = tr('saveParentBtn'); button.disabled = false; }
        window.toggleParentBtn();
    }
}
// =====================================================================
// ЯЗЫК И ТЕКСТЫ ИНТЕРФЕЙСА
// =====================================================================
async function changeAppLanguage(newLang) {
    currentLang = newLang;
    applyLanguage();
    renderBanners();
    renderStoriesList();

    if (!userExists) return;
    try {
        await api('/api/app/language', { method: 'POST', body: { language: newLang } });
    } catch (err) {
        console.error('Не удалось сохранить язык:', err);
        showAlert(err.message || tr('error_generic'));
    }
}
function applyLanguage() {
    document.documentElement.lang = currentLang;

    setText('lblTabHome', tr('tab_home'));
    setText('lblTabKids', tr('tab_kids'));
    setText('lblTabStories', tr('tab_stories'));
    setText('lblTabProfile', tr('tab_profile'));
    setText('pageTitleHome', tr('page_title_home'));
    setText('pageTitleKids', tr('page_title_kids'));
    setText('pageTitleStories', tr('page_title_stories'));
    setText('pageTitleProfile', tr('page_title_profile'));

    setText('appLoaderText', tr('loading'));
    setText('openInTelegramTitle', tr('open_in_telegram_title'));
    setText('openInTelegramText', tr('open_in_telegram_text'));
    setText('appErrorRetry', tr('btn_retry'));

    setIconText('lblParentCard', 'profile', tr('lbl_parent_card'));
    setIconText('lblTariffCard', 'crown', tr('lbl_tariff_card'));
    setIconText('lblSettingsCard', 'settings', tr('lbl_settings_card'));
    setText('kidsFormBackBtn', tr('reader_back'));
    setText('kidsFormCancelBtn', tr('btn_cancel'));

    setText('lblAppLang', tr('lbl_app_lang'));
    setText('lblAppTheme', tr('lbl_app_theme'));
    updateThemeButton();
    setText('textAliceBtn', tr('textAliceBtn'));
    setText('aliceModalTitle', tr('aliceModalTitle'));
    setText('aliceModalSub', tr('aliceModalSub', { phrase: ALICE_SKILL_PHRASE }));
    setText('aliceSubmitBtn', tr('aliceSubmitBtn'));
    setText('aliceCancelBtn', tr('aliceCancelBtn'));
    setText('aliceSuccessTitle', tr('aliceSuccessTitle'));
    setText('aliceSuccessText', tr('aliceSuccessText'));
    setText('aliceSuccessPhrase', ALICE_SKILL_PHRASE);
    setText('modalTitle', tr('modalTitle'));
    setText('modalSub', tr('modalSub'));
    setText('labelParentName', tr('labelParentName'));
    setPlaceholder('parentNameInput', tr('parentNamePlaceholder'));
    setText('labelParentRole', tr('labelParentRole'));
    setText('roleMother', tr('roleMother'));
    setText('roleFather', tr('roleFather'));
    setText('roleGrandma', tr('roleGrandma'));
    setText('roleGrandpa', tr('roleGrandpa'));
    setText('roleNanny', tr('roleNanny'));
    setText('roleOther', tr('roleOther'));
    setPlaceholder('customParentRole', tr('customRolePlaceholder'));
    setText('labelParentAge', tr('labelParentAge'));
    setPlaceholder('parentAgeInput', tr('parentAgePlaceholder'));
    const privacyText = el('textPrivacy');
    if (privacyText) privacyText.innerHTML = tr('textPrivacy');
    const offerText = el('textOffer');
    if (offerText) offerText.innerHTML = tr('textOffer');
    setText('saveParentBtn', tr('saveParentBtn'));
    setIconText('lblChildren', 'kids', tr('lbl_children'));
    setIconText('lblNewStories', 'sparkles', tr('lbl_new_stories'));
    setIconText('lblArchiveStories', 'tales', tr('lbl_archive_stories'));
    setText('paywallText', tr('paywall_text'));
    setText('readerHeaderTitle', tr('reader_header'));
    setText('readerBackBtn', tr('reader_back'));
    const promoCta = el('readerPromoCta');
    if (promoCta) promoCta.innerHTML = iconText('sparkles', tr('reader_promo_cta')) + icon('sparkles');
    applyReportTexts();
    applyShareTexts();
    setIconText('readerSupportBtn', 'support', tr('support_btn'));
    setText('feedbackRatingTitle', tr('feedback_rating_title'));
    setText('feedbackCommentTitle', tr('feedback_comment_title'));
    setPlaceholder('story-comment', tr('feedback_placeholder'));
    const sendButton = el('submit-comment-btn');
    if (sendButton && !sendButton.disabled) sendButton.innerText = tr('feedback_send');

    if (profileData) updateStatusUI();
    renderChildren();
    renderParentCard();
    renderTariffCard();
    refreshKidsFormTexts();
    renderFirstStory();
    renderFooterAndPromo();
    renderStoriesPromo();
}
function renderFooterAndPromo() {
    const footer = el('footerLinks');
    if (!footer) return;

    let html = '';
    const promoImage = safeUrl(configUrls.promo_image_url);
    const promoLink = safeUrl(configUrls.promo_link_url);
    if (promoImage && promoLink) {
        html += `
            <a href="#" data-config-link="promo_link_url" class="footer-promo">
                <img src="${escapeHtml(promoImage)}" alt="Promo">
            </a>`;
    }
    html += `
        <a href="#" data-config-link="privacy_url">${escapeHtml(tr('footer_privacy'))}</a>
        <a href="#" data-config-link="offer_url">${escapeHtml(tr('footer_offer'))}</a>
        <a href="#" data-config-link="about_url">${escapeHtml(tr('footer_about'))}</a>`;
    footer.innerHTML = html;
}
// Тот же рекламный баннер — внизу вкладки «Сказки» (без ссылок футера)
function renderStoriesPromo() {
    const box = el('storiesPromo');
    if (!box) return;
    const promoImage = safeUrl(configUrls.promo_image_url);
    const promoLink = safeUrl(configUrls.promo_link_url);
    box.innerHTML = (promoImage && promoLink)
        ? `<a href="#" data-config-link="promo_link_url" class="footer-promo"><img src="${escapeHtml(promoImage)}" alt="Promo"></a>`
        : '';
}
// =====================================================================
// НАСТРОЙКИ И СЛАЙДЕР БАННЕРОВ
// =====================================================================
async function loadAppConfig() {
    try {
        const data = await api('/api/app/config');
        banners = data.banners || [];
        Object.assign(configUrls, data.settings || {});
        renderBanners();
        applyLanguage();
    } catch (err) {
        console.error('Не удалось загрузить баннеры и ссылки:', err);
    }
}
// Один набор баннеров показываем в двух каруселях: на «Главной» и во вкладке «Сказки»
const BANNER_SLIDERS = [['sliderContainer', 'sliderTrack'], ['storiesSliderContainer', 'storiesSliderTrack']];
function renderBanners() {
    if (window.sliderIntervalId) {
        clearInterval(window.sliderIntervalId);
        window.sliderIntervalId = null;
    }
    const tracks = [];
    BANNER_SLIDERS.forEach(([containerId, trackId]) => {
        const container = el(containerId);
        const track = el(trackId);
        if (!track || !container) return;
        if (!banners.length) { container.style.display = 'none'; return; }

        container.style.display = 'block';
        track.style.transform = 'translateX(0)';
        track.innerHTML = banners.map(b => {
            const title = (currentLang === 'uz' && b.title_uz) ? b.title_uz : ((currentLang === 'en' && b.title_en) ? b.title_en : b.title);
            return `
                <div class="slide">
                    <img src="${escapeHtml(safeUrl(b.image_url))}" class="slide-bg" loading="lazy" alt="">
                    <div class="slide-title">${escapeHtml(title)}</div>
                </div>`;
        }).join('');
        tracks.push(track);
    });

    if (banners.length > 1 && tracks.length) {
        window.sliderIntervalId = setInterval(() => {
            tracks.forEach(track => {
                track.style.transition = 'transform 0.5s ease-in-out';
                track.style.transform = 'translateX(-100%)';
            });
            setTimeout(() => {
                tracks.forEach(track => {
                    track.style.transition = 'none';
                    track.appendChild(track.firstElementChild);
                    track.style.transform = 'translateX(0)';
                });
            }, 500);
        }, 5000);
    }
}
// =====================================================================
// СТАТУС ПОДПИСКИ, ТАРИФЫ И ТАЙМЕР АКЦИИ
// Цены, лимиты и дедлайн акции решает сервер — здесь только показ.
// =====================================================================
const TARIFF_ICONS = { start: 'sprout', baby: 'teddy', kids: 'balloon' };   // символы спрайта иконок
let tariffSheetOpen = false;
let tariffTimerInterval = null;
let payingTariff = false;

function tariffName(id) { return tr('tariff_' + id + '_name') || id; }

// Обратный отсчёт: каждую секунду paint('чч:мм:сс'), по окончании — onEnd(). Возвращает таймер.
function runCountdown(deadlineMs, paint, onEnd) {
    const tick = () => {
        const diff = deadlineMs - serverNow();
        if (diff <= 0) { clearInterval(timer); onEnd(); return; }
        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
        const m = String(Math.floor(diff / 60000) % 60).padStart(2, '0');
        const s = String(Math.floor(diff / 1000) % 60).padStart(2, '0');
        paint(`${h}:${m}:${s}`);
    };
    const timer = setInterval(tick, 1000);
    tick();
    return timer;
}
// Акция закончилась — перечитываем профиль (не чаще раза в 10 секунд), цены вернутся к обычным
function reloadProfileAfterPromo() {
    if (Date.now() - (window.lastPromoReload || 0) > 10000) {
        window.lastPromoReload = Date.now();
        loadProfile().catch(err => console.error(err));
    }
}

function updateStatusUI() {
    const section = el('statusSection');
    if (!section) return;

    if (promoTimerInterval) { clearInterval(promoTimerInterval); promoTimerInterval = null; }
    hide('promoTimerContainer');

    if (!profileData || !profileData.user) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    const access = profileData.access || {};
    const payment = profileData.payment || {};
    const currentId = profileData.tariffs ? profileData.tariffs.current : null;

    const badge = el('statusBadge');
    if (badge) {
        badge.className = `status-badge ${access.hasAccess ? (access.isTrial ? 'trial' : 'active') : 'inactive'}`;
        if (!access.hasAccess) badge.innerHTML = iconText('cross-star', tr('status_inactive'));
        else if (access.isTrial) badge.innerHTML = iconText('hourglass', tr('status_trial'));
        else badge.innerHTML = iconText('check-star', currentId ? tr('status_active_tariff', { name: tariffName(currentId) }) : tr('status_active'));
    }

    if (access.hasAccess && access.endDate) {
        const date = formatDate(access.endDate);
        setText('statusText', access.isTrial ? tr('status_trial_text', { date }) : tr('status_active_text', { date }));
    } else {
        setText('statusText', tr('status_inactive_text'));
    }

    // Триал и истёкший доступ — «Оформить подписку», действующий тариф — «Сменить тариф».
    // Продление текущего тарифа — кнопка на его карточке в окне выбора.
    const button = el('renewBtn');
    if (button) {
        button.style.display = 'block';
        button.disabled = false;
        if (access.hasAccess && !access.isTrial) button.innerText = tr(currentId ? 'btn_change_tariff' : 'btn_pick_tariff');
        else button.innerText = tr('btn_subscribe');
    }

    setText('paywallBtn', tr('paywall_btn'));

    if (payment.promo_active && payment.promo_deadline) {
        startPromoTimer(new Date(payment.promo_deadline).getTime(), payment.keeps_trial_days);
    }
    if (tariffSheetOpen) renderTariffSheet();
}
// Таймер акции на странице профиля: показываем только пока акция действует (триал, первые 48 часов)
function startPromoTimer(deadlineMs, keepsTrialDays) {
    const promoItem = ((profileData.tariffs && profileData.tariffs.items) || []).find(i => i.promo_amount);
    if (!promoItem) return;
    setIconText('promoTimerTitle', 'flame', tr('timer_title', {
        name: tariffName(promoItem.id),
        promo_price: formatPrice(promoItem.promo_amount),
        price: formatPrice(promoItem.price_amount)
    }));
    setText('promoTimerCta', tr('timer_cta'));
    const note = el('promoTimerNote');
    if (note) {
        note.innerText = keepsTrialDays ? tr('promo_keeps_trial') : '';
        note.style.display = keepsTrialDays ? 'block' : 'none';
    }
    show('promoTimerContainer');
    promoTimerInterval = runCountdown(deadlineMs,
        text => setText('promoTimerCountdown', text),
        () => { promoTimerInterval = null; hide('promoTimerContainer'); reloadProfileAfterPromo(); });
}

// ---------------------------------------------------------------------
// АНАЛИТИКА МИНИ-ПРИЛОЖЕНИЯ: три события уходят на сервер (POST /api/app/event) с подписью Telegram.
// Без ожидания и без сообщений об ошибках — приложению аналитика не мешает. Что принимать, сервер решает сам.
// ---------------------------------------------------------------------
function trackAppEvent(body) {
    if (!initData || !body) return;
    try { api('/api/app/event', { method: 'POST', body }).catch(() => {}); } catch (e) { /* аналитика не должна ломать экран */ }
}
// Состояние доступа человека для событий: пробный период, оплаченная подписка, закончился доступ
function planStateForEvent() {
    const access = (profileData && profileData.access) || {};
    if (access.hasAccess) return access.isTrial ? 'trial' : 'active';
    return profileData && profileData.user ? 'expired' : 'none';
}

// ---------------------------------------------------------------------
// ОКНО ВЫБОРА ТАРИФА
// ---------------------------------------------------------------------
// source — откуда открыли окно (для аналитики): paywall, profile, promo, children_limit
function openTariffs(source) {
    if (!userExists || !profileData || !profileData.tariffs) return;
    trackAppEvent({ event_name: 'subscription_offer_viewed', source: typeof source === 'string' ? source : 'other', plan_state: planStateForEvent() });
    tariffSheetOpen = true;
    renderTariffSheet();
    const sheet = el('tariffSheet');
    if (!sheet) return;
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    const panel = sheet.querySelector('.tariff-sheet__panel');
    if (panel) { panel.scrollTop = 0; try { panel.focus({ preventScroll: true }); } catch (e) { /* не страшно */ } }
}
function closeTariffs() {
    tariffSheetOpen = false;
    if (tariffTimerInterval) { clearInterval(tariffTimerInterval); tariffTimerInterval = null; }
    const sheet = el('tariffSheet');
    if (sheet) sheet.hidden = true;
    document.body.classList.remove('sheet-open');
}
// Старое имя функции: на случай, если Telegram показал закэшированный index.html
function initiatePayment() { openTariffs(); }

function priceParts(tiyin) {
    const sum = Math.round(Number(tiyin) / 100);
    return { number: new Intl.NumberFormat(currentLang === 'en' ? 'en-GB' : 'ru-RU').format(sum), currency: tr('currency') };
}
function tariffCardMarkup(item, context) {
    const id = escapeHtml(item.id);
    const promo = item.promo_amount !== null && item.promo_amount !== undefined;
    const current = item.state === 'current';
    const blocked = item.state === 'blocked_children';
    const price = priceParts(promo ? item.promo_amount : item.price_amount);

    const features = [
        ['kids', item.max_children === 1 ? tr('tariff_children_one') : tr('tariff_children_many', { n: item.max_children })],
        ['mic', item.voiceovers === 1 ? tr('tariff_voiceovers_one') : item.voiceovers > 0 ? tr('tariff_voiceovers_n', { n: item.voiceovers }) : tr('tariff_voiceovers_none')],
        ['card', tr('tariff_extra_voiceover', { price: formatPrice(item.extra_voiceover_amount) })]
    ].map(([name, text]) => `
        <li class="tariff-feature"><span class="tariff-feature__icon" aria-hidden="true">${icon(name)}</span><span>${escapeHtml(text)}</span></li>`).join('');

    const badge = current ? `<span class="tariff-badge tariff-badge--current">${escapeHtml(tr('tariff_badge_current'))}</span>`
        : (promo ? `<span class="tariff-badge tariff-badge--promo">${iconText('flame', tr('tariff_badge_promo'))}</span>` : '');

    const oldPrice = promo ? `<span class="tariff-price__old">${escapeHtml(formatPrice(item.price_amount))}</span>` : '';
    const promoLine = promo ? `
        <div class="tariff-promo">
            <span>${escapeHtml(tr('tariff_promo_first'))}</span>
            <span class="tariff-promo__left">${escapeHtml(tr('tariff_promo_left'))} <b id="tariffPromoCountdown">--:--:--</b></span>
        </div>` : '';

    let action;
    if (blocked) {
        action = `
            <p class="tariff-card__hint">${escapeHtml(tr('tariff_blocked', { count: context.t.children_count, max: item.max_children }))}</p>
            <button class="tariff-btn tariff-btn--ghost" type="button" data-tariff-action="children">${escapeHtml(tr('tariff_btn_children'))}</button>`;
    } else {
        const label = current ? tr('tariff_btn_renew') : (context.switching ? tr('tariff_btn_switch') : tr('tariff_btn_choose'));
        action = `<button class="tariff-btn" type="button" data-tariff-action="choose" data-tariff-id="${id}">${escapeHtml(label)}</button>`;
    }

    return `
        <article class="tariff-card tariff-card--${id}${current ? ' is-current' : ''}${blocked ? ' is-blocked' : ''}${promo ? ' has-promo' : ''}">
            ${badge}
            <header class="tariff-card__header">
                <span class="tariff-card__icon" aria-hidden="true">${icon(TARIFF_ICONS[item.id] || 'star')}</span>
                <div class="tariff-card__title">
                    <h3 class="tariff-card__name">${escapeHtml(tariffName(item.id))}</h3>
                    <p class="tariff-card__tag">${escapeHtml(tr('tariff_' + item.id + '_tag'))}</p>
                </div>
            </header>
            <div class="tariff-price">
                ${oldPrice}
                <div class="tariff-price__row">
                    <span class="tariff-price__num">${escapeHtml(price.number)}</span>
                    <span class="tariff-price__cur">${escapeHtml(price.currency)}</span>
                    <span class="tariff-price__per">${escapeHtml(tr('tariff_per_period'))}</span>
                </div>
            </div>
            ${promoLine}
            <ul class="tariff-features">${features}</ul>
            ${action}
        </article>`;
}
function renderTariffSheet() {
    const sheet = el('tariffSheet');
    if (!sheet || !profileData || !profileData.tariffs) return;
    const t = profileData.tariffs;
    const access = profileData.access || {};
    const payment = profileData.payment || {};
    const activeSub = !!(access.hasAccess && !access.isTrial);
    const switching = activeSub && !t.legacy;       // есть действующий тариф: смена начинается сразу

    setText('tariffSheetTitle', tr(activeSub ? 'tariff_sheet_title_change' : 'tariff_sheet_title_choose'));
    setText('tariffSheetSub', tr('tariff_sheet_sub'));
    const closeBtn = el('tariffSheetClose');
    if (closeBtn) closeBtn.setAttribute('aria-label', tr('tariff_sheet_close'));

    let note = '';
    if (activeSub && t.legacy) note = tr('tariff_note_legacy', { date: formatDate(access.endDate) });
    else if (switching) note = tr('tariff_note_change');
    else if (access.hasAccess && access.isTrial) note = tr('tariff_note_trial');
    const noteNode = el('tariffNote');
    if (noteNode) { noteNode.textContent = note; noteNode.style.display = note ? 'block' : 'none'; }

    const cards = el('tariffCards');
    if (cards) cards.innerHTML = t.items.map(item => tariffCardMarkup(item, { t, switching })).join('');

    if (tariffTimerInterval) { clearInterval(tariffTimerInterval); tariffTimerInterval = null; }
    if (payment.promo_active && payment.promo_deadline && t.items.some(i => i.promo_amount)) {
        tariffTimerInterval = runCountdown(new Date(payment.promo_deadline).getTime(),
            text => { const node = el('tariffPromoCountdown'); if (node) node.textContent = text; },
            () => { tariffTimerInterval = null; reloadProfileAfterPromo(); });
    }
}
// Кнопки окна: закрыть, выбрать/продлить тариф, перейти к профилям детей
document.addEventListener('click', (event) => {
    const node = event.target.closest('[data-tariff-action]');
    if (!node) return;
    const action = node.getAttribute('data-tariff-action');
    if (action === 'close') closeTariffs();
    else if (action === 'open') openTariffs(node.getAttribute('data-tariff-source') || 'other');
    else if (action === 'choose') payForTariff(node.getAttribute('data-tariff-id'), node);
    else if (action === 'children') {
        closeTariffs();
        showChildrenSection();
    }
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && tariffSheetOpen) closeTariffs(); });

// =====================================================================
// ОПЛАТА: ссылку собирает сервер (тариф и цену выбирает он же)
// =====================================================================
async function payForTariff(tariffId, button) {
    if (!userExists || payingTariff || !profileData || !profileData.tariffs) return;
    const t = profileData.tariffs;
    const item = t.items.find(i => i.id === tariffId);
    if (!item || item.state === 'blocked_children') return;
    // Нажали «Выбрать / Продлить» — ещё до вопроса про смену тарифа и до ссылки Payme
    trackAppEvent({ event_name: 'subscription_cta_clicked', tariff_key: tariffId, plan_state: planStateForEvent() });

    // Смена тарифа посреди оплаченного периода: остаток прежнего не сохраняется — спрашиваем
    const access = profileData.access || {};
    if (item.state !== 'current' && access.hasAccess && !access.isTrial && !t.legacy) {
        const ok = await showConfirm(tr('tariff_change_confirm', { name: tariffName(item.id), date: formatDate(access.endDate) }));
        if (!ok) return;
    }

    payingTariff = true;
    const label = button ? button.innerHTML : '';
    if (button) { button.disabled = true; button.innerText = tr('payment_opening'); }
    try {
        const data = await api('/api/app/payment-link', { method: 'POST', body: { tariff: tariffId, language: currentLang } });
        paymentSnapshot = {
            status: profileData.user.subscription_status,
            endDate: access.endDate || null,
            tariff: t.current || null
        };
        awaitingPayment = true;
        openLink(data.url);
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
    } finally {
        payingTariff = false;
        if (button && button.isConnected) { button.disabled = false; button.innerHTML = label; }
    }
}
function subscribeReturnFromPayment() {
    if (window.paymentReturnBound) return;
    window.paymentReturnBound = true;

    const onReturn = () => {
        if (awaitingPayment) checkPaymentResult(true);
        if (awaitingVoiceoverPayment) checkVoiceoverPayment(true);
    };
    try { if (tg && tg.onEvent) tg.onEvent('activated', onReturn); } catch (e) { /* старые клиенты */ }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onReturn();
    });
}
async function checkPaymentResult(retryOnce) {
    try {
        await loadProfile();
        const access = profileData.access || {};
        const currentId = profileData.tariffs ? profileData.tariffs.current : null;
        const paid = profileData.user && profileData.user.subscription_status === 'active' &&
            (!paymentSnapshot || paymentSnapshot.status !== 'active' || access.endDate !== paymentSnapshot.endDate ||
                currentId !== paymentSnapshot.tariff);
        if (paid) {
            awaitingPayment = false;
            paymentSnapshot = null;
            closeTariffs();
            loadUserStories();   // закрытые сказки архива открываются сразу после оплаты
            const date = formatDate(access.endDate);
            showAlert(currentId ? tr('payment_success_tariff', { name: tariffName(currentId), date }) : tr('payment_success', { date }));
        } else if (retryOnce) {
            setTimeout(() => checkPaymentResult(false), 5000);
        }
    } catch (err) {
        console.error('Не удалось обновить статус после оплаты:', err);
    }
}
// =====================================================================
// ДЕТИ (вкладка «Дети»)
// Блок 1 — сводка: сколько детей можно добавить по тарифу, кто уже добавлен, кнопка «Добавить ребёнка»
// (мест нет — «Обновить тариф»; детей уже 5, как в «Кидс», — кнопки нет).
// Блок 2 — карточки детей: имя, пол, язык сказок, «Изменить», «Удалить».
// Добавление и правка — на отдельном экране kidsFormScreen (ниже).
// =====================================================================
const KIDS_TOP_MAX = 5;          // больше детей нет ни в одном тарифе («Кидс»)
const TALE_LANGS = [['ru', '🇷🇺 Русский'], ['uz', "🇺🇿 O'zbekcha"], ['en', '🇬🇧 English']];

function languageBadge(language) {
    return language === 'ru' ? '🇷🇺 RU' : (language === 'uz' ? '🇺🇿 UZ' : '🇬🇧 EN');
}
function genderLabel(gender) {
    return tr(gender === 'M' ? 'btn_boy' : 'btn_girl');
}
function renderKidsSummary() {
    const box = el('kidsSummary');
    if (!box) return;
    if (!userExists) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = 'block';

    const count = allChildren.length;
    const max = maxChildren;
    const free = Math.max(0, max - count);
    const access = (profileData && profileData.access) || {};

    let text;
    let button = '';
    if (free > 0) {
        if (max === 1) text = tr('kids_info_one');
        else if (!count) text = tr('kids_info_empty', { max });
        else text = tr('kids_info_free', { max, count, free });
        button = `<button class="primary-btn" type="button" onclick="openKidsForm()">${iconText('plus', tr('kids_btn_add'))}</button>`;
    } else if (max >= KIDS_TOP_MAX) {
        text = tr('kids_info_top', { max });
    } else {
        text = tr('kids_info_full', { max });
        const label = access.hasAccess && !access.isTrial ? 'kids_btn_upgrade' : 'btn_pick_tariff';
        button = `<button class="primary-btn" type="button" data-tariff-action="open" data-tariff-source="children_limit">${escapeHtml(tr(label))}</button>`;
    }

    const names = count
        ? `<ul class="kids-summary__list">${allChildren.map(child =>
            `<li><span class="kids-summary__name">${escapeHtml(child.name)}</span><span class="kids-summary__gender">${escapeHtml(genderLabel(child.gender))}</span></li>`).join('')}</ul>`
        : '';

    box.innerHTML = `
        <div class="kids-summary__count">${escapeHtml(tr('kids_summary_count', { count, max }))}</div>
        <p class="kids-summary__text">${escapeHtml(text)}</p>
        ${names}
        ${button}`;
}
function renderChildren() {
    renderKidsSummary();
    const container = el('childrenList');
    if (!container) return;

    if (!allChildren.length) {
        container.innerHTML = `<p class="empty-note">${escapeHtml(tr('no_profiles'))}</p>`;
        return;
    }
    container.innerHTML = allChildren.map(child => `
        <div class="child-card kid-card">
            <div class="child-info">
                <span class="child-name">${escapeHtml(child.name)}</span>
                <span class="child-details">${escapeHtml(genderLabel(child.gender))} · ${languageBadge(child.language)}</span>
            </div>
            <div class="kid-card__actions">
                <button class="kid-btn" type="button" data-id="${escapeHtml(child.id)}" onclick="openKidsForm(this.dataset.id)">${iconText('edit', tr('kids_btn_edit'))}</button>
                <button class="kid-btn kid-btn--danger" type="button" data-id="${escapeHtml(child.id)}" onclick="deleteChild(this.dataset.id)">${iconText('trash', tr('kids_btn_delete'))}</button>
            </div>
        </div>`).join('');
}
async function deleteChild(id) {
    // Окно Telegram вмещает не больше 256 символов — длинное имя укорачиваем
    const child = allChildren.find(c => String(c.id) === String(id));
    const name = child && child.name ? String(child.name).slice(0, 40) : '';
    if (!(await showConfirm(tr('confirm_delete_child', { name })))) return;
    try {
        await api(`/api/app/children/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadProfile();
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
    }
}
// =====================================================================
// ЭКРАН «ДОБАВИТЬ ДЕТЕЙ» / «ИЗМЕНИТЬ ДАННЫЕ РЕБЁНКА»
// Добавление: сначала одна строка «Ребёнок №N». Ещё строку добавляет кнопка «Добавить ещё ребёнка» (пока есть свободные
// места тарифа), лишнюю строку можно убрать. Пустые строки пропускаются. Правка: одна строка с данными ребёнка.
// Имя — в алфавите языка сказок (name-script.js): у каждой строки своя защита поля и свой выбор языка.
// Одно поле — одно имя: перечисление («Тимур и Ясмина», «Солиха, Ирода») не принимаем, на 3 слова и больше переспрашиваем.
// =====================================================================
let kidsForm = null;             // { mode: 'add' | 'edit', childId, rows: [{ number, node, guard, sepTyped }], busy }

function nameHintText(taleLang) {
    return tr(taleLang === 'uz' ? 'name_hint_lat_uz' : taleLang === 'en' ? 'name_hint_lat_en' : 'name_hint_cyr');
}
// Сколько детей ещё можно добавить по тарифу (строк в форме добавления — не больше)
function kidsFormFree() {
    return Math.max(0, maxChildren - allChildren.length);
}
// Можно ли в форме добавить ещё строку
function kidsFormCanAddRow() {
    return !!kidsForm && kidsForm.mode === 'add' && kidsForm.rows.length < kidsFormFree();
}
// «В одном поле — одно имя» + совет про кнопку «Добавить ещё ребёнка», если места ещё есть
function oneNameText() {
    return tr('kids_form_one_name') + (kidsFormCanAddRow() ? ' ' + tr('kids_form_add_separately') : '');
}
function kidRowMarkup(number, child, removable) {
    const lang = child ? child.language : currentLang;
    const gender = child ? child.gender : '';
    const remove = removable
        ? `<button type="button" class="kid-row__remove" data-tr="kids_form_remove_row" data-tr-icon="close" onclick="removeKidRow(this)">${iconText('close', tr('kids_form_remove_row'))}</button>`
        : '';
    return `
        <div class="kid-row glass-panel" data-kid-row="${number}">
            <div class="kid-row__head">
                <h3 class="kid-row__title" data-kid-number="${number}">${escapeHtml(tr('kids_row_title', { n: number }))}</h3>
                ${remove}
            </div>
            <label data-tr="label_name">${escapeHtml(tr('label_name'))}</label>
            <input type="text" class="kid-row__name" data-tr-placeholder="placeholder_name" placeholder="${escapeHtml(tr('placeholder_name'))}" autocomplete="off" maxlength="40" value="${escapeHtml(child ? child.name : '')}">
            <p class="kid-row__warn" hidden></p>
            <label data-tr="label_gender">${escapeHtml(tr('label_gender'))}</label>
            <div class="radio-group kid-row__gender">
                <div class="radio-label${gender === 'F' ? ' selected' : ''}" data-kid-gender="F" data-tr="btn_girl" data-tr-icon="girl" role="button" tabindex="0">${iconText('girl', tr('btn_girl'))}</div>
                <div class="radio-label${gender === 'M' ? ' selected' : ''}" data-kid-gender="M" data-tr="btn_boy" data-tr-icon="boy" role="button" tabindex="0">${iconText('boy', tr('btn_boy'))}</div>
            </div>
            <label data-tr="label_lang">${escapeHtml(tr('label_lang'))}</label>
            <select class="kid-row__lang">
                ${TALE_LANGS.map(([code, title]) => `<option value="${code}"${code === lang ? ' selected' : ''}>${escapeHtml(title)}</option>`).join('')}
            </select>
        </div>`;
}
function refreshKidsFormTexts() {
    if (!kidsForm) return;
    const edit = kidsForm.mode === 'edit';
    setText('kidsFormTitle', tr(edit ? 'kids_form_title_edit' : 'kids_form_title_add'));
    if (!kidsForm.busy) setText('kidsFormSaveBtn', tr(edit ? 'btn_save_edit' : 'kids_form_btn_add'));
    const info = el('kidsFormInfo');
    if (info) {
        const free = kidsFormFree();
        if (edit) info.innerText = tr('kids_form_info_edit');
        else if (maxChildren === 1) info.innerText = tr('kids_info_one');
        else info.innerText = tr(free === 1 ? 'kids_form_info_last' : 'kids_form_info', { max: maxChildren, free });
    }
    const addRowBtn = el('kidsFormAddRowBtn');
    if (addRowBtn) {
        addRowBtn.style.display = kidsFormCanAddRow() ? 'block' : 'none';
        addRowBtn.disabled = !!kidsForm.busy;
        addRowBtn.innerHTML = iconText('plus', tr('kids_form_add_row'));
    }
    const screen = el('kidsFormScreen');
    if (!screen) return;
    screen.querySelectorAll('[data-tr]').forEach(node => {
        const name = node.getAttribute('data-tr-icon');   // подпись с иконкой спрайта
        if (name) node.innerHTML = iconText(name, tr(node.getAttribute('data-tr')));
        else node.innerText = tr(node.getAttribute('data-tr'));
    });
    screen.querySelectorAll('[data-tr-placeholder]').forEach(node => { node.placeholder = tr(node.getAttribute('data-tr-placeholder')); });
    screen.querySelectorAll('[data-kid-number]').forEach(node => { node.innerText = tr('kids_row_title', { n: node.getAttribute('data-kid-number') }); });
    kidsForm.rows.forEach(row => {
        if (row.guard) row.guard.refresh();
        updateKidRowWarn(row);
    });
}
// Подсказка «одно поле — одно имя» под полем имени: видна, пока в поле перечислены несколько детей
function kidRowSeveral(row) {
    const input = row.node.querySelector('.kid-row__name');
    const select = row.node.querySelector('.kid-row__lang');
    const value = input ? input.value : '';
    if (!value.trim() || !window.NameScript || !NameScript.severalNames) return false;
    const several = NameScript.severalNames(value, select ? select.value : currentLang);
    // Запятую и «/» поле стирает сразу (name-script.js), поэтому помним, что их вводили: «Тимур, Ясмина» → «Тимур Ясмина»
    return several.joined || (row.sepTyped && several.words >= 2);
}
function updateKidRowWarn(row) {
    const warn = row.node.querySelector('.kid-row__warn');
    if (!warn) return;
    const input = row.node.querySelector('.kid-row__name');
    if (row.sepTyped && input && !input.value.trim()) row.sepTyped = false;   // поле очистили — начинаем заново
    const show = kidRowSeveral(row);
    warn.hidden = !show;
    if (show) warn.innerText = oneNameText();
}
// Защита поля имени и подсказки для строки формы
function bindKidRow(node, child) {
    const input = node.querySelector('.kid-row__name');
    const select = node.querySelector('.kid-row__lang');
    let guard = null;
    if (window.NameScript && input && select) {
        guard = NameScript.bind(input, {
            getLang: () => select.value,
            uiLang: () => currentLang,
            t: (key, params) => tr('name_' + key, params)
        });
        select.addEventListener('change', () => guard.recheck());
        if (child) guard.recheck();   // старое имя в чужом алфавите: подсказка и кнопка перевода, текст не трогаем
    }
    const row = { number: Number(node.getAttribute('data-kid-row')), node, guard, sepTyped: false };
    if (input) {
        // Знаки перечисления ловим до того, как поле их сотрёт
        input.addEventListener('beforeinput', (event) => {
            if (event && typeof event.data === 'string' && /[,;\/&+|\\\n]/.test(event.data)) row.sepTyped = true;
        });
        input.addEventListener('input', () => updateKidRowWarn(row));
    }
    if (select) select.addEventListener('change', () => updateKidRowWarn(row));
    return row;
}
// Номера строк «Ребёнок №N» по порядку (после удаления строки)
function renumberKidRows() {
    if (!kidsForm || kidsForm.mode !== 'add') return;
    kidsForm.rows.forEach((row, i) => {
        row.number = allChildren.length + i + 1;
        row.node.setAttribute('data-kid-row', String(row.number));
        const title = row.node.querySelector('[data-kid-number]');
        if (title) title.setAttribute('data-kid-number', String(row.number));
    });
}
function openKidsForm(editId) {
    if (!userExists) return;
    const box = el('kidsFormRows');
    const screen = el('kidsFormScreen');
    if (!box || !screen) return;

    let number;
    let child = null;
    if (editId !== undefined && editId !== null) {
        const index = allChildren.findIndex(c => String(c.id) === String(editId));
        if (index < 0) return;
        child = allChildren[index];
        number = index + 1;
    } else {
        if (allChildren.length >= maxChildren) { renderKidsSummary(); return; }
        number = allChildren.length + 1;      // сначала — один ребёнок; ещё — кнопкой «Добавить ещё ребёнка»
    }

    box.innerHTML = kidRowMarkup(number, child, false);
    kidsForm = { mode: child ? 'edit' : 'add', childId: child ? child.id : null, rows: [], busy: false };
    box.querySelectorAll('[data-kid-row]').forEach(node => { kidsForm.rows.push(bindKidRow(node, child)); });
    refreshKidsFormTexts();
    screen.style.display = 'flex';
    screen.scrollTop = 0;
}
// «Добавить ещё ребёнка»: новая пустая строка внизу формы
function addKidRow() {
    if (!kidsFormCanAddRow() || kidsForm.busy) return;
    const box = el('kidsFormRows');
    if (!box) return;
    const number = allChildren.length + kidsForm.rows.length + 1;
    box.insertAdjacentHTML('beforeend', kidRowMarkup(number, null, true));
    const node = box.lastElementChild;
    kidsForm.rows.push(bindKidRow(node, null));
    refreshKidsFormTexts();
    haptic('select');
    try { node.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* старый WebView */ }
    const input = node.querySelector('.kid-row__name');
    if (input) setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 350);
}
// «Убрать»: удаляет добавленную строку (первую строку убрать нельзя)
function removeKidRow(button) {
    if (!kidsForm || kidsForm.busy || kidsForm.mode !== 'add') return;
    const node = button && button.closest ? button.closest('[data-kid-row]') : null;
    const index = node ? kidsForm.rows.findIndex(row => row.node === node) : -1;
    if (index <= 0) return;
    kidsForm.rows.splice(index, 1);
    node.remove();
    renumberKidRows();
    refreshKidsFormTexts();
}
function closeKidsForm() {
    if (kidsForm && kidsForm.busy) return;
    kidsForm = null;
    hide('kidsFormScreen');
    const box = el('kidsFormRows');
    if (box) box.innerHTML = '';
}
// Выбор пола в строке (нажатие и клавиатура)
function pickKidGender(node) {
    const group = node.parentNode;
    if (!group) return;
    group.querySelectorAll('[data-kid-gender]').forEach(item => item.classList.toggle('selected', item === node));
}
document.addEventListener('click', (event) => {
    const node = event.target.closest ? event.target.closest('[data-kid-gender]') : null;
    if (node) pickKidGender(node);
});
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const node = event.target && event.target.matches && event.target.matches('[data-kid-gender]') ? event.target : null;
    if (node) { event.preventDefault(); pickKidGender(node); }
});
// Читает строки формы. Возвращает { items } или { error } (текст для окна)
function collectKidsForm() {
    const items = [];
    for (const row of kidsForm.rows) {
        const input = row.node.querySelector('.kid-row__name');
        const select = row.node.querySelector('.kid-row__lang');
        const picked = row.node.querySelector('[data-kid-gender].selected');
        let name = input ? input.value.trim() : '';
        const language = select ? select.value : currentLang;
        if (!name) {
            if (kidsForm.mode === 'edit') return { error: tr('alert_enter_child_name') };
            continue;            // пустая строка — это место просто не заполняли
        }
        if (!picked) return { error: tr('kids_form_gender', { n: row.number }) };
        const gender = picked.getAttribute('data-kid-gender');
        // Имя — в алфавите языка сказок. Старое имя при правке только пола не трогаем (так же решает и сервер)
        const original = kidsForm.mode === 'edit' ? allChildren.find(c => String(c.id) === String(kidsForm.childId)) : null;
        const nameUnchanged = original && original.name === name && original.language === language;
        let manyWords = false;
        if (!nameUnchanged && window.NameScript) {
            // Одно поле — одно имя: «Тимур и Ясмина», «Солиха, Ирода» — это несколько детей
            if (kidRowSeveral(row)) {
                updateKidRowWarn(row);
                return { error: oneNameText() };
            }
            const checked = NameScript.check(name, language);
            if (checked.foreign) {
                if (row.guard) row.guard.recheck();
                return { error: nameHintText(language) };
            }
            if (!checked.text) return { error: tr('alert_enter_child_name') };
            name = checked.text;
            manyWords = !!NameScript.severalNames && NameScript.severalNames(name, language).words >= 3;
        }
        items.push({ name, gender, language, manyWords });
    }
    if (!items.length) return { error: tr('kids_form_empty') };
    return { items };
}
async function submitKidsForm() {
    if (!kidsForm || kidsForm.busy) return;
    const collected = collectKidsForm();
    if (collected.error) return showAlert(collected.error);
    // Имя из 3 слов и больше: двойные имена бывают, но чаще так пишут нескольких детей — переспрашиваем
    for (const item of collected.items) {
        if (!item.manyWords) continue;
        const question = tr('kids_form_confirm_words', { name: item.name.slice(0, 40) })
            + (kidsFormCanAddRow() ? ' ' + tr('kids_form_add_separately') : '');
        if (!(await showConfirm(question))) return;
        if (!kidsForm || kidsForm.busy) return;
    }
    collected.items = collected.items.map(({ name, gender, language }) => ({ name, gender, language }));

    const edit = kidsForm.mode === 'edit';
    const hadNoChildren = !allChildren.length;
    const button = el('kidsFormSaveBtn');
    kidsForm.busy = true;
    if (button) { button.disabled = true; button.innerText = tr('saving'); }

    let saved = 0;
    let failure = null;
    try {
        for (const body of collected.items) {
            if (edit) await api(`/api/app/children/${encodeURIComponent(kidsForm.childId)}`, { method: 'PATCH', body });
            else await api('/api/app/children', { method: 'POST', body });
            saved += 1;
        }
    } catch (err) {
        console.error(err);
        failure = err;
    }
    kidsForm.busy = false;
    if (button) button.disabled = false;

    if (failure && !saved) {
        refreshKidsFormTexts();
        const failedLang = collected.items[0].language;
        if (failure.code === 'CHILD_NAME_SEVERAL') return showAlert(oneNameText());
        return showAlert(failure.code === 'CHILD_NAME_SCRIPT' ? nameHintText(failedLang) : (failure.message || tr('error_generic')));
    }

    closeKidsForm();
    try {
        await loadProfile();
    } catch (err) {
        console.error(err);
    }
    switchAppTab('kids');
    if (failure) {
        // Часть детей сохранилась, на следующем сервер ответил ошибкой
        showAlert(tr('kids_form_partial', { saved }) + ' ' + (failure.message || tr('error_generic')));
        return;
    }
    if (edit) return;
    // Пользователь мог добавить ребёнка уже после первого открытия Mini App.
    siteDemoClaimChecked = false;
    const claimedDemo = await claimPendingSiteDemo();
    if (claimedDemo && claimedDemo.storyId) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('story_id', claimedDemo.storyId);
        window.history.replaceState({}, '', nextUrl.toString());
        switchAppTab('stories');
        await openReader(claimedDemo.storyId);
    } else if (hadNoChildren) {
        // Карточка «Первая сказка» появляется на вкладке «Дети», и не все родители её замечают — зовём окном
        offerFirstStoryAfterFirstChild();
    }
}
// =====================================================================
// МОЙ ПРОФИЛЬ: данные родителя из анкеты (можно изменить) и действующий тариф
// =====================================================================
const PARENT_ROLES = [['Мама', 'roleMother'], ['Папа', 'roleFather'], ['Бабушка', 'roleGrandma'], ['Дедушка', 'roleGrandpa'], ['Няня', 'roleNanny']];
let parentEditing = false;
let parentSaving = false;

// В базе роль хранится по-русски («Мама»); показываем на языке интерфейса. Своя роль («Тётя») — как ввели
function roleLabel(value) {
    const known = PARENT_ROLES.find(([role]) => role === value);
    return known ? tr(known[1]) : String(value || '');
}
function infoRow(label, value) {
    return `<div class="info-row"><span class="info-row__label">${escapeHtml(label)}</span><span class="info-row__value">${escapeHtml(value)}</span></div>`;
}
function renderParentCard() {
    const box = el('parentCard');
    if (!box) return;
    const user = profileData && profileData.user;
    if (!user || !user.profile_complete) { box.innerHTML = ''; return; }

    if (!parentEditing) {
        box.innerHTML = `
            ${infoRow(tr('parent_name'), user.parent_name || '—')}
            ${infoRow(tr('parent_age'), user.parent_age ? String(user.parent_age) : '—')}
            ${infoRow(tr('parent_role'), roleLabel(user.parent_role) || '—')}
            <button class="kid-btn info-card__btn" type="button" onclick="startParentEdit()">${iconText('edit', tr('kids_btn_edit'))}</button>`;
        return;
    }
    const known = PARENT_ROLES.some(([role]) => role === user.parent_role);
    const options = PARENT_ROLES.map(([role, key]) =>
        `<option value="${role}"${role === user.parent_role ? ' selected' : ''}>${escapeHtml(tr(key))}</option>`).join('') +
        `<option value="Другое"${known ? '' : ' selected'}>${escapeHtml(tr('roleOther'))}</option>`;
    box.innerHTML = `
        <label for="editParentName">${escapeHtml(tr('labelParentName'))}</label>
        <input type="text" id="editParentName" maxlength="60" autocomplete="off" value="${escapeHtml(user.parent_name || '')}">
        <label for="editParentAge">${escapeHtml(tr('labelParentAge'))}</label>
        <input type="number" id="editParentAge" inputmode="numeric" min="10" max="100" value="${escapeHtml(user.parent_age || '')}">
        <label for="editParentRole">${escapeHtml(tr('labelParentRole'))}</label>
        <select id="editParentRole" onchange="toggleEditCustomRole(this.value)">${options}</select>
        <input type="text" id="editParentCustomRole" maxlength="40" placeholder="${escapeHtml(tr('customRolePlaceholder'))}" value="${escapeHtml(known ? '' : (user.parent_role || ''))}" style="display: ${known ? 'none' : 'block'};">
        <button class="primary-btn" id="editParentSave" type="button" onclick="saveParentEdit()"${parentSaving ? ' disabled' : ''}>${escapeHtml(tr(parentSaving ? 'saving' : 'btn_save_edit'))}</button>
        <button class="cancel-edit" type="button" onclick="cancelParentEdit()" style="display: block;">${escapeHtml(tr('btn_cancel'))}</button>`;
}
function startParentEdit() { parentEditing = true; renderParentCard(); }
function cancelParentEdit() { if (parentSaving) return; parentEditing = false; renderParentCard(); }
function toggleEditCustomRole(value) {
    const input = el('editParentCustomRole');
    if (input) input.style.display = value === 'Другое' ? 'block' : 'none';
}
async function saveParentEdit() {
    if (parentSaving) return;
    const parentName = (el('editParentName') ? el('editParentName').value : '').trim();
    let role = el('editParentRole') ? el('editParentRole').value : '';
    if (role === 'Другое') role = (el('editParentCustomRole') ? el('editParentCustomRole').value : '').trim();
    const age = parseInt(el('editParentAge') ? el('editParentAge').value : '', 10);

    if (!parentName) return showAlert(tr('alert_enter_parent_name'));
    if (!role || isNaN(age) || age < 10 || age > 100) return showAlert(tr('alert_parent_role_age'));

    const button = el('editParentSave');
    parentSaving = true;
    if (button) { button.disabled = true; button.innerText = tr('saving'); }
    try {
        await api('/api/app/parent', { method: 'PATCH', body: { parentName, role, age } });
        parentSaving = false;
        parentEditing = false;
        await loadProfile();
    } catch (err) {
        console.error(err);
        parentSaving = false;
        if (button) { button.disabled = false; button.innerText = tr('btn_save_edit'); }
        showAlert(err.message || tr('error_generic'));
    }
}
// Действующий тариф: название, дата начала и дата окончания
function renderTariffCard() {
    const box = el('tariffCard');
    if (!box) return;
    if (!profileData || !profileData.user) { box.innerHTML = ''; return; }
    const access = profileData.access || {};
    const currentId = profileData.tariffs ? profileData.tariffs.current : null;

    if (!access.hasAccess) {
        box.innerHTML = `
            ${infoRow(tr('tariff_card_name'), tr('tariff_card_none'))}
            <p class="info-card__note">${escapeHtml(tr('tariff_card_none_text'))}</p>
            <button class="primary-btn" type="button" onclick="openTariffs('profile')">${escapeHtml(tr('btn_pick_tariff'))}</button>`;
        return;
    }
    const name = access.isTrial ? tr('tariff_card_trial') : (currentId ? `«${tariffName(currentId)}»` : tr('tariff_card_legacy'));
    box.innerHTML = `
        ${infoRow(tr('tariff_card_name'), name)}
        ${access.startDate ? infoRow(tr('tariff_card_start'), formatDate(access.startDate)) : ''}
        ${access.endDate ? infoRow(tr('tariff_card_end'), formatDate(access.endDate)) : ''}`;
}
// =====================================================================
// ПЕРВАЯ СКАЗКА СРАЗУ (пробный период)
// Карточка с кнопкой «Получить первую сказку сейчас» — на «Главной» и во вкладке «Дети».
// Один ребёнок в профиле — сказка уходит сразу; несколько — спрашиваем «Для кого прислать сказку?».
// Нет детей — отправляем добавлять профиль. Показываем, пока сервер говорит first_story.available.
// Вечерняя сказка в 21:00 приходит как обычно.
// =====================================================================
let firstStoryBusy = false;
let firstStoryResult = null;     // { storyId, childName, childNameGen, sent } — после успешной отправки
let firstStorySheetOpen = false;

function firstStoryState() {
    if (firstStoryResult) return 'done';
    if (firstStoryBusy) return 'busy';
    return profileData && profileData.first_story && profileData.first_story.available ? 'ready' : 'hidden';
}
function firstStoryMarkup(state) {
    if (state === 'done') {
        // По-русски «Сказка для Тимура» — родительный падеж даёт сервер; на других языках имя остаётся как есть
        const name = escapeHtml(currentLang === 'ru' && firstStoryResult.childNameGen ? firstStoryResult.childNameGen : firstStoryResult.childName);
        const text = tr(firstStoryResult.sent ? 'first_story_done_text' : 'first_story_done_unsent', { name });
        return `
        <div class="first-story first-story--done" data-first-story-state="done">
            <div class="first-story__head"><span class="first-story__icon" aria-hidden="true">${icon('check-star', 'ic--ok')}</span><span class="first-story__title">${escapeHtml(tr('first_story_done_title'))}</span></div>
            <p class="first-story__text">${text}</p>
            <button type="button" class="first-story__btn" data-first-story-action="read">${escapeHtml(tr('first_story_read_btn'))}</button>
        </div>`;
    }
    const busy = state === 'busy';
    return `
        <div class="first-story" data-first-story-state="${state}">
            <div class="first-story__head"><span class="first-story__icon" aria-hidden="true">${icon('moon', 'ic--gold')}</span><span class="first-story__title">${escapeHtml(tr('first_story_title'))}</span></div>
            <p class="first-story__text">${escapeHtml(tr('first_story_text'))}</p>
            <button type="button" class="first-story__btn" data-first-story-action="start"${busy ? ' disabled aria-busy="true"' : ''}>${busy ? '<span class="first-story__spin" aria-hidden="true"></span>' + escapeHtml(tr('first_story_sending')) : escapeHtml(tr('first_story_btn'))}</button>
        </div>`;
}
function renderFirstStory() {
    const state = firstStoryState();
    document.querySelectorAll('[data-first-story-slot]').forEach(slot => {
        const inProfile = slot.getAttribute('data-first-story-slot') === 'kids';
        // Под профилями детей кнопка нужна, когда уже есть кого выбирать. Итог «Сказка отправлена» показываем в обоих местах:
        // нажали на вкладке «Дети» — ответ должен появиться там же (вкладки открыты по одной, дубля на экране нет)
        const hidden = state === 'hidden' || (inProfile && !allChildren.length);
        if (hidden) {
            slot.style.display = 'none';
            slot.innerHTML = '';
            slot.removeAttribute('data-rendered');
            return;
        }
        const html = firstStoryMarkup(state);
        slot.style.display = 'block';
        if (slot.getAttribute('data-rendered') !== html) {      // не перерисовываем то же самое: иначе теряется фокус кнопки
            slot.innerHTML = html;
            slot.setAttribute('data-rendered', html);
        }
    });
}
function startFirstStory() {
    if (firstStoryBusy || !userExists) return;
    if (!allChildren.length) {
        showAlert(tr('first_story_need_child'));
        showChildrenSection();
        return;
    }
    if (allChildren.length === 1) {
        sendFirstStory(allChildren[0].id);
        return;
    }
    openFirstStorySheet();
}
function openFirstStorySheet() {
    const sheet = el('firstStorySheet');
    if (!sheet) return;
    setText('firstStorySheetTitle', tr('first_story_pick_title'));
    setText('firstStorySheetSub', tr('first_story_pick_sub'));
    const close = el('firstStorySheetClose');
    if (close) close.setAttribute('aria-label', tr('first_story_close'));
    const list = el('firstStoryChoices');
    if (list) {
        list.innerHTML = allChildren.map(child => `
            <button type="button" class="first-story-choice" data-first-story-action="pick" data-child-id="${escapeHtml(child.id)}">
                <span class="first-story-choice__name"><span>${escapeHtml(child.name)}</span>${icon(child.gender === 'M' ? 'boy' : 'girl')}</span>
                <span class="first-story-choice__meta">${languageBadge(child.language)}</span>
            </button>`).join('');
    }
    firstStorySheetOpen = true;
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    const panel = sheet.querySelector('.tariff-sheet__panel');
    if (panel) { panel.scrollTop = 0; try { panel.focus({ preventScroll: true }); } catch (e) { /* не страшно */ } }
}
function closeFirstStorySheet() {
    firstStorySheetOpen = false;
    const sheet = el('firstStorySheet');
    if (sheet) sheet.hidden = true;
    if (!tariffSheetOpen) document.body.classList.remove('sheet-open');
}
async function sendFirstStory(childId) {
    if (firstStoryBusy) return;
    firstStoryBusy = true;
    closeFirstStorySheet();
    renderFirstStory();
    try {
        const data = await api('/api/app/first-story', { method: 'POST', body: { childId } });
        firstStoryResult = { storyId: data.story_id, childName: data.child_name || '', childNameGen: data.child_name_genitive || '', sent: data.sent !== false };
        if (profileData) profileData.first_story = { available: false };
    } catch (err) {
        console.error(err);
        // Сказка уже выдана — кнопка больше не нужна
        if (err.code === 'FIRST_STORY_DONE' && profileData) profileData.first_story = { available: false };
        showAlert(err.message || tr('error_generic'));
    } finally {
        firstStoryBusy = false;
        renderFirstStory();
    }
}
function readFirstStory() {
    if (!firstStoryResult) return;
    switchAppTab('stories');
    openReader(firstStoryResult.storyId);
}
// --- Окно-подсказка после добавления ПЕРВОГО ребёнка ---
// Новый родитель добавляет профиль и остаётся у формы, а карточка «Первая сказка» возникает выше неё. Чтобы её не пропустили,
// показываем окно с предложением. «Получить» — как кнопка в карточке (один ребёнок — сказка уходит сразу);
// «Позже» — закрываем окно и прокручиваем к карточке. Окно показывается один раз за сеанс и только пока сервер говорит first_story.available.
let firstStoryPromptOpen = false;
let firstStoryPromptShown = false;
function offerFirstStoryAfterFirstChild() {
    if (firstStoryPromptShown || firstStoryBusy || firstStoryResult || !userExists) return;
    if (allChildren.length !== 1) return;
    if (!(profileData && profileData.first_story && profileData.first_story.available)) return;
    openFirstStoryPrompt();
}
function openFirstStoryPrompt() {
    const sheet = el('firstStoryPrompt');
    if (!sheet) return;
    firstStoryPromptShown = true;
    setText('firstStoryPromptTitle', tr('first_story_prompt_title'));
    setText('firstStoryPromptText', tr('first_story_prompt_text'));
    setText('firstStoryPromptGo', tr('first_story_btn'));
    setText('firstStoryPromptLater', tr('first_story_prompt_later'));
    const close = el('firstStoryPromptClose');
    if (close) close.setAttribute('aria-label', tr('first_story_close'));
    firstStoryPromptOpen = true;
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    const panel = sheet.querySelector('.tariff-sheet__panel');
    if (panel) { panel.scrollTop = 0; try { panel.focus({ preventScroll: true }); } catch (e) { /* не страшно */ } }
}
function closeFirstStoryPrompt() {
    firstStoryPromptOpen = false;
    const sheet = el('firstStoryPrompt');
    if (sheet) sheet.hidden = true;
    if (!tariffSheetOpen && !firstStorySheetOpen) document.body.classList.remove('sheet-open');
}
// «Позже»: показываем, где лежит кнопка, — прокручиваем к карточке «Первая сказка» под профилями детей
function revealFirstStoryCard() {
    const slot = document.querySelector('[data-first-story-slot="kids"]');
    if (!slot || slot.style.display === 'none') return;
    slot.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
document.addEventListener('click', (event) => {
    const node = event.target.closest('[data-first-story-action]');
    if (!node) return;
    const action = node.getAttribute('data-first-story-action');
    if (action === 'start') startFirstStory();
    else if (action === 'pick') sendFirstStory(node.getAttribute('data-child-id'));
    else if (action === 'read') readFirstStory();
    else if (action === 'close') closeFirstStorySheet();
    else if (action === 'prompt-go') { closeFirstStoryPrompt(); startFirstStory(); }
    else if (action === 'prompt-later') { closeFirstStoryPrompt(); revealFirstStoryCard(); }
});
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (firstStoryPromptOpen) { closeFirstStoryPrompt(); revealFirstStoryCard(); }
    else if (firstStorySheetOpen) closeFirstStorySheet();
});

// =====================================================================
// НАВИГАЦИЯ
// =====================================================================
const APP_TABS = {
    home: ['tabHome', 'btnTabHome'],
    kids: ['tabKids', 'btnTabKids'],
    stories: ['tabStories', 'btnTabStories'],
    profile: ['tabProfile', 'btnTabProfile']
};
function switchAppTab(tabId) {
    const [pageId, buttonId] = APP_TABS[tabId] || APP_TABS.home;
    document.querySelectorAll('.tab-page').forEach(node => node.classList.remove('active'));
    document.querySelectorAll('.tab-item').forEach(node => node.classList.remove('active'));
    if (el(pageId)) el(pageId).classList.add('active');
    if (el(buttonId)) el(buttonId).classList.add('active');
    if (tabId === 'stories') loadUserStories();
    window.scrollTo(0, 0);
}
// Профили детей живут во вкладке «Дети»: открываем её
function showChildrenSection() {
    closeKidsForm();
    switchAppTab('kids');
}
// Новому пользователю без детей сразу открываем раздел, где их добавляют
function openChildrenIfEmpty() {
    if (!userExists || !profileData || !profileData.user || !profileData.user.profile_complete) return;
    if (!allChildren.length) showChildrenSection();
}
// =====================================================================
// СКАЗКИ И АРХИВ (закрытые сказки сервер отдаёт без текста)
// =====================================================================
async function loadUserStories() {
    if (!userExists) return;
    try {
        const data = await api('/api/app/stories');
        userStories = data.stories || [];
        renderStoriesList();
    } catch (err) {
        console.error('Ошибка загрузки сказок:', err);
    }
}
function renderStoriesList() {
    const todayContainer = el('todayStoriesList');
    const archiveContainer = el('archiveStoriesList');
    const paywall = el('paywallOverlay');
    if (!todayContainer || !archiveContainer || !paywall) return;

    const today = userStories.filter(st => st.is_today);
    const archive = userStories.filter(st => !st.is_today);

    todayContainer.innerHTML = today.length
        ? today.map(createStoryCard).join('')
        : `<p class="empty-note">${escapeHtml(tr('empty_today'))}</p>`;

    if (!archive.length) {
        archiveContainer.innerHTML = `<p class="empty-note">${escapeHtml(tr('empty_archive'))}</p>`;
        paywall.style.display = 'none';
        return;
    }
    archiveContainer.innerHTML = archive.map(createStoryCard).join('');
    paywall.style.display = archive.some(st => st.locked) ? 'flex' : 'none';
}
function createStoryCard(st) {
    const date = formatDate(st.created_at, { day: 'numeric', month: 'short' });
    const childName = st.child_name ? ` (${escapeHtml(st.child_name)})` : '';
    return `
        <div class="story-card${st.locked ? ' locked' : ''}" data-id="${escapeHtml(st.id)}" onclick="openReader(this.dataset.id)">
            <div>
                <div class="story-title">${escapeHtml(st.title)}${childName}</div>
                <div class="story-date">${escapeHtml(date)}${st.locked ? ' · ' + escapeHtml(tr('story_locked')) : ''}</div>
            </div>
            <div class="story-icon">${icon(st.locked ? 'lock' : 'tales')}</div>
        </div>`;
}
async function openReader(storyId, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const listed = userStories.find(s => String(s.id) === String(storyId));
    if (listed && listed.locked) {
        showAlert(tr('paywall_text'));
        return;
    }
    let story;
    try {
        const data = await api(`/api/app/stories/${encodeURIComponent(storyId)}`);
        story = data.story;
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
        return;
    }
    currentStory = story;
    setText('readerTitle', story.title || '');
    const image = el('readerImg');
    if (image) {
        const src = safeUrl(story.image_url);
        image.src = src;
        image.style.display = src ? 'block' : 'none';
    }
    const text = el('readerText');
    if (text) {
        text.innerHTML = readerTextHtml(story.ready_text);
    }
    const promoLink = el('readerPromoLink');
    const promoImage = el('readerPromoImg');
    if (promoLink && promoImage) {
        const link = safeUrl(story.promo_link_url);
        const img = safeUrl(story.promo_image_url);
        if (link && img) {
            promoLink.setAttribute('data-open-link', link);
            promoImage.src = img;
            promoLink.style.display = 'block';
        } else {
            promoLink.removeAttribute('data-open-link');
            promoLink.style.display = 'none';
        }
    }
    const screen = el('readerScreen');
    if (screen) {
        screen.style.display = 'flex';
        screen.scrollTop = 0;
        document.body.style.overflow = 'hidden';
    }
    try {
        if (tg && tg.BackButton) { tg.BackButton.show(); tg.BackButton.onClick(closeReader); }
    } catch (e) { /* старые клиенты */ }

    renderFeedbackBlocks(story);
    if (opts.share) openShareSheet();
    setAudioLoading();
    await loadAudioInterface();
}
function closeReader() {
    stopReaderAudio(); // иначе озвучка продолжает играть за закрытой сказкой
    closeReportSheet();
    closeShareSheet();
    exitReportMode();
    hide('readerScreen');
    document.body.style.overflow = 'auto';
    if (el('readerImg')) el('readerImg').src = '';
    if (el('readerText')) el('readerText').innerHTML = '';
    currentStory = null;
    try {
        if (tg && tg.BackButton) { tg.BackButton.offClick(closeReader); tg.BackButton.hide(); }
    } catch (e) { /* старые клиенты */ }
}
// =====================================================================
// ОШИБКИ В ТЕКСТЕ («Нашли ошибку?»)
// Кнопка в шапке читалки и под текстом. Нажали — предложения становятся нажимаемыми,
// а внизу появляется подсказка. Родитель нажимает предложение (или выделяет слова пальцем),
// видит фразу, по желанию пишет, что не так, и отправляет. Сервер проверяет, что сказка его,
// сохраняет жалобу (таблица story_error_reports) и пишет админу в бот поддержки.
// =====================================================================
// Конец предложения: знак препинания, пробел и заглавная буква (или реплика «— Заглавная»).
// «— Привет! — сказал он.» не режется: после «!» идёт тире и строчная буква.
// Без lookbehind: старые iOS его не понимают.
const SENTENCE_END = /[.!?…]+["»”)]*\s+(?=[«"„(]?[A-ZА-ЯЁЎҚҒҲ0-9]|—\s?[A-ZА-ЯЁЎҚҒҲ])/g;
function splitSentences(paragraph) {
    const parts = [];
    let start = 0;
    let match;
    SENTENCE_END.lastIndex = 0;
    while ((match = SENTENCE_END.exec(paragraph)) !== null) {
        const end = match.index + match[0].length;
        parts.push(paragraph.slice(start, end));
        start = end;
    }
    if (start < paragraph.length) parts.push(paragraph.slice(start));
    return parts;
}
function sentencesHtml(paragraph) {
    return splitSentences(paragraph).map(part => `<span class="sent">${escapeHtml(part)}</span>`).join('');
}
// Текст сказки по абзацам. Кнопка «Поделиться» встаёт и внутрь текста — после первого абзаца,
// где набралось SHARE_INLINE_AFTER знаков, если после неё остаётся ещё заметная часть сказки
// (иначе рядом и так кнопка в конце). Подпись кнопки — в data-label и рисуется CSS (::after),
// поэтому при выделении текста пальцем («Нашли ошибку?») она не попадает в выделенную фразу.
const SHARE_INLINE_AFTER = 200;
const SHARE_INLINE_MIN_REST = 300;
function shareInlineIndex(paragraphs) {
    let total = 0;
    for (let i = 0; i < paragraphs.length - 1; i++) {
        total += paragraphs[i].trim().length;
        if (total < SHARE_INLINE_AFTER) continue;
        const rest = paragraphs.slice(i + 1).reduce((sum, p) => sum + p.trim().length, 0);
        return rest >= SHARE_INLINE_MIN_REST ? i : -1;
    }
    return -1;
}
function shareInlineHtml() {
    const label = escapeHtml(tr('share_btn'));
    return `<div class="share-inline"><button type="button" class="share-btn share-btn--inline" data-share-action="open" data-label="${label}" aria-label="${label}">${icon('share')}</button></div>`;
}
function readerTextHtml(rawText) {
    const paragraphs = String(rawText || '').split('\n').filter(p => p.trim());
    const shareAfter = shareInlineIndex(paragraphs);
    return paragraphs.map((p, i) => `<p>${sentencesHtml(p)}</p>` + (i === shareAfter ? shareInlineHtml() : '')).join('');
}

const REPORT_FRAGMENT_MAX = 1000;
const reportState = { marking: false, open: false, sending: false, fragment: '', selection: '', selectionAt: 0 };

function applyReportTexts() {
    setText('readerReportBtn', tr('report_btn'));
    setIconText('readerReportEndBtn', 'edit', tr('report_end_btn'));
    setText('reportHintTitle', tr('report_hint'));
    setText('reportHintSub', tr('report_hint_sub'));
    setText('reportUseSelectionBtn', tr('report_use_selection'));
    setText('reportCancelBtn', tr('report_cancel'));
    setText('reportSheetTitle', tr('report_title'));
    setText('reportSheetSub', tr('report_sub'));
    setText('reportFragmentLabel', tr('report_fragment_label'));
    setText('reportCommentLabel', tr('report_comment_label'));
    setPlaceholder('reportComment', tr('report_comment_placeholder'));
    setText('reportOtherBtn', tr('report_other'));
    const close = el('reportSheetClose');
    if (close) close.setAttribute('aria-label', tr('report_close'));
    const send = el('reportSendBtn');
    if (send && !reportState.sending) send.innerText = tr('report_send');
}

function haptic(kind) {
    try {
        if (!tg || !tg.HapticFeedback) return;
        if (kind === 'select') tg.HapticFeedback.selectionChanged();
        else tg.HapticFeedback.notificationOccurred(kind);
    } catch (e) { /* старые клиенты */ }
}

// Выделенный пальцем текст внутри сказки (пусто — если выделения нет или оно вне текста)
function readerSelectionText() {
    const selection = window.getSelection ? window.getSelection() : null;
    const container = el('readerText');
    if (!selection || selection.isCollapsed || !selection.rangeCount || !container) return '';
    if (!container.contains(selection.getRangeAt(0).commonAncestorContainer)) return '';
    return selection.toString().replace(/\s+/g, ' ').trim();
}
function updateUseSelectionButton() {
    const button = el('reportUseSelectionBtn');
    if (button) button.hidden = !(reportState.marking && readerSelectionText().length >= 2);
}
// На телефоне нажатие на кнопку снимает выделение раньше, чем срабатывает клик, — запоминаем его заранее
document.addEventListener('selectionchange', () => {
    const text = readerSelectionText();
    if (text) { reportState.selection = text; reportState.selectionAt = Date.now(); }
    updateUseSelectionButton();
});

function clearPicked() {
    document.querySelectorAll('#readerText .sent.is-picked').forEach(node => node.classList.remove('is-picked'));
}
function enterReportMode() {
    reportState.marking = true;
    const screen = el('readerScreen');
    if (screen) screen.classList.add('is-marking');
    const hint = el('reportHint');
    if (hint) hint.hidden = false;
    updateUseSelectionButton();
    haptic('select');
}
function exitReportMode() {
    reportState.marking = false;
    const screen = el('readerScreen');
    if (screen) screen.classList.remove('is-marking');
    const hint = el('reportHint');
    if (hint) hint.hidden = true;
    clearPicked();
}
function startErrorReport() {
    if (!currentStory) return;
    // Родитель уже выделил слова и нажал кнопку — сразу к отправке
    const selected = readerSelectionText() || (Date.now() - reportState.selectionAt < 5000 ? reportState.selection : '');
    if (selected.length >= 2) { openReportSheet(selected); return; }
    enterReportMode();
}
function openReportSheet(fragment) {
    if (fragment.length > REPORT_FRAGMENT_MAX) { showAlert(tr('report_too_long')); return; }
    reportState.fragment = fragment;
    reportState.selection = '';
    reportState.selectionAt = 0;
    const hint = el('reportHint');
    if (hint) hint.hidden = true;
    setText('reportFragment', fragment);
    const comment = el('reportComment');
    if (comment) comment.value = '';
    const send = el('reportSendBtn');
    if (send) { send.disabled = false; send.innerText = tr('report_send'); }
    const sheet = el('reportSheet');
    if (!sheet) return;
    sheet.hidden = false;
    reportState.open = true;
    document.body.classList.add('sheet-open');
    try { window.getSelection().removeAllRanges(); } catch (e) { /* не страшно */ }
}
function closeReportSheet() {
    const sheet = el('reportSheet');
    if (sheet) sheet.hidden = true;
    reportState.open = false;
    document.body.classList.remove('sheet-open');
}
async function sendErrorReport() {
    if (!currentStory || !reportState.fragment || reportState.sending) return;
    const send = el('reportSendBtn');
    reportState.sending = true;
    if (send) { send.disabled = true; send.innerText = tr('report_sending'); }
    try {
        await api(`/api/app/stories/${encodeURIComponent(currentStory.id)}/error-report`, {
            method: 'POST',
            body: { fragment: reportState.fragment, comment: (el('reportComment') || {}).value || '', language: currentLang }
        });
        closeReportSheet();
        exitReportMode();
        haptic('success');
        showAlert(tr('report_thanks'));
    } catch (err) {
        console.error('Ошибка отправки сообщения об ошибке:', err);
        haptic('error');
        showAlert(err.message || tr('error_generic'));
    } finally {
        reportState.sending = false;
        if (send && send.isConnected) { send.disabled = false; send.innerText = tr('report_send'); }
    }
}
document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-report-action]');
    if (action) {
        const name = action.getAttribute('data-report-action');
        if (name === 'start') startErrorReport();
        else if (name === 'cancel') exitReportMode();
        else if (name === 'use-selection') { const text = readerSelectionText() || reportState.selection; if (text) openReportSheet(text); }
        else if (name === 'close') { closeReportSheet(); exitReportMode(); }
        else if (name === 'other') { closeReportSheet(); clearPicked(); enterReportMode(); }
        else if (name === 'send') sendErrorReport();
        return;
    }
    // В режиме выбора нажатие на предложение отмечает его
    if (!reportState.marking || reportState.open) return;
    const sentence = event.target.closest('#readerText .sent');
    if (!sentence) return;
    if (readerSelectionText()) return; // родитель выделяет слова — не мешаем
    clearPicked();
    sentence.classList.add('is-picked');
    haptic('select');
    const fragment = sentence.textContent.replace(/\s+/g, ' ').trim();
    if (fragment.length >= 2) openReportSheet(fragment);
});
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (reportState.open) { closeReportSheet(); exitReportMode(); } else if (reportState.marking) exitReportMode();
});

// =====================================================================
// ПОДЕЛИТЬСЯ СКАЗКОЙ
// Кнопка под текстом сказки открывает окно с двумя вариантами:
//   • «Отправить в Telegram» — стандартное окно Telegram «выбрать чат» с карточкой сказки
//     (WebApp.shareMessage, Telegram 8.0+); в старых версиях — t.me/share/url со ссылкой;
//   • «Поделиться ссылкой» — системное «Поделиться» телефона (WhatsApp, Instagram…) или копирование.
// Ссылку и карточку сервер готовит, когда окно открывается: тогда нажатие сразу вызывает
// shareMessage / navigator.share — иначе телефон может не разрешить окно после ожидания сети.
// Ссылка ведёт на страницу сказки scheherezade.uz/s/<код>; «Перестать делиться» отключает её.
// =====================================================================
const shareState = { open: false, loading: false, data: null, storyId: null, wasShared: false };

function canNativeShare() {
    try { return !!(navigator.share && (!navigator.canShare || navigator.canShare({ url: 'https://scheherezade.uz/' }))); } catch (e) { return false; }
}
function canTelegramCard() {
    try { return !!(tg && typeof tg.shareMessage === 'function' && (!tg.isVersionAtLeast || tg.isVersionAtLeast('8.0'))); } catch (e) { return false; }
}
function applyShareTexts() {
    setIconText('readerShareBtn', 'share', tr('share_btn'));
    document.querySelectorAll('.share-btn--inline').forEach((button) => {
        button.setAttribute('data-label', tr('share_btn'));
        button.setAttribute('aria-label', tr('share_btn'));
    });
    setText('shareSheetTitle', tr('share_title'));
    setText('shareNote', tr('share_note'));
    setText('shareStopBtn', tr('share_stop'));
    const close = el('shareSheetClose');
    if (close) close.setAttribute('aria-label', tr('report_close'));
    updateShareButtons();
}
function updateShareButtons() {
    const telegram = el('shareTelegramBtn');
    const link = el('shareLinkBtn');
    const ready = !!shareState.data && !shareState.loading;
    if (telegram) { telegram.innerHTML = shareState.loading ? escapeHtml(tr('share_loading')) : iconText('send', tr('share_telegram')); telegram.disabled = !ready; }
    if (link) { link.innerHTML = iconText('link', canNativeShare() ? tr('share_link') : tr('share_copy')); link.disabled = !ready; }
    const stop = el('shareStopBtn');
    if (stop) stop.hidden = !shareState.wasShared;
}
async function openShareSheet() {
    if (!currentStory) return;
    const sheet = el('shareSheet');
    if (!sheet) return;
    const storyId = currentStory.id;
    shareState.open = true;
    shareState.storyId = storyId;
    shareState.wasShared = !!currentStory.shared;
    shareState.data = null;
    shareState.loading = true;
    setText('shareSheetSub', tr('share_sub', { name: currentStory.child_name || '' }));
    updateShareButtons();
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    haptic('select');
    try {
        const data = await api(`/api/app/stories/${encodeURIComponent(storyId)}/share`, { method: 'POST', body: {} });
        if (!shareState.open || shareState.storyId !== storyId) return; // окно уже закрыли
        shareState.data = data;
    } catch (err) {
        console.error('Поделиться сказкой: ссылка не получена:', err);
        closeShareSheet();
        showAlert(err.message || tr('error_generic'));
        return;
    } finally {
        if (shareState.storyId === storyId) { shareState.loading = false; updateShareButtons(); }
    }
}
function closeShareSheet() {
    const sheet = el('shareSheet');
    if (sheet) sheet.hidden = true;
    if (shareState.open) document.body.classList.remove('sheet-open');
    shareState.open = false;
    shareState.data = null;
    shareState.loading = false;
}
function markShared() {
    if (currentStory && String(currentStory.id) === String(shareState.storyId)) currentStory.shared = true;
}
// «Отправили»: сообщаем серверу, что сказкой поделились (счётчик «Поделились» в админке).
// Фоном: если не дошло — родителю это не мешает.
function reportShareSent(storyId, channel) {
    if (!storyId) return;
    api(`/api/app/stories/${encodeURIComponent(storyId)}/share/sent`, { method: 'POST', body: { channel } })
        .catch((err) => console.warn('Поделиться сказкой: отметка «отправили» не записана:', err));
}
function shareViaTelegramLink(data) {
    const link = 'https://t.me/share/url?url=' + encodeURIComponent(data.url_telegram) + '&text=' + encodeURIComponent(data.share_text || '');
    try {
        if (tg && tg.openTelegramLink) { tg.openTelegramLink(link); return; }
    } catch (e) { /* ниже — обычное окно */ }
    window.open(link, '_blank');
}
function shareToTelegram() {
    const data = shareState.data;
    if (!data) return;
    const storyId = shareState.storyId;
    markShared();
    if (data.prepared_message_id && canTelegramCard()) {
        try {
            tg.shareMessage(data.prepared_message_id, (sent) => {
                if (sent) { haptic('success'); reportShareSent(storyId, 'telegram'); closeShareSheet(); }
            });
            return;
        } catch (err) {
            console.warn('shareMessage недоступен, делимся ссылкой:', err);
        }
    }
    // Старый Telegram: открываем выбор чата; дошло ли сообщение, он не сообщает — считаем отправкой
    shareViaTelegramLink(data);
    reportShareSent(storyId, 'telegram');
    closeShareSheet();
}
function copyText(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    } catch (e) { /* ниже — запасной способ */ }
    return Promise.resolve(legacyCopy(text));
}
function legacyCopy(text) {
    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    } catch (e) {
        return false;
    }
}
function shareAsLink() {
    const data = shareState.data;
    if (!data) return;
    const storyId = shareState.storyId;
    markShared();
    if (canNativeShare()) {
        // navigator.share вызываем сразу по нажатию: ссылка уже готова
        navigator.share({ title: (currentStory && currentStory.title) || '', text: data.share_text || '', url: data.url_link })
            .then(() => { haptic('success'); reportShareSent(storyId, 'link'); closeShareSheet(); })
            .catch((err) => { if (!err || err.name !== 'AbortError') copyAndTell(data.url_link, storyId); });
        return;
    }
    copyAndTell(data.url_link, storyId);
}
function copyAndTell(url, storyId) {
    copyText(url).then((ok) => {
        if (ok) reportShareSent(storyId, 'copy');
        closeShareSheet();
        showAlert(ok ? tr('share_copied') : tr('share_copy_manual') + '\n' + url);
    });
}
async function stopSharing() {
    if (!currentStory) return;
    if (!(await showConfirm(tr('share_stop_confirm')))) return;
    try {
        await api(`/api/app/stories/${encodeURIComponent(currentStory.id)}/share`, { method: 'DELETE' });
        currentStory.shared = false;
        closeShareSheet();
        showAlert(tr('share_stopped'));
    } catch (err) {
        console.error('Не удалось отключить ссылку:', err);
        showAlert(err.message || tr('error_generic'));
    }
}
document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-share-action]');
    if (!action) return;
    const name = action.getAttribute('data-share-action');
    if (name === 'open') openShareSheet();
    else if (name === 'close') closeShareSheet();
    else if (name === 'telegram') shareToTelegram();
    else if (name === 'link') shareAsLink();
    else if (name === 'stop') stopSharing();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shareState.open) closeShareSheet();
});

// =====================================================================
// СЛУЖБА ПОДДЕРЖКИ: кнопка в читалке открывает чат с ботом поддержки
// =====================================================================
function openSupport() {
    try {
        if (tg && tg.openTelegramLink) { tg.openTelegramLink(SUPPORT_BOT_URL); return; }
    } catch (e) { /* ниже — обычная ссылка */ }
    window.open(SUPPORT_BOT_URL, '_blank');
}
document.addEventListener('click', (event) => {
    if (event.target.closest('[data-support-action="open"]')) openSupport();
});

// =====================================================================
// ОТЗЫВЫ
// =====================================================================
function renderFeedbackBlocks(story) {
    show('rating-block');
    show('comment-block');

    const stars = el('stars-container');
    const ratingThanks = el('rating-thanks');
    if (story.rating) {
        if (stars) stars.style.display = 'none';
        if (ratingThanks) {
            ratingThanks.style.display = 'block';
            ratingThanks.innerHTML = `${escapeHtml(tr('feedback_your_rating'))} <span class="rating-thanks__stars">${icon('star-fill', 'ic--gold').repeat(Math.min(5, Number(story.rating) || 0))}</span>`;
        }
    } else {
        if (stars) stars.style.display = 'flex';
        if (ratingThanks) ratingThanks.style.display = 'none';
        document.querySelectorAll('#stars-container span').forEach(s => s.classList.remove('active'));
    }
    const input = el('story-comment');
    const button = el('submit-comment-btn');
    const commentThanks = el('comment-thanks');
    if (story.user_comment) {
        if (input) input.style.display = 'none';
        if (button) button.style.display = 'none';
        if (commentThanks) {
            commentThanks.style.display = 'block';
            commentThanks.innerHTML = `<span class="feedback-own">${escapeHtml(tr('feedback_your_comment'))} «${escapeHtml(story.user_comment)}»</span>`;
        }
    } else {
        if (input) { input.style.display = 'block'; input.value = ''; }
        if (button) { button.style.display = 'block'; button.disabled = false; button.innerText = tr('feedback_send'); }
        if (commentThanks) commentThanks.style.display = 'none';
    }
}
function rememberFeedback(storyId, patch) {
    [currentStory, userStories.find(s => String(s.id) === String(storyId))].forEach(st => {
        if (st && String(st.id) === String(storyId)) Object.assign(st, patch);
    });
}
async function sendFeedbackData(rating, comment) {
    if (!currentStory) return false;
    try {
        await api('/api/save-feedback', {
            method: 'POST',
            body: { story_id: currentStory.id, rating, comment }
        });
        return true;
    } catch (err) {
        console.error('Ошибка отправки отзыва:', err);
        showAlert(err.message || tr('error_generic'));
        return false;
    }
}
document.addEventListener('click', async (event) => {
    const star = event.target.closest('#stars-container span');
    if (!star || !currentStory || currentStory.rating) return;

    const rating = Number(star.getAttribute('data-value'));
    document.querySelectorAll('#stars-container span').forEach(s =>
        s.classList.toggle('active', Number(s.getAttribute('data-value')) <= rating));

    const storyId = currentStory.id;
    rememberFeedback(storyId, { rating });
    const ok = await sendFeedbackData(rating, null);
    if (!ok) {
        rememberFeedback(storyId, { rating: null });
        document.querySelectorAll('#stars-container span').forEach(s => s.classList.remove('active'));
        return;
    }
    if (currentStory && String(currentStory.id) === String(storyId)) renderFeedbackBlocks(currentStory);
});

window.sendComment = async function () {
    const input = el('story-comment');
    if (!input || !currentStory) return;

    const comment = input.value.trim();
    if (!comment) return showAlert(tr('feedback_empty'));

    const button = el('submit-comment-btn');
    if (button) { button.disabled = true; button.innerText = tr('feedback_sending'); }

    const storyId = currentStory.id;
    const ok = await sendFeedbackData(null, comment);
    if (!ok) {
        if (button) { button.disabled = false; button.innerText = tr('feedback_send'); }
        return;
    }
    rememberFeedback(storyId, { user_comment: comment });
    if (currentStory && String(currentStory.id) === String(storyId)) renderFeedbackBlocks(currentStory);
};
// =====================================================================
// ЯНДЕКС АЛИСА
// =====================================================================
function openAliceModal() {
    const input = el('aliceCodeInput');
    if (input) input.value = '';
    show('aliceModal', 'flex');
}
function closeAliceModal() {
    hide('aliceModal');
}
window.updateAliceUI = updateAliceUI;
function updateAliceUI(connected) {
    if (connected) { hide('alice-disconnected-state'); show('alice-connected-state'); }
    else { show('alice-disconnected-state'); hide('alice-connected-state'); }
}
async function submitAliceCode() {
    const input = el('aliceCodeInput');
    const code = (input ? input.value : '').replace(/\D/g, '');
    if (code.length !== 4) return showAlert(tr('alice_enter_4_digits'));

    const button = el('aliceSubmitBtn');
    if (button) { button.disabled = true; button.innerText = '...'; }

    try {
        await api('/api/bind-alice', { method: 'POST', body: { code } });
        closeAliceModal();
        updateAliceUI(true);
        if (profileData && profileData.user) profileData.user.alice_connected = true;
        showAlert('🎉 ' + tr('aliceAlertSuccess'));
    } catch (err) {
        showAlert('❌ ' + (err.message || tr('error_generic')));
    } finally {
        if (button) { button.disabled = false; button.innerText = tr('aliceSubmitBtn'); }
    }
}
// =====================================================================
// ОЗВУЧКА СКАЗКИ (аудиоспектакль)
// Баланс и цену отдаёт сервер, пользователь определяется по подписи initData.
// Оплата — через Payme (та же ссылка, что и у подписки, но на сумму одной озвучки).
// Внешний вид — в style.css (блок «ОЗВУЧКА СКАЗКИ»).
// =====================================================================
let voiceoversLeft = 0;
let voiceoverAmount = 0;              // цена одной озвучки в тийинах (приходит с сервера)
let awaitingVoiceoverPayment = null;  // { balanceBefore } — пока пользователь платит в Payme
let audioPlaybackRate = 1;            // скорость плеера помним, пока открыто приложение

const AUDIO_RATES = [1, 1.25, 1.5, 0.75];
const AUDIO_SKIP_SECONDS = 15;
const AUDIO_ICONS = {
    play: '<svg class="audio-icon audio-icon--play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z"/></svg>',
    pause: '<svg class="audio-icon audio-icon--pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3"/></svg>',
    back: '<svg class="audio-icon audio-icon--skip" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></g><text x="12" y="15.2" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor">15</text></svg>',
    forward: '<svg class="audio-icon audio-icon--skip" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></g><text x="12" y="15.2" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor">15</text></svg>'
};

async function refreshVoiceoverBalance() {
    try {
        const data = await api('/api/user/check-balance', { method: 'POST', body: {} });
        voiceoversLeft = Number(data.voiceovers_left || 0);
        if (data.voiceover_amount) voiceoverAmount = Number(data.voiceover_amount);
        return true;
    } catch (err) {
        console.error('Не удалось получить баланс озвучек', err);
        return false;
    }
}

function isCurrentStory(storyId) {
    return !!currentStory && String(currentStory.id) === String(storyId);
}

function audioContainer() {
    return el('audio-dynamic-content');
}

function formatAudioTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function formatAudioRate(rate) {
    return rate + '×';
}

function setAudioLoading() {
    const container = audioContainer();
    if (!container) return;
    container.innerHTML = `
        <div class="audio-card audio-card--loading" role="status">
            <span class="audio-spinner" aria-hidden="true"></span>
            <span class="audio-card__desc">${escapeHtml(tr('audio_loading'))}</span>
        </div>
    `;
}

// Загружает статус озвучки текущей сказки: готовое аудио, кнопка «Озвучить» или кнопка оплаты
async function loadAudioInterface() {
    const story = currentStory;
    if (!story) return;

    // Озвучка уже в очереди или создаётся — показываем это и ждём, вместо кнопки «Озвучить»
    const vo = story.voiceover;
    if (!story.audio_url && vo && (vo.status === 'queued' || vo.status === 'processing')) {
        renderAudioQueued(story.id);
        startVoiceoverPolling(story.id);
        return;
    }
    // У готовой озвучки баланс не нужен — лишний запрос не делаем
    if (!story.audio_url) {
        const ok = await refreshVoiceoverBalance();
        if (!isCurrentStory(story.id)) return; // пока ждали, закрыли или открыли другую сказку
        if (!ok) { renderAudioLoadError(story.id); return; }
    }
    updateAudioInterface(story.id, story.audio_url, voiceoversLeft);
}

// =====================================================================
// ОЧЕРЕДЬ ОЗВУЧЕК: «Озвучить» ставит сказку в очередь, сервер отвечает сразу.
// Пока сказка открыта, раз в 5 секунд спрашиваем статус; готово — показываем плеер.
// Можно закрыть приложение: когда озвучка будет готова, бот пришлёт сообщение.
// =====================================================================
const VOICEOVER_POLL_MS = 5000;
let voiceoverPoll = null; // { storyId, timer }

function renderAudioQueued(storyId) {
    const container = audioContainer();
    if (!container) return;
    // Одна карточка и для «в очереди», и для «озвучивается»: место в очереди и время ожидания не показываем
    container.innerHTML = `
        <div class="audio-card audio-card--loading" role="status" data-story-id="${escapeHtml(storyId)}">
            ${audioHeader(icon('hourglass'), tr('audio_processing_title'), tr('audio_queued_desc'))}
            <span class="audio-spinner" aria-hidden="true"></span>
        </div>
    `;
}

function stopVoiceoverPolling() {
    if (voiceoverPoll) clearTimeout(voiceoverPoll.timer);
    voiceoverPoll = null;
}

function startVoiceoverPolling(storyId) {
    stopVoiceoverPolling();
    const poll = { storyId: String(storyId), timer: null };
    voiceoverPoll = poll;
    const step = async () => {
        if (voiceoverPoll !== poll || !isCurrentStory(storyId)) return;
        try {
            const data = await api(`/api/user/voiceover-status?story_id=${encodeURIComponent(storyId)}`);
            if (voiceoverPoll !== poll || !isCurrentStory(storyId)) return;
            if (data.voiceoversLeft !== undefined) voiceoversLeft = Number(data.voiceoversLeft) || 0;
            if (data.status === 'done' && data.audioUrl) {
                stopVoiceoverPolling();
                rememberFeedback(storyId, { audio_url: data.audioUrl, voiceover: { status: 'done' } });
                updateAudioInterface(storyId, data.audioUrl, voiceoversLeft);
                return;
            }
            if (data.status === 'failed' || data.status === 'none') {
                stopVoiceoverPolling();
                rememberFeedback(storyId, { voiceover: { status: data.status } });
                if (data.status === 'failed') showAlert(tr('audio_error'));
                updateAudioInterface(storyId, null, voiceoversLeft);
                return;
            }
            renderAudioQueued(storyId);
        } catch (err) {
            console.error('Не удалось узнать статус озвучки', err); // попробуем ещё раз
        }
        if (voiceoverPoll === poll) poll.timer = setTimeout(step, VOICEOVER_POLL_MS);
    };
    poll.timer = setTimeout(step, VOICEOVER_POLL_MS);
}

function renderAudioLoadError(storyId) {
    const container = audioContainer();
    if (!container) return;
    container.innerHTML = `
        <div class="audio-card audio-card--error">
            ${audioHeader(icon('warning'), tr('audio_load_error'))}
            <button class="audio-btn audio-btn--ghost" type="button" data-audio-action="retry" data-story-id="${escapeHtml(storyId)}">
                <span>${escapeHtml(tr('audio_retry'))}</span>
            </button>
        </div>
    `;
}

// Верхняя строка карточки: значок, заголовок, пояснение и (необязательно) плашка справа
function audioHeader(icon, title, desc, chip) {
    return `
        <div class="audio-card__header">
            <span class="audio-card__icon" aria-hidden="true">${icon}</span>
            <div class="audio-card__text">
                <div class="audio-card__title">${escapeHtml(title)}</div>
                ${desc ? `<div class="audio-card__desc">${escapeHtml(desc)}</div>` : ''}
            </div>
            ${chip ? `<span class="audio-card__chip">${escapeHtml(chip)}</span>` : ''}
        </div>
    `;
}

function audioPlayerMarkup(url, storyId) {
    const label = (key) => escapeHtml(tr(key));
    return `
        <div class="audio-player" data-audio-player data-story-id="${escapeHtml(storyId || '')}">
            <audio preload="metadata" src="${escapeHtml(url)}"></audio>
            <div class="audio-player__seek">
                <input class="audio-player__range" type="range" min="0" max="1000" step="1" value="0" data-player-seek aria-label="${label('audio_seek')}">
                <div class="audio-player__times">
                    <span data-player-current>0:00</span>
                    <button class="audio-player__speed" type="button" data-player-action="speed" aria-label="${label('audio_speed')}">${formatAudioRate(audioPlaybackRate)}</button>
                    <span data-player-duration>–:––</span>
                </div>
            </div>
            <div class="audio-player__controls">
                <button class="audio-player__skip" type="button" data-player-action="back" aria-label="${label('audio_back')}">${AUDIO_ICONS.back}</button>
                <button class="audio-player__play" type="button" data-player-action="toggle" aria-label="${label('audio_play')}">${AUDIO_ICONS.play}${AUDIO_ICONS.pause}</button>
                <button class="audio-player__skip" type="button" data-player-action="forward" aria-label="${label('audio_forward')}">${AUDIO_ICONS.forward}</button>
            </div>
            <p class="audio-player__error" role="alert">${label('audio_load_failed')}</p>
        </div>
    `;
}

// Подключает к нарисованному плееру настоящий <audio>: время, перемотка, состояние кнопки
function bindAudioPlayer(root) {
    const player = root.querySelector('[data-audio-player]');
    if (!player) return;
    const audio = player.querySelector('audio');
    const seek = player.querySelector('[data-player-seek]');
    const current = player.querySelector('[data-player-current]');
    const duration = player.querySelector('[data-player-duration]');
    const playButton = player.querySelector('[data-player-action="toggle"]');
    // Первый запуск этой сказки в плеере — событие аналитики (сервер оставляет одно на человека, сказку и день)
    const analyticsStoryId = player.getAttribute('data-story-id');
    let playCounted = false;
    audio.addEventListener('play', () => {
        if (playCounted || !analyticsStoryId) return;
        playCounted = true;
        trackAppEvent({ event_name: 'audio_played', story_id: analyticsStoryId });
    });
    if (!audio || !seek || !current || !duration || !playButton) return;

    let scrubbing = false; // пользователь тянет ползунок — не двигаем его сами
    audio.defaultPlaybackRate = audioPlaybackRate;
    audio.playbackRate = audioPlaybackRate;

    const hasDuration = () => Number.isFinite(audio.duration) && audio.duration > 0;
    const paint = () => {
        if (!scrubbing) seek.value = hasDuration() ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
        seek.style.setProperty('--progress', (seek.value / 10) + '%');
        current.textContent = formatAudioTime(scrubbing && hasDuration() ? seek.value / 1000 * audio.duration : audio.currentTime);
        duration.textContent = hasDuration() ? formatAudioTime(audio.duration) : '–:––';
    };
    const setPlaying = (playing) => {
        player.classList.toggle('is-playing', playing);
        playButton.setAttribute('aria-label', tr(playing ? 'audio_pause' : 'audio_play'));
    };

    ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked'].forEach(name => audio.addEventListener(name, paint));
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => { setPlaying(false); audio.currentTime = 0; paint(); });
    audio.addEventListener('waiting', () => player.classList.add('is-buffering'));
    ['playing', 'canplay'].forEach(name => audio.addEventListener(name, () => player.classList.remove('is-buffering')));
    // Озвучка открывается по временной ссылке (сервер выдаёт её на 6 часов). Если ссылка устарела
    // (приложение долго было открыто), один раз берём у сервера свежую и продолжаем с того же места;
    // не вышло — показываем ошибку, как раньше.
    let refreshed = false;
    audio.addEventListener('canplay', () => { refreshed = false; });
    audio.addEventListener('error', async () => {
        const storyId = player.getAttribute('data-story-id');
        if (!refreshed && storyId) {
            refreshed = true;
            const wasPlaying = player.classList.contains('is-playing');
            const resumeAt = audio.currentTime || 0;
            player.classList.add('is-buffering');
            try {
                const data = await api(`/api/user/voiceover-status?story_id=${encodeURIComponent(storyId)}`);
                const fresh = data && data.status === 'done' ? safeUrl(data.audioUrl) : '';
                if (fresh && player.isConnected) {
                    rememberFeedback(storyId, { audio_url: fresh });
                    player.classList.remove('is-error');
                    audio.src = fresh;
                    if (resumeAt > 0) {
                        audio.addEventListener('loadedmetadata', () => {
                            try { audio.currentTime = resumeAt; } catch (e) { /* перемотка недоступна */ }
                        }, { once: true });
                    }
                    audio.load();
                    if (wasPlaying) {
                        const started = audio.play();
                        if (started && started.catch) started.catch(err => console.error('Не удалось запустить аудио', err));
                    }
                    return;
                }
            } catch (err) {
                console.error('Не удалось обновить ссылку на озвучку', err);
            }
        }
        player.classList.remove('is-buffering');
        player.classList.add('is-error');
        setPlaying(false);
    });

    seek.addEventListener('input', () => { scrubbing = true; paint(); });
    seek.addEventListener('change', () => {
        if (hasDuration()) audio.currentTime = seek.value / 1000 * audio.duration;
        scrubbing = false;
        paint();
    });
    paint();
}

// Кнопки плеера: пауза/пуск, ±15 секунд, скорость
function handlePlayerAction(button) {
    const player = button.closest('[data-audio-player]');
    const audio = player && player.querySelector('audio');
    if (!audio) return;

    const action = button.getAttribute('data-player-action');
    if (action === 'toggle') {
        if (audio.paused) {
            const started = audio.play();
            if (started && started.catch) started.catch(err => console.error('Не удалось запустить аудио', err));
        } else {
            audio.pause();
        }
    } else if (action === 'back') {
        audio.currentTime = Math.max(0, audio.currentTime - AUDIO_SKIP_SECONDS);
    } else if (action === 'forward') {
        const end = Number.isFinite(audio.duration) ? audio.duration : Infinity;
        audio.currentTime = Math.min(end, audio.currentTime + AUDIO_SKIP_SECONDS);
    } else if (action === 'speed') {
        audioPlaybackRate = AUDIO_RATES[(AUDIO_RATES.indexOf(audioPlaybackRate) + 1) % AUDIO_RATES.length];
        audio.defaultPlaybackRate = audioPlaybackRate;
        audio.playbackRate = audioPlaybackRate;
        button.textContent = formatAudioRate(audioPlaybackRate);
    }
}

function updateAudioInterface(storyId, audioUrl, left) {
    const container = audioContainer();
    if (!container) return;
    const id = escapeHtml(storyId);

    const url = safeUrl(audioUrl);
    if (url) {
        container.innerHTML = `
            <div class="audio-card audio-card--ready">
                ${audioHeader(icon('headphones'), tr('audio_ready'), tr('audio_ready_desc'))}
                ${audioPlayerMarkup(url, storyId)}
            </div>
        `;
        bindAudioPlayer(container);
        return;
    }

    if (left > 0) {
        container.innerHTML = `
            <div class="audio-card audio-card--free">
                ${audioHeader(icon('mic'), tr('audio_gen_title'), tr('audio_gen_desc'), tr('audio_left_chip', { left }))}
                <button id="btn-gen-audio" class="audio-btn audio-btn--primary" type="button" data-audio-action="generate" data-story-id="${id}">
                    <span class="audio-btn__icon">${icon('mic')}</span>
                    <span>${escapeHtml(tr('audio_gen_btn'))}</span>
                </button>
            </div>
        `;
        return;
    }

    const buyLabel = voiceoverAmount
        ? tr('audio_buy_btn', { price: formatPrice(voiceoverAmount) })
        : tr('audio_buy_btn_plain');
    // Тариф без включённых озвучек (сейчас таких нет: с 11.11.2026 в «Старте» 1 озвучка в месяц) — это не «закончились», а «оплатите одну»
    const tariffInfo = profileData && profileData.tariffs;
    const currentPlan = tariffInfo && Array.isArray(tariffInfo.items) ? tariffInfo.items.find((t) => t.id === tariffInfo.current) : null;
    const startPlan = !!(currentPlan && Number(currentPlan.voiceovers) === 0);
    container.innerHTML = `
        <div class="audio-card audio-card--paid">
            ${startPlan
                ? audioHeader(icon('mic'), tr('audio_pay_title'), tr('audio_pay_desc'))
                : audioHeader(icon('lock'), tr('audio_limit_title'), tr('audio_limit_desc'))}
            <button id="btn-buy-audio" class="audio-btn audio-btn--secondary" type="button" data-audio-action="buy" data-story-id="${id}">
                <span class="audio-btn__icon">${icon('card')}</span>
                <span>${escapeHtml(buyLabel)}</span>
            </button>
        </div>
    `;
}

async function requestAudioGeneration(storyId) {
    const btn = el('btn-gen-audio');
    if (!btn || btn.disabled) return;

    btn.innerHTML = `<span class="audio-btn__icon">${icon('hourglass')}</span><span>${escapeHtml(tr('audio_gen_progress'))}</span>`;
    btn.disabled = true;
    btn.classList.add('is-loading');

    try {
        // async: сервер ставит озвучку в очередь и отвечает сразу (старый вариант ждал ~70 секунд)
        const data = await api('/api/user/generate-audio', { method: 'POST', body: { plod_id: storyId, async: true } });
        if (data.voiceoversLeft !== undefined) voiceoversLeft = Number(data.voiceoversLeft) || 0;
        if (data.audioUrl) {
            rememberFeedback(storyId, { audio_url: data.audioUrl, voiceover: { status: 'done' } });
            if (isCurrentStory(storyId)) updateAudioInterface(storyId, data.audioUrl, voiceoversLeft);
            return;
        }
        rememberFeedback(storyId, { voiceover: { status: data.status || 'queued' } });
        if (isCurrentStory(storyId)) {
            renderAudioQueued(storyId);
            startVoiceoverPolling(storyId);
        }
    } catch (err) {
        console.error(err);
        if (err.code === 'NO_VOICEOVERS') {
            // Баланс на сервере меньше, чем показывал экран — показываем кнопку оплаты
            voiceoversLeft = 0;
            if (isCurrentStory(storyId)) updateAudioInterface(storyId, null, 0);
            return;
        }
        showAlert(err.message || tr('audio_error'));
        if (btn.isConnected) {
            btn.innerHTML = `<span class="audio-btn__icon">${icon('mic')}</span><span>${escapeHtml(tr('audio_gen_retry'))}</span>`;
            btn.disabled = false;
            btn.classList.remove('is-loading');
        }
    }
}

// Оплата одной озвучки: ссылку на Payme собирает сервер. Когда пользователь вернётся
// из Payme, checkVoiceoverPayment() увидит новый баланс (см. subscribeReturnFromPayment).
async function buyAudioGeneration(storyId) {
    const btn = el('btn-buy-audio');
    if (btn) {
        if (btn.disabled) return;
        btn.dataset.label = btn.innerHTML;
        btn.innerHTML = `<span class="audio-btn__icon">${icon('hourglass')}</span><span>${escapeHtml(tr('audio_pay_opening'))}</span>`;
        btn.disabled = true;
    }

    try {
        const data = await api('/api/user/voiceover-payment-link', { method: 'POST', body: { language: currentLang } });
        awaitingVoiceoverPayment = { balanceBefore: voiceoversLeft };
        openLink(data.url);
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
    } finally {
        if (btn && btn.isConnected) {
            btn.innerHTML = btn.dataset.label || btn.innerHTML;
            btn.disabled = false;
        }
    }
}

async function checkVoiceoverPayment(retryOnce) {
    const pending = awaitingVoiceoverPayment;
    if (!pending) return;

    const ok = await refreshVoiceoverBalance();
    if (ok && voiceoversLeft > pending.balanceBefore) {
        awaitingVoiceoverPayment = null;
        if (currentStory) updateAudioInterface(currentStory.id, currentStory.audio_url, voiceoversLeft);
        showAlert(tr('audio_pay_success'));
    } else if (retryOnce) {
        // Payme мог ещё не прислать подтверждение — проверим ещё раз через несколько секунд
        setTimeout(() => checkVoiceoverPayment(false), 5000);
    }
}

// Кнопки озвучки и плеера рисуются из JS, поэтому слушаем клики на уровне документа (без onclick в разметке)
document.addEventListener('click', (event) => {
    const playerButton = event.target.closest('[data-player-action]');
    if (playerButton) { handlePlayerAction(playerButton); return; }

    const button = event.target.closest('[data-audio-action]');
    if (!button) return;
    const storyId = button.getAttribute('data-story-id');
    const action = button.getAttribute('data-audio-action');
    if (action === 'generate') requestAudioGeneration(storyId);
    else if (action === 'buy') buyAudioGeneration(storyId);
    else if (action === 'retry') { setAudioLoading(); loadAudioInterface(); }
});

function stopReaderAudio() {
    stopVoiceoverPolling();
    const container = audioContainer();
    const player = container ? container.querySelector('audio') : null;
    if (player) { try { player.pause(); } catch (e) { /* ничего страшного */ } }
    if (container) container.innerHTML = '';
}
// =====================
// ======= СТАРТ =======
// =====================
boot();
