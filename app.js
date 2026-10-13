// =====================================================================
// СКАЗКИ ШЕХЕРЕЗАДЫ — MINI APP
// Все данные идут через наш сервер (API_BASE) с подписью Telegram initData.
// Напрямую в Supabase мини-апп больше не ходит: так никто не сможет
// выдать себе подписку или прочитать чужие данные.
// =====================================================================
const API_BASE = 'https://scheherazade-yr42.onrender.com';
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
let selectedGender = 'M';
let editingChildId = null;
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
// Перевод с подстановкой: tr('btn_renew_trial', { price: '34 900 сум' })
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
        return new Date(iso).toLocaleDateString(localeTag(), options || { day: 'numeric', month: 'long', year: 'numeric' });
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
// Ссылки из настроек (политика, оферта, баннер) — через data-атрибуты, без JS в разметке
document.addEventListener('click', (event) => {
    const configLink = event.target.closest('[data-config-link]');
    if (configLink) {
        event.preventDefault();
        openLink(configUrls[configLink.getAttribute('data-config-link')]);
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
    }
}
const ERROR_TEXT_KEYS = {
    NO_INIT_DATA: 'error_session',
    CHILDREN_LIMIT: 'alert_children_limit',
    CHILD_NAME_REQUIRED: 'alert_enter_child_name',
    PARENT_NAME_REQUIRED: 'alert_enter_parent_name',
    PARENT_ROLE_AGE: 'alert_parent_role_age',
    TERMS_REQUIRED: 'alert_accept_terms',
    LOCKED: 'paywall_text',
    ALICE_CODE_NOT_FOUND: 'alice_code_not_found',
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
        throw new ApiError(message, response.status, code);
    }

    return data || {};
}
// ====================================================================
// ЭКРАНЫ: загрузка / «откройте в Telegram» / ошибка / анкета / приложение
// =====================================================================
function showScreen(name) {
    ['appLoader', 'openInTelegram', 'appError', 'parentModal', 'mainAppContent'].forEach(hide);
    if (name === 'loading') show('appLoader', 'flex');
    if (name === 'openInTelegram') show('openInTelegram', 'flex');
    if (name === 'error') show('appError', 'flex');
    if (name === 'parent') show('parentModal');
    if (name === 'main') show('mainAppContent');
}
function showLoadError(err) {
    setText('appErrorText', err && err.code === 'NO_INIT_DATA' ? tr('error_session') : tr('error_load'));
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
    const storyId = new URLSearchParams(window.location.search).get('story_id');
    if (storyId && profileData && profileData.user && profileData.user.profile_complete) {
        switchAppTab('profile');
        openReader(storyId);
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
    setText('themeToggleBtn', document.body.classList.contains('light-theme') ? tr('theme_day') : tr('theme_night'));
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

    if (!data.user || !data.user.profile_complete) {
        prefillParentForm(data.user);
        showScreen('parent');
    } else {
        showScreen('main');
    }

    updateStatusUI();
    updateAliceUI(!!(data.user && data.user.alice_connected));
    renderChildren();
    checkLimitAndMode();
}
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
    renderChildren();
    updateStatusUI();
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
    setText('lblTabProfile', tr('tab_profile'));
    setText('pageTitleHome', tr('page_title_home'));
    setText('pageTitleProfile', tr('page_title_profile'));

    setText('appLoaderText', tr('loading'));
    setText('openInTelegramTitle', tr('open_in_telegram_title'));
    setText('openInTelegramText', tr('open_in_telegram_text'));
    setText('appErrorRetry', tr('btn_retry'));

    setText('formTitle', editingChildId ? tr('form_title_edit') : tr('form_title_add'));
    setText('labelLang', tr('label_lang'));
    setText('labelName', tr('label_name'));
    setPlaceholder('childName', tr('placeholder_name'));
    setText('labelGender', tr('label_gender'));
    setText('txtBoy', tr('btn_boy'));
    setText('txtGirl', tr('btn_girl'));
    setText('saveBtn', editingChildId ? tr('btn_save_edit') : tr('btn_save_add'));
    setText('cancelBtn', tr('btn_cancel'));

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
    setText('lblNewStories', tr('lbl_new_stories'));
    setText('lblArchiveStories', tr('lbl_archive_stories'));
    setText('paywallText', tr('paywall_text'));
    setText('readerHeaderTitle', tr('reader_header'));
    setText('readerBackBtn', tr('reader_back'));
    setText('readerPromoCta', tr('reader_promo_cta'));
    setText('feedbackRatingTitle', tr('feedback_rating_title'));
    setText('feedbackCommentTitle', tr('feedback_comment_title'));
    setPlaceholder('story-comment', tr('feedback_placeholder'));
    const sendButton = el('submit-comment-btn');
    if (sendButton && !sendButton.disabled) sendButton.innerText = tr('feedback_send');

    if (profileData && profileData.payment) {
        setText('paywallBtn', tr('paywall_btn', { price: formatPrice(profileData.payment.standard_amount) }));
    }

    renderFooterAndPromo();
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
function renderBanners() {
    const track = el('sliderTrack');
    const container = el('sliderContainer');
    if (!track || !container) return;

    if (window.sliderIntervalId) {
        clearInterval(window.sliderIntervalId);
        window.sliderIntervalId = null;
    }
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

    if (banners.length > 1) {
        window.sliderIntervalId = setInterval(() => {
            track.style.transition = 'transform 0.5s ease-in-out';
            track.style.transform = 'translateX(-100%)';
            setTimeout(() => {
                track.style.transition = 'none';
                track.appendChild(track.firstElementChild);
                track.style.transform = 'translateX(0)';
            }, 500);
        }, 5000);
    }
}
// =====================================================================
// СТАТУС ПОДПИСКИ, ЦЕНА И ТАЙМЕР АКЦИИ
// Сумму и дедлайн акции решает сервер — здесь только показ.
// =====================================================================
function updateStatusUI() {
    const section = el('statusSection');
    if (!section) return;

    if (promoTimerInterval) { clearInterval(promoTimerInterval); promoTimerInterval = null; }
    hide('promoTimerContainer');

    if (!profileData || !profileData.user) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    const access = profileData.access || {};
    const payment = profileData.payment || {};
    const standardPrice = formatPrice(payment.standard_amount);
    const promoPrice = formatPrice(payment.promo_amount);

    const badge = el('statusBadge');
    if (badge) {
        badge.className = `status-badge ${access.hasAccess ? (access.isTrial ? 'trial' : 'active') : 'inactive'}`;
        badge.innerText = access.hasAccess ? (access.isTrial ? tr('status_trial') : tr('status_active')) : tr('status_inactive');
    }

    if (access.hasAccess && access.endDate) {
        const date = formatDate(access.endDate);
        setText('statusText', access.isTrial ? tr('status_trial_text', { date }) : tr('status_active_text', { date }));
    } else {
        setText('statusText', tr('status_inactive_text'));
    }

    const button = el('renewBtn');
    if (button) {
        button.style.display = 'block';
        button.disabled = false;
        if (!access.hasAccess) button.innerText = tr('btn_renew_inactive', { price: standardPrice });
        else if (!access.isTrial) button.innerText = tr('btn_renew_active', { price: standardPrice });
        else if (payment.promo_active) button.innerText = tr('btn_renew_promo', { promo_price: promoPrice, price: standardPrice });
        else button.innerText = tr('btn_renew_trial', { price: standardPrice });
    }

    setText('paywallBtn', tr('paywall_btn', { price: standardPrice }));

    if (payment.promo_active && payment.promo_deadline) {
        startPromoTimer(new Date(payment.promo_deadline).getTime(), standardPrice, payment.keeps_trial_days);
    }
}
function startPromoTimer(deadlineMs, standardPrice, keepsTrialDays) {
    setText('promoTimerTitle', tr('timer_title', { price: standardPrice }));
    const note = el('promoTimerNote');
    if (note) {
        note.innerText = keepsTrialDays ? tr('promo_keeps_trial') : '';
        note.style.display = keepsTrialDays ? 'block' : 'none';
    }
    show('promoTimerContainer');

    const tick = () => {
        const diff = deadlineMs - serverNow();
        if (diff <= 0) {
            clearInterval(promoTimerInterval);
            promoTimerInterval = null;
            hide('promoTimerContainer');
            if (Date.now() - (window.lastPromoReload || 0) > 10000) {
                window.lastPromoReload = Date.now();
                loadProfile().catch(err => console.error(err));
            }
            return;
        }
        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
        const m = String(Math.floor(diff / 60000) % 60).padStart(2, '0');
        const s = String(Math.floor(diff / 1000) % 60).padStart(2, '0');
        setText('promoTimerCountdown', `${h}:${m}:${s}`);
    };
    tick();
    promoTimerInterval = setInterval(tick, 1000);
}
// =====================================================================
// ОПЛАТА: ссылку собирает сервер
// =====================================================================
async function initiatePayment() {
    if (!userExists) return;

    const buttons = [el('renewBtn'), el('paywallBtn')].filter(Boolean);
    buttons.forEach(b => { b.disabled = true; b.dataset.label = b.innerText; b.innerText = tr('payment_opening'); });

    try {
        const data = await api('/api/app/payment-link', { method: 'POST', body: { language: currentLang } });
        paymentSnapshot = {
            status: profileData.user.subscription_status,
            endDate: profileData.access ? profileData.access.endDate : null
        };
        awaitingPayment = true;
        openLink(data.url);
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
    } finally {
        buttons.forEach(b => { b.disabled = false; b.innerText = b.dataset.label || b.innerText; });
    }
}
function subscribeReturnFromPayment() {
    if (window.paymentReturnBound) return;
    window.paymentReturnBound = true;

    const onReturn = () => { if (awaitingPayment) checkPaymentResult(true); };
    try { if (tg && tg.onEvent) tg.onEvent('activated', onReturn); } catch (e) { /* старые клиенты */ }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onReturn();
    });
}
async function checkPaymentResult(retryOnce) {
    try {
        await loadProfile();
        const access = profileData.access || {};
        const paid = profileData.user && profileData.user.subscription_status === 'active' &&
            (!paymentSnapshot || paymentSnapshot.status !== 'active' || access.endDate !== paymentSnapshot.endDate);
        if (paid) {
            awaitingPayment = false;
            paymentSnapshot = null;
            showAlert(tr('payment_success', { date: formatDate(access.endDate) }));
        } else if (retryOnce) {
            setTimeout(() => checkPaymentResult(false), 5000);
        }
    } catch (err) {
        console.error('Не удалось обновить статус после оплаты:', err);
    }
}
// =====================================================================
// ДЕТИ
// =====================================================================
function selectGender(gender) {
    selectedGender = gender;
    const boy = el('btn-M');
    const girl = el('btn-F');
    if (boy) boy.classList.toggle('selected', gender === 'M');
    if (girl) girl.classList.toggle('selected', gender === 'F');
}

function languageBadge(language) {
    return language === 'ru' ? '🇷🇺 RU' : (language === 'uz' ? '🇺🇿 UZ' : '🇬🇧 EN');
}
function renderChildren() {
    const container = el('childrenList');
    if (!container) return;

    if (!allChildren.length) {
        container.innerHTML = `<p class="empty-note">${escapeHtml(tr('no_profiles'))}</p>`;
        return;
    }
    container.innerHTML = allChildren.map(child => `
        <div class="child-card">
            <div class="child-info">
                <span class="child-name">${escapeHtml(child.name)} ${child.gender === 'M' ? '👦' : '👧'}</span>
                <span class="child-details">${languageBadge(child.language)}</span>
            </div>
            <div class="card-actions">
                <button class="icon-btn" data-id="${escapeHtml(child.id)}" onclick="startEdit(this.dataset.id)" aria-label="${escapeHtml(tr('form_title_edit'))}">✏️</button>
                <button class="icon-btn" data-id="${escapeHtml(child.id)}" onclick="deleteChild(this.dataset.id)">🗑️</button>
            </div>
        </div>`).join('');
}
function checkLimitAndMode() {
    const form = el('formContainer');
    if (!form) return;
    form.style.display = (allChildren.length >= maxChildren && !editingChildId) ? 'none' : 'block';
    const cancel = el('cancelBtn');
    if (cancel) cancel.style.display = editingChildId ? 'block' : 'none';
}
function startEdit(id) {
    const child = allChildren.find(c => String(c.id) === String(id));
    if (!child) return;
    editingChildId = child.id;
    if (el('childName')) el('childName').value = child.name;
    if (el('language')) el('language').value = child.language;
    selectGender(child.gender);
    applyLanguage();
    checkLimitAndMode();
    const form = el('formContainer');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetForm() {
    editingChildId = null;
    if (el('childName')) el('childName').value = '';
    selectGender('M');
    applyLanguage();
    checkLimitAndMode();
}
async function deleteChild(id) {
    if (!(await showConfirm(tr('confirm_delete_child')))) return;
    try {
        await api(`/api/app/children/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (String(editingChildId) === String(id)) resetForm();
        await loadProfile();
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
    }
}
async function saveData() {
    const nameInput = el('childName');
    const languageSelect = el('language');
    if (!nameInput || !languageSelect) return;

    const name = nameInput.value.trim();
    if (!name) return showAlert(tr('alert_enter_child_name'));
    if (!editingChildId && allChildren.length >= maxChildren) return showAlert(tr('alert_children_limit', { max: maxChildren }));

    const button = el('saveBtn');
    if (button) { button.disabled = true; button.innerText = tr('saving'); }

    try {
        const body = { name, gender: selectedGender, language: languageSelect.value };
        if (editingChildId) {
            await api(`/api/app/children/${encodeURIComponent(editingChildId)}`, { method: 'PATCH', body });
        } else {
            await api('/api/app/children', { method: 'POST', body });
        }
        resetForm();
        await loadProfile();
    } catch (err) {
        console.error(err);
        showAlert(err.message || tr('error_generic'));
    } finally {
        if (button) button.disabled = false;
        applyLanguage();
    }
}
// =====================================================================
// НАВИГАЦИЯ
// =====================================================================
function switchAppTab(tabId) {
    document.querySelectorAll('.tab-page').forEach(node => node.classList.remove('active'));
    document.querySelectorAll('.tab-item').forEach(node => node.classList.remove('active'));

    if (tabId === 'home') {
        if (el('tabHome')) el('tabHome').classList.add('active');
        if (el('btnTabHome')) el('btnTabHome').classList.add('active');
    } else {
        if (el('tabProfile')) el('tabProfile').classList.add('active');
        if (el('btnTabProfile')) el('btnTabProfile').classList.add('active');
        loadUserStories();
    }
    window.scrollTo(0, 0);
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
            <div class="story-icon">${st.locked ? '🔒' : '📖'}</div>
        </div>`;
}
async function openReader(storyId) {
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
        text.innerHTML = String(story.ready_text || '')
            .split('\n')
            .filter(p => p.trim())
            .map(p => `<p>${escapeHtml(p)}</p>`)
            .join('');
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
    await refreshVoiceoverBalance();
    updateAudioInterface(story.id, story.audio_url, voiceoversLeft);
}
function closeReader() {
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
            ratingThanks.innerText = `${tr('feedback_your_rating')} ${'⭐'.repeat(Math.min(5, Number(story.rating) || 0))}`;
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
// Функция обновления интерфейса аудио
let voiceoversLeft = 0;

async function refreshVoiceoverBalance() {
    const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
    const tgId = tgUser ? tgUser.id : null;

    if (!tgId) return;

    try {
        const data = await api('/api/user/check-balance', {
            method: 'POST',
            body: { telegram_id: tgId }
        });
        voiceoversLeft = Number(data.voiceovers_left || 0);
    } catch (err) {
        console.error('Не удалось получить баланс с сервера', err);
    }
}

function updateAudioInterface(storyId, audioUrl, left) {
    const container = document.getElementById('audio-dynamic-content');
    if (!container) return;

    if (audioUrl) {
        container.innerHTML = `
            <div class="audio-card audio-card--ready">
                <div class="audio-card__badge">🎧 Аудиоспектакль готов</div>
                <audio controls class="audio-player">
                    <source src="${audioUrl}" type="audio/mpeg">
                </audio>
            </div>
        `;
        return;
    }

    if (left > 0) {
        container.innerHTML = `
            <div class="audio-card audio-card--free">
                <div class="audio-card__meta">
                    <span class="audio-card__icon">🎙️</span>
                    <span class="audio-card__title">Озвучить сказку</span>
                </div>
                <div class="audio-card__desc">Профессиональные голоса • осталось: ${left}</div>
                <button onclick="requestAudioGeneration('${storyId}')" id="btn-gen-audio" class="audio-btn audio-btn--primary" type="button">
                    <span class="audio-btn__icon">🎙️</span>
                    <span>Озвучить</span>
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="audio-card audio-card--paid">
            <div class="audio-card__meta">
                <span class="audio-card__icon">🔒</span>
                <span class="audio-card__title">Лимит исчерпан</span>
            </div>
            <div class="audio-card__desc">Завершите оплату, чтобы озвучить сказку.</div>
            <button onclick="buyAudioGeneration('${storyId}')" id="btn-buy-audio" class="audio-btn audio-btn--secondary" type="button">
                <span class="audio-btn__icon">💳</span>
                <span>Озвучить за 14 900 сум</span>
            </button>
        </div>
    `;
}

async function requestAudioGeneration(storyId) {
    const btn = document.getElementById('btn-gen-audio');
    if (!btn) return;

    btn.innerHTML = '<span class="audio-btn__icon">⏳</span><span>Создаем...</span>';
    btn.disabled = true;
    btn.classList.add('is-loading');

    try {
        const data = await api('/api/user/generate-audio', {
            method: 'POST',
            body: { plod_id: storyId }
        });

        updateAudioInterface(storyId, data.audioUrl, data.voiceoversLeft);
    } catch (error) {
        console.error(error);
        alert('Ошибка при озвучке: ' + error.message);
        btn.innerHTML = '<span class="audio-btn__icon">🎙️</span><span>Ошибка. Попробовать снова</span>';
        btn.disabled = false;
        btn.classList.remove('is-loading');
    }
}

function buyAudioGeneration(storyId) {
    const confirmPay = confirm('Оплатить 14 900 сум за озвучку этой сказки?');
    if (confirmPay) {
        requestAudioGeneration(storyId);
    }
}
// =====================
// ======= СТАРТ =======
// =====================
boot();
