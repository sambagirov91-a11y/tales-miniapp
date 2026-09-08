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
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerText = isLight ? '☀️ День' : '🌙 Ночь';
}
// Установка текста кнопки при загрузке
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerText = document.body.classList.contains('light-theme') ? '☀️ День' : '🌙 Ночь';
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
        loadUserStories(); // Подгружаем сказки при открытии профиля
    }
    window.scrollTo(0, 0);
}

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
let configUrls = { privacy_url: '', offer_url: '', about_url: '' };
let sliderInterval;

const i18n_app = {
    ru: { /*... (содержимое оставь как было для базовых текстов) ...*/
        page_title: "Профили детей", no_profiles: "Профили еще не добавлены.",
        form_title_add: "Добавить ребенка", form_title_edit: "Редактировать профиль",
        label_lang: "Язык сказок", label_name: "Имя", placeholder_name: "Например: Тимур",
        label_gender: "Пол", btn_boy: "Мальчик 👦", btn_girl: "Девочка 👧",
        btn_save_add: "Добавить профиль", btn_save_edit: "Сохранить изменения", btn_cancel: "Отменить",
        status_active: "✅ Активная подписка", status_trial: "⏳ Пробный период", status_inactive: "❌ Неактивная",
        status_active_text: "Доступ открыт до {date}. Сказки приходят каждый день!",
        status_trial_text: "Бесплатный доступ до {date}.",
        status_inactive_text: "Волшебное время истекло. Продлите доступ.",
        btn_renew_active: "Продлить на месяц (24 500 сум)", btn_renew_trial: "Оформить подписку (24 500 сум)", btn_renew_inactive: "Возобновить подписку (24 500 сум)",
        consent_text: "Я принимаю условия <a href='#' onclick='openLink(\"{offer}\")'>Оферты</a> и <a href='#' onclick='openLink(\"{privacy}\")'>Политики</a>",
        footer_privacy: "Политика конфиденциальности", footer_offer: "Публичная оферта", footer_about: "О проекте",
        modal_title: "Расскажите о себе", modal_sub: "Это поможет нам сделать сказки еще лучше:",
        label_role: "Кто вы для ребенка?", label_age: "Ваш возраст", btn_save_parent: "Продолжить"
    },
    uz: { /*... узбекский ...*/ },
    en: { /*... английский ...*/ }
};

window.onload = async () => {
    await Promise.all([loadProfile(), loadAppConfig()]);
    
    // ПРОВЕРКА DEEP LINK: Если в URL есть id сказки — сразу открываем архив и сказку
    const urlParams = new URLSearchParams(window.location.search);
    const storyId = urlParams.get('story_id');
    
    if (storyId) {
        switchAppTab('profile'); // Эта функция автоматически вызовет loadUserStories()
    }
};

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

async function changeAppLanguage(newLang) {
    currentLang = newLang; applyLanguage(); renderChildren(allChildren);
    if (currentUserData) updateStatusUI(currentUserData);
    loadAppConfig();
    if (userExists) await _supabase.from('users').update({ bot_language: newLang }).eq('telegram_id', telegramId).catch(e => console.error(e));
}

function applyLanguage() {
    const t = i18n_app[currentLang] || i18n_app['ru'];
    document.documentElement.lang = currentLang;
    
    // Заголовки и текстовые элементы
    if (document.getElementById('pageTitle')) document.getElementById('pageTitle').innerText = t.page_title;
    if (document.getElementById('formTitle')) document.getElementById('formTitle').innerText = editingChildId ? t.form_title_edit : t.form_title_add;
    if (document.getElementById('labelLang')) document.getElementById('labelLang').innerText = t.label_lang;
    if (document.getElementById('labelName')) document.getElementById('labelName').innerText = t.label_name;
    if (document.getElementById('childName')) document.getElementById('childName').placeholder = t.placeholder_name;
    if (document.getElementById('labelGender')) document.getElementById('labelGender').innerText = t.label_gender;
    if (document.getElementById('txtBoy')) document.getElementById('txtBoy').innerText = t.btn_boy;
    if (document.getElementById('txtGirl')) document.getElementById('txtGirl').innerText = t.btn_girl;
    if (document.getElementById('saveBtn')) document.getElementById('saveBtn').innerText = editingChildId ? t.btn_save_edit : t.btn_save_add;
    if (document.getElementById('cancelBtn')) document.getElementById('cancelBtn').innerText = t.btn_cancel;
    
    // Модалка родителя
    if (document.getElementById('modalTitle')) document.getElementById('modalTitle').innerText = t.modal_title;
    if (document.getElementById('modalSub')) document.getElementById('modalSub').innerText = t.modal_sub;
    if (document.getElementById('labelParentRole')) document.getElementById('labelParentRole').innerText = t.label_role;
    if (document.getElementById('labelParentAge')) document.getElementById('labelParentAge').innerText = t.label_age;
    if (document.getElementById('saveParentBtn')) document.getElementById('saveParentBtn').innerText = t.btn_save_parent;

    // Ссылки в чекбоксах
    const consentText = t.consent_text.replace('{offer}', configUrls.offer_url || '#').replace('{privacy}', configUrls.privacy_url || '#');
    if (document.getElementById('regConsentLabel')) document.getElementById('regConsentLabel').innerHTML = consentText;
    if (document.getElementById('paymentConsentLabel')) document.getElementById('paymentConsentLabel').innerHTML = consentText;

    // Отрисовка футера и баннера
    renderFooterAndPromo();
}

// НОВАЯ ФУНКЦИЯ: Отрисовка футера и глобального рекламного баннера
function renderFooterAndPromo() {
    const t = i18n_app[currentLang] || i18n_app['ru'];
    const footer = document.getElementById('footerLinks');
    if (!footer) return;

    let html = '';
    
    // Глобальный рекламный баннер (из настроек админки)
    if (configUrls.promo_image_url && configUrls.promo_link_url) {
        html += `
            <a href="#" onclick="openLink('${configUrls.promo_link_url}')" style="display:block; margin-bottom: 24px; text-decoration: none; cursor: pointer; transition: transform 0.2s;" onmousedown="this.style.transform='scale(0.98)'" onmouseup="this.style.transform='scale(1)'">
                <img src="${configUrls.promo_image_url}" style="width:100%; border-radius: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);" alt="Promo">
            </a>
        `;
    }
    
    // Юридические ссылки
    html += `
        <a href="#" onclick="openLink('${configUrls.privacy_url}')">${t.footer_privacy}</a>
        <a href="#" onclick="openLink('${configUrls.offer_url}')">${t.footer_offer}</a>
        <a href="#" onclick="openLink('${configUrls.about_url}')">${t.footer_about}</a>
    `;
    
    footer.innerHTML = html;
}

async function loadAppConfig() {
    try {
        const [ { data: banners }, { data: settings } ] = await Promise.all([
            _supabase.from('banners').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
            _supabase.from('app_settings').select('*')
        ]);

        if (banners && banners.length > 0) {
            const track = document.getElementById('sliderTrack');
            document.getElementById('sliderContainer').style.display = 'block';
            if (track.children.length === 0) {
                track.innerHTML = banners.map(b => `
                    <div class="slide">
                        <img src="${b.image_url}" class="slide-bg" loading="lazy">
                        <div class="slide-title">${b.title}</div>
                    </div>
                `).join('');
                if (banners.length > 1 && !sliderInterval) {
                    sliderInterval = setInterval(() => {
                        track.style.transition = 'transform 0.5s ease-in-out';
                        track.style.transform = 'translateX(-100%)';
                        setTimeout(() => { track.style.transition = 'none'; track.appendChild(track.firstElementChild); track.style.transform = 'translateX(0)'; }, 500);
                    }, 5000);
                }
            }
        }
        
        if (settings) {
            settings.forEach(s => configUrls[s.key] = s.value);
            // Применяем язык и рендерим футер только ПОСЛЕ загрузки ссылок из базы
            applyLanguage(); 
        }
    } catch (e) { console.error(e); }
}

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
        userExists = !!user; currentUserData = user; 

        document.getElementById('parentModal').style.display = (!user || !user.parent_role || !user.parent_age) ? 'flex' : 'none';

        if (userExists && user.bot_language) currentLang = user.bot_language;
        document.getElementById('appLangSelector').value = currentLang;
        
        applyLanguage(); updateStatusUI(user);

        const { data: children } = await _supabase.from('children').select('*').eq('parent_telegram_id', telegramId).order('created_at', { ascending: true });
        allChildren = children || [];

    } catch (err) { console.error(err); allChildren = []; } 
    finally { renderChildren(allChildren); checkLimitAndMode(); }
}

function updateStatusUI(user) {
    const section = document.getElementById('statusSection');
    if (!user) { section.style.display = 'none'; return; }
    
    // (Логика бейджей и текстов осталась прежней)
    section.style.display = 'block';
    const now = new Date();
    const trialEnd = new Date(user.trial_end_date);
    const subEnd = user.subscription_end_date ? new Date(user.subscription_end_date) : null;
    
    let hasAccess = false;
    if (user.subscription_status === 'active' && subEnd && subEnd > now) hasAccess = true;
    if (user.subscription_status === 'trial' && trialEnd > now) hasAccess = true;

    document.getElementById('statusBadge').innerText = hasAccess ? (user.subscription_status === 'active' ? '✅ Активная подписка' : '⏳ Пробный период') : '❌ Неактивная';
    document.getElementById('statusBadge').className = `status-badge ${hasAccess ? (user.subscription_status === 'active' ? 'active' : 'trial') : 'inactive'}`;
    
    document.getElementById('renewBtn').style.display = 'block';
    document.getElementById('renewBtn').innerText = hasAccess ? 'Продлить доступ' : 'Возобновить подписку';
}

function initiatePayment() {
    const checkoutUrl = `https://checkout.paycom.uz/${btoa(`m=67fc349fca95ffea6667f140;ac.order_id=${telegramId};a=2450000`)}`;
    tg.openLink(checkoutUrl);
}

function renderChildren(children) {
    const container = document.getElementById('childrenList');
    if (children.length === 0) { container.innerHTML = `<p style="color: #a0a0a0; font-size: 14px; text-align:center;">Профили еще не добавлены.</p>`; return; }
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
    if (allChildren.length >= 5 && !editingChildId) formContainer.style.display = 'none'; 
}

function startEdit(id) {
    const child = allChildren.find(c => c.id === id);
    if (!child) return;
    editingChildId = child.id;
    document.getElementById('childName').value = child.name; document.getElementById('language').value = child.language; selectGender(child.gender);
    applyLanguage(); checkLimitAndMode(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function resetForm() { editingChildId = null; document.getElementById('childName').value = ''; checkLimitAndMode(); }

async function deleteChild(id) {
    if (!confirm('Удалить этот профиль?')) return;
    await _supabase.from('children').delete().eq('id', id); loadProfile();
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
        resetForm(); loadProfile();
    } catch (error) { tg.showAlert('Ошибка сохранения'); }
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

        // ЛОГИКА АВТОМАТИЧЕСКОГО ОТКРЫТИЯ СКАЗКИ
        const urlParams = new URLSearchParams(window.location.search);
        const storyId = urlParams.get('story_id');
        
        // Переменная window.deepLinkOpened защищает от повторного открытия при ручном клике на вкладки
        if (storyId && !window.deepLinkOpened) {
            window.deepLinkOpened = true; 
            
            // Небольшая задержка, чтобы UI успел переключиться на нужную вкладку
            setTimeout(() => {
                openReader(storyId);
            }, 300); 
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

    // Отрисовка за сегодня
    if (todayStories.length === 0) {
        todayContainer.innerHTML = '<p style="color: #a0a0a0; font-size: 13px; text-align: center; padding: 10px;">Новая сказка появится сегодня в 21:00!</p>';
    } else {
        todayContainer.innerHTML = todayStories.map(st => createStoryCard(st)).join('');
    }

    // Отрисовка архива
    if (archiveStories.length === 0) {
        archiveContainer.innerHTML = '<p style="color: #a0a0a0; font-size: 13px; text-align: center; padding: 10px;">Архив пуст. Сказки появятся здесь завтра.</p>';
        paywall.style.display = 'none';
    } else {
        archiveContainer.innerHTML = archiveStories.map(st => createStoryCard(st)).join('');
        
        // Логика Пейвола
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
    const d = new Date(st.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
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

// Открытие Читалки внутри Mini App
function openReader(storyId) {
    const st = userStories.find(s => s.id === storyId);
    if (!st) return;

    document.getElementById('readerTitle').innerText = st.title;
    document.getElementById('readerImg').src = st.image_url || '';
    document.getElementById('readerImg').style.display = st.image_url ? 'block' : 'none';

    // Форматируем текст (заменяем переносы строк на параграфы)
    const textHtml = (st.ready_text || '').split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('');
    document.getElementById('readerText').innerHTML = textHtml;

    // Внедряем рекламный баннер
    const promoLink = document.getElementById('readerPromoLink');
    if (st.promo_image_url && st.promo_link_url) {
        promoLink.href = st.promo_link_url;
        document.getElementById('readerPromoImg').src = st.promo_image_url;
        promoLink.style.display = 'block';
    } else {
        promoLink.style.display = 'none';
    }

    // Показываем экран и блокируем скролл фона
    document.getElementById('readerScreen').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeReader() {
    document.getElementById('readerScreen').style.display = 'none';
    document.body.style.overflow = 'auto';
    // Очищаем, чтобы не мелькало старое при следующем открытии
    document.getElementById('readerImg').src = '';
    document.getElementById('readerText').innerHTML = '';
}
