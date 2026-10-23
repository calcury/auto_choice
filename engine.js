/* ============================================================
   今天吃哪儿 —— 纯逻辑层
   不碰 DOM，浏览器与 node 共用（node 下用于测试）。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* 调参集中在这里，改行为不用翻全文 */
  const TUNING = {
    lightSlope: 0.15,      // 比用户清淡的方向：每单位距离衰减 15%，几乎不罚
    heavyMid: 0.3,         // 比用户重口的方向：绝对差值到这里掉到一半
    heavySlope: 14,        // 越过中点后的陡度
    peopleFalloff: 0.42,   // 每超 1 人的权重系数（可以挤一挤）
    timeFalloff: 3.5,      // 连最短耗时都不够时的衰减速度
    queuePeakHours: 0.25,  // 饭点峰值折算 15 分钟排队
    viable: 0.05,          // 低于此权重视为不可行
    pickFalloff: 0.05,     // 「换一个」时当前这家临时降权
    relaxCount: 5,         // 全军覆没时取最接近的几家
  };

  /* ---------- 时间 ---------- */

  function triangle(m, start, peak, end) {
    if (m <= start || m >= end) return 0;
    return m <= peak ? (m - start) / (peak - start) : (end - m) / (end - peak);
  }

  /** 饭点强度 0..1：午饭 11:30–13:00 峰在 12:15，晚饭 17:30–18:30 峰在 18:00 */
  function peakness(minutesOfDay) {
    return Math.max(
      triangle(minutesOfDay, 11 * 60 + 30, 12 * 60 + 15, 13 * 60),
      triangle(minutesOfDay, 17 * 60 + 30, 18 * 60, 18 * 60 + 30)
    );
  }

  /** 周末压缩后的耗时上限（小时）：1–2h → 1–1.5h，即压到区间中点 */
  function effectiveMax(spot, weekend) {
    const a = spot.minMinutes / 60;
    const b = spot.maxMinutes / 60;
    return weekend ? a + (b - a) / 2 : b;
  }

  /**
   * 当下上下文。
   * 周末：耗时上限压到区间中点。
   * 饭点：视作耗时趋向上限，先从可用时间里扣掉排队时间。
   */
  function buildContext(date, availableMinutes) {
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const peak = peakness(date.getHours() * 60 + date.getMinutes());
    const queue = peak * TUNING.queuePeakHours;
    const rawHours = availableMinutes / 60;
    return {
      weekend,
      peak,
      queue,
      rawHours,
      avail: Math.max(rawHours - queue, 5 / 60),
    };
  }

  function timeFactor(spot, ctx) {
    const a = spot.minMinutes / 60;
    const b = effectiveMax(spot, ctx.weekend);

    if (ctx.avail >= b) return { w: 1, level: 'ok', cap: b };
    if (ctx.avail >= a) {
      const r = (ctx.avail - a) / Math.max(b - a, 1e-6);
      return { w: 0.35 + 0.65 * r, level: 'mid', cap: b };
    }
    const over = (a - ctx.avail) / Math.max(a, 0.08);
    return { w: 0.35 * Math.exp(-TUNING.timeFalloff * over), level: 'bad', cap: b };
  }

  /* ---------- 口味 ---------- */

  /**
   * 口味权重。用的是口味刻度上的绝对差值，不用归一化比例 ——
   * 否则拉到头（0 或 1）时剩余空间被压缩，区分度会失真。
   *
   * 比用户清淡的方向近乎不罚（重口的人吃清淡的完全 OK）。
   * 比用户重口的方向走 sigmoid：平台期之后急剧下掉，而不是钟形分布。
   */
  function tasteFactor(spot, taste) {
    const d = spot.taste - taste;
    if (d <= 0.001) {
      const room = Math.max(taste, 0.02);
      const x = Math.min(1, -d / room);
      return { w: 1 - TUNING.lightSlope * x, level: 'ok' };
    }
    const w = 1 / (1 + Math.exp(TUNING.heavySlope * (d - TUNING.heavyMid)));
    return { w, level: w > 0.6 ? 'ok' : w > 0.3 ? 'mid' : 'bad' };
  }

  /* ---------- 人数 ---------- */

  function peopleFactor(spot, people) {
    const over = people - spot.maxPeople;
    if (over <= 0) return { w: 1, level: 'ok' };
    return {
      w: Math.pow(TUNING.peopleFalloff, over),
      level: over <= 1 ? 'mid' : 'bad',
    };
  }

  /* ---------- 汇总 ---------- */

  function scoreAll(spots, prefs, ctx, excludeId) {
    return spots.map((spot) => {
      const t = timeFactor(spot, ctx);
      const ta = tasteFactor(spot, prefs.taste);
      const p = peopleFactor(spot, prefs.people);

      let w = t.w * ta.w * p.w;
      if (spot.id === excludeId) w *= TUNING.pickFalloff;

      return { spot, w, t, ta, p };
    });
  }

  function weightedPick(items) {
    const total = items.reduce((sum, it) => sum + it.w, 0);
    if (total <= 0) return items[Math.floor(Math.random() * items.length)];
    let r = Math.random() * total;
    for (const it of items) {
      r -= it.w;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** 一步到位：筛池子 → 抽一个 */
  function pickOne(spots, prefs, date, excludeId) {
    const ctx = buildContext(date, prefs.minutes);
    let scored = scoreAll(spots, prefs, ctx, excludeId);
    let pool = scored.filter((it) => it.w >= TUNING.viable);
    let relaxed = false;

    // 「换一个」可能把唯一的可选项压到阈值以下。这时候退回不排除重算，
    // 而不是放宽到「最接近的几家」—— 唯一答案就该还是它。
    if (pool.length === 0 && excludeId) {
      scored = scoreAll(spots, prefs, ctx, null);
      pool = scored.filter((it) => it.w >= TUNING.viable);
    }

    if (pool.length === 0) {
      relaxed = true;
      pool = scored.slice().sort((a, b) => b.w - a.w).slice(0, Math.min(TUNING.relaxCount, scored.length));
    }

    return {
      ctx,
      scored,
      pool,
      relaxed,
      viableCount: scored.filter((it) => it.w >= TUNING.viable).length,
      chosen: pool.length ? weightedPick(pool) : null,
    };
  }

  return {
    TUNING,
    peakness,
    effectiveMax,
    buildContext,
    timeFactor,
    tasteFactor,
    peopleFactor,
    scoreAll,
    weightedPick,
    pickOne,
  };
});
