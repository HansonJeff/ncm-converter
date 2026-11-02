/* 往返测试：用 JS 解密器解开 Python 生成的 NCM，逐字节比对原始音频与元数据 */
'use strict';
const fs = require('fs');
const path = require('path');

const NCM = require('../js/ncm.js');
const ZIP = require('../js/zip.js');

const fixtures = path.join(__dirname, 'fixtures');
const ncmBuf = new Uint8Array(fs.readFileSync(path.join(fixtures, 'test.ncm')));
const original = new Uint8Array(fs.readFileSync(path.join(fixtures, 'original.bin')));

let failed = 0;
function check(name, ok, extra) {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}

const result = NCM.parseNcm(ncmBuf);

check('魔数与容器解析', !!result);
check('音频逐字节一致',
  result.audio.length === original.length &&
  result.audio.every((b, i) => b === original[i]),
  `长度 ${result.audio.length}/${original.length}`);
check('格式识别为 mp3', result.format === 'mp3', result.format);
check('歌名解析', result.musicName === '测试歌曲·Test Song', result.musicName);
check('歌手解析', result.artists === '歌手甲, 歌手乙', result.artists);
check('专辑解析', result.album === '测试专辑', result.album);
check('封面提取', !!result.cover && result.cover.length === 508 &&
  result.cover[0] === 0x89 && result.cover[1] === 0x50);
check('输出文件名', NCM.outputName(result, 'x.ncm') === '歌手甲, 歌手乙 - 测试歌曲·Test Song.mp3',
  NCM.outputName(result, 'x.ncm'));

// ZIP 打包冒烟测试
const zip = ZIP.createZip([
  { name: '第一首 - 歌名.mp3', data: result.audio },
  { name: 'second.flac', data: result.audio.slice(0, 100) },
]);
check('ZIP 生成（EOCD 签名）', zip.length > 100 &&
  zip[zip.length - 22] === 0x50 && zip[zip.length - 21] === 0x4b &&
  zip[zip.length - 20] === 0x05 && zip[zip.length - 19] === 0x06);
fs.writeFileSync(path.join(fixtures, 'test-output.zip'), zip);

if (failed) {
  console.error(`\n${failed} 项测试失败`);
  process.exit(1);
}
console.log('\n全部测试通过 🎉');
