(function () {
  'use strict';

  const L = window.EXCUSE_LOGIC;
  const KEY = 'excuse_gen_v1';

  /* ============ Состояние ============ */
  const defaults = {
    history: [],
    favorites: [],
    stats: { total: 0, byTier: {} },
    theme: 'light',
    sound: true,
    credibility: 50,
    detailed: false
  };

  function loadState() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    const s = Object.assign({}, defaults, raw && typeof raw === 'object' ? raw : {});
    s.history = Array.isArray(s.history) ? s.history.slice(0, 30) : [];
    s.favorites = Array.isArray(s.favorites) ? s.favorites.slice(0, 50) : [];
    s.stats = s.stats && typeof s.stats === 'object' ? s.stats : { total: 0, byTier: {} };
    s.stats.total = Math.max(0, Math.round(Number(s.stats.total) || 0));
    s.stats.byTier = s.stats.byTier && typeof s.stats.byTier === 'object' ? s.stats.byTier : {};
    L.TIERS.forEach(t => { s.stats.byTier[t.id] = Math.max(0, Math.round(Number(s.stats.byTier[t.id]) || 0)); });
    s.theme = s.theme === 'dark' ? 'dark' : 'light';
    s.sound = s.sound !== false;
    s.credibility = L.normalizeCredibility(s.credibility);
    s.detailed = !!s.detailed;
    return s;
  }

  const state = loadState();
  let current = null;
  let activeTab = 'history';
  let toastTimer = null;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ }
  }

  /* ============ Элементы ============ */
  const $ = id => document.getElementById(id);
  const el = {
    credibility: $('credibility'), credValue: $('credValue'), tierHint: $('tierHint'),
    randomCred: $('randomCred'), detailed: $('detailed'),
    oracle: $('oracle'), loading: $('loading'),
    empty: $('empty'), result: $('result'), tierBadge: $('tierBadge'),
    resultTime: $('resultTime'), excuseText: $('excuseText'),
    copyBtn: $('copyBtn'), favBtn: $('favBtn'), shareBtn: $('shareBtn'), againBtn: $('againBtn'),
    dailyText: $('dailyText'), dailyBtn: $('dailyBtn'),
    tabs: { history: $('tabHistory'), favorites: $('tabFavorites'), base: $('tabBase'), stats: $('tabStats') },
    lists: { history: $('listHistory'), favorites: $('listFavorites'), stats: $('listStats') },
    views: { history: $('listHistory'), favorites: $('listFavorites'), base: $('viewBase'), stats: $('listStats') },
    baseSearch: $('baseSearch'), searchCount: $('searchCount'), listBase: $('listBase'),
    clearList: $('clearList'),
    themeBtn: $('themeBtn'), soundBtn: $('soundBtn'), toast: $('toast')
  };

  /* ============ Утилиты ============ */
  function toast(msg, type) {
    el.toast.textContent = msg;
    el.toast.dataset.type = type || 'ok';
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  function timeAgo(ts) {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return 'только что';
    const min = Math.floor(sec / 60); if (min < 60) return min + ' мин назад';
    const h = Math.floor(min / 60); if (h < 24) return h + ' ч назад';
    const d = Math.floor(h / 24); if (d < 30) return d + ' дн назад';
    return new Date(ts).toLocaleDateString('ru-RU');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ============ Звук ============ */
  let audio = null;
  function beep(freq, duration, type, gain) {
    if (!state.sound) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      vol.gain.setValueAtTime(gain || 0.05, audio.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (duration || 0.12));
      osc.connect(vol); vol.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + (duration || 0.12));
    } catch (e) { /* звук не критичен */ }
  }
  const Sfx = {
    click: () => beep(520, 0.07, 'sine', 0.035),
    roll: () => { beep(320, 0.09, 'triangle', 0.04); setTimeout(() => beep(480, 0.09, 'triangle', 0.035), 90); },
    reveal: () => { beep(660, 0.12, 'sine', 0.045); setTimeout(() => beep(880, 0.16, 'sine', 0.035), 100); },
    good: () => { beep(720, 0.08, 'sine', 0.04); setTimeout(() => beep(980, 0.12, 'sine', 0.03), 80); }
  };

  /* ============ Отрисовка ============ */
  function renderCredibility() {
    el.credValue.textContent = state.credibility + '%';
    const tier = L.tierFor(state.credibility);
    el.tierHint.textContent = tier.icon + ' ' + tier.name;
    el.tierHint.style.color = tier.accent;
  }

  function renderChrome() {
    document.documentElement.dataset.theme = state.theme;
    el.themeBtn.textContent = state.theme === 'dark' ? '☀️' : '🌙';
    el.themeBtn.setAttribute('aria-label', state.theme === 'dark' ? 'Включить бежевую тему' : 'Включить ночную тему');
    el.soundBtn.textContent = state.sound ? '🔊' : '🔇';
    el.soundBtn.setAttribute('aria-label', state.sound ? 'Выключить звук' : 'Включить звук');
    el.credibility.value = state.credibility;
    el.detailed.checked = state.detailed;
  }

  function renderResult() {
    if (!current) {
      el.result.hidden = true;
      el.empty.hidden = false;
      return;
    }
    el.empty.hidden = true;
    el.result.hidden = false;
    el.result.style.setProperty('--tone', current.accent || 'var(--accent)');
    el.tierBadge.textContent = current.icon + ' ' + current.tierName;
    el.tierBadge.style.setProperty('--tone', current.accent || 'var(--accent)');
    el.resultTime.textContent = timeAgo(current.ts || Date.now());
    el.excuseText.textContent = current.text;
    const fav = state.favorites.some(f => f.id === current.id);
    el.favBtn.textContent = fav ? '★ В избранном' : '☆ В избранное';
  }

  function itemHtml(item) {
    const tier = L.tierById(item.tier);
    return '<div class="item" data-id="' + escapeHtml(item.id) + '" role="button" tabindex="0">' +
      '<div class="txt">' + escapeHtml(item.text) + '</div>' +
      '<div class="meta"><span>' + (tier ? tier.icon + ' ' + tier.name : '') + '</span>' +
      '<span>' + timeAgo(item.ts) + (item.fav ? ' · <span class="fav">★</span>' : '') + '</span></div>' +
      '</div>';
  }

  function renderDaily() {
    const daily = L.excuseOfTheDay();
    el.dailyText.textContent = '«' + daily.text + '»';
    el.dailyBtn.dataset.daily = '1';
  }

  function renderLists() {
    Object.keys(el.tabs).forEach(k => {
      el.tabs[k].classList.toggle('active', k === activeTab);
      el.tabs[k].setAttribute('aria-selected', String(k === activeTab));
      el.views[k].hidden = k !== activeTab;
    });

    el.lists.history.innerHTML = state.history.length
      ? state.history.map(itemHtml).join('')
      : '<div class="empty"><p>Пока пусто — сгенерируй первое оправдание</p></div>';

    el.lists.favorites.innerHTML = state.favorites.length
      ? state.favorites.map(i => Object.assign({}, i, { fav: true })).map(itemHtml).join('')
      : '<div class="empty"><p>Нажми ☆ у понравившегося оправдания</p></div>';

    const summary = L.summarize(state.history);
    el.lists.stats.innerHTML =
      '<div class="stat-total"><b>' + state.stats.total + '</b><span>всего создано</span></div>' +
      L.TIERS.map(t =>
        '<div class="stat-row"><span>' + t.icon + ' ' + t.name + '</span><b>' + (state.stats.byTier[t.id] || 0) + '</b></div>'
      ).join('') +
      '<div class="stat-row"><span>В избранном</span><b>' + state.favorites.length + '</b></div>' +
      '<div class="stat-row"><span>В истории</span><b>' + summary.total + '</b></div>';

    el.clearList.textContent = activeTab === 'stats' ? 'Сбросить статистику' :
      activeTab === 'favorites' ? 'Очистить избранное' :
      activeTab === 'base' ? 'Очистить поиск' : 'Очистить историю';
  }

  function renderBase() {
    const q = el.baseSearch.value.trim();
    const results = q ? L.searchExcuses(q, 60) : [];
    el.searchCount.textContent = q
      ? 'Найдено: ' + results.length + (results.length === 60 ? ' (показаны первые 60)' : '')
      : 'В базе ' + L.allExcuses().length + ' оправданий — введи запрос';
    el.listBase.innerHTML = results.length
      ? results.map(item => itemHtml(Object.assign({}, item, { ts: Date.now() }))).join('')
      : (q ? '<div class="empty"><p>Ничего не найдено</p></div>' : '<div class="empty"><p>Например: «голубь», «сервер», «пробки»</p></div>');
  }

  function renderAll() {
    renderCredibility();
    renderChrome();
    renderResult();
    renderDaily();
    renderLists();
    renderBase();
  }

  /* ============ Действия ============ */
  function generate() {
    if (el.oracle.disabled) return;
    el.oracle.disabled = true;
    el.loading.hidden = false;
    el.empty.hidden = true;
    Sfx.roll();

    setTimeout(() => {
      const exclude = state.history.slice(-8).map(i => i.id);
      const made = L.generateExcuse(state.credibility, { detailed: state.detailed, exclude: exclude });
      made.ts = Date.now();

      current = made;
      state.history.unshift({ id: made.id, text: made.text, tier: made.tier, ts: made.ts });
      state.history = state.history.slice(0, 30);
      state.stats.total += 1;
      state.stats.byTier[made.tier] = (state.stats.byTier[made.tier] || 0) + 1;
      save();

      el.loading.hidden = true;
      el.oracle.disabled = false;
      renderResult();
      renderLists();
      Sfx.reveal();
    }, 800);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Скопировано', 'good')).catch(() => fallbackCopy(text));
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Скопировано', 'good'); }
    catch (e) { toast('Не удалось скопировать', 'bad'); }
    ta.remove();
  }

  function copyCurrent() {
    if (!current) { toast('Сначала создай оправдание', 'bad'); return; }
    copyText(current.text);
    Sfx.click();
  }

  function toggleFavorite() {
    if (!current) { toast('Сначала создай оправдание', 'bad'); return; }
    const idx = state.favorites.findIndex(f => f.id === current.id);
    if (idx >= 0) {
      state.favorites.splice(idx, 1);
      toast('Удалено из избранного');
    } else {
      state.favorites.unshift({ id: current.id, text: current.text, tier: current.tier, ts: Date.now() });
      state.favorites = state.favorites.slice(0, 50);
      toast('Добавлено в избранное', 'good');
      Sfx.good();
    }
    save(); renderResult(); renderLists();
  }

  function shareCurrent() {
    if (!current) { toast('Сначала создай оправдание', 'bad'); return; }
    if (navigator.share) {
      navigator.share({ title: 'Генератор оправданий', text: current.text }).catch(() => {});
      Sfx.click();
    } else { copyText(current.text); toast('Ссылка не поддерживается — скопировано', 'good'); }
  }

  function showItem(item) {
    const tier = L.tierById(item.tier);
    current = {
      id: item.id, text: item.text, tier: item.tier,
      tierName: tier ? tier.name : '', icon: tier ? tier.icon : '✨',
      accent: tier ? tier.accent : 'var(--accent)', ts: item.ts || Date.now()
    };
    renderResult();
    Sfx.click();
  }

  function setTab(name) {
    activeTab = name;
    renderLists();
    if (name === 'base') { renderBase(); el.baseSearch.focus(); }
    Sfx.click();
  }

  function clearActive() {
    if (activeTab === 'history') { state.history = []; toast('История очищена'); }
    else if (activeTab === 'favorites') { state.favorites = []; toast('Избранное очищено'); }
    else if (activeTab === 'base') {
      el.baseSearch.value = '';
      renderBase();
      toast('Поиск очищен');
      return;
    } else {
      state.stats = { total: 0, byTier: {} };
      L.TIERS.forEach(t => { state.stats.byTier[t.id] = 0; });
      toast('Статистика сброшена');
    }
    save(); renderLists();
  }

  /* ============ События ============ */
  el.oracle.addEventListener('click', generate);
  el.againBtn.addEventListener('click', generate);

  el.credibility.addEventListener('input', () => {
    state.credibility = L.normalizeCredibility(el.credibility.value);
    renderCredibility(); save();
  });
  el.randomCred.addEventListener('click', () => {
    state.credibility = L.randomCredibility();
    renderCredibility(); renderChrome(); save(); Sfx.click();
  });
  el.detailed.addEventListener('change', () => { state.detailed = el.detailed.checked; save(); Sfx.click(); });

  el.copyBtn.addEventListener('click', copyCurrent);
  el.favBtn.addEventListener('click', toggleFavorite);
  el.shareBtn.addEventListener('click', shareCurrent);
  el.clearList.addEventListener('click', clearActive);
  el.dailyBtn.addEventListener('click', () => {
    const daily = L.excuseOfTheDay();
    showItem(daily);
    toast('Оправдание дня открыто');
  });

  Object.keys(el.tabs).forEach(k => el.tabs[k].addEventListener('click', () => setTab(k)));

  el.baseSearch.addEventListener('input', renderBase);

  el.listBase.addEventListener('click', e => {
    const node = e.target.closest('.item');
    if (!node) return;
    const item = L.allExcuses().find(i => i.id === node.dataset.id);
    if (item) showItem(item);
  });
  el.listBase.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const node = e.target.closest('.item');
    if (!node) return;
    e.preventDefault();
    const item = L.allExcuses().find(i => i.id === node.dataset.id);
    if (item) showItem(item);
  });

  [el.lists.history, el.lists.favorites].forEach(list => {
    list.addEventListener('click', e => {
      const node = e.target.closest('.item');
      if (!node) return;
      const all = state.history.concat(state.favorites);
      const item = all.find(i => i.id === node.dataset.id);
      if (item) showItem(item);
    });
    list.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const node = e.target.closest('.item');
      if (!node) return;
      e.preventDefault();
      const all = state.history.concat(state.favorites);
      const item = all.find(i => i.id === node.dataset.id);
      if (item) showItem(item);
    });
  });

  el.themeBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    renderChrome(); save(); Sfx.click();
  });
  el.soundBtn.addEventListener('click', () => {
    state.sound = !state.sound;
    renderChrome(); save();
    if (state.sound) Sfx.good();
  });

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;

    if (e.key === 'Escape' && current) {
      current = null; renderResult(); return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (tag === 'button') return;
      e.preventDefault(); generate(); return;
    }
    if (e.key === 'c' || e.key === 'C' || e.key === 'ц' || e.key === 'Ц') { copyCurrent(); return; }
    if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') { toggleFavorite(); return; }
    if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') { el.themeBtn.click(); return; }
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') { el.randomCred.click(); }
  });

  /* ============ Старт ============ */
  renderAll();
})();
