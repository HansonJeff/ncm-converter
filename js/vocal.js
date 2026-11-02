/*
 * 去人声（提取伴奏）模块。
 * 原理：主流歌曲的人声通常混合在立体声正中央（中置声道），
 * 将左右声道的共同成分（mid）衰减即可大幅消除人声；
 * 同时对 mid 做低通、保留低频段，避免把同在中央的底鼓/贝斯一并删掉。
 * 输出 16-bit PCM WAV（无损）。DSP 核心不依赖 WebAudio，可在 Node 中测试。
 */
(function (global) {
  'use strict';

  /**
   * 双二阶低通（RBJ 公式）。
   * 四阶 Butterworth 由 Q=0.5412 与 Q=1.3065 两节级联而成。
   */
  function makeBiquadLowpass(sampleRate, cutoff, q) {
    const w0 = 2 * Math.PI * cutoff / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw = Math.cos(w0);
    const a0 = 1 + alpha;
    const b0 = ((1 - cosw) / 2) / a0;
    const b1 = (1 - cosw) / a0;
    const b2 = b0;
    const a1 = (-2 * cosw) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return function step(x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x;
      y2 = y1; y1 = y;
      return y;
    };
  }

  /** 四阶 Butterworth 低通（级联两节） */
  function makeLowpass4(sampleRate, cutoff) {
    const s1 = makeBiquadLowpass(sampleRate, cutoff, 0.5412);
    const s2 = makeBiquadLowpass(sampleRate, cutoff, 1.3065);
    return x => s2(s1(x));
  }

  /**
   * 中置声道消除（带低频保留）。
   * @param {Float32Array} left
   * @param {Float32Array} right
   * @param {number} sampleRate
   * @param {{strength?: number, cutoff?: number}} [opts]
   *   strength 中置成分衰减量 0~1（默认 1 完全消除）
   *   cutoff   低频保留截止频率 Hz（默认 200，低于它的中央成分保留）
   * @returns {{left: Float32Array, right: Float32Array}}
   */
  function removeVocalsDSP(left, right, sampleRate, opts) {
    opts = opts || {};
    const strength = opts.strength != null ? opts.strength : 1.0;
    const cutoff = opts.cutoff != null ? opts.cutoff : 200;
    const lowpass = makeLowpass4(sampleRate, cutoff);
    const n = left.length;
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const mid = (left[i] + right[i]) * 0.5;
      const low = lowpass(mid);                 // 中央成分的低频（底鼓/贝斯）
      const vocalPart = (mid - low) * strength; // 中高频的中央成分 ≈ 人声
      const l = left[i] - vocalPart;
      const r = right[i] - vocalPart;
      outL[i] = l;
      outR[i] = r;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
    }
    if (peak > 0.98) { // 防止削波
      const g = 0.98 / peak;
      for (let i = 0; i < n; i++) { outL[i] *= g; outR[i] *= g; }
    }
    return { left: outL, right: outR };
  }

  /** 将多声道 Float32 PCM 编码为 16-bit WAV */
  function encodeWav(channelData, sampleRate) {
    const numCh = channelData.length;
    const n = channelData[0].length;
    const dataSize = n * numCh * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, numCh, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * numCh * 2, true);
    v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true);
    writeStr(36, 'data'); v.setUint32(40, dataSize, true);
    let off = 44;
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        let s = channelData[ch][i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Uint8Array(buffer);
  }

  /**
   * 浏览器端入口：解码音频字节 -> 去人声 -> WAV 字节。
   * @param {Uint8Array} audioBytes MP3 / FLAC / OGG 等浏览器可解码的音频
   * @returns {Promise<Uint8Array>} WAV 文件字节
   */
  async function toInstrumental(audioBytes, opts) {
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) throw new Error('当前浏览器不支持音频解码（WebAudio）');
    const ctx = new AC();
    try {
      // decodeAudioData 会 detach 传入的 ArrayBuffer，必须给副本
      const copy = audioBytes.slice().buffer;
      const audioBuf = await ctx.decodeAudioData(copy);
      if (audioBuf.numberOfChannels < 2) {
        throw new Error('单声道音频无法分离人声');
      }
      const r = removeVocalsDSP(
        audioBuf.getChannelData(0), audioBuf.getChannelData(1),
        audioBuf.sampleRate, opts);
      return encodeWav([r.left, r.right], audioBuf.sampleRate);
    } finally {
      if (ctx.close) ctx.close();
    }
  }

  const VOCAL = { toInstrumental, removeVocalsDSP, encodeWav };
  global.NCM_VOCAL = VOCAL;
  if (typeof module !== 'undefined' && module.exports) module.exports = VOCAL;
})(typeof self !== 'undefined' ? self : globalThis);
