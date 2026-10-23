/* ============================================================
   今天吃哪儿 —— 纯逻辑层
   不碰 DOM，浏览器与 node 共用（node 下用于测试）。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TUNING = {
    bufferMinutes: 5,      // 时间缓冲：可用 = 输入 - 缓冲，且必须「预计耗时 < 可用」
    lightSlope: 0.15,      // 比用户清淡的方向：每单位距离衰减 15%，几乎不罚
    heavyMid: 0.3,         // 比用户重口的方向：绝对差值到这里掉到一半
    heavySlope: 14,        // 越过中点后的陡度
    peopleFalloff: 0.42,   // 每超 1 人的权重系数（可以挤一挤）
    viable: 0.05,          // 口味/人数权重低于此值时不作首选
    pickFalloff: 0.05,     // 「换一个」时当前这家临时降权
    closestCount: 3,       // 无解时给几家最接近的作参考
  };

  /* ---------- 饭点强度 ---------- */

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

  /* ---------- 时间 ---------- */

  /** 周末把耗时上限压到区间中点：1–2h → 1–1.5h。返回分钟。 */
  function effectiveMax(spot, weekend) {
    const a = spot.minMinutes;
    const b = spot.maxMinutes;
    return weekend ? a + (b - a) / 2 : b;
  }

  /**
   * 一家店在当前时点的预计耗时（分钟）。
   * 基准取区间中点；饭点排队会把它推向区间上限；周末区间整体下移。
   */
  function expectedMinutes(spot, ctx) {
    const a = spot.minMinutes;
    const b = effectiveMax(spot, ctx.weekend);
    const mid = (a + b) / 2;
    return mid + (b - mid) * ctx.peak;
  }

  /**
   * 当下上下文。
   * usable 是真正拿来卡时间的额度：输入值先扣掉缓冲，避免「刚好卡点」。
   */
  function buildContext(date, requestedMinutes) {
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const peak = peakness(date.getHours() * 60 + date.getMinutes());
    return {
      weekend,
      peak,
      requested: requestedMinutes,
      buffer: TUNING.bufferMinutes,
      usable: Math.max(requestedMinutes - TUNING.bufferMinutes, 0),
    };
  }

  /* ---------- 口味 ---------- */

  /**
   * 用的是口味刻度上的绝对差值，不用归一化比例 ——
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

  /* ---------- 校内外 ---------- */

  /** 兼容配置里的中文键「校内」和内部字段 onCampus，缺省算校内 */
  function isOnCampus(spot) {
    if (typeof spot.onCampus === 'boolean') return spot.onCampus;
    if (typeof spot['校内'] === 'boolean') return spot['校内'];
    return true;
  }

  function matchesCampus(spot, campus) {
    return campus === 'off' ? !isOnCampus(spot) : isOnCampus(spot);
  }

  /* ---------- 汇总 ---------- */

  /**
   * 校内：时间是一道硬门槛，预计耗时必须严格小于可用时间。
   * 校外：路上来回估不准，时间不参与判定。
   * 口味和人数在剩下的店里决定谁更可能被抽中。
   */
  function scoreAll(spots, prefs, ctx, excludeId) {
    const ignoreTime = prefs.campus === 'off';

    return spots.map((spot) => {
      const exp = expectedMinutes(spot, ctx);
      const fits = ignoreTime || exp < ctx.usable;
      const ta = tasteFactor(spot, prefs.taste);
      const p = peopleFactor(spot, prefs.people);

      let w = fits ? ta.w * p.w : 0;
      if (fits && spot.id === excludeId) w *= TUNING.pickFalloff;

      return { spot, w, exp, fits, ta, p };
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

  /** 一步到位：卡校内外 → 卡时间 → 筛口味人数 → 抽一个 */
  function pickOne(spots, prefs, date, excludeId) {
    const ctx = buildContext(date, prefs.minutes);
    const campus = prefs.campus === 'off' ? 'off' : 'on';
    const candidates = spots.filter((s) => matchesCampus(s, campus));

    if (candidates.length === 0) {
      return {
        ctx, campus, scored: [], pool: [], chosen: null,
        reason: 'empty', timedCount: 0, nearest: [],
      };
    }

    const scored = scoreAll(candidates, prefs, ctx, excludeId);
    const nearest = scored
      .slice()
      .sort((a, b) => a.exp - b.exp)
      .slice(0, TUNING.closestCount);

    const timed = scored.filter((it) => it.fits);

    if (timed.length === 0) {
      return { ctx, campus, scored, pool: [], chosen: null, reason: 'time', timedCount: 0, nearest };
    }

    // 时间都够、只是口味或人数不理想时，仍然从来得及的店里选，不该报无解
    let pool = timed.filter((it) => it.w >= TUNING.viable);
    if (pool.length === 0) pool = timed;

    return {
      ctx,
      campus,
      scored,
      pool,
      nearest,
      reason: null,
      timedCount: timed.length,
      chosen: weightedPick(pool),
    };
  }

  return {
    TUNING,
    peakness,
    effectiveMax,
    expectedMinutes,
    buildContext,
    isOnCampus,
    matchesCampus,
    tasteFactor,
    peopleFactor,
    scoreAll,
    weightedPick,
    pickOne,
  };
});
