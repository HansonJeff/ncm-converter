/* 真实文件测试：读取网易云本地曲库，找到「我喜欢的音乐」中第一首已下载的歌并完成转换 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const NCM = require('../js/ncm.js');

const MUSIC_DIR = path.join(os.homedir(), 'Music/网易云音乐');
const DB_PATH = path.join(os.homedir(),
  'Library/Containers/com.netease.163music/Data/Documents/storage/sqlite_storage.sqlite3');

// 1. 从 sqlite 读「我喜欢的音乐」歌单顺序（specialType=5 才是真正的喜欢列表；机器上可能有多个账号）
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const candidates = db.prepare("SELECT pid, playlist FROM web_playlist").all()
  .map(r => { const p = JSON.parse(r.playlist); return { pid: r.pid, name: p.name, specialType: p.specialType, trackCount: p.trackCount || 0 }; })
  .filter(p => p.name === '我喜欢的音乐')
  .sort((a, b) => (b.specialType === 5) - (a.specialType === 5) || b.trackCount - a.trackCount);
const plRow = candidates[0];
console.log(`歌单: ${plRow.name} (pid=${plRow.pid})`);
const likedTids = db.prepare(
  'SELECT tid FROM web_playlist_track WHERE pid=? ORDER BY "order" ASC').all(plRow.pid).map(r => r.tid);
console.log(`喜欢列表共 ${likedTids.length} 首`);
const trackName = {};
for (const r of db.prepare('SELECT tid, track FROM web_track').all()) {
  try {
    const t = JSON.parse(r.track);
    trackName[r.tid] = `${(t.artists || []).map(a => a.name).join(',')} - ${t.name}`;
  } catch (e) { /* 忽略坏行 */ }
}
db.close();

// 2. 扫描本地 NCM 文件，用我们自己的解析器建立 musicId -> 文件 映射（顺带全量验证解析器）
const files = fs.readdirSync(MUSIC_DIR).filter(f => /\.ncm$/i.test(f));
console.log(`本地 .ncm 文件 ${files.length} 个，逐个解析元数据…`);
const byId = new Map();
let parseOk = 0, parseFail = 0;
for (const f of files) {
  const p = path.join(MUSIC_DIR, f);
  try {
    const r = NCM.parseNcm(new Uint8Array(fs.readFileSync(p)));
    parseOk++;
    const id = r.meta && r.meta.musicId;
    if (id != null && !byId.has(id)) byId.set(id, { path: p, result: r, file: f });
  } catch (e) {
    parseFail++;
    console.log(`  ⚠️ 解析失败: ${f} (${e.message})`);
  }
}
console.log(`真实文件批量解析: 成功 ${parseOk} / 失败 ${parseFail}`);

// 3. 找喜欢列表里第一首已下载的
let found = null, rank = 0;
for (const tid of likedTids) {
  rank++;
  if (byId.has(tid)) { found = { tid, ...byId.get(tid) }; break; }
}
if (!found) {
  console.log('喜欢列表中没有已下载到本地的歌曲');
  process.exit(2);
}
if (rank === 1) {
  console.log(`\n喜欢列表第一首已下载到本地: ${trackName[found.tid] || found.file}`);
} else {
  console.log(`\n喜欢列表第一首: ${trackName[likedTids[0]] || likedTids[0]}（未下载到本地，无文件可测）`);
  console.log(`顺延到第 ${rank} 首（第一首已下载的）: ${trackName[found.tid] || found.file}`);
}
console.log(`文件: ${found.file} (${(fs.statSync(found.path).size / 1048576).toFixed(1)} MB)`);

// 4. 复制进工作区并完整转换
const outDir = path.join(__dirname, '..', '..', '试听结果');
fs.mkdirSync(outDir, { recursive: true });
const copied = path.join(outDir, '原始文件.ncm');
fs.copyFileSync(found.path, copied);

const r = NCM.parseNcm(new Uint8Array(fs.readFileSync(copied)));
const outName = NCM.outputName(r, found.file);
const outPath = path.join(outDir, outName);
fs.writeFileSync(outPath, r.audio);
console.log(`\n转换结果:`);
console.log(`  歌名: ${r.musicName}`);
console.log(`  歌手: ${r.artists}`);
console.log(`  专辑: ${r.album}`);
console.log(`  格式: ${r.format.toUpperCase()} (${(r.audio.length / 1048576).toFixed(1)} MB)`);
console.log(`  封面: ${r.cover ? r.cover.length + ' 字节' : '无'}`);
console.log(`  输出: ${outPath}`);
fs.writeFileSync(path.join(outDir, '_tid.txt'), String(found.tid));
