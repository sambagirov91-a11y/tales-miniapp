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

    if (profileData) updateStatusUI();
    updateChildrenLimitHint();
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
// СТАТУС ПОДПИСКИ, ТАРИФЫ И ТАЙМЕР АКЦИИ
// Цены, лимиты и дедлайн акции решает сервер — здесь только показ.
// =====================================================================
const TARIFF_ICONS = { start: '🌱', baby: '🧸', kids: '🎈' };
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
        if (!access.hasAccess) badge.innerText = tr('status_inactive');
        else if (access.isTrial) badge.innerText = tr('status_trial');
        else badge.innerText = currentId ? tr('status_active_tariff', { name: tariffName(currentId) }) : tr('status_active');
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
    setText('promoTimerTitle', tr('timer_title', {
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
// ОКНО ВЫБОРА ТАРИФА
// ---------------------------------------------------------------------
function openTariffs() {
    if (!userExists || !profileData || !profileData.tariffs) return;
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
        ['👧', item.max_children === 1 ? tr('tariff_children_one') : tr('tariff_children_many', { n: item.max_children })],
        ['🎙️', item.voiceovers > 0 ? tr('tariff_voiceovers_n', { n: item.voiceovers }) : tr('tariff_voiceovers_none')],
        ['💳', tr('tariff_extra_voiceover', { price: formatPrice(item.extra_voiceover_amount) })]
    ].map(([icon, text]) => `
        <li class="tariff-feature"><span class="tariff-feature__icon" aria-hidden="true">${icon}</span><span>${escapeHtml(text)}</span></li>`).join('');

    const badge = current ? `<span class="tariff-badge tariff-badge--current">${escapeHtml(tr('tariff_badge_current'))}</span>`
        : (promo ? `<span class="tariff-badge tariff-badge--promo">${escapeHtml(tr('tariff_badge_promo'))}</span>` : '');

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
                <span class="tariff-card__icon" aria-hidden="true">${TARIFF_ICONS[item.id] || '⭐'}</span>
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
    else if (action === 'open') openTariffs();
    else if (action === 'choose') payForTariff(node.getAttribute('data-tariff-id'), node);
    else if (action === 'children') {
        closeTariffs();
        switchAppTab('home');
        const list = el('childrenList');
        if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    updateChildrenLimitHint();
}
// Достигнут лимит детей по тарифу: объясняем и предлагаем сменить тариф
function updateChildrenLimitHint() {
    const hint = el('childrenLimitHint');
    if (!hint) return;
    const full = userExists && allChildren.length >= maxChildren && !editingChildId;
    hint.style.display = full ? 'flex' : 'none';
    if (!full) return;
    const access = (profileData && profileData.access) || {};
    setText('childrenLimitText', tr('children_limit_hint', { max: maxChildren }));
    setText('childrenLimitBtn', tr(access.hasAccess && !access.isTrial ? 'btn_change_tariff' : 'btn_pick_tariff'));
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
    setAudioLoading();
    await loadAudioInterface();
}
function closeReader() {
    stopReaderAudio(); // иначе озвучка продолжает играть за закрытой сказкой
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

    // У готовой озвучки баланс не нужен — лишний запрос не делаем
    if (!story.audio_url) {
        const ok = await refreshVoiceoverBalance();
        if (!isCurrentStory(story.id)) return; // пока ждали, закрыли или открыли другую сказку
        if (!ok) { renderAudioLoadError(story.id); return; }
    }
    updateAudioInterface(story.id, story.audio_url, voiceoversLeft);
}

function renderAudioLoadError(storyId) {
    const container = audioContainer();
    if (!container) return;
    container.innerHTML = `
        <div class="audio-card audio-card--error">
            ${audioHeader('⚠️', tr('audio_load_error'))}
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

function audioPlayerMarkup(url) {
    const label = (key) => escapeHtml(tr(key));
    return `
        <div class="audio-player" data-audio-player>
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
    audio.addEventListener('error', () => {
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
                ${audioHeader('🎧', tr('audio_ready'), tr('audio_ready_desc'))}
                ${audioPlayerMarkup(url)}
            </div>
        `;
        bindAudioPlayer(container);
        return;
    }

    if (left > 0) {
        container.innerHTML = `
            <div class="audio-card audio-card--free">
                ${audioHeader('🎙️', tr('audio_gen_title'), tr('audio_gen_desc'), tr('audio_left_chip', { left }))}
                <button id="btn-gen-audio" class="audio-btn audio-btn--primary" type="button" data-audio-action="generate" data-story-id="${id}">
                    <span class="audio-btn__icon">🎙️</span>
                    <span>${escapeHtml(tr('audio_gen_btn'))}</span>
                </button>
            </div>
        `;
        return;
    }

    const buyLabel = voiceoverAmount
        ? tr('audio_buy_btn', { price: formatPrice(voiceoverAmount) })
        : tr('audio_buy_btn_plain');
    // В тарифе «Старт» озвучек нет вовсе — это не «закончились», а «оплатите одну»
    const startPlan = !!(profileData && profileData.tariffs && profileData.tariffs.current === 'start');
    container.innerHTML = `
        <div class="audio-card audio-card--paid">
            ${startPlan
                ? audioHeader('🎙️', tr('audio_pay_title'), tr('audio_pay_desc'))
                : audioHeader('🔒', tr('audio_limit_title'), tr('audio_limit_desc'))}
            <button id="btn-buy-audio" class="audio-btn audio-btn--secondary" type="button" data-audio-action="buy" data-story-id="${id}">
                <span class="audio-btn__icon">💳</span>
                <span>${escapeHtml(buyLabel)}</span>
            </button>
        </div>
    `;
}

async function requestAudioGeneration(storyId) {
    const btn = el('btn-gen-audio');
    if (!btn || btn.disabled) return;

    btn.innerHTML = `<span class="audio-btn__icon">⏳</span><span>${escapeHtml(tr('audio_gen_progress'))}</span>`;
    btn.disabled = true;
    btn.classList.add('is-loading');

    try {
        const data = await api('/api/user/generate-audio', { method: 'POST', body: { plod_id: storyId } });
        if (data.voiceoversLeft !== undefined) voiceoversLeft = Number(data.voiceoversLeft) || 0;
        rememberFeedback(storyId, { audio_url: data.audioUrl });
        if (isCurrentStory(storyId)) updateAudioInterface(storyId, data.audioUrl, voiceoversLeft);
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
            btn.innerHTML = `<span class="audio-btn__icon">🎙️</span><span>${escapeHtml(tr('audio_gen_retry'))}</span>`;
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
        btn.innerHTML = `<span class="audio-btn__icon">⏳</span><span>${escapeHtml(tr('audio_pay_opening'))}</span>`;
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
    const container = audioContainer();
    const player = container ? container.querySelector('audio') : null;
    if (player) { try { player.pause(); } catch (e) { /* ничего страшного */ } }
    if (container) container.innerHTML = '';
}
// =====================
// ======= СТАРТ =======
// =====================
boot();
