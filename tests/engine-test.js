// 使い方: node engine-test.js <hadou フォルダ>
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.argv[2];
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const ctx = { module: { exports: {} } }; vm.createContext(ctx); vm.runInContext(src, ctx);
const Engine = ctx.module.exports;
const rd = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const DATA = rd('busho.json'), W = rd('weights.json'), TAGS = rd('tags.json');
const P = Engine.prepare(DATA, W, TAGS);
// 全通り探索と比べるのは先頭10人だけ（40人だと組み合わせが多すぎる）
const all = DATA.busho.slice(0, 10).map(b => b.id);
const all40 = DATA.busho.map(b => b.id);
let fail = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : '  NG  ') + m); if (!c) fail++; };
const name = id => Engine.nameOf(P, id);

function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i < arr.length; i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); }
  return out;
}
function perms(a) { if (a.length <= 1) return [a]; const o = []; a.forEach((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).forEach(p => o.push([x].concat(p)))); return o; }
function brute(kind, mode, axis) {
  let best = -Infinity, bestU = null;
  const P7 = perms([0, 1, 2, 3, 4, 5, 6]);
  for (const c of combos(all, 7)) {
    if (axis && !c.includes(axis.id)) continue;
    const ts = Engine.team(P, c, kind, mode).score;
    const iv = c.map(id => W.slots.map(sl => Engine.indiv(P, id, sl, kind, mode).total));
    for (const p of P7) {
      // p[i] = c の何番目を枠 i に置くか
      if (axis) { const s = p.indexOf(c.indexOf(axis.id)); const sl = W.slots[s]; if (axis.pos !== '任意' && sl.position !== axis.pos) continue; if (axis.side !== '任意' && sl.side !== axis.side) continue; }
      let s = ts; for (let i = 0; i < 7; i++) s += iv[p[i]][i];
      if (s > best) { best = s; bestU = p.map(j => c[j]); }
    }
  }
  return { best, bestU };
}

console.log('■ 1部隊：全通り探索と一致するか');
for (const [kind, mode, axis] of [['騎馬', '破壊', null], ['弓', '対人', null], ['騎馬', '防衛', null],
  ['騎馬', '破壊', { id: 'toyotomi_hideyoshi', pos: '与力', side: '右' }],
  ['弓', '破壊', { id: 'honda_tadakatsu', pos: '大将', side: '任意' }]]) {
  const r = Engine.search(P, { owned: all, kinds: [kind], mode, axes: axis ? [axis] : [] });
  const b = brute(kind, mode, axis);
  const top = r.results[0];
  ok(Math.abs(top.total - b.best) < 1e-6, `${kind}・${mode}${axis ? '・軸 ' + name(axis.id) + '（' + axis.pos + '/' + axis.side + '）' : ''}：探索 ${top.total.toFixed(2)} / 全通り ${b.best.toFixed(2)}`);
  if (axis) {
    const u = top.units[0]; const s = u.slots.find(x => x.id === axis.id);
    ok(s && (axis.pos === '任意' || s.slot.position === axis.pos) && (axis.side === '任意' || s.slot.side === axis.side), `  軸の位置：${s && s.slot.position + '/' + (s.slot.side || '-')}`);
    ok(r.results.every(ev => ev.units[0].slots.some(x => x.id === axis.id)), '  上位3件すべてに軸武将が入る');
  }
  ok(r.results.length === 3, `  上位 ${r.results.length} 件：` + r.results.map(e => e.total.toFixed(2) + (e.without ? '（' + name(e.without) + 'なし）' : '')).join(' / '));
  ok(r.results.every(e => Math.abs(e.total - e.searchTotal) < 1e-6), '  高速版の点数と表示用の点数が一致');
  const ex = Engine.explain(P, top, mode, []);
  console.log('     1位：' + top.units[0].slots.map(s => s.slot.position + (s.slot.side || '') + '=' + name(s.id)).join(' '));
  ex.good.forEach(t => console.log('       ・' + t)); ex.ng.forEach(t => console.log('       ！' + t));
}

console.log('■ エラー表示');
let r = Engine.search(P, { owned: all, kinds: ['騎馬', '弓'], mode: '破壊', axes: [] });
ok(r.error && r.error.includes('14人'), '人数不足：' + r.error);
r = Engine.search(P, { owned: all.filter(i => i !== 'toyotomi_hideyoshi'), kinds: ['騎馬'], mode: '破壊', axes: [{ id: 'toyotomi_hideyoshi', pos: '任意', side: '任意' }] });
ok(r.error && r.error.includes('所持'), '軸が未所持：' + r.error);
r = Engine.search(P, { owned: all, kinds: ['騎馬'], mode: '破壊', axes: [{ id: 'toyotomi_hideyoshi', pos: '大将', side: '任意' }, { id: 'oda_nobunaga', pos: '大将', side: '任意' }] });
ok(r.error && r.error.includes('枠'), '大将を2人指定：' + r.error);

console.log('■ 混成（ダミー40人で確認）');
const kinds = ['騎馬', '騎馬', '騎馬', '弓', '弓'];
const t0 = Date.now();
r = Engine.search(P, { owned: all40, kinds, mode: '破壊', axes: [{ id: 'toyotomi_hideyoshi', pos: '大将', side: '任意' }] });
const ms = Date.now() - t0;
ok(!r.error, `騎馬3・弓2 を探索（${ms}ms、候補 ${r.explored}）`);
const ids = r.results[0].units.flatMap(u => u.slots.map(s => s.id));
ok(new Set(ids).size === 35, '35人に重複なし');
ok(r.results.length === 3 && r.results.every(e => Math.abs(e.total - e.searchTotal) < 1e-6), '上位3件・点数一致：' + r.results.map(e => e.total.toFixed(1)).join(' / '));
ok(r.results.every(ev => ev.units.some(u => u.slots[0].id === 'toyotomi_hideyoshi')), '全件で秀吉が大将');
ok(ms < 3000, '3秒以内');
const mem = ev => new Set(ev.units.flatMap(u => u.slots.map(s => s.id)));
const dif = (a, b) => [...mem(a)].filter(x => !mem(b).has(x)).length;
ok(dif(r.results[1], r.results[0]) >= 2 && dif(r.results[2], r.results[0]) >= 2 && dif(r.results[2], r.results[1]) >= 2,
  `2位・3位は上位と2人以上ちがう（1位との差 ${dif(r.results[1], r.results[0])}人・${dif(r.results[2], r.results[0])}人、2位と3位 ${dif(r.results[2], r.results[1])}人）`);
r.results[0].units.forEach((u, i) => console.log(`     第${i + 1}部隊 ${u.kind}（${u.role}） ${u.score.toFixed(1)}点：` + u.slots.map(s => name(s.id) + s.r.letter).join(' ')));
Engine.explain(P, r.results[0], '破壊', []).good.forEach(t => console.log('       ・' + t));

console.log('■ 縁（タグ）の発動人数を3人にした場合');
const W3 = JSON.parse(JSON.stringify(W)); W3.en_min_members = 3;
const P3 = Engine.prepare(DATA, W3, TAGS);
const enNames = ids => Engine.team(P3, ids, '騎馬', '破壊').parts.filter(p => p.type === 'en').map(p => p.name);
let en3 = enNames(['tokugawa_ieyasu', 'honda_tadakatsu', 'date_masamune', 'mori_motonari', 'shimazu_yoshihiro', 'sanada_yukimura', 'takeda_shingen']);
ok(!en3.includes('三河武士（仮）'), '2人の縁（三河武士）は発動しない：' + (en3.join('・') || 'なし'));
en3 = enNames(['tokugawa_ieyasu', 'honda_tadakatsu', 'oda_nobunaga', 'toyotomi_hideyoshi', 'shimazu_yoshihiro', 'sanada_yukimura', 'takeda_shingen']);
ok(en3.includes('天下人（仮）'), '3人そろった縁（天下人）は発動する：' + en3.join('・'));
const r3 = Engine.search(P3, { owned: all40, kinds: ['騎馬', '弓'], mode: '対人', axes: [] });
ok(r3.results.every(e => Math.abs(e.total - e.searchTotal) < 1e-6), '発動人数3人でも高速版と表示用の点数が一致');

console.log('■ 120人に増やしたときの時間（実データ想定。40人を複製）');
const huge = JSON.parse(JSON.stringify(DATA));
for (let n = 2; n <= 3; n++) DATA.busho.forEach(b => { const c = JSON.parse(JSON.stringify(b)); c.id = b.id + '_' + n; c.name = b.name + n; c.en = []; huge.busho.push(c); });
const PH = Engine.prepare(huge, W, TAGS);
let t1 = Date.now();
const rh = Engine.search(PH, { owned: huge.busho.map(b => b.id), kinds, mode: '対人', axes: [] });
const ms2 = Date.now() - t1;
ok(!rh.error && ms2 < 3000, `120人・騎馬3弓2：${ms2}ms（初期解 ${rh.restarts} 回${rh.stopped ? '、時間で打ち切り' : ''}）`);
process.exit(fail ? 1 : 0);
