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

const base = { minutes: 90, taste: 0.5, people: 5, campus: 'on' };
const byName = (name) => spots.find((s) => s.name === name);
const rate = (list, name) => (list.find((x) => x.name === name) || { pct: 0 }).pct;

/* ---------- 1. 预计耗时的算法 ---------- */
console.log('\n[1] 预计耗时怎么算');
const instant = byName('便利店饭团');           // 5–15 分钟
const wang = byName('老王牛肉面');              // 30–60 分钟
const ctxCalm = E.buildContext(workday(), 90);
const ctxLunch = E.buildContext(lunch(), 90);
const ctxWeekend = E.buildContext(weekend(), 90);
check('非饭点 = 区间中点', E.expectedMinutes(instant, ctxCalm) === 10,
  `${E.expectedMinutes(instant, ctxCalm)} 分`);
check('饭点峰值 = 区间上限', E.expectedMinutes(instant, ctxLunch) === 15,
  `${E.expectedMinutes(instant, ctxLunch)} 分`);
check('11:52 处在中间过渡', (() => {
  const v = E.expectedMinutes(wang, E.buildContext(new Date(2026, 9, 23, 11, 52), 90));
  return v > 45 && v < 60;
})(), `${E.expectedMinutes(wang, E.buildContext(new Date(2026, 9, 23, 11, 52), 90)).toFixed(1)} 分`);
check('周末上限压到区间中点', E.effectiveMax(wang, true) === 45, `${E.effectiveMax(wang, true)} 分`);
check('周末预计耗时整体下移', E.expectedMinutes(wang, ctxWeekend) === 37.5,
  `${E.expectedMinutes(wang, ctxWeekend)} 分`);

/* ---------- 2. 缓冲与严格小于 ---------- */
console.log('\n[2] 缓冲 5 分钟 + 严格小于');
check('可用 = 输入 − 5', ctxCalm.usable === 85, `usable=${ctxCalm.usable}`);

const solo = (minutes) => E.pickOne([wang], { ...base, minutes }, workday());
check('正好卡点（可用 45，预计 45）不算通过', solo(50).reason === 'time');
check('多给 1 分钟就通过', solo(51).reason === null);

/* ---------- 3. 默认条件 ---------- */
console.log('\n[3] 默认：校内 / 90 分钟 / 不挑 / 5 人 / 周五 15:00');
const d3 = sample(base, workday);
d3.slice(0, 6).forEach((x) => console.log(`     ${x.name.padEnd(8, '　')} ${x.pct.toFixed(1)}%`));
const timely = E.pickOne(spots, base, workday()).timedCount;
check('校内 14 家里 13 家来得及', timely === 13, `timed=${timely}`);
check('校外店不会混进校内结果', rate(d3, '川味火锅') === 0 && rate(d3, '商场美食层') === 0);
check('2 小时的早茶来不及', rate(d3, '粤式早茶') === 0);
check('分布没有一家独大', d3[0].pct < 16, `最高 ${d3[0].pct.toFixed(1)}%`);
check('来得及的都有机会', d3.length >= 10);

/* ---------- 4. 时间收紧 ---------- */
console.log('\n[4] 时间收紧');
const r10 = E.pickOne(spots, { ...base, minutes: 10 }, workday());
check('10 分钟无解（可用只剩 5）', r10.reason === 'time', `usable=${r10.ctx.usable}`);
check('无解时给出最快的一家', r10.nearest[0].spot.name === '便利店饭团', r10.nearest[0].spot.name);

const d20 = sample({ ...base, minutes: 20 }, workday(), 2000);
check('20 分钟只剩便利店', d20.length === 1 && d20[0].name === '便利店饭团',
  d20.map((x) => x.name).join(','));

const d30 = sample({ ...base, minutes: 30 }, workday(), 2000);
check('30 分钟沙县仍出局（25 不严格小于 25）', rate(d30, '沙县小吃') === 0,
  d30.map((x) => x.name).join(','));

const d35 = sample({ ...base, minutes: 35 }, workday(), 2000);
check('35 分钟沙县才进来', rate(d35, '沙县小吃') > 0,
  d35.map((x) => x.name).join(','));

/* ---------- 5. 口味：极清淡 ---------- */
console.log('\n[5] 口味拉到最清淡（0.00），默认 90 分钟');
const d5 = sample({ ...base, taste: 0 }, workday, 3000);
console.log(`     ${d5.slice(0, 5).map((x) => `${x.name} ${x.pct.toFixed(0)}%`).join(' | ')}`);
check('重口火锅来不及，权重也为 0', rate(d5, '川味火锅') === 0);
check('清淡的沙拉明显占优', rate(d5, '轻食沙拉碗') > 25, `${rate(d5, '轻食沙拉碗').toFixed(0)}%`);
check('早茶 90 分钟来不及，自然不出现', rate(d5, '粤式早茶') === 0);

/* ---------- 6. 口味：极重口（放长到 2 小时，排除时间门槛干扰） ---------- */
console.log('\n[6] 口味拉到最重口（1.00），120 分钟');
const d6 = sample({ ...base, minutes: 120, taste: 1 }, workday, 3000);
console.log(`     ${d6.slice(0, 5).map((x) => `${x.name} ${x.pct.toFixed(0)}%`).join(' | ')}`);
check('清淡的沙拉仍有可观概率', rate(d6, '轻食沙拉碗') > 4, `${rate(d6, '轻食沙拉碗').toFixed(1)}%`);
check('清淡的早茶仍有可观概率', rate(d6, '粤式早茶') > 3, `${rate(d6, '粤式早茶').toFixed(1)}%`);

/* ---------- 7. 口味曲线 ---------- */
console.log('\n[7] 口味 0.50 时的逐家权重');
const curve = spots.map((s) => ({ t: s.taste, w: E.tasteFactor(s, 0.5).w })).sort((a, b) => a.t - b.t);
console.log(`     ${curve.map((c) => `${c.t.toFixed(2)}:${c.w.toFixed(2)}`).join('  ')}`);
check('最重口一端被陡降', curve[curve.length - 1].w < 0.15, `w=${curve[curve.length - 1].w.toFixed(3)}`);
check('最清淡一端几乎不降', curve[0].w > 0.8, `w=${curve[0].w.toFixed(3)}`);
check('中间段保持高位', curve.filter((c) => c.w > 0.6).length >= 5);

/* ---------- 8. 饭点收紧 ---------- */
console.log('\n[8] 12:15 午饭高峰');
const calm = E.pickOne(spots, base, workday());
const rush = E.pickOne(spots, base, lunch());
check('饭点来得及的店更少', rush.timedCount < calm.timedCount, `${calm.timedCount} → ${rush.timedCount}`);
const hunan = byName('湘菜小馆');
check('湘菜非饭点来得及、饭点来不及',
  E.expectedMinutes(hunan, calm.ctx) < calm.ctx.usable &&
  E.expectedMinutes(hunan, rush.ctx) >= rush.ctx.usable,
  `${E.expectedMinutes(hunan, calm.ctx).toFixed(0)} / ${E.expectedMinutes(hunan, rush.ctx).toFixed(0)} 分`);

/* ---------- 9. 周末 ---------- */
console.log('\n[9] 周末');
const wk = E.pickOne(spots, base, weekend());
check('周末来得及的店比平日多', wk.timedCount > calm.timedCount, `${calm.timedCount} → ${wk.timedCount}`);
check('周末的湘菜仍在池子里', wk.scored.find((x) => x.spot.name === '湘菜小馆').fits === true);

/* ---------- 10. 人数 ---------- */
console.log('\n[10] 9 个人（滑块上限）');
const d10 = sample({ ...base, people: 9 }, workday, 3000);
console.log(`     ${d10.slice(0, 5).map((x) => `${x.name} ${x.pct.toFixed(0)}%`).join(' | ')}`);
check('只能坐 4 人的沙县基本出局', rate(d10, '沙县小吃') < 1, `${rate(d10, '沙县小吃').toFixed(1)}%`);
const bigTable = ['一层员工食堂', '二层盖浇饭窗口', '东北饺子馆', '川味火锅']
  .reduce((sum, name) => sum + rate(d10, name), 0);
check('能坐 10 人的店占明显多数', bigTable > 55, `${bigTable.toFixed(0)}%`);

/* ---------- 11. 2 小时（滑块上限） ---------- */
console.log('\n[11] 给足 2 小时');
const d11 = sample({ ...base, minutes: 120 }, workday, 3000);
check('校内 14 家全部来得及',
  E.pickOne(spots, { ...base, minutes: 120 }, workday()).timedCount === 14);
check('早茶终于进来', rate(d11, '粤式早茶') > 2, `${rate(d11, '粤式早茶').toFixed(1)}%`);
check('湘菜来得及了，份额抬升', rate(d11, '湘菜小馆') > 2, `${rate(d11, '湘菜小馆').toFixed(1)}%`);

/* ---------- 12. 换一个 ---------- */
console.log('\n[12] 换一个');
const firstPick = E.pickOne(spots, base, workday());
const first = firstPick.pool[0];
const again = E.pickOne(spots, base, workday(), first.spot.id);
check('被排除的那家权重降到 1/20',
  Math.abs(again.scored.find((x) => x.spot.id === first.spot.id).w - first.ta.w * first.p.w * 0.05) < 1e-9);
check('换一个不会返回同一家（池子里还有别的）', again.chosen.spot.id !== first.spot.id);

const only = [];
for (let i = 0; i < 20; i += 1) {
  only.push(E.pickOne(spots, { ...base, minutes: 20 }, workday(), 'convenience'));
}
check('唯一可行项被排除时仍然返回它',
  only.every((r) => r.chosen.spot.name === '便利店饭团'));

/* ---------- 13. 校内外 ---------- */
console.log('\n[13] 校内外');
const onSide = E.pickOne(spots, base, workday());
check('校内候选 14 家', onSide.scored.length === 14, `n=${onSide.scored.length}`);
check('校内候选里没有校外店', onSide.scored.every((x) => x.spot['校内'] === true));

const offSide = E.pickOne(spots, { ...base, campus: 'off' }, workday());
check('校外候选 6 家', offSide.scored.length === 6, `n=${offSide.scored.length}`);
check('校外候选里没有校内店', offSide.scored.every((x) => x.spot['校内'] === false));

check('校外不看时间：10 分钟照样出结果',
  E.pickOne(spots, { ...base, minutes: 10, campus: 'off' }, workday()).chosen !== null,
  E.pickOne(spots, { ...base, minutes: 10, campus: 'off' }, workday()).chosen.spot.name);
check('校内 10 分钟则无解',
  E.pickOne(spots, { ...base, minutes: 10 }, workday()).reason === 'time');

const offNames = new Set();
for (let i = 0; i < 300; i += 1) {
  offNames.add(E.pickOne(spots, { ...base, campus: 'off' }, workday()).chosen.spot.name);
}
check('校外时火锅、烤肉都进池子', offNames.has('川味火锅') && offNames.has('烤肉自助'),
  [...offNames].join(','));

const onOnly = spots.filter((s) => s['校内'] === true);
check('切到校外但没有校外店时给出 empty',
  E.pickOne(onOnly, { ...base, campus: 'off' }, workday()).reason === 'empty');

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}\n`);
process.exit(failures === 0 ? 0 : 1);
