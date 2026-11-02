/* 去人声 DSP 验证：构造「中央人声 + 偏左吉他 + 中央贝斯」的立体声信号，
 * 用 Goertzel 算法测量处理前后各频率的幅度，确认人声被消除、伴奏被保留。 */
'use strict';
const VOCAL = require('../js/vocal.js');

const fs = 44100, n = fs * 2;
const left = new Float32Array(n);
const right = new Float32Array(n);
const TWO_PI = Math.PI * 2;
for (let i = 0; i < n; i++) {
  const t = i / fs;
  const vocal = 0.5 * Math.sin(TWO_PI * 440 * t);   // 人声：左右相同（居中）
  const guitarL = 0.5 * Math.sin(TWO_PI * 880 * t); // 吉他：偏左
  const guitarR = 0.08 * Math.sin(TWO_PI * 880 * t);
  const bass = 0.4 * Math.sin(TWO_PI * 100 * t);    // 贝斯：居中（应保留）
  left[i] = vocal + guitarL + bass;
  right[i] = vocal + guitarR + bass;
}

// Goertzel：测量单频幅度
function amp(data, freq) {
  const w = TWO_PI * freq / fs, cw = Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < data.length; i++) {
    const s0 = data[i] + 2 * cw * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - 2 * cw * s1 * s2) / data.length * 2;
}

const { left: outL, right: outR } = VOCAL.removeVocalsDSP(left, right, fs);

const vocalBefore = amp(left, 440);
const vocalAfterL = amp(outL, 440);
const vocalAfterR = amp(outR, 440);
const guitarAfter = amp(outL, 880);
const bassAfter = amp(outL, 100);

let failed = 0;
function check(name, ok, extra) {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
}

console.log(`人声 440Hz: 处理前 ${vocalBefore.toFixed(3)} -> 处理后 L ${vocalAfterL.toFixed(4)} / R ${vocalAfterR.toFixed(4)}`);
console.log(`吉他 880Hz(偏左): 处理后 L ${guitarAfter.toFixed(3)}（原始 0.50，侧声道保留约 0.21）`);
console.log(`贝斯 100Hz(居中): 处理后 ${bassAfter.toFixed(3)}（原始 0.40，低频保留）`);

check('人声消除 > 25dB', vocalAfterL < vocalBefore * 0.056 && vocalAfterR < vocalBefore * 0.056,
  `衰减 ${(20 * Math.log10(vocalBefore / Math.max(vocalAfterL, 1e-9))).toFixed(1)} dB`);
check('偏左吉他的立体声成分保留', guitarAfter > 0.15 && guitarAfter < 0.30,
  guitarAfter.toFixed(3));
check('居中贝斯保留 > 75%', bassAfter > 0.30, bassAfter.toFixed(3));

// WAV 编码往返：校验头与采样值
const wav = VOCAL.encodeWav([outL, outR], fs);
const dv = new DataView(wav.buffer);
const isRiff = wav[0] === 0x52 && wav[1] === 0x49 && wav[2] === 0x46 && wav[3] === 0x46;
const isWave = wav[8] === 0x57 && wav[9] === 0x41 && wav[10] === 0x56 && wav[11] === 0x45;
check('WAV 头（RIFF/WAVE）', isRiff && isWave);
check('WAV 声道数/采样率/位深',
  dv.getUint16(22, true) === 2 && dv.getUint32(24, true) === fs && dv.getUint16(34, true) === 16);
check('WAV 数据大小', dv.getUint32(40, true) === n * 2 * 2 && wav.length === 44 + n * 2 * 2);
const s = dv.getInt16(44 + 1000 * 4, true) / 0x8000; // 第 1000 个左声道采样
check('WAV 采样值与 PCM 一致', Math.abs(s - outL[1000]) < 1 / 32768 + 1e-6,
  `${s.toFixed(6)} vs ${outL[1000].toFixed(6)}`);

if (failed) {
  console.error(`\n${failed} 项测试失败`);
  process.exit(1);
}
console.log('\n去人声模块测试通过 🎉');
