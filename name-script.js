/*
 * Письменность имени ребёнка: язык сказки ↔ алфавит.
 *   • Русская сказка  → имя только кириллицей;
 *   • узбекская и английская сказки → имя только латиницей.
 * Лишние буквы молча не вводятся (или отбрасываются на сервере), под полем — мягкая подсказка,
 * рядом — кнопка «записать латиницей/кириллицей» (перевод имени в нужный алфавит одним нажатием).
 *
 * ЕДИНЫЙ ИСТОЧНИК. Файл лежит в site/ (его отдаёт сайт как /name_script.js), его же подключает сервер
 * (require('./site/name_script')). Копия для мини-приложения — файл name-script.js в репозитории tales-miniapp:
 * править здесь и копировать туда без изменений (сверка — name_script.test.js).
 *
 * Алфавиты (источники: Wikipedia «Uzbek alphabet», «Russian alphabet», «ISO basic Latin alphabet»,
 * закон «Об усовершенствовании узбекского алфавита на основе латинской графики» — подписан 21.10.2026,
 * по сообщению dunyo.info вступает в силу 22.04.2027):
 *   • русский — 33 буквы: А–Я и Ё;
 *   • узбекский (кириллица) — 35 букв: русский без Щ и Ы, плюс Ў Қ Ғ Ҳ;
 *   • узбекский (латиница, редакция 1995) — 24 буквы a b d e f g h i j k l m n o p q r s t u v x y z,
 *     плюс Oʻ Gʻ (26 букв), сочетания Sh Ch Ng и апостроф ʼ (тутуқ белги);
 *   • узбекский (новая латиница) — 28 букв и апостроф: те же 24 + Ö Ğ Ş Ç (вместо Oʻ Gʻ Sh Ch), «ng» — не отдельная буква;
 *   • английский — 26 букв базовой латиницы ISO: A–Z.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NameScript = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---------------------------------------------------------------- алфавиты (строчные)
    var ALPHABETS = {
        ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',                  // 33
        uzCyr: 'абвгдеёжзийклмнопрстуфхцчшъьэюя' + 'ўқғҳ',        // 31 + 4 = 35 (без щ, ы)
        uzLat1995: 'abdefghijklmnopqrstuvxyz',                    // 24 (+ oʻ gʻ, sh ch ng, апостроф)
        uzLatNew: 'abdefghijklmnopqrstuvxyz' + 'öğşç',            // 24 + 4 = 28 (+ апостроф)
        en: 'abcdefghijklmnopqrstuvwxyz'                          // 26
    };
    // Буквы узбекской кириллицы, которых нет в русском: в русской сказке их не стираем (имя не должно молча меняться).
    // false → в русском режиме они отсекались бы и превращались в Ў→У, Қ→К, Ғ→Г, Ҳ→Х.
    var RU_ALLOWS_UZ_CYRILLIC = true;
    // В узбекском режиме разрешены и c, w (иностранные имена: Wilhelm, Cristiano), поэтому берём всю базовую латиницу
    // плюс буквы новой редакции алфавита.
    var ALLOWED = {
        cyr: ALPHABETS.ru + (RU_ALLOWS_UZ_CYRILLIC ? 'ўқғҳ' : ''),
        latUz: ALPHABETS.en + 'öğşç',
        latEn: ALPHABETS.en
    };
    var LANG_SCRIPT = { ru: 'cyr', uz: 'lat', en: 'lat' };
    var LANGS = ['ru', 'uz', 'en'];

    function scriptFor(lang) { return LANG_SCRIPT[lang] || 'cyr'; }
    function allowedFor(lang) { return lang === 'uz' ? ALLOWED.latUz : lang === 'en' ? ALLOWED.latEn : ALLOWED.cyr; }
    function isCased(ch) { return ch.toLowerCase() !== ch.toUpperCase(); }
    function isUpper(ch) { return isCased(ch) && ch === ch.toUpperCase(); }

    // Символы-«апострофы» всех видов и дефисы всех видов
    var APOSTROPHES = '\'’‘ʻʼ`´′ʹʽʾˈ';
    var HYPHENS = '-‐‑‒–—−';
    var UZ_O_G = 'og';           // после этих букв апостроф — «ʻ» (oʻ, gʻ), после остальных — «ʼ»
    var APOS_UZ_TURN = 'ʻ';   // ʻ  (oʻ, gʻ)
    var APOS_UZ_STOP = 'ʼ';   // ʼ  (ma'no, ta'm)
    var FOLD_EXTRA = { 'ı': 'i', 'İ': 'I', 'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ß': 'ss' };

    function baseLetter(ch) {
        // é → e, ñ → n …; Cyrillic й/ё сюда не попадают — они разрешены напрямую, либо складываются в и/е.
        var d = ch.normalize ? ch.normalize('NFD') : ch;
        var b = d.charAt(0);
        if (b && b !== ch && isCased(b)) return b;
        return FOLD_EXTRA[ch] || '';
    }

    /**
     * Очистка имени под язык сказки.
     * opts.final = true — «чистовая» версия (сервер, сохранение): убираем пробелы, дефисы, апострофы по краям.
     * Возвращает { text, foreign, changed }:
     *   text    — имя, каким его можно сохранить;
     *   foreign — отброшенные БУКВЫ чужих алфавитов (цифры и знаки сюда не попадают) — для подсказки и кнопки;
     *   changed — текст отличается от введённого.
     */
    function clean(input, lang, opts) {
        var fin = !!(opts && opts.final);
        var str = String(input == null ? '' : input);
        if (str.normalize) str = str.normalize('NFC');
        var allowed = allowedFor(lang);
        var uz = lang === 'uz';
        var out = '';
        var foreign = '';
        var chars = Array.from(str);
        for (var i = 0; i < chars.length; i++) {
            var ch = chars[i];
            var low = ch.toLowerCase();
            var last = out.charAt(out.length - 1);
            if (/\s/.test(ch)) {
                if (out && last !== ' ' && last !== '-') out += ' ';
                continue;
            }
            if (HYPHENS.indexOf(ch) >= 0) {
                if (out && last !== '-' && last !== '\'' && last !== APOS_UZ_TURN && last !== APOS_UZ_STOP) {
                    if (last === ' ') out = out.slice(0, -1);
                    out += '-';
                }
                continue;
            }
            if (APOSTROPHES.indexOf(ch) >= 0) {
                if (!out || last === ' ' || last === '-' || last === '\'' || last === APOS_UZ_TURN || last === APOS_UZ_STOP) continue;
                out += uz ? (UZ_O_G.indexOf(last.toLowerCase()) >= 0 ? APOS_UZ_TURN : APOS_UZ_STOP) : '\'';
                continue;
            }
            if (allowed.indexOf(low) >= 0) { out += ch; continue; }
            // Одиночный диакритический знак (остался от «o» + «¨») — молча пропускаем
            if (/[̀-ͯ]/.test(ch)) continue;
            var base = baseLetter(ch);
            if (base && allowed.indexOf(base.toLowerCase().charAt(0)) >= 0) {
                // é → e, ß → ss …: имя сохраняем, чужой буквой это не считаем
                out += isUpper(ch) ? base.charAt(0).toUpperCase() + base.slice(1) : base;
                continue;
            }
            if (isCased(ch)) foreign += ch;   // буква другого алфавита
            // цифры, знаки, эмодзи — молча отбрасываем
        }
        // Дефис/пробел/апостроф в конце оставляем только при наборе (чтобы можно было писать «Мария-Анна», «Oʻg'li»)
        if (fin) out = out.replace(/^[\s\-'ʻʼ]+|[\s\-'ʻʼ]+$/g, '');
        return { text: out, foreign: foreign, changed: out !== str };
    }

    /** Проверка имени: ok — имя целиком в нужном алфавите (текст не пуст, чужих букв не было). */
    function check(name, lang) {
        var r = clean(name, lang, { final: true });
        return { ok: r.text.length > 0 && !r.foreign, text: r.text, foreign: r.foreign, script: scriptFor(lang) };
    }

    /** Ключ для сравнения имён: без регистра и лишних пробелов, все апострофы (' ʻ ʼ ’ ‘) считаются одинаковыми. */
    function key(name) {
        var str = String(name == null ? '' : name);
        if (str.normalize) str = str.normalize('NFC');
        return Array.from(str).map(function (c) { return APOSTROPHES.indexOf(c) >= 0 ? '\'' : c.toLowerCase(); }).join('').replace(/\s+/g, ' ').trim();
    }

    /** Есть ли в тексте буквы другого алфавита (для уже сохранённых имён). */
    function hasForeign(text, lang) {
        return clean(text, lang, { final: false }).foreign.length > 0;
    }

    /** Какой письменностью написан текст: 'cyr' | 'lat' | 'mixed' | 'none'. */
    function detectScript(text) {
        var s = String(text || '');
        var cyr = (s.match(/[Ѐ-ӿ]/g) || []).length;
        var lat = (s.match(/[A-Za-zÀ-ɏ]/g) || []).length;
        if (cyr && lat) return 'mixed';
        if (cyr) return 'cyr';
        if (lat) return 'lat';
        return 'none';
    }

    // ---------------------------------------------------------------- транслитерация
    var VOWELS_CYR = 'аеёиоуыэюяўъь';
    var CYR_TO_LAT = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ё': 'yo', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k',
        'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
        'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'ҳ': 'h', 'қ': 'q'
    };
    var CYR_TO_LAT_BY_LANG = {
        uz: { 'ж': 'j', 'х': 'x', 'ы': 'i', 'ъ': 'ʼ', 'ў': 'oʻ', 'ғ': 'gʻ' },
        en: { 'ж': 'zh', 'х': 'kh', 'ы': 'y', 'ъ': '', 'ў': 'o', 'ғ': 'g' }
    };

    function capitalize(piece, upperFirst, upperAll) {
        if (!piece) return piece;
        if (upperAll) return piece.toUpperCase();
        if (upperFirst) return piece.charAt(0).toUpperCase() + piece.slice(1);
        return piece;
    }
    // Слово целиком заглавными (ТИМУР) — результат тоже заглавными; одиночная заглавная — не считается
    function wordAllCaps(word) {
        var letters = Array.from(word).filter(isCased);
        return letters.length > 1 && letters.every(isUpper);
    }

    /** Кириллица → латиница. lang: 'uz' (узбекская латиница) или 'en' (английская). Остальные символы остаются как есть. */
    function cyrToLat(text, lang) {
        var table = CYR_TO_LAT_BY_LANG[lang === 'en' ? 'en' : 'uz'];
        return String(text || '').replace(/[^\s\-]+/g, function (word) {
            var caps = wordAllCaps(word);
            var chars = Array.from(word);
            var res = '';
            for (var i = 0; i < chars.length; i++) {
                var ch = chars[i];
                var low = ch.toLowerCase();
                var piece;
                if (low === 'е') {
                    var prev = i ? chars[i - 1].toLowerCase() : '';
                    piece = (!prev || VOWELS_CYR.indexOf(prev) >= 0) ? 'ye' : 'e';
                } else if (low === 'х' && lang !== 'en' && i === 2 && word.toLowerCase().indexOf('мухам') === 0) {
                    piece = 'h';        // Мухаммад, Мухамадали: тут «х» — это «h» (Muhammad), а не «x»
                } else if (Object.prototype.hasOwnProperty.call(table, low)) piece = table[low];
                else if (Object.prototype.hasOwnProperty.call(CYR_TO_LAT, low)) piece = CYR_TO_LAT[low];
                else { res += ch; continue; }
                res += capitalize(piece, isUpper(ch), caps);
            }
            return res;
        });
    }

    var LAT_DIGRAPHS = [
        ['shch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['ng', 'нг'], ['yo', 'ё'], ['yu', 'ю'], ['ya', 'я'], ['ye', 'е'],
        ['ts', 'ц'], ['zh', 'ж'], ['kh', 'х'], ['ph', 'ф'], ['ck', 'к']
    ];
    var LAT_TO_CYR = {
        'a': 'а', 'b': 'б', 'd': 'д', 'f': 'ф', 'g': 'г', 'h': 'х', 'i': 'и', 'j': 'ж', 'k': 'к', 'l': 'л',
        'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'q': 'к', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у', 'v': 'в',
        'w': 'в', 'x': 'х', 'z': 'з', 'ö': 'у', 'ğ': 'г', 'ş': 'ш', 'ç': 'ч'
    };

    /**
     * Латиница → кириллица в русском написании (Timur → Тимур, Jasur → Жасур, Oʻktam → Уктам, Gʻayrat → Гайрат, Saʼdulla → Саъдулла).
     * Одна схема на узбекскую и английскую латиницу; английские имена подправляются вручную после нажатия кнопки.
     */
    function latToCyr(text) {
        return String(text || '').replace(/[^\s\-]+/g, function (word) {
            var caps = wordAllCaps(word);
            var chars = Array.from(word);
            var res = '';
            var i = 0;
            while (i < chars.length) {
                var ch = chars[i];
                var low = ch.toLowerCase();
                var rest = chars.slice(i).join('').toLowerCase();
                var piece = null;
                var len = 1;
                var next = chars[i + 1] || '';
                if ((low === 'o' || low === 'g') && next && APOSTROPHES.indexOf(next) >= 0) {
                    piece = low === 'o' ? 'у' : 'г'; len = 2;                       // oʻ → у, gʻ → г
                } else if (APOSTROPHES.indexOf(ch) >= 0) {
                    piece = i && i < chars.length - 1 ? 'ъ' : '';                  // ʼ между буквами → ъ, по краям — нет
                } else {
                    for (var d = 0; d < LAT_DIGRAPHS.length; d++) {
                        if (rest.indexOf(LAT_DIGRAPHS[d][0]) === 0) { piece = LAT_DIGRAPHS[d][1]; len = LAT_DIGRAPHS[d][0].length; break; }
                    }
                    if (piece === null) {
                        if (low === 'e') {
                            var prev = i ? chars[i - 1].toLowerCase() : '';
                            piece = (!prev || 'aeiouyʼʼʻ\''.indexOf(prev) >= 0) ? 'э' : 'е';
                        } else if (low === 'c') {
                            piece = 'eiy'.indexOf(next.toLowerCase()) >= 0 && next ? 'ц' : 'к';
                        } else if (low === 'x' && i > 0 && i === chars.length - 1) {
                            piece = 'кс';                                           // Alex → Алекс (в узбекских именах «x» в конце не бывает)
                        } else if (low === 'y') {
                            piece = 'й';
                        } else if (Object.prototype.hasOwnProperty.call(LAT_TO_CYR, low)) piece = LAT_TO_CYR[low];
                    }
                }
                if (piece === null) { res += ch; i += 1; continue; }
                res += capitalize(piece, isUpper(ch), caps);
                i += len;
            }
            return res;
        });
    }

    /**
     * Имя в алфавит языка сказки: Cyrillic ↔ Latin. Буквы уже нужного алфавита остаются, чужие — переводятся.
     * Возвращает очищенный результат (clean, не «чистовой»).
     */
    function transliterate(text, lang) {
        var s = String(text || '');
        var converted = scriptFor(lang) === 'cyr' ? latToCyr(s) : cyrToLat(s, lang);
        return clean(converted, lang, { final: false }).text;
    }

    // ---------------------------------------------------------------- тексты (сайт и сервер; мини-приложение берёт свои из словарей)
    var MESSAGES = {
        ru: {
            hint_cyr: 'Имя нужно писать русскими буквами (кириллицей), так как язык сказок выбран русский.',
            hint_lat_uz: 'Имя нужно писать латиницей, так как язык сказок выбран узбекский.',
            hint_lat_en: 'Имя нужно писать латиницей, так как язык сказок выбран английский.',
            btn_to_cyr: 'Записать кириллицей: {preview}',
            btn_to_lat: 'Записать латиницей: {preview}'
        },
        uz: {
            hint_cyr: 'Ism rus harflarida (kirill alifbosida) yozilishi kerak, chunki ertak tili sifatida rus tili tanlangan.',
            hint_lat_uz: 'Ism lotin harflarida yozilishi kerak, chunki ertak tili sifatida o‘zbek tili tanlangan.',
            hint_lat_en: 'Ism lotin harflarida yozilishi kerak, chunki ertak tili sifatida ingliz tili tanlangan.',
            btn_to_cyr: 'Kirill harflarida yozish: {preview}',
            btn_to_lat: 'Lotin harflarida yozish: {preview}'
        },
        en: {
            hint_cyr: 'The name must be written in Russian letters (Cyrillic), because Russian is selected as the story language.',
            hint_lat_uz: 'The name must be written in Latin letters, because Uzbek is selected as the story language.',
            hint_lat_en: 'The name must be written in Latin letters (English alphabet), because English is selected as the story language.',
            btn_to_cyr: 'Write in Cyrillic: {preview}',
            btn_to_lat: 'Write in Latin letters: {preview}'
        }
    };
    function hintKey(taleLang) { return taleLang === 'uz' ? 'hint_lat_uz' : taleLang === 'en' ? 'hint_lat_en' : 'hint_cyr'; }
    function message(key, uiLang, params) {
        var table = MESSAGES[uiLang] || MESSAGES.ru;
        var text = table[key] || MESSAGES.ru[key] || '';
        Object.keys(params || {}).forEach(function (k) { text = text.split('{' + k + '}').join(params[k]); });
        return text;
    }
    /** Подсказка «пишите таким-то алфавитом» для языка сказки, на языке интерфейса. */
    function hint(taleLang, uiLang) { return message(hintKey(taleLang), uiLang); }

    // ---------------------------------------------------------------- привязка к полю ввода (браузер)
    // Что добавили в поле между двумя значениями (общий префикс и суффикс отбрасываем)
    function insertedText(prev, cur) {
        var p = 0;
        var max = Math.min(prev.length, cur.length);
        while (p < max && prev.charAt(p) === cur.charAt(p)) p++;
        var s = 0;
        while (s < max - p && prev.charAt(prev.length - 1 - s) === cur.charAt(cur.length - 1 - s)) s++;
        return cur.slice(p, cur.length - s);
    }
    function lettersAndApostrophes(text) {
        return Array.from(text).filter(function (c) { return isCased(c) || APOSTROPHES.indexOf(c) >= 0; }).join('');
    }

    /**
     * Привязывает фильтр к полю имени. opts:
     *   getLang()     — язык сказки ('ru' | 'uz' | 'en') — обязательно;
     *   uiLang()      — язык интерфейса для текстов (по умолчанию 'ru');
     *   t(key, params)— свой источник текстов (мини-приложение: словари), ключи как в MESSAGES;
     *   onChange()    — вызывается после того, как значение поля изменили кнопкой;
     *   hideAfterMs   — через сколько скрыть подсказку после отброшенной буквы (по умолчанию 12000).
     * Два режима подсказки:
     *   • набор: чужая буква не попадает в поле, подсказка и кнопка появляются на несколько секунд;
     *   • предупреждение (смена языка сказки, редактирование старого имени): в поле уже чужой алфавит — текст не трогаем,
     *     подсказка и кнопка висят, пока имя не исправят.
     * Возвращает { recheck(), reset(), refresh(), isValid(), hintText() }.
     */
    function bind(input, opts) {
        opts = opts || {};
        var doc = input.ownerDocument;
        var box = doc.createElement('div');
        box.className = 'name-script-box';
        box.hidden = true;
        box.style.cssText = 'margin:6px 0 10px;font-size:.82rem;line-height:1.4;';
        var hintEl = doc.createElement('div');
        hintEl.className = 'name-script-hint';
        hintEl.setAttribute('role', 'status');
        hintEl.setAttribute('aria-live', 'polite');
        hintEl.style.cssText = 'color:var(--name-hint-color,#d97706);';
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'name-script-btn';
        btn.style.cssText = 'margin-top:6px;padding:7px 12px;border-radius:10px;border:1px solid currentColor;background:transparent;color:var(--name-hint-color,#d97706);font:inherit;cursor:pointer;max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:left;';
        box.appendChild(hintEl);
        box.appendChild(btn);
        input.parentNode.insertBefore(box, input.nextSibling);

        var foreignBuf = '';       // что не пустили в поле (чужие буквы и апострофы между ними) — чтобы предложить перевод
        var prevValue = input.value;
        var wholeMode = false;     // true — режим предупреждения: в поле уже чужой алфавит
        var timer = null;
        var composing = false;

        function lang() { return opts.getLang() || 'ru'; }
        function ui() { return (opts.uiLang && opts.uiLang()) || 'ru'; }
        function text(key, params) { return opts.t ? opts.t(key, params) : message(key, ui(), params); }
        function hintText() { return text(hintKey(lang())); }
        function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
        function hide() { box.hidden = true; foreignBuf = ''; wholeMode = false; clearTimer(); }
        var lastSource = '';
        function render(source) {
            lastSource = source;
            var preview = transliterate(source, lang());
            hintEl.textContent = hintText();
            btn.hidden = !preview;
            btn.textContent = preview ? text(scriptFor(lang()) === 'cyr' ? 'btn_to_cyr' : 'btn_to_lat', { preview: preview }) : '';
            box.hidden = false;
        }
        function showTyping() {
            wholeMode = false;
            render(input.value + foreignBuf);
            clearTimer();
            timer = setTimeout(hide, opts.hideAfterMs || 12000);
        }
        function showWarning() {
            wholeMode = true;
            foreignBuf = '';
            render(input.value);
            clearTimer();
        }
        function apply() {
            var raw = input.value;
            var lg = lang();
            // В поле уже чужой алфавит (старое имя, смена языка) — ничего не стираем, пока человек сам не исправит
            if (wholeMode || hasForeign(prevValue, lg)) {
                prevValue = raw;
                if (hasForeign(raw, lg)) showWarning(); else hide();
                return;
            }
            var inserted = insertedText(prevValue, raw);
            var r = clean(raw, lg, { final: false });
            if (r.text !== raw) {
                var pos = typeof input.selectionStart === 'number' ? input.selectionStart : raw.length;
                var keep = clean(raw.slice(0, pos), lg, { final: false }).text.length;
                input.value = r.text;
                try { input.setSelectionRange(keep, keep); } catch (e) { /* поле не поддерживает выделение */ }
            }
            prevValue = input.value;
            var insertedForeign = clean(inserted, lg, { final: false }).foreign;
            if (insertedForeign) {
                foreignBuf += lettersAndApostrophes(inserted);
                showTyping();
            } else if (foreignBuf && lettersAndApostrophes(inserted) && !box.hidden) {
                foreignBuf += lettersAndApostrophes(inserted);     // апостроф после чужих букв: O'ktam
                showTyping();
            }
        }
        input.addEventListener('input', function (e) {
            if (composing || (e && e.isComposing)) return;
            apply();
        });
        input.addEventListener('compositionstart', function () { composing = true; });
        input.addEventListener('compositionend', function () { composing = false; apply(); });
        btn.addEventListener('click', function () {
            var next = transliterate(input.value + (wholeMode ? '' : foreignBuf), lang());
            input.value = next;
            prevValue = next;
            hide();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            if (opts.onChange) opts.onChange();
            try { input.focus(); } catch (e) { /* ignore */ }
        });

        return {
            /** Вызвать после смены языка сказки или подстановки значения (редактирование): предупреждает, если в поле чужой алфавит. */
            recheck: function () {
                prevValue = input.value;
                if (hasForeign(input.value, lang())) showWarning(); else hide();
            },
            reset: function () { prevValue = input.value; hide(); },
            /** Перерисовать тексты, пока подсказка видна (человек сменил язык интерфейса). */
            refresh: function () { if (!box.hidden) render(lastSource); },
            isValid: function () { return !hasForeign(input.value, lang()); },
            hintText: hintText
        };
    }

    return {
        ALPHABETS: ALPHABETS, ALLOWED: ALLOWED, LANGS: LANGS, MESSAGES: MESSAGES,
        scriptFor: scriptFor, clean: clean, check: check, key: key, hasForeign: hasForeign, detectScript: detectScript,
        cyrToLat: cyrToLat, latToCyr: latToCyr, transliterate: transliterate,
        hint: hint, message: message, bind: bind
    };
});
