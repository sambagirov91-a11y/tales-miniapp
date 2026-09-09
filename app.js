const tg = window.Telegram.WebApp;
tg.expand();

function openLink(url) { tg.openLink(url); }

// === ИНИЦИАЛИЗАЦИЯ ТЕМЫ ===
const savedTheme = localStorage.getItem('samba_theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
}

function toggleMiniAppTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('samba_theme', isLight ? 'light' : 'dark');
    
    // Мгновенное обновление текста кнопки темы
    const t = i18n_app[currentLang] || i18n_app['ru'];
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerText = isLight ? t.theme_day : t.theme_night;
}

document.addEventListener('DOMContentLoaded', () => {
    const t = i18n_app[currentLang] || i18n_app['ru'];
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerText = document.body.classList.contains('light-theme') ? t.theme_day : t.theme_night;
});

// === НАВИГАЦИЯ (TAB BAR) ===
function switchAppTab(tabId) {
    document.querySelectorAll('.tab-page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));

    if (tabId === 'home') {
        document.getElementById('tabHome').classList.add('active');
        document.getElementById('btnTabHome').classList.add('active');
    } else {
        document.getElementById('tabProfile').classList.add('active');
        document.getElementById('btnTabProfile').classList.add('active');
        loadUserStories(); 
    }
    window.scrollTo(0, 0);
}

// === SUPABASE ===
const supabaseUrl = 'https://lmxacoleuvsbtgxbhokc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxteGFjb2xldXZzYnRneGJob2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxMTg0OTEsImV4cCI6MjEwMjY5NDQ5MX0.Cy2H1qvhuX6lKSFFtrPeecmFr526WDddyakk5vIvqnc';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

const telegramId = tg.initDataUnsafe?.user?.id || 123456789;
let selectedGender = 'M';
let editingChildId = null;
let allChildren = [];
let userStories = [];
let userExists = false;
let currentLang = 'ru'; 
let currentUserData = null; 
let configUrls = { privacy_url: '', offer_url: '', about_url: '', promo_image_url: '', promo_link_url: '' };
let sliderIntervalId;

// === СЛОВАРЬ (Собран из внешних файлов) ===
const i18n_app = {
    ru: window.langRU,
    uz: window.langUZ,
    en: window.langEN
};

window.onload = async () => {
    await Promise.all([loadProfile(), loadAppConfig()]);
    
    // ПРОВЕРКА DEEP LINK: Если в URL есть id сказки
    const urlParams = new URLSearchParams(window.location.search);
    const storyId = urlParams.get('story_id');
    
    if (storyId) {
        switchAppTab('profile'); 
    }
};

// === РОДИТЕЛЬСКАЯ АНКЕТА ===
function checkCustomRole(val) {
    document.getElementById('customParentRole').style.display = val === 'Другое' ? 'block' : 'none';
}

async function saveParentInfo() {
    let role = document.getElementById('parentRoleSelect').value;
    if (role === 'Другое') role = document.getElementById('customParentRole').value.trim();
    const age = parseInt(document.getElementById('parentAgeInput').value);

    if (!role || isNaN(age) || age < 10 || age > 100) return alert('Пожалуйста, корректно заполните все поля.');

    try {
        if (!userExists) {
            const trialEndDate = new Date(); trialEndDate.setDate(trialEndDate.getDate() + 7);
            await _supabase.from('users').insert({ 
                telegram_id: telegramId, subscription_status: 'trial', trial_end_date: trialEndDate.toISOString(),
                bot_language: currentLang, parent_role: role, parent_age: age
            });
            userExists = true;
        } else {
            await _supabase.from('users').update({ parent_role: role, parent_age: age }).eq('telegram_id', telegramId);
        }
        document.getElementById('parentModal').style.display = 'none';
        await loadProfile();
    } catch (err) { console.error(err); alert('Ошибка сохранения'); }
}

// === ЯЗЫК И ИНТЕРФЕЙС ===
async function changeAppLanguage(newLang) {
    currentLang = newLang; 
    applyLanguage(); 
    renderChildren(allChildren);
    if (currentUserData) updateStatusUI(currentUserData);
    
    // Перезапускаем слайдер, чтобы обновить языки баннеров
    loadAppConfig();
    
    if (userExists) {
        await _supabase.from('users').update({ bot_language: newLang }).eq('telegram_id', telegramId).catch(e => console.error(e));
    }
}

function applyLanguage() {
    const t = i18n_app[currentLang] || i18n_app['ru'];
    document.documentElement.lang = currentLang;
    
    // Вкладки и заголовки
    if (document.getElementById('lblTabHome')) document.getElementById('lblTabHome').innerText = t.tab_home;
    if (document.getElementById('lblTabProfile')) document.getElementById('lblTabProfile').innerText = t.tab_profile;
    if (document.getElementById('pageTitleHome')) document.getElementById('pageTitleHome').innerText = t.page_title_home;
    if (document.getElementById('pageTitleProfile')) document.getElementById('pageTitleProfile').innerText = t.page_title_profile;
    
    // Форма профиля
    if (document.getElementById('formTitle')) document.getElementById('formTitle').innerText = editingChildId ? t.form_title_edit : t.form_title_add;
    if (document.getElementById('labelLang')) document.getElementById('labelLang').innerText = t.label_lang;
    if (document.getElementById('labelName')) document.getElementById('labelName').innerText = t.label_name;
    if (document.getElementById('childName')) document.getElementById('childName').placeholder = t.placeholder_name;
    if (document.getElementById('labelGender')) document.getElementById('labelGender').innerText = t.label_gender;
    if (document.getElementById('txtBoy')) document.getElementById('txtBoy').innerText = t.btn_boy;
    if (document.getElementById('txtGirl')) document.getElementById('txtGirl').innerText = t.btn_girl;
    if (document.getElementById('saveBtn')) document.getElementById('saveBtn').innerText = editingChildId ? t.btn_save_edit : t.btn_save_add;
    if (document.getElementById('cancelBtn')) document.getElementById('cancelBtn').innerText = t.btn_cancel;
    
    // Настройки
    if (document.getElementById('lblAppLang')) document.getElementById('lblAppLang').innerText = t.lbl_app_lang;
    if (document.getElementById('lblAppTheme')) document.getElementById('lblAppTheme').innerText = t.lbl_app_theme;
    
    // Перевод кнопки темы
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.innerText = document.body.classList.contains('light-theme') ? t.theme_day : t.theme_night;
    
    // Сюжеты и Архив
    if (document.getElementById('lblNewStories')) document.getElementById('lblNewStories').innerText = t.lbl_new_stories;
    if (document.getElementById('emptyToday')) document.getElementById('emptyToday').innerText = t.empty_today;
    if (document.getElementById('lblArchiveStories')) document.getElementById('lblArchiveStories').innerText = t.lbl_archive_stories;
    if (document.getElementById('paywallText')) document.getElementById('paywallText').innerText = t.paywall_text;
    if (document.getElementById('paywallBtn')) document.getElementById('paywallBtn').innerText = t.paywall_btn;
    
    // Читалка
    if (document.getElementById('readerHeaderTitle')) document.getElementById('readerHeaderTitle').innerText = t.reader_header;
    if (document.getElementById('readerBackBtn')) document.getElementById('readerBackBtn').innerText = t.reader_back;

    // Модалка родителя
    if (document.getElementById('modalTitle')) document.getElementById('modalTitle').innerText = t.modal_title;
    if (document.getElementById('modalSub')) document.getElementById('modalSub').innerText = t.modal_sub;
    if (document.getElementById('labelParentRole')) document.getElementById('labelParentRole').innerText = t.label_role;
    if (document.getElementById('roleMother')) document.getElementById('roleMother').innerText = t.role_mother;
    if (document.getElementById('roleFather')) document.getElementById('roleFather').innerText = t.role_father;
    if (document.getElementById('roleGrandma')) document.getElementById('roleGrandma').innerText = t.role_grandma;
    if (document.getElementById('roleGrandpa')) document.getElementById('roleGrandpa').innerText = t.role_grandpa;
    if (document.getElementById('roleNanny')) document.getElementById('roleNanny').innerText = t.role_nanny;
    if (document.getElementById('roleOther')) document.getElementById('roleOther').innerText = t.role_other;
    if (document.getElementById('customParentRole')) document.getElementById('customParentRole').placeholder = t.role_custom;
    if (document.getElementById('labelParentAge')) document.getElementById('labelParentAge').innerText = t.label_age;
    if (document.getElementById('parentAgeInput')) document.getElementById('parentAgeInput').placeholder = t.age_placeholder;
    if (document.getElementById('saveParentBtn')) document.getElementById('saveParentBtn').innerText = t.btn_save_parent;

    const consentText = t.consent_text.replace('{offer}', configUrls.offer_url || '#').replace('{privacy}', configUrls.privacy_url || '#');
    if (document.getElementById('regConsentLabel')) document.getElementById('regConsentLabel').innerHTML = consentText;
    if (document.getElementById('paymentConsentLabel')) document.getElementById('paymentConsentLabel').innerHTML = consentText;

    renderFooterAndPromo();
}

function renderFooterAndPromo() {
    const t = i18n_app[currentLang] || i18n_app['ru'];
    const footer = document.getElementById('footerLinks');
    if (!footer) return;

    let html = '';
    
    if (configUrls.promo_image_url && configUrls.promo_link_url) {
        html += `
            <a href="#" onclick="openLink('${configUrls.promo_link_url}')" style="display:block; margin-bottom: 24px; text-decoration: none; cursor: pointer; transition: transform 0.2s;" onmousedown="this.style.transform='scale(0.98)'" onmouseup="this.style.transform='scale(1)'">
                <img src="${configUrls.promo_image_url}" style="width:100%; border-radius: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);" alt="Promo">
            </a>
        `;
    }
    
    html += `
        <a href="#" onclick="openLink('${configUrls.privacy_url}')">${t.footer_privacy}</a>
        <a href="#" onclick="openLink('${configUrls.offer_url}')">${t.footer_offer}</a>
        <a href="#" onclick="openLink('${configUrls.about_url}')">${t.footer_about}</a>
    `;
    
    footer.innerHTML = html;
}

// === КОНФИГИ И СЛАЙДЕР ===
async function loadAppConfig() {
    try {
        const [ { data: banners }, { data: settings } ] = await Promise.all([
            _supabase.from('banners').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
            _supabase.from('app_settings').select('*')
        ]);

        if (banners && banners.length > 0) {
            const track = document.getElementById('sliderTrack');
            document.getElementById('sliderContainer').style.display = 'block';
            
            track.innerHTML = '';
            
            if (window.sliderIntervalId) {
                clearInterval(window.sliderIntervalId);
                window.sliderIntervalId = null;
            }

            track.innerHTML = banners.map(b => {
                const bannerTitle = (currentLang === 'uz' && b.title_uz) ? b.title_uz : ((currentLang === 'en' && b.title_en) ? b.title_en : b.title);
                return `
                    <div class="slide">
                        <img src="${b.image_url}" class="slide-bg" loading="lazy">
                        <div class="slide-title">${bannerTitle}</div>
                    </div>
                `;
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
        
        if (settings) {
            settings.forEach(s => configUrls[s.key] = s.value);
            applyLanguage(); 
        }
    } catch (e) { console.error(e); }
}

// === ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ И ДЕТИ ===
function selectGender(gender) {
    selectedGender = gender;
    document.getElementById('btn-M').classList.remove('selected');
    document.getElementById('btn-F').classList.remove('selected');
    document.getElementById(`btn-${gender}`).classList.add('selected');
}

async function loadProfile() {
    try {
        const { data: users } = await _supabase.from('users').select('*').eq('telegram_id', telegramId).limit(1); 
        const user = (users && users.length > 0) ? users[0] : null;
        userExists = !!user; 
        currentUserData = user; 

        document.getElementById('parentModal').style.display = (!user || !user.parent_role || !user.parent_age) ? 'flex' : 'none';

        if (userExists && user.bot_language) currentLang = user.bot_language;
        document.getElementById('appLangSelector').value = currentLang;
        
        applyLanguage(); 
        updateStatusUI(user);

        const { data: children } = await _supabase.from('children').select('*').eq('parent_telegram_id', telegramId).order('created_at', { ascending: true });
        allChildren = children || [];

    } catch (err) { 
        console.error(err); 
        allChildren = []; 
    } finally { 
        renderChildren(allChildren); 
        checkLimitAndMode(); 
    }
}

function updateStatusUI(user) {
    const section = document.getElementById('statusSection');
    if (!user) { section.style.display = 'none'; return; }
    
    section.style.display = 'block';
    const now = new Date();
    const trialEnd = new Date(user.trial_end_date);
    const subEnd = user.subscription_end_date ? new Date(user.subscription_end_date) : null;
    
    let hasAccess = false;
    let isTrial = false;
    let endDate = null;

    if (user.subscription_status === 'active' && subEnd && subEnd > now) {
        hasAccess = true;
        endDate = subEnd;
    } else if (user.subscription_status === 'trial' && trialEnd > now) {
        hasAccess = true;
        isTrial = true;
        endDate = trialEnd;
    }

    const t = i18n_app[currentLang] || i18n_app['ru'];
    
    document.getElementById('statusBadge').className = `status-badge ${hasAccess ? (isTrial ? 'trial' : 'active') : 'inactive'}`;
    document.getElementById('statusBadge').innerText = hasAccess ? (isTrial ? t.status_trial : t.status_active) : t.status_inactive;
    
    const textEl = document.getElementById('statusText');
    if (hasAccess && endDate) {
        const locale = currentLang === 'en' ? 'en-GB' : (currentLang === 'uz' ? 'uz-UZ' : 'ru-RU');
        const dateStr = endDate.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
        
        textEl.innerText = isTrial 
            ? t.status_trial_text.replace('{date}', dateStr) 
            : t.status_active_text.replace('{date}', dateStr);
    } else {
        textEl.innerText = t.status_inactive_text;
    }

    const btnEl = document.getElementById('renewBtn');
    btnEl.style.display = 'block';
    if (hasAccess) {
        btnEl.innerText = isTrial ? t.btn_renew_trial : t.btn_renew_active;
    } else {
        btnEl.innerText = t.btn_renew_inactive;
    }
}

function initiatePayment() {
    const checkoutUrl = `https://checkout.paycom.uz/${btoa(`m=67fc349fca95ffea6667f140;ac.order_id=${telegramId};a=2450000`)}`;
    tg.openLink(checkoutUrl);
}

function renderChildren(children) {
    const container = document.getElementById('childrenList');
    if (children.length === 0) { 
        const t = i18n_app[currentLang] || i18n_app['ru'];
        container.innerHTML = `<p style="color: #a0a0a0; font-size: 14px; text-align:center;">${t.no_profiles}</p>`; 
        return; 
    }
    container.innerHTML = children.map(child => `
        <div class="child-card">
            <div class="child-info">
                <span class="child-name">${child.name} ${child.gender === 'M' ? '👦' : '👧'}</span>
                <span class="child-details">${child.language === 'ru' ? '🇷🇺 RU' : (child.language === 'uz' ? '🇺🇿 UZ' : '🇬🇧 EN')}</span>
            </div>
            <div class="card-actions">
                <button class="icon-btn" onclick="startEdit('${child.id}')">✏️</button>
                <button class="icon-btn" onclick="deleteChild('${child.id}')">🗑️</button>
            </div>
        </div>
    `).join('');
}

function checkLimitAndMode() {
    const formContainer = document.getElementById('formContainer');
    formContainer.style.display = 'block';
    document.getElementById('cancelBtn').style.display = editingChildId ? 'block' : 'none';
    if (allChildren.length >= 5 && !editingChildId) formContainer.style.display = 'none'; 
}

function startEdit(id) {
    const child = allChildren.find(c => c.id === id);
    if (!child) return;
    editingChildId = child.id;
    document.getElementById('childName').value = child.name; 
    document.getElementById('language').value = child.language; 
    selectGender(child.gender);
    applyLanguage(); 
    checkLimitAndMode(); 
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function resetForm() { 
    editingChildId = null; 
    document.getElementById('childName').value = ''; 
    applyLanguage();
    checkLimitAndMode(); 
}

async function deleteChild(id) {
    if (!confirm('Удалить этот профиль?')) return;
    await _supabase.from('children').delete().eq('id', id); 
    loadProfile();
}

async function saveData() {
    const childName = document.getElementById('childName').value.trim();
    if (!childName) return tg.showAlert('Введите имя ребенка');
    try {
        if (editingChildId) {
            await _supabase.from('children').update({ name: childName, gender: selectedGender, language: document.getElementById('language').value }).eq('id', editingChildId);
        } else {
            await _supabase.from('children').insert({ parent_telegram_id: telegramId, name: childName, gender: selectedGender, language: document.getElementById('language').value });
        }
        resetForm(); 
        loadProfile();
    } catch (error) { 
        tg.showAlert('Ошибка сохранения'); 
    }
}

// === ЛОГИКА ЧИТАЛКИ И АРХИВА СКАЗОК ===
async function loadUserStories() {
    if (!userExists || allChildren.length === 0) return;
    try {
        const childIds = allChildren.map(c => c.id);
        const { data, error } = await _supabase
            .from('delivered_stories')
            .select('*, children(name)')
            .in('child_id', childIds)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        userStories = data || [];
        renderStoriesList();

        const urlParams = new URLSearchParams(window.location.search);
        const storyId = urlParams.get('story_id');
        
        if (storyId && !window.deepLinkOpened) {
            window.deepLinkOpened = true; 
            setTimeout(() => { openReader(storyId); }, 300); 
        }

    } catch (err) { console.error("Error loading stories:", err); }
}

function renderStoriesList() {
    const todayContainer = document.getElementById('todayStoriesList');
    const archiveContainer = document.getElementById('archiveStoriesList');
    const paywall = document.getElementById('paywallOverlay');

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStories = []; const archiveStories = [];

    userStories.forEach(st => {
        const stDate = new Date(st.created_at);
        (stDate >= today) ? todayStories.push(st) : archiveStories.push(st);
    });

    const t = i18n_app[currentLang] || i18n_app['ru'];

    if (todayStories.length === 0) {
        todayContainer.innerHTML = `<p id="emptyToday" style="color: #a0a0a0; font-size: 13px; text-align: center; padding: 10px;">${t.empty_today}</p>`;
    } else {
        todayContainer.innerHTML = todayStories.map(st => createStoryCard(st)).join('');
    }

    if (archiveStories.length === 0) {
        archiveContainer.innerHTML = `<p style="color: #a0a0a0; font-size: 13px; text-align: center; padding: 10px;">${t.empty_archive}</p>`;
        paywall.style.display = 'none';
    } else {
        archiveContainer.innerHTML = archiveStories.map(st => createStoryCard(st)).join('');
        
        let hasAccess = false;
        const now = new Date();
        if (currentUserData) {
            if (currentUserData.subscription_status === 'active' && new Date(currentUserData.subscription_end_date) > now) hasAccess = true;
            if (currentUserData.subscription_status === 'trial' && new Date(currentUserData.trial_end_date) > now) hasAccess = true;
        }
        paywall.style.display = hasAccess ? 'none' : 'flex';
    }
}

function createStoryCard(st) {
    const locale = currentLang === 'en' ? 'en-GB' : (currentLang === 'uz' ? 'uz-UZ' : 'ru-RU');
    const d = new Date(st.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    return `
        <div class="story-card" onclick="openReader('${st.id}')">
            <div>
                <div class="story-title">${st.title} (${st.children?.name})</div>
                <div class="story-date">${d}</div>
            </div>
            <div style="font-size: 20px;">📖</div>
        </div>
    `;
}

function openReader(storyId) {
    const st = userStories.find(s => s.id === storyId);
    if (!st) return;

    document.getElementById('readerTitle').innerText = st.title;
    document.getElementById('readerImg').src = st.image_url || '';
    document.getElementById('readerImg').style.display = st.image_url ? 'block' : 'none';

    const textHtml = (st.ready_text || '').split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('');
    document.getElementById('readerText').innerHTML = textHtml;

    const promoLink = document.getElementById('readerPromoLink');
    if (st.promo_image_url && st.promo_link_url) {
        promoLink.href = st.promo_link_url;
        document.getElementById('readerPromoImg').src = st.promo_image_url;
        promoLink.style.display = 'block';
    } else {
        promoLink.style.display = 'none';
    }

    document.getElementById('readerScreen').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeReader() {
    document.getElementById('readerScreen').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.getElementById('readerImg').src = '';
    document.getElementById('readerText').innerHTML = '';
}
