const tg = window.Telegram.WebApp;
tg.expand();

function openLink(url) { tg.openLink(url); }

const supabaseUrl = 'https://lmxacoleuvsbtgxbhokc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxteGFjb2xldXZzYnRneGJob2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxMTg0OTEsImV4cCI6MjEwMjY5NDQ5MX0.Cy2H1qvhuX6lKSFFtrPeecmFr526WDddyakk5vIvqnc';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

const telegramId = tg.initDataUnsafe?.user?.id || 123456789;
let selectedGender = 'M';
let editingChildId = null;
let allChildren = [];
let userExists = false;
let currentLang = 'ru'; 
let currentUserData = null; 
let configUrls = {
    privacy_url: 'https://telegra.ph/Privacy',
    offer_url: 'https://telegra.ph/Public-Offer',
    about_url: 'https://telegra.ph/About'
};
let sliderInterval;

const i18n_app = {
    ru: {
        page_title: "Профили детей",
        loading: "Загружаем волшебство...",
        no_profiles: "Профили еще не добавлены.",
        form_title_add: "Добавить ребенка",
        form_title_edit: "Редактировать профиль",
        label_lang: "Язык сказок",
        label_name: "Имя",
        placeholder_name: "Например: Тимур",
        label_gender: "Пол",
        btn_boy: "Мальчик 👦",
        btn_girl: "Девочка 👧",
        btn_save_add: "Добавить профиль",
        btn_save_edit: "Сохранить изменения",
        btn_cancel: "Отменить редактирование",
        status_active: "✅ Активная подписка",
        status_trial: "⏳ Пробный период",
        status_inactive: "❌ Неактивная",
        status_active_text: "Доступ открыт до {date}. Сказки приходят каждый день!",
        status_trial_text: "Бесплатный доступ до {date}. Оформите подписку заранее, чтобы сказки не прерывались.",
        status_inactive_text: "Волшебное время истекло. Продлите доступ, чтобы дети снова получали уникальные сказки.",
        btn_renew_active: "Продлить на месяц (24 500 сум)",
        btn_renew_trial: "Оформить подписку (24 500 сум)",
        btn_renew_inactive: "Возобновить подписку (24 500 сум)",
        consent_text: "Я принимаю условия <a href='#' onclick='openLink(\"{offer}\")'>Публичной оферты</a> и <a href='#' onclick='openLink(\"{privacy}\")'>Политики конфиденциальности</a>",
        footer_privacy: "Политика конфиденциальности",
        footer_offer: "Публичная оферта",
        footer_about: "О проекте",
        alert_consent: "Пожалуйста, подтвердите согласие с Офертой и Политикой конфиденциальности.",
        alert_late: "Обратите внимание: при оплате сейчас, следующая сказка придет завтра в 21:00.",
        alert_name: "Пожалуйста, введите имя ребенка",
        alert_reg_consent: "Для продолжения необходимо принять условия Оферты и Политики конфиденциальности.",
        alert_added_late: "Профиль добавлен! ✨\n\nТак как уже вечер, первая сказка придет завтра в 21:00.",
        alert_added: "Профиль успешно добавлен!",
        alert_delete_confirm: "Вы уверены, что хотите удалить этот профиль?",
        alert_delete_err: "Не удалось удалить профиль.",
        alert_save_err: "Произошла ошибка при сохранении.",
        btn_saving: "Сохранение...",
        modal_title: "Расскажите о себе",
        modal_sub: "Это поможет нам сделать сказки еще лучше:",
        label_role: "Кто вы для ребенка?",
        label_age: "Ваш возраст",
        btn_save_parent: "Продолжить"
    },
    uz: {
        page_title: "Bolalar profillari",
        loading: "Sehr yuklanmoqda...",
        no_profiles: "Profillar hali qo'shilmagan.",
        form_title_add: "Farzand qo'shish",
        form_title_edit: "Profilni tahrirlash",
        label_lang: "Ertaklar tili",
        label_name: "Ism",
        placeholder_name: "Masalan: Temur",
        label_gender: "Jins",
        btn_boy: "O'g'il bola 👦",
        btn_girl: "Qiz bola 👧",
        btn_save_add: "Profil qo'shish",
        btn_save_edit: "O'zgarishlarni saqlash",
        btn_cancel: "Tahrirlashni bekor qilish",
        status_active: "✅ Faol obuna",
        status_trial: "⏳ Sinov muddati",
        status_inactive: "❌ Faol emas",
        status_active_text: "Kirish {date} gacha ochiq. Ertaklar har kuni keladi!",
        status_trial_text: "Bepul kirish {date} gacha. Ertaklar to'xtab qolmasligi uchun obunani oldindan rasmiylashtiring.",
        status_inactive_text: "Sehrli vaqt tugadi. Farzandlaringiz yana noyob ertaklarni olishi uchun kirishni uzaytiring.",
        btn_renew_active: "Bir oyga uzaytirish (24 500 so'm)",
        btn_renew_trial: "Obunani rasmiylashtirish (24 500 so'm)",
        btn_renew_inactive: "Obunani tiklash (24 500 so'm)",
        consent_text: "Men <a href='#' onclick='openLink(\"{offer}\")'>Ommaviy ofera</a> va <a href='#' onclick='openLink(\"{privacy}\")'>Maxfiylik siyosati</a> shartlarini qabul qilaman",
        footer_privacy: "Maxfiylik siyosati",
        footer_offer: "Ommaviy ofera",
        footer_about: "Loyiha haqida",
        alert_consent: "Iltimos, Oferta va Maxfiylik siyosatiga roziligingizni tasdiqlang.",
        alert_late: "E'tibor bering: hozir to'lov qilsangiz, keyingi ertak ertaga 21:00 da keladi.",
        alert_name: "Iltimos, bolaning ismini kiriting",
        alert_reg_consent: "Davom etish uchun Oferta va Maxfiylik siyosati shartlarini qabul qilishingiz kerak.",
        alert_added_late: "Profil qo'shildi! ✨\n\nKech bo'lganligi sababli, birinchi ertak ertaga 21:00 da keladi.",
        alert_added: "Profil muvaffaqiyatli qo'shildi!",
        alert_delete_confirm: "Haqiqatan ham bu profilni o'chirmoqchimisiz?",
        alert_delete_err: "Profilni o'chirib bo'lmadi.",
        alert_save_err: "Saqlashda xatolik yuz berdi.",
        btn_saving: "Saqlanmoqda...",
        modal_title: "O'zingiz haqingizda",
        modal_sub: "Iltimos, o'zingiz haqingizda ma'lumot kiriting:",
        label_role: "Farzandga kimsiz?",
        label_age: "Yoshingiz",
        btn_save_parent: "Davom etish"
    },
    en: {
        page_title: "Children's profiles",
        loading: "Loading magic...",
        no_profiles: "No profiles added yet.",
        form_title_add: "Add a child",
        form_title_edit: "Edit profile",
        label_lang: "Tale's language",
        label_name: "Name",
        placeholder_name: "E.g.: Timur",
        label_gender: "Gender",
        btn_boy: "Boy 👦",
        btn_girl: "Girl 👧",
        btn_save_add: "Add profile",
        btn_save_edit: "Save changes",
        btn_cancel: "Cancel editing",
        status_active: "✅ Active subscription",
        status_trial: "⏳ Trial period",
        status_inactive: "❌ Inactive",
        status_active_text: "Access is open until {date}. Tales arrive every day!",
        status_trial_text: "Free access until {date}. Subscribe in advance so the tales don't stop.",
        status_inactive_text: "The magic time has expired. Renew access so children can receive unique tales again.",
        btn_renew_active: "Renew for a month (24,500 UZS)",
        btn_renew_trial: "Subscribe (24,500 UZS)",
        btn_renew_inactive: "Resume subscription (24,500 UZS)",
        consent_text: "I accept the terms of the <a href='#' onclick='openLink(\"{offer}\")'>Public Offer</a> and <a href='#' onclick='openLink(\"{privacy}\")'>Privacy Policy</a>",
        footer_privacy: "Privacy Policy",
        footer_offer: "Public Offer",
        footer_about: "About the project",
        alert_consent: "Please confirm your agreement with the Offer and Privacy Policy.",
        alert_late: "Please note: if you pay now, the next tale will arrive tomorrow at 21:00.",
        alert_name: "Please enter the child's name",
        alert_reg_consent: "To continue, you must accept the terms of the Offer and Privacy Policy.",
        alert_added_late: "Profile added! ✨\n\nSince it's already evening, the first tale will arrive tomorrow at 21:00.",
        alert_added: "Profile successfully added!",
        alert_delete_confirm: "Are you sure you want to delete this profile?",
        alert_delete_err: "Failed to delete the profile.",
        alert_save_err: "An error occurred while saving.",
        btn_saving: "Saving...",
        modal_title: "About you",
        modal_sub: "Please provide information about yourself:",
        label_role: "Who are you to the child?",
        label_age: "Your age",
        btn_save_parent: "Continue"
    }
};

window.onload = async () => {
    await loadProfile();
    await loadAppConfig();
};

function checkCustomRole(val) {
    const customInput = document.getElementById('customParentRole');
    if (val === 'Другое') {
        customInput.style.display = 'block';
    } else {
        customInput.style.display = 'none';
    }
}

async function saveParentInfo() {
    let role = document.getElementById('parentRoleSelect').value;
    if (role === 'Другое') {
        role = document.getElementById('customParentRole').value.trim();
    }
    const age = parseInt(document.getElementById('parentAgeInput').value);

    if (!role || isNaN(age) || age < 10 || age > 100) {
        alert('Пожалуйста, корректно заполните все поля.');
        return;
    }

    try {
        if (!userExists) {
            const trialEndDate = new Date();
            trialEndDate.setDate(trialEndDate.getDate() + 7);
            await _supabase.from('users').insert({ 
                telegram_id: telegramId, 
                subscription_status: 'trial',
                trial_end_date: trialEndDate.toISOString(),
                bot_language: currentLang,
                parent_role: role,
                parent_age: age
            });
            userExists = true;
        } else {
            await _supabase.from('users').update({
                parent_role: role,
                parent_age: age
            }).eq('telegram_id', telegramId);
        }

        document.getElementById('parentModal').style.display = 'none';
        await loadProfile();
    } catch (err) {
        console.error(err);
        alert('Ошибка сохранения');
    }
}

async function changeAppLanguage(newLang) {
    currentLang = newLang;
    applyLanguage();
    renderChildren(allChildren);
    if (currentUserData) updateStatusUI(currentUserData);
    loadAppConfig();

    if (userExists) {
        try {
            await _supabase.from('users').update({ bot_language: newLang }).eq('telegram_id', telegramId);
        } catch (e) { console.error(e); }
    }
}

function applyLanguage() {
    const t = i18n_app[currentLang];
    document.documentElement.lang = currentLang;
    
    document.getElementById('pageTitle').innerText = t.page_title;
    document.getElementById('formTitle').innerText = editingChildId ? t.form_title_edit : t.form_title_add;
    document.getElementById('labelLang').innerText = t.label_lang;
    document.getElementById('labelName').innerText = t.label_name;
    document.getElementById('childName').placeholder = t.placeholder_name;
    document.getElementById('labelGender').innerText = t.label_gender;
    document.getElementById('txtBoy').innerText = t.btn_boy;
    document.getElementById('txtGirl').innerText = t.btn_girl;
    document.getElementById('saveBtn').innerText = editingChildId ? t.btn_save_edit : t.btn_save_add;
    document.getElementById('cancelBtn').innerText = t.btn_cancel;

    // Перевод модалки
    document.getElementById('modalTitle').innerText = t.modal_title;
    document.getElementById('modalSub').innerText = t.modal_sub;
    document.getElementById('labelParentRole').innerText = t.label_role;
    document.getElementById('labelParentAge').innerText = t.label_age;
    document.getElementById('saveParentBtn').innerText = t.btn_save_parent;
}

async function loadAppConfig() {
    try {
        const { data: banners } = await _supabase.from('banners').select('*').eq('is_active', true).order('sort_order', { ascending: true });
        if (banners && banners.length > 0) {
            const track = document.getElementById('sliderTrack');
            document.getElementById('sliderContainer').style.display = 'block';
            if (track.children.length === 0) {
                track.innerHTML = banners.map(b => `<div class="slide" style="background-image: url('${b.image_url}');"><div class="slide-title">${b.title}</div></div>`).join('');
                if (banners.length > 1 && !sliderInterval) {
                    sliderInterval = setInterval(() => {
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
        }

        const { data: settings } = await _supabase.from('app_settings').select('*');
        if (settings) settings.forEach(s => configUrls[s.key] = s.value);

        const t = i18n_app[currentLang];
        document.getElementById('footerLinks').innerHTML = `
            <a href="#" onclick="openLink('${configUrls.privacy_url}')">${t.footer_privacy}</a>
            <a href="#" onclick="openLink('${configUrls.offer_url}')">${t.footer_offer}</a>
            <a href="#" onclick="openLink('${configUrls.about_url}')">${t.footer_about}</a>
        `;

        const consentHtml = t.consent_text.replace('{offer}', configUrls.offer_url).replace('{privacy}', configUrls.privacy_url);
        document.getElementById('paymentConsentLabel').innerHTML = consentHtml;
        document.getElementById('regConsentLabel').innerHTML = consentHtml;

       // Рекламный баннер + трекинг показов
        const promoImgUrl = configUrls['promo_image_url'];
        const promoLinkUrl = configUrls['promo_link_url'];
        const promoContainer = document.getElementById('promoBannerContainer');

        if (promoImgUrl && promoImgUrl.trim() !== '') {
            // Устанавливаем картинку как фон, что исключает ее растягивание на весь экран
            promoContainer.style.backgroundImage = `url('${promoImgUrl}')`;
            promoContainer.style.display = 'block';

            // Трекаем просмотр (view) ровно один раз за сессию
            if (!window._promoViewTracked) {
                window._promoViewTracked = true;
                _supabase.from('promo_stats').insert({
                    telegram_id: telegramId,
                    action_type: 'view',
                    parent_role: currentUserData?.parent_role || 'Не указано',
                    parent_age: currentUserData?.parent_age || null
                }).then();
            }

            // Трекаем клик (click)
            promoContainer.onclick = () => {
                _supabase.from('promo_stats').insert({
                    telegram_id: telegramId,
                    action_type: 'click',
                    parent_role: currentUserData?.parent_role || 'Не указано',
                    parent_age: currentUserData?.parent_age || null
                }).then(() => {
                    openLink(promoLinkUrl || '#');
                });
            };
        } else {
            promoContainer.style.display = 'none';
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
        const { data: user, error: userError } = await _supabase.from('users').select('*').eq('telegram_id', telegramId).maybeSingle(); 
        if (userError) throw userError;
        
        userExists = !!user;
        currentUserData = user; 

        // Если у юзера нет данных о себе (роль или возраст) — показываем модалку
        if (!user || !user.parent_role || !user.parent_age) {
            document.getElementById('parentModal').style.display = 'flex';
        } else {
            document.getElementById('parentModal').style.display = 'none';
        }

        if (userExists && user.bot_language) currentLang = user.bot_language;
        document.getElementById('appLangSelector').value = currentLang;
        
        applyLanguage(); 
        updateStatusUI(user);

        const { data: children, error: childrenError } = await _supabase.from('children').select('*').eq('parent_telegram_id', telegramId).order('created_at', { ascending: true });
        if (childrenError) throw childrenError;

        allChildren = children || [];
        renderChildren(allChildren);
        checkLimitAndMode();

    } catch (err) { console.error(err); }
}

function updateStatusUI(user) {
    const section = document.getElementById('statusSection');
    const badge = document.getElementById('statusBadge');
    const text = document.getElementById('statusText');
    const renewBtn = document.getElementById('renewBtn');
    const paymentConsent = document.getElementById('paymentConsentContainer');
    const t = i18n_app[currentLang];
    
    section.style.display = 'block';
    if (!user) { section.style.display = 'none'; return; }

    const now = new Date();
    const trialEnd = new Date(user.trial_end_date);
    const subEnd = user.subscription_end_date ? new Date(user.subscription_end_date) : null;
    const locale = currentLang === 'ru' ? 'ru-RU' : (currentLang === 'uz' ? 'uz-UZ' : 'en-US');
    const options = { day: 'numeric', month: 'long' };

    if (user.subscription_status === 'active' && subEnd && subEnd > now) {
        badge.className = 'status-badge active'; badge.innerText = t.status_active;
        text.innerText = t.status_active_text.replace('{date}', subEnd.toLocaleDateString(locale, options));
        renewBtn.style.display = Math.ceil((subEnd - now) / (1000 * 60 * 60 * 24)) <= 3 ? 'block' : 'none';
    } else if (user.subscription_status === 'trial' && trialEnd > now) {
        badge.className = 'status-badge trial'; badge.innerText = t.status_trial;
        text.innerText = t.status_trial_text.replace('{date}', trialEnd.toLocaleDateString(locale, options));
        renewBtn.style.display = 'block'; renewBtn.innerText = t.btn_renew_trial; paymentConsent.style.display = 'flex';
    } else {
        badge.className = 'status-badge inactive'; badge.innerText = t.status_inactive;
        text.innerText = t.status_inactive_text; renewBtn.style.display = 'block'; renewBtn.innerText = t.btn_renew_inactive; paymentConsent.style.display = 'flex';
    }
}

function initiatePayment() {
    const t = i18n_app[currentLang];
    if (!document.getElementById('paymentConsent').checked) { tg.showAlert(t.alert_consent); return; }
    const checkoutUrl = `https://checkout.paycom.uz/${btoa(`m=67fc349fca95ffea6667f140;ac.order_id=${telegramId};a=2450000`)}`;
    const now = new Date();
    const hours = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tashkent"})).getHours();
    if (hours >= 21) tg.showAlert(t.alert_late, () => { tg.openLink(checkoutUrl); });
    else tg.openLink(checkoutUrl);
}

function renderChildren(children) {
    const container = document.getElementById('childrenList');
    const t = i18n_app[currentLang];
    if (children.length === 0) { container.innerHTML = `<p style="color: #a0a0a0; font-size: 14px;">${t.no_profiles}</p>`; return; }
    container.innerHTML = children.map(child => `
        <div class="child-card">
            <div class="child-info">
                <span class="child-name">${child.name} ${child.gender === 'M' ? '👦' : '👧'}</span>
                <span class="child-details">${t.label_lang}: ${child.language === 'ru' ? '🇷🇺' : (child.language === 'uz' ? '🇺🇿' : '🇬🇧')}</span>
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
    if (!userExists && !editingChildId) document.getElementById('regConsentContainer').style.display = 'flex';
    else document.getElementById('regConsentContainer').style.display = 'none';
    if (allChildren.length >= 5 && !editingChildId) formContainer.style.display = 'none'; 
}

function startEdit(id) {
    const child = allChildren.find(c => c.id === id);
    if (!child) return;
    editingChildId = child.id;
    document.getElementById('childName').value = child.name;
    document.getElementById('language').value = child.language;
    selectGender(child.gender);
    applyLanguage(); checkLimitAndMode();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function resetForm() {
    editingChildId = null; document.getElementById('childName').value = '';
    document.getElementById('language').value = 'ru'; selectGender('M');
    applyLanguage(); checkLimitAndMode();
}

async function deleteChild(id) {
    if (!confirm(i18n_app[currentLang].alert_delete_confirm)) return;
    await _supabase.from('children').delete().eq('id', id);
    loadProfile();
}

async function saveData() {
    const btn = document.getElementById('saveBtn');
    const childName = document.getElementById('childName').value.trim();
    const language = document.getElementById('language').value;
    const t = i18n_app[currentLang];

    if (!childName) { tg.showAlert(t.alert_name); return; }
    if (!userExists && !editingChildId && !document.getElementById('regConsent').checked) { tg.showAlert(t.alert_reg_consent); return; }

    btn.disabled = true; btn.innerText = t.btn_saving;
    try {
        if (editingChildId) {
            await _supabase.from('children').update({ name: childName, gender: selectedGender, language }).eq('id', editingChildId);
        } else {
            await _supabase.from('children').insert({ parent_telegram_id: telegramId, name: childName, gender: selectedGender, language });
            const hours = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tashkent"})).getHours();
            if (hours >= 21) tg.showAlert(t.alert_added_late);
            else tg.showAlert(t.alert_added);
        }
        resetForm(); loadProfile();
    } catch (error) { tg.showAlert(t.alert_save_err); }
    finally { btn.disabled = false; applyLanguage(); }
}
