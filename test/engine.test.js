/* 算法行为测试：node test/engine.test.js */
const E = require('../engine.js');
const spots = require('../data/restaurants.json').restaurants;

let failures = 0;
function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
  if (!cond) failures += 1;
}

/* 固定时点：2026-10-23 周五，2026-10-24 周六 */
const workday = () => new Date(2026, 9, 23, 15, 0);   // 周五 15:00 非饭点
const lunch = () => new Date(2026, 9, 23, 12, 15);     // 周五 12:15 午饭峰值
const weekend = () => new Date(2026, 9, 24, 15, 0);    // 周六 15:00

function sample(prefs, dateOrFn, n = 4000) {
  const date = typeof dateOrFn === 'function' ? dateOrFn() : dateOrFn;
  const counts = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = E.pickOne(spots, prefs, date);
    if (!r.chosen) continue;
    counts.set(r.chosen.spot.name, (counts.get(r.chosen.spot.name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, c]) => ({ name, pct: (c / n) * 100 }))
    .sort((a, b) => b.pct - a.pct);
}

const base = { minutes: 90, taste: 0.5, people: 4, history: [] };
const rate = (list, name) => (list.find((x) => x.name === name) || { pct: 0 }).pct;

/* ---------- 1. 默认条件 ---------- */
console.log('\n[1] 默认：90 分钟 / 不挑 / 4 人 / 周五 15:00');
const d1 = sample(base, workday);
d1.slice(0, 6).forEach((x) => console.log(`     ${x.name.padEnd(8, '　')} ${x.pct.toFixed(1)}%`));
check('耗时 2 小时的烤肉不应出现', rate(d1, '烤肉自助') < 1, `${rate(d1, '烤肉自助').toFixed(1)}%`);
check('耗时 3 小时的火锅不应出现', rate(d1, '川味火锅') < 1, `${rate(d1, '川味火锅').toFixed(1)}%`);
check('清单里每家都有机会', new Set(d1.map((x) => x.name)).size >= 10);

/* ---------- 2. 时间收紧 ---------- */
console.log('\n[2] 只有 5 分钟');
const d2 = sample({ ...base, minutes: 5 }, workday, 2000);
console.log(`     ${d2.slice(0, 4).map((x) => `${x.name} ${x.pct.toFixed(0)}%`).join(' | ')}`);
check('5 分钟基本只剩便利店', rate(d2, '便利店饭团') > 70, `${rate(d2, '便利店饭团').toFixed(0)}%`);
check('5 分钟不会出现火锅', rate(d2, '川味火锅') === 0);

/* ---------- 3. 口味：极清淡 ---------- */
console.log('\n[3] 口味拉到最清淡（0.00）');
const d3 = sample({ ...base, taste: 0 }, workday, 3000);
console.log(`     ${d3.slice(0, 5).map((x) => `${x.name} ${x.pct.toFixed(0)}%`).join(' | ')}`);
check('重口火锅被压到接近 0', rate(d3, '川味火锅') < 1, `${rate(d3, '川味火锅').toFixed(1)}%`);
check('清淡的沙拉 / 早茶占主导', rate(d3, '轻食沙拉碗') + rate(d3, '粤式早茶') > 25);

/* ---------- 4. 口味：极重口，清淡不应被罚 ---------- */
console.log('\n[4] 口味拉到最重口（1.00）');
const d4 = sample({ ...base, taste: 1 }, workday, 3000);
console.log(`     ${d4.slice(0, 5).map((x) => `${x.name} ${x.pct.toFixed(0)}%`).join(' | ')}`);
check('清淡的沙拉仍有可观概率', rate(d4, '轻食沙拉碗') > 4, `${rate(d4, '轻食沙拉碗').toFixed(1)}%`);
check('清淡的早茶仍有可观概率', rate(d4, '粤式早茶') > 3, `${rate(d4, '粤式早茶').toFixed(1)}%`);

/* ---------- 5. 口味：中间不是峰，而是到某点陡降 ---------- */
console.log('\n[5] 口味 0.50 时的逐家权重曲线');
const ctx = E.buildContext(workday(), 90);
const curve = spots
  .map((s) => ({ name: s.name, t: s.taste, w: E.tasteFactor(s, 0.5).w }))
  .sort((a, b) => a.t - b.t);
console.log(`     ${curve.map((c) => `${c.t.toFixed(2)}:${c.w.toFixed(2)}`).join('  ')}`);
const heavyEnd = curve[curve.length - 1].w;
const lightEnd = curve[0].w;
check('最重口一端被陡降', heavyEnd < 0.15, `w=${heavyEnd.toFixed(3)}`);
check('最清淡一端几乎不降', lightEnd > 0.8, `w=${lightEnd.toFixed(3)}`);
check('中间段保持高位', curve.filter((c) => c.w > 0.6).length >= 5);

/* ---------- 6. 周六压缩 ---------- */
console.log('\n[6] 周末耗时上限压缩');
const capWorkday = E.effectiveMax(spots.find((s) => s.name === '港式茶餐厅'), false) * 60;
const capWeekend = E.effectiveMax(spots.find((s) => s.name === '港式茶餐厅'), true) * 60;
check('40–80 分 → 周末压到 60 分', Math.round(capWorkday) === 80 && Math.round(capWeekend) === 60,
  `${Math.round(capWorkday)} → ${Math.round(capWeekend)}`);
const rw = E.pickOne(spots, { ...base, minutes: 75 }, weekend());
const rh = E.pickOne(spots, { ...base, minutes: 75 }, workday());
const pickW = (r, name) => r.scored.find((x) => x.spot.name === name).w;
check('75 分钟时周末的茶餐厅权重高于平日',
  pickW(rw, '港式茶餐厅') > pickW(rh, '港式茶餐厅'),
  `${pickW(rw, '港式茶餐厅').toFixed(2)} > ${pickW(rh, '港式茶餐厅').toFixed(2)}`);

/* ---------- 7. 饭点折算 ---------- */
console.log('\n[7] 12:15 午饭高峰折算排队时间');
const cLunch = E.buildContext(lunch(), 90);
const cCalm = E.buildContext(workday(), 90);
check('12:15 峰值接近 1', cLunch.peak > 0.95, `peak=${cLunch.peak.toFixed(2)}`);
check('可用时间从 90 分钟折到 75 分钟', Math.round(cLunch.avail * 60) === 75,
  `${Math.round(cLunch.avail * 60)} 分`);
const hotA = E.timeFactor(spots.find((s) => s.name === '川味火锅'), cCalm).w;
const hotB = E.timeFactor(spots.find((s) => s.name === '川味火锅'), cLunch).w;
check('火锅在饭点更难被选中', hotB < hotA, `${hotA.toFixed(2)} → ${hotB.toFixed(2)}`);

/* ---------- 8. 人数 ---------- */
console.log('\n[8] 10 个人');
const d8 = sample({ ...base, people: 10 }, workday, 3000);
console.log(`     ${d8.slice(0, 5).map((x) => `${x.name} ${x.pct.toFixed(0)}%`).join(' | ')}`);
check('只能坐 4 人的沙县基本出局', rate(d8, '沙县小吃') < 1, `${rate(d8, '沙县小吃').toFixed(1)}%`);
check('能坐 12 人的食堂 / 火锅上场', rate(d8, '一层员工食堂') + rate(d8, '川味火锅') > 20);

/* ---------- 9. 3 小时全开 ---------- */
console.log('\n[9] 给足 3 小时');
const d9 = sample({ ...base, minutes: 180, taste: 0.5, people: 4 }, workday, 3000);
const hot = spots.find((s) => s.name === '川味火锅');
const hotTime = (mins) => E.timeFactor(hot, E.buildContext(workday(), mins)).w;
check('火锅的时间权重从 0.35 提到 1', hotTime(90).toFixed(2) === '0.35' && hotTime(180) === 1,
  `${hotTime(90).toFixed(2)} → ${hotTime(180).toFixed(2)}`);
check('火锅终于有机会出现', rate(d9, '川味火锅') > 0.3, `${rate(d9, '川味火锅').toFixed(1)}%`);
check('烤肉也上场', rate(d9, '烤肉自助') > 1, `${rate(d9, '烤肉自助').toFixed(1)}%`);
console.log('     注：权重被口味压着（0.95 对「不挑」算很远），所以出现率仍低，属预期');

/* ---------- 10. 无解时兜底 ---------- */
console.log('\n[10] 极端条件兜底（5 分钟 + 10 人）');
const r10 = E.pickOne(spots, { ...base, minutes: 5, people: 10 }, workday());
check('仍然有结果，不崩', Boolean(r10.chosen));
check('标记为放宽模式', r10.relaxed === true);
console.log(`     → ${r10.chosen.spot.name}（匹配度 ${(r10.chosen.w * 100).toFixed(0)}%）`);

/* ---------- 11. 历史降权 ---------- */
console.log('\n[11] 刚吃过的会被降权');
const ctxH = E.buildContext(workday(), 90);
const noHist = E.scoreAll(spots, { ...base, history: [] }, ctxH).find((x) => x.spot.name === '老王牛肉面').w;
const withHist = E.scoreAll(spots, { ...base, history: ['noodle-wang'] }, ctxH).find((x) => x.spot.name === '老王牛肉面').w;
check('权重降到 1/4', Math.abs(withHist - noHist * 0.25) < 1e-9, `${noHist.toFixed(3)} → ${withHist.toFixed(3)}`);

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}\n`);
process.exit(failures === 0 ? 0 : 1);
