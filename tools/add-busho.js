#!/usr/bin/env node
// 武将の下書き JSON を点検して data/busho.json に追加する。
//
//   node tools/add-busho.js --check drafts/uesugi_kenshin.json   … 点検だけ（busho.json は変えない）
//   node tools/add-busho.js drafts/uesugi_kenshin.json           … 点検して追加
//   node tools/add-busho.js --replace drafts/uesugi_kenshin.json … 同じ id の武将を置き換える
//
// 決まりごと：
//   - 読み取れなかった・自信がない項目は null（文字・数値）または []（一覧）にして、
//     その項目名を missing に書く。空欄なのに missing に無いものはエラーにする（推測で埋めない／書き漏れを防ぐ）。
//   - missing に書く項目名：レア度・適性:<兵科>・大将時の兵科・統率・武勇・知略・政治・戦力・天賦・技能・皆伝・
//     戦法の名前・戦法の系統・戦法の効果・縁・シーズン（技能の一部だけ不明なら「技能Lv30」のように書いてもよい）
//   - 「_」で始まる項目（_note など）は下書き用のメモで、追加するときに取り除く。
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check'), replace = args.includes('--replace');
const files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('使い方: node tools/add-busho.js [--check] [--replace] <下書き.json>...'); process.exit(2); }

const TAGS = JSON.parse(fs.readFileSync(path.join(root, 'data/tags.json'), 'utf8'));
const dataFile = path.join(root, 'data/busho.json');
const DATA = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const ORDER = ['id', 'name', 'rarity', 'aptitude', 'taisho_heika', 'stats', 'power', 'tenpu', 'skills', 'kaiden', 'senpo', 'en', 'season', 'source', 'updated', 'missing'];
const EFFECT = new Set(TAGS.effect), UNIT = new Set(TAGS.unit);
let bad = 0;

for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = Array.isArray(raw) ? raw : [raw];
  for (const d0 of list) {
    const d = {};
    Object.keys(d0).forEach(k => { if (!k.startsWith('_')) d[k] = d0[k]; });
    const errs = [], warns = [];
    const miss = new Set(d.missing || []);
    const blank = (label, isBlank) => { if (isBlank && !miss.has(label)) errs.push(`「${label}」が空欄なのに missing に書かれていない`); };
    const isNum = v => typeof v === 'number' && isFinite(v);

    if (!d.id || !/^[a-z0-9_]+$/.test(d.id)) errs.push(`id は英小文字・数字・_ で書く（${d.id}）`);
    if (d.id && d.id.startsWith('dummy_')) errs.push('dummy_ で始まる id は使わない（ダミー専用）');
    if (!d.name) errs.push('name（武将名）は必須');
    if (d.dummy) errs.push('実データに dummy は付けない');
    if (d.missing && !Array.isArray(d.missing)) errs.push('missing は文字の配列で書く');

    if (d.rarity == null) blank('レア度', true);
    else if (!TAGS.rarity.includes(d.rarity)) errs.push(`レア度「${d.rarity}」は ${TAGS.rarity.join('/')} のどれか`);

    const apt = d.aptitude || {};
    Object.keys(apt).forEach(k => { if (!UNIT.has(k)) errs.push(`適性の兵科「${k}」が tags.json にない`); });
    TAGS.unit.forEach(k => {
      const v = apt[k];
      if (v == null || v === '') blank('適性:' + k, true);
      else if (!TAGS.aptitude.includes(v)) errs.push(`${k}の適性「${v}」は ${TAGS.aptitude.join('/')} のどれか`);
    });

    if (d.taisho_heika == null || d.taisho_heika === '') blank('大将時の兵科', true);
    else if (!UNIT.has(d.taisho_heika)) errs.push(`大将時の兵科「${d.taisho_heika}」は ${TAGS.unit.join('/')} のどれか`);

    const st = d.stats || {};
    TAGS.stats.forEach(k => { if (st[k] == null) blank(k, true); else if (!isNum(st[k])) errs.push(`${k}は数値で書く（${st[k]}）`); });
    if (d.power == null) blank('戦力', true); else if (!isNum(d.power)) errs.push('戦力は数値で書く');
    if (d.tenpu == null) blank('天賦', true); else if (!isNum(d.tenpu)) errs.push('天賦（天賦値）は数値で書く');

    const tagCheck = (where, tags) => {
      if (!Array.isArray(tags)) { errs.push(`${where}の tags は配列で書く`); return; }
      tags.forEach(t => { if (!EFFECT.has(t) && !UNIT.has(t)) errs.push(`${where}のタグ「${t}」が tags.json にない`); });
    };
    const skills = d.skills || [];
    if (skills.length !== 4 && ![...miss].some(m => m.startsWith('技能'))) errs.push(`技能が${skills.length}つ（4つでないなら missing に「技能」と書く）`);
    skills.forEach(s => {
      if (![10, 20, 30, 40].includes(s.lv)) errs.push(`技能の lv は 10/20/30/40（${s.lv}）`);
      if (!s.name) blank('技能Lv' + s.lv, true);
      tagCheck('技能Lv' + s.lv, s.tags || []);
    });
    const kaiden = d.kaiden || [];
    if (kaiden.length !== 4 && !miss.has('皆伝')) errs.push(`皆伝が${kaiden.length}つ（4つでないなら missing に「皆伝」と書く）`);
    kaiden.forEach(k => { if (![4, 5, 6, 7].includes(k.rank)) errs.push(`皆伝の rank は 4〜7（${k.rank}）`); tagCheck('皆伝' + k.rank, k.tags || []); });

    const sp = d.senpo || {};
    blank('戦法の名前', !sp.name);
    blank('戦法の系統', !sp.lineage);
    blank('戦法の効果', !(sp.tags && sp.tags.length));
    tagCheck('戦法', sp.tags || []);

    if (!Array.isArray(d.en) || d.en.some(t => typeof t !== 'string')) errs.push('縁は文字（タグ）の配列で書く');
    else blank('縁', d.en.length === 0);
    if (d.season == null) blank('シーズン', true); else if (!Number.isInteger(d.season)) errs.push('season は整数');
    if (!d.source) errs.push('source（出典）は必須（例：ゲーム画面のスクリーンショット 2026-11-01）');
    if (!d.updated || !/^\d{4}-\d{2}-\d{2}$/.test(d.updated)) errs.push('updated は YYYY-MM-DD');
    miss.forEach(m => { if (typeof m !== 'string') errs.push('missing は文字の配列で書く'); });

    const idx = DATA.busho.findIndex(b => b.id === d.id);
    if (idx >= 0 && !replace) errs.push(`id「${d.id}」はすでにある（置き換えるなら --replace）`);
    DATA.busho.filter(b => !b.dummy && b.name === d.name && b.id !== d.id)
      .forEach(b => warns.push(`同じ名前の実データがある（${b.id}）。別の版の武将なら問題ない`));
    if (d.season != null && d.season !== DATA.meta.season) warns.push(`シーズン${d.season}の情報（現在 ${DATA.meta.season}）`);

    const head = `${d.name || '?'}（${d.id || '?'}）`;
    if (errs.length) {
      bad++;
      console.log(`✗ ${head}`); errs.forEach(e => console.log('    エラー：' + e));
    } else {
      console.log(`✓ ${head}${miss.size ? '　未入力・未確認：' + [...miss].join('、') : ''}`);
    }
    warns.forEach(w => console.log('    注意：' + w));
    if (errs.length || checkOnly) continue;

    const out = {};
    ORDER.forEach(k => { if (k in d) out[k] = d[k]; });
    Object.keys(d).forEach(k => { if (!(k in out)) out[k] = d[k]; });
    if (!out.missing || !out.missing.length) delete out.missing;
    if (idx >= 0) DATA.busho[idx] = out; else DATA.busho.push(out);
  }
}

if (bad) { console.log(`\nエラーが ${bad} 件あるため、busho.json は変更していません。`); process.exit(1); }
if (checkOnly) { console.log('\n点検のみ（busho.json は変更していません）。'); process.exit(0); }
const t = new Date();
DATA.meta.updated = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
fs.writeFileSync(dataFile, JSON.stringify(DATA, null, 2) + '\n');
const real = DATA.busho.filter(b => !b.dummy).length, dummy = DATA.busho.length - real;
console.log(`\nbusho.json を更新しました。実データ ${real}人・ダミー ${dummy}人。`);
if (real >= 10 && dummy > 0) console.log('※ 実データが10人以上になりました。ダミー武将を削除するか、ユーザーに確認してください。');
