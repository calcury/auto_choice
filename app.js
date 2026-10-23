/* ============================================================
   今天吃哪儿 —— 界面层（逻辑在 engine.js）
   ============================================================ */
(() => {
  'use strict';

  const Engine = window.Engine;
  const KEY_SPOTS = 'auto_choice.spots.v1';
  const DATA_URL = './data/restaurants.json';

  /* 默认清单：仓库 data/restaurants.json 的副本。
     用 file:// 直接打开时 fetch 会失败，靠它兜底。 */
  const FALLBACK_SPOTS = [
    { id: 'canteen-1',    name: '一层员工食堂',   minMinutes: 20,  maxMinutes: 45,  taste: 0.25, maxPeople: 12, note: '打饭快，菜式轮换' },
    { id: 'canteen-2',    name: '二层盖浇饭窗口', minMinutes: 25,  maxMinutes: 50,  taste: 0.45, maxPeople: 10, note: '现炒，饭点要等' },
    { id: 'noodle-wang',  name: '老王牛肉面',     minMinutes: 30,  maxMinutes: 60,  taste: 0.55, maxPeople: 6,  note: '汤头浓，出餐稳定' },
    { id: 'shaxian',      name: '沙县小吃',       minMinutes: 15,  maxMinutes: 35,  taste: 0.40, maxPeople: 4,  note: '快，位子少' },
    { id: 'mcd',          name: '麦当劳',         minMinutes: 15,  maxMinutes: 40,  taste: 0.60, maxPeople: 8,  note: '自助点单，不挑人' },
    { id: 'salad',        name: '轻食沙拉碗',     minMinutes: 20,  maxMinutes: 40,  taste: 0.08, maxPeople: 6,  note: '冷食，吃完不困' },
    { id: 'hunan',        name: '湘菜小馆',       minMinutes: 60,  maxMinutes: 100, taste: 0.85, maxPeople: 10, note: '辣，适合多人点菜' },
    { id: 'hotpot',       name: '川味火锅',       minMinutes: 90,  maxMinutes: 180, taste: 0.95, maxPeople: 12, note: '耗时大户，得留足时间' },
    { id: 'japanese',     name: '日式定食',       minMinutes: 45,  maxMinutes: 75,  taste: 0.30, maxPeople: 6,  note: '安静，出餐稍慢' },
    { id: 'lanzhou',      name: '兰州拉面',       minMinutes: 25,  maxMinutes: 50,  taste: 0.45, maxPeople: 8,  note: '翻台快' },
    { id: 'chachanteng',  name: '港式茶餐厅',     minMinutes: 40,  maxMinutes: 80,  taste: 0.35, maxPeople: 8,  note: '选择多，适合凑人' },
    { id: 'bbq',          name: '烤肉自助',       minMinutes: 120, maxMinutes: 180, taste: 0.90, maxPeople: 10, note: '至少两小时，别赶时间' },
    { id: 'dumpling',     name: '东北饺子馆',     minMinutes: 35,  maxMinutes: 70,  taste: 0.50, maxPeople: 10, note: '实在，管饱' },
    { id: 'thai',         name: '泰式咖喱',       minMinutes: 50,  maxMinutes: 90,  taste: 0.75, maxPeople: 6,  note: '偏甜辣，评价两极' },
    { id: 'convenience',  name: '便利店饭团',     minMinutes: 5,   maxMinutes: 15,  taste: 0.30, maxPeople: 2,  note: '赶时间专属，站着吃' },
    { id: 'dimsum',       name: '粤式早茶',       minMinutes: 60,  maxMinutes: 120, taste: 0.20, maxPeople: 12, note: '清淡，但要慢慢吃' },
  ];

  const state = {
    minutes: 90,
    taste: 0.5,
    people: 4,
    spots: [],
    lastPickId: null,
    rolling: false,
  };

  const $ = (id) => document.getElementById(id);

  /* ---------- 格式化 ---------- */

  function fmtMinutes(m) {
    const v = Math.round(m);
    if (v < 60) return `${v} 分钟`;
    const h = Math.floor(v / 60);
    const r = v % 60;
    return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
  }

  function tasteLabel(v) {
    if (v < 0.2) return '很清淡';
    if (v < 0.4) return '偏清淡';
    if (v < 0.6) return '不挑';
    if (v < 0.8) return '偏重口';
    return '重口';
  }

  /* ---------- 存储 ---------- */

  function readStore(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* 隐私模式下写不进去，忽略 */
    }
  }

  function normalize(raw) {
    if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    const min = Number(raw.minMinutes);
    const max = Number(raw.maxMinutes);
    const taste = Number(raw.taste);
    const maxPeople = Number(raw.maxPeople);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;

    return {
      id: raw.id || `s-${Math.random().toString(36).slice(2, 9)}`,
      name: raw.name.trim().slice(0, 24),
      minMinutes: Math.max(1, Math.round(min)),
      maxMinutes: Math.max(1, Math.round(max)),
      taste: Math.min(1, Math.max(0, Number.isFinite(taste) ? taste : 0.5)),
      maxPeople: Math.max(1, Math.round(Number.isFinite(maxPeople) ? maxPeople : 8)),
      note: typeof raw.note === 'string' ? raw.note.slice(0, 40) : '',
      custom: raw.custom === true,
    };
  }

  const persistSpots = () => writeStore(KEY_SPOTS, state.spots);

  /* ---------- 载入 ---------- */

  async function fetchRepoSpots() {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data && data.restaurants;
    if (!Array.isArray(list) || list.length === 0) throw new Error('清单为空');

    const spots = list.map(normalize).filter(Boolean);
    if (spots.length === 0) throw new Error('清单格式不对');
    return spots;
  }

  async function boot() {
    // 旧版「记下这顿」的遗留，清掉
    try { localStorage.removeItem('auto_choice.history.v1'); } catch (_) { /* 忽略 */ }

    const saved = readStore(KEY_SPOTS);
    if (Array.isArray(saved) && saved.length) {
      state.spots = saved.map(normalize).filter(Boolean);
    } else {
      try {
        state.spots = await fetchRepoSpots();
      } catch (_) {
        state.spots = FALLBACK_SPOTS.slice();
      }
      persistSpots();
    }

    syncInputs();
    bindEvents();
    renderSpots();
    updateStatus();
    updatePickAvailability();
  }

  /* ---------- 渲染 ---------- */

  function syncInputs() {
    $('time').value = state.minutes;
    $('taste').value = Math.round(state.taste * 100);
    $('people').value = state.people;
    renderReadouts();
  }

  function renderReadouts() {
    $('timeOut').textContent = fmtMinutes(state.minutes);
    $('tasteOut').textContent = tasteLabel(state.taste);
    $('peopleOut').textContent = `${state.people} 人`;
  }

  function updateStatus() {
    const ctx = Engine.buildContext(new Date(), state.minutes);
    const bits = [];

    if (ctx.weekend) bits.push('周末 · 耗时上限压到中点');
    if (ctx.peak > 0.05) bits.push(`饭点 · 折掉 ${Math.round(ctx.queue * 60)} 分钟排队`);
    if (bits.length === 0) bits.push('非饭点 · 按区间中位估算');

    $('statusText').textContent = bits.join(' · ');
    $('statusAvail').textContent = `可用 ${fmtMinutes(ctx.avail * 60)}`;
  }

  function renderSpots() {
    const list = $('spotList');
    list.innerHTML = '';
    $('spotCount').textContent = String(state.spots.length);

    for (const spot of state.spots) {
      const li = document.createElement('li');

      const nameWrap = document.createElement('div');
      const name = document.createElement('span');
      name.className = 's-name';
      name.textContent = spot.name;
      nameWrap.appendChild(name);

      if (spot.custom) {
        const tag = document.createElement('span');
        tag.className = 'tag-custom';
        tag.textContent = '自定义';
        nameWrap.appendChild(tag);
      }

      const sub = document.createElement('span');
      sub.className = 's-sub';
      const notePart = spot.note ? ` · ${spot.note}` : '';
      sub.textContent = `${Math.round(spot.minMinutes)}–${Math.round(spot.maxMinutes)} 分 · 口味 ${spot.taste.toFixed(2)} · ≤${spot.maxPeople} 人${notePart}`;
      nameWrap.appendChild(sub);

      const del = document.createElement('button');
      del.className = 's-del';
      del.type = 'button';
      del.title = `删除 ${spot.name}`;
      del.setAttribute('aria-label', `删除 ${spot.name}`);
      del.textContent = '×';
      del.addEventListener('click', () => removeSpot(spot.id));

      li.append(nameWrap, del);
      list.appendChild(li);
    }
  }

  function updatePickAvailability() {
    const empty = state.spots.length === 0;
    $('pickBtn').disabled = empty || state.rolling;
    if (empty) $('pickBtn').textContent = '清单是空的，先加一家';
    else if (!state.rolling) $('pickBtn').textContent = '帮我选一个';
  }

  function clearResult() {
    $('resultName').textContent = '';
    $('resultNote').textContent = '';
    $('resultBreak').innerHTML = '';
    $('resultMeta').textContent = '';
  }

  function renderBreak(pick, ctx) {
    const ul = $('resultBreak');
    ul.innerHTML = '';
    const spot = pick.spot;

    const weekendNote = ctx.weekend && spot.maxMinutes > spot.minMinutes
      ? `${Math.round(spot.minMinutes)}–${Math.round(spot.maxMinutes)} 分（周末压到 ${Math.round(pick.t.cap * 60)}）`
      : `${Math.round(spot.minMinutes)}–${Math.round(spot.maxMinutes)} 分`;

    const rows = [
      { level: pick.t.level, label: '时间', text: weekendNote, val: `可用 ${fmtMinutes(ctx.avail * 60)}` },
      { level: pick.ta.level, label: '口味', text: `${tasteLabel(spot.taste)} ${spot.taste.toFixed(2)}`, val: `你选 ${state.taste.toFixed(2)}` },
      { level: pick.p.level, label: '人数', text: `建议 ≤ ${spot.maxPeople} 人`, val: `你们 ${state.people} 人` },
    ];

    for (const row of rows) {
      const li = document.createElement('li');
      li.className = row.level;

      const dot = document.createElement('span');
      dot.className = 'dot';

      const text = document.createElement('span');
      text.textContent = `${row.label} · ${row.text}`;

      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = row.val;

      li.append(dot, text, val);
      ul.appendChild(li);
    }
  }

  /* ---------- 抽选 ---------- */

  function rollName(el, finalName, names) {
    return new Promise((resolve) => {
      const duration = 1000;
      const start = performance.now();

      const tick = () => {
        const elapsed = performance.now() - start;
        if (elapsed >= duration) {
          el.textContent = finalName;
          el.classList.remove('rolling');
          resolve();
          return;
        }
        el.textContent = names[(Math.random() * names.length) | 0];
        setTimeout(tick, 45 + Math.pow(elapsed / duration, 3) * 230);
      };

      el.classList.add('rolling');
      tick();
    });
  }

  async function pick(excludeId) {
    if (state.rolling || state.spots.length === 0) return;

    const result = Engine.pickOne(
      state.spots,
      { minutes: state.minutes, taste: state.taste, people: state.people },
      new Date(),
      excludeId
    );

    if (!result.chosen) return;

    state.rolling = true;
    updatePickAvailability();
    $('pickBtn').textContent = '正在挑…';

    const card = $('result');
    card.hidden = false;
    clearResult();
    $('resultEyebrow').textContent = result.relaxed ? '勉强能去的' : '就它了';

    const names = result.pool.map((it) => it.spot.name);
    await rollName($('resultName'), result.chosen.spot.name, names.length > 1 ? names : [result.chosen.spot.name]);

    $('resultNote').textContent = result.chosen.spot.note || '';
    renderBreak(result.chosen, result.ctx);

    const matchPct = Math.round(result.chosen.w * 100);
    $('resultMeta').textContent = result.relaxed
      ? `${state.spots.length} 家里没有严格合适的，从最接近的 ${result.pool.length} 家里抽的 · 匹配度 ${matchPct}%`
      : `${state.spots.length} 家里有 ${result.viableCount} 家可去，按权重抽中的 · 匹配度 ${matchPct}%`;

    state.lastPickId = result.chosen.spot.id;
    state.rolling = false;
    updatePickAvailability();
  }

  /* ---------- 事件 ---------- */

  function bindEvents() {
    $('time').addEventListener('input', (e) => {
      state.minutes = Number(e.target.value);
      renderReadouts();
      updateStatus();
    });

    $('taste').addEventListener('input', (e) => {
      state.taste = Number(e.target.value) / 100;
      renderReadouts();
    });

    $('people').addEventListener('input', (e) => {
      state.people = Number(e.target.value);
      renderReadouts();
    });

    $('pickBtn').addEventListener('click', () => pick(state.lastPickId));
    $('againBtn').addEventListener('click', () => pick(state.lastPickId));

    $('addTaste').addEventListener('input', (e) => {
      $('addTasteOut').textContent = tasteLabel(Number(e.target.value) / 100);
    });

    $('addForm').addEventListener('submit', onAddSpot);
    $('reloadBtn').addEventListener('click', onReload);
    $('exportBtn').addEventListener('click', onExport);
    $('importInput').addEventListener('change', onImport);
  }

  function onAddSpot(e) {
    e.preventDefault();
    const err = $('addError');
    err.hidden = true;

    const name = $('addName').value.trim();
    const min = Number($('addMin').value);
    const max = Number($('addMax').value);
    const maxPeople = Number($('addPeople').value);
    const taste = Number($('addTaste').value) / 100;

    const fail = (msg) => {
      err.textContent = msg;
      err.hidden = false;
    };

    if (!name) return fail('先给它起个名字。');
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return fail('耗时填个正数。');
    if (max < min) return fail('最慢耗时不能小于最快耗时。');
    if (!Number.isFinite(maxPeople) || maxPeople < 1) return fail('最多人数至少为 1。');

    state.spots.push({
      id: `custom-${Date.now().toString(36)}`,
      name: name.slice(0, 24),
      minMinutes: Math.round(min),
      maxMinutes: Math.round(max),
      taste,
      maxPeople: Math.round(maxPeople),
      note: '',
      custom: true,
    });

    persistSpots();
    renderSpots();
    updatePickAvailability();
    updateStatus();

    $('addForm').reset();
    $('addMin').value = 30;
    $('addMax').value = 60;
    $('addPeople').value = 8;
    $('addTaste').value = 50;
    $('addTasteOut').textContent = '不挑';
  }

  function removeSpot(id) {
    state.spots = state.spots.filter((s) => s.id !== id);
    if (state.lastPickId === id) state.lastPickId = null;
    persistSpots();
    renderSpots();
    updatePickAvailability();
    updateStatus();
  }

  async function onReload() {
    const btn = $('reloadBtn');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '读取中…';

    try {
      const remote = await fetchRepoSpots();
      const customs = state.spots.filter((s) => s.custom);
      const remoteIds = new Set(remote.map((s) => s.id));
      state.spots = remote.concat(customs.filter((s) => !remoteIds.has(s.id)));
      persistSpots();
      renderSpots();
      updatePickAvailability();
      btn.textContent = `已载入 ${remote.length} 家`;
    } catch (_) {
      btn.textContent = '仓库读取失败';
    } finally {
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1600);
      updateStatus();
    }
  }

  function onExport() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      note: 'minMinutes/maxMinutes 单位为分钟；taste 0=极清淡 1=极重口；maxPeople 为建议人数上限。',
      restaurants: state.spots.map((s) => ({
        id: s.id,
        name: s.name,
        minMinutes: s.minMinutes,
        maxMinutes: s.maxMinutes,
        taste: s.taste,
        maxPeople: s.maxPeople,
        note: s.note,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `restaurants-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function onImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const list = Array.isArray(data) ? data : data && data.restaurants;
        if (!Array.isArray(list)) throw new Error('找不到 restaurants 数组');

        const spots = list.map(normalize).filter(Boolean);
        if (spots.length === 0) throw new Error('没有有效条目');

        state.spots = spots;
        persistSpots();
        renderSpots();
        updatePickAvailability();
        updateStatus();
        $('importInput').value = '';
      } catch (err) {
        window.alert(`导入失败：${err.message}`);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  boot();
})();
