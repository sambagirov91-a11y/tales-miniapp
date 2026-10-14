// Цены не пишем в тексте: {price} и {promo_price} подставляются из ответа сервера,
// поэтому при смене цены словари править не нужно.
window.langRU = {
    currency: "сум",

    // Озвучка сказки (аудиоспектакль). Цена подставляется из ответа сервера.
    audio_loading: "Загрузка аудио...",
    audio_ready: "Аудиоспектакль готов",
    audio_gen_title: "Озвучить сказку",
    audio_gen_desc: "Профессиональные голоса • осталось: {left}",
    audio_gen_btn: "Озвучить",
    audio_gen_progress: "Создаём озвучку...",
    audio_gen_retry: "Ошибка. Попробовать снова",
    audio_limit_title: "Озвучки закончились",
    audio_limit_desc: "Оплатите одну озвучку, чтобы превратить эту сказку в аудиоспектакль.",
    audio_buy_btn: "Озвучить за {price}",
    audio_buy_btn_plain: "Оплатить озвучку",
    audio_pay_opening: "Открываем оплату...",
    audio_pay_success: "Оплата получена! Теперь нажмите «Озвучить».",
    audio_load_error: "Не удалось загрузить данные об озвучке.",
    audio_retry: "Повторить",
    audio_busy: "Озвучка этой сказки уже создаётся. Подождите немного.",
    audio_error: "Не удалось создать озвучку. Лимит возвращён, попробуйте ещё раз.",
    audio_no_voiceovers: "Озвучки закончились. Оплатите новую.",

    // Вкладки и заголовки
    tab_home: "Главная",
    tab_profile: "Мой профиль",
    page_title_home: "Профили детей",
    page_title_profile: "Мой профиль",

    // Загрузка и ошибки
    loading: "Загрузка...",
    open_in_telegram_title: "Откройте приложение в Telegram",
    open_in_telegram_text: "Приложение работает только внутри Telegram. Вернитесь в бота и нажмите «Открыть профиль».",
    error_load: "Не удалось загрузить данные. Проверьте интернет и попробуйте ещё раз.",
    error_session: "Сессия устарела. Закройте приложение и откройте его снова из бота.",
    error_network: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.",
    error_generic: "Что-то пошло не так. Попробуйте ещё раз.",
    btn_retry: "Попробовать снова",
    saving: "Сохранение...",

    // Форма профиля ребёнка
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
    btn_cancel: "Отменить",
    alert_enter_child_name: "Введите имя ребенка",
    alert_children_limit: "Можно добавить не больше {max} профилей.",
    confirm_delete_child: "Удалить этот профиль? Сказки для него больше не будут приходить.",

    // Настройки
    lbl_app_lang: "Язык приложения",
    lbl_app_theme: "Тема оформления",
    theme_day: "☀️ День",
    theme_night: "🌙 Ночь",

    // Статусы подписки
    status_active: "✅ Активная подписка",
    status_trial: "⏳ Пробный период",
    status_inactive: "❌ Неактивная",
    status_active_text: "Доступ открыт до {date}. Сказки приходят каждый день!",
    status_trial_text: "Бесплатный доступ до {date}.",
    status_inactive_text: "Волшебное время истекло. Продлите доступ.",

    // Оплата
    btn_renew_active: "Продлить на месяц ({price})",
    btn_renew_trial: "Оформить подписку ({price})",
    btn_renew_inactive: "Возобновить подписку ({price})",
    btn_renew_promo: "Оплатить {promo_price} — спецпредложение 🔥",
    timer_title: "🔥 Успейте оплатить со скидкой! Потом цена станет {price}. Спецпредложение сгорит через:",
    promo_keeps_trial: "Бесплатные дни не сгорят: подписка начнётся после пробного периода.",
    payment_opening: "Открываем оплату...",
    payment_success: "🎉 Оплата получена! Подписка активна до {date}.",

    // Сказки и архив
    lbl_new_stories: "✨ Новые сказки (Сегодня)",
    empty_today: "Новая сказка появится сегодня в 21:00!",
    lbl_archive_stories: "📚 Мои сказки (Архив)",
    empty_archive: "Архив пуст. Сказки появятся здесь завтра.",
    paywall_text: "Доступ к архиву прошлых сказок возможен только в платном тарифе.",
    paywall_btn: "Открыть доступ ({price})",
    story_locked: "🔒 По подписке",

    // Читалка и отзывы
    reader_header: "Сказка",
    reader_back: "⬅ Назад",
    reader_promo_cta: "👉 Нажмите здесь, чтобы узнать подробности 👈",
    feedback_rating_title: "Как вам сказка?",
    feedback_your_rating: "Ваша оценка:",
    feedback_comment_title: "Ваше мнение",
    feedback_placeholder: "Напишите, что понравилось малышу (до 500 символов)...",
    feedback_send: "Отправить отзыв",
    feedback_sending: "Отправка...",
    feedback_your_comment: "Ваш отзыв:",
    feedback_empty: "Пожалуйста, напишите что-нибудь перед отправкой.",

    // Анкета родителя
    modalTitle: "Расскажите о себе",
    modalSub: "Это поможет нам сделать сказки еще лучше:",
    labelParentName: "Ваше имя",
    parentNamePlaceholder: "Например: Искандер",
    labelParentRole: "Кто вы для ребенка?",
    roleMother: "Мама",
    roleFather: "Папа",
    roleGrandma: "Бабушка",
    roleGrandpa: "Дедушка",
    roleNanny: "Няня",
    roleOther: "Другое",
    customRolePlaceholder: "Укажите кто вы...",
    labelParentAge: "Ваш возраст",
    parentAgePlaceholder: "Например: 32",
    textPrivacy: 'Ознакомлен и согласен с <a href="#" data-config-link="privacy_url">политикой конфиденциальности</a>',
    textOffer: 'Принимаю условия <a href="#" data-config-link="offer_url">договора оферты</a>',
    saveParentBtn: "Продолжить",
    alert_enter_parent_name: "Пожалуйста, введите ваше имя.",
    alert_parent_role_age: "Пожалуйста, корректно укажите роль и возраст.",
    alert_accept_terms: "Необходимо принять условия соглашений.",

    // Яндекс Алиса ({phrase} — фраза запуска навыка, она всегда на русском)
    textAliceBtn: "Подключить Яндекс Алису",
    aliceModalTitle: "Связка с Алисой",
    aliceModalSub: "Скажите колонке {phrase} и введите 4 цифры, которые она продиктует:",
    aliceSubmitBtn: "Подключить",
    aliceCancelBtn: "Отмена",
    aliceSuccessTitle: "Колонка с Алисой подключена!",
    aliceSuccessText: "Для прослушивания сказок скажите колонке:",
    aliceAlertSuccess: "Колонка успешно подключена!",
    alice_enter_4_digits: "Введите 4 цифры",
    alice_code_not_found: "Код не найден или устарел. Попросите Алису назвать новый.",

    // Футер
    footer_privacy: "Политика конфиденциальности",
    footer_offer: "Публичная оферта",
    footer_about: "О проекте"
};
