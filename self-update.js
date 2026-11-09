// Самообновление мини-приложения.
//
// Зачем. GitHub Pages и Telegram держат index.html в кэше (до 10 минут), а мини-приложение, свёрнутое в
// Telegram, может часами жить в фоне со старым кодом. Номера ?v= у файлов помогают только тогда, когда
// браузер заново прочитал сам index.html. Поэтому при запуске и при возврате в приложение мы читаем
// index.html мимо кэша, сравниваем номера ?v= у своих скриптов и стилей с теми, что загружены сейчас,
// и если вышла новая версия — перезагружаемся.
//
// Когда НЕ перезагружаем: играет озвучка; в поле введён текст (чтобы не потерять набранное);
// нет сети или index.html не прочитался; нет sessionStorage (тогда не получится защититься от цикла).
// Защита от цикла: на одну и ту же новую версию — не больше одной перезагрузки за сеанс, а сразу после
// перезагрузки стартовая проверка пропускается.
//
// Договорённость: любое изменение файлов мини-приложения сопровождается новым ?v= в index.html (CLAUDE.md).
// Правка только разметки index.html без нового ?v= самообновление не заметит — поднимите номер app.js.
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else { root.MiniAppUpdate = api; api.boot(); }
})(typeof self !== 'undefined' ? self : this, function () {
    var MIN_INTERVAL_MS = 60 * 1000;     // проверяем не чаще раза в минуту
    var FETCH_TIMEOUT_MS = 5000;
    var GUARD_KEY = 'miniapp_update_tried';
    var RELOAD_PARAM = '_u';
    var IDLE_INPUT_TYPES = ['hidden', 'checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'];

    // Отпечаток версий: свои (относительные) скрипты и стили с ?v=, по алфавиту.
    function fingerprint(urls) {
        return urls
            .filter(function (u) {
                return typeof u === 'string' && /\?v=/.test(u) && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
            })
            .sort()
            .join('\n');
    }

    function urlsOf(doc) {
        var out = [];
        doc.querySelectorAll('script[src], link[href]').forEach(function (node) {
            out.push(node.getAttribute('src') || node.getAttribute('href') || '');
        });
        return out;
    }

    // Отпечаток новой версии, если она отличается от загруженной; иначе null.
    // Страницу без единого ?v= (например, ответ-заглушка) за новую версию не считаем.
    function staleVersion(currentDoc, freshDoc) {
        var fresh = fingerprint(urlsOf(freshDoc));
        if (!fresh) return null;
        return fresh === fingerprint(urlsOf(currentDoc)) ? null : fresh;
    }

    // Нельзя перезагружать: играет озвучка или в видимом поле введён текст.
    function isBusy(doc) {
        var audios = doc.querySelectorAll('audio');
        for (var i = 0; i < audios.length; i++) {
            if (audios[i].paused === false) return true;
        }
        var fields = doc.querySelectorAll('input, textarea');
        for (var j = 0; j < fields.length; j++) {
            var f = fields[j];
            var type = String(f.type || '').toLowerCase();
            if (IDLE_INPUT_TYPES.indexOf(type) !== -1) continue;
            if (!String(f.value || '').trim()) continue;
            if (f.getClientRects && f.getClientRects().length > 0) return true;
        }
        return false;
    }

    function createUpdater(env) {
        var doc = env.doc, loc = env.loc, storage = env.storage, now = env.now;
        var lastCheck = 0, running = false, reloading = false;

        function canPersist() {
            if (!storage) return false;
            try { storage.setItem(GUARD_KEY + '_probe', '1'); storage.removeItem(GUARD_KEY + '_probe'); return true; }
            catch (e) { return false; }
        }

        async function loadFresh() {
            var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
            var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS) : null;
            try {
                var res = await env.fetchFn(new URL('index.html', loc.href).toString(), {
                    cache: 'no-cache',               // всегда спрашиваем у сервера; не изменилось — ответ 304, это дёшево
                    credentials: 'same-origin',
                    signal: ctrl ? ctrl.signal : undefined
                });
                if (!res.ok) return null;
                return new env.ParserCtor().parseFromString(await res.text(), 'text/html');
            } catch (e) {
                return null;
            } finally {
                if (timer) clearTimeout(timer);
            }
        }

        function reloadFresh() {
            var url = new URL(loc.href);
            url.searchParams.set(RELOAD_PARAM, String(now()));   // другой адрес — index.html точно придёт с сервера; #hash с данными Telegram сохраняется
            loc.replace(url.toString());
        }

        // Убирает служебный параметр из адреса; true — страница только что перезагружена нами.
        function cleanUrl() {
            var url = new URL(loc.href);
            if (!url.searchParams.has(RELOAD_PARAM)) return false;
            url.searchParams.delete(RELOAD_PARAM);
            try { env.history.replaceState(env.history.state, '', url.pathname + url.search + url.hash); } catch (e) { /* не страшно */ }
            return true;
        }

        // Возвращает причину исхода — для тестов и отладки.
        async function check(reason) {
            if (reloading || running) return 'busy-check';
            var t = now();
            if (reason !== 'start' && t - lastCheck < MIN_INTERVAL_MS) return 'throttled';
            lastCheck = t;
            running = true;
            try {
                if (env.isOnline && !env.isOnline()) return 'offline';
                var freshDoc = await loadFresh();
                if (!freshDoc) return 'no-fresh';
                var fresh = staleVersion(doc, freshDoc);
                if (!fresh) return 'current';
                if (!canPersist()) return 'no-storage';
                if (storage.getItem(GUARD_KEY) === fresh) return 'already-tried';
                if (isBusy(doc)) return 'deferred';
                storage.setItem(GUARD_KEY, fresh);
                reloading = true;
                reloadFresh();
                return 'reloading';
            } finally {
                running = false;
            }
        }

        function start() {
            var justReloaded = cleanUrl();
            if (!justReloaded) check('start').catch(function () {});
            doc.addEventListener('visibilitychange', function () {
                if (doc.visibilityState === 'visible') check('resume').catch(function () {});
            });
            // Клиенты Telegram, которые не шлют visibilitychange при разворачивании мини-аппа
            try {
                if (env.telegram && typeof env.telegram.onEvent === 'function') {
                    env.telegram.onEvent('activated', function () { check('resume').catch(function () {}); });
                }
            } catch (e) { /* старый клиент Telegram */ }
        }

        return { check: check, start: start, cleanUrl: cleanUrl };
    }

    function boot() {
        if (typeof window === 'undefined' || !window.document || window.location.protocol === 'file:') return;
        function run() {
            try {
                var storage = null;
                try { storage = window.sessionStorage; } catch (e) { storage = null; }
                createUpdater({
                    doc: window.document,
                    loc: window.location,
                    history: window.history,
                    storage: storage,
                    now: function () { return Date.now(); },
                    fetchFn: function (u, o) { return window.fetch(u, o); },
                    ParserCtor: window.DOMParser,
                    isOnline: function () { return window.navigator.onLine !== false; },
                    telegram: window.Telegram && window.Telegram.WebApp
                }).start();
            } catch (e) {
                console.warn('Самообновление не запустилось:', e);
            }
        }
        // Проверяем после разбора страницы: иначе список загруженных файлов был бы неполным
        if (window.document.readyState === 'loading') window.document.addEventListener('DOMContentLoaded', run);
        else run();
    }

    return { fingerprint: fingerprint, urlsOf: urlsOf, staleVersion: staleVersion, isBusy: isBusy, createUpdater: createUpdater, boot: boot, GUARD_KEY: GUARD_KEY, RELOAD_PARAM: RELOAD_PARAM };
});
