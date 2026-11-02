/*
 * 极简 ZIP 打包（STORE 模式，不压缩）。
 * 音频文件本就难以再压缩，直接存储既快又省内存，无外部依赖。
 */
(function (global) {
  'use strict';

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * 将多个文件打包成一个 ZIP。
   * @param {Array<{name: string, data: Uint8Array}>} entries
   * @returns {Uint8Array}
   */
  function createZip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const dosTime = 0, dosDate = 0x21; // 固定时间戳即可

    for (const entry of entries) {
      const nameBytes = enc.encode(entry.name);
      const crc = crc32(entry.data);
      const size = entry.data.length;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // local file header 签名
      lv.setUint16(4, 20, true);           // 版本
      lv.setUint16(6, 0x0800, true);       // 通用标志：bit11 = UTF-8 文件名
      lv.setUint16(8, 0, true);            // 压缩方式：0 = 存储
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);        // 压缩后大小
      lv.setUint32(22, size, true);        // 原始大小
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);           // 扩展字段长度
      local.set(nameBytes, 30);
      parts.push(local, entry.data);

      const cent = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cent.buffer);
      cv.setUint32(0, 0x02014b50, true);   // central directory 签名
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);      // local header 偏移
      cent.set(nameBytes, 46);
      central.push(cent);

      offset += local.length + entry.data.length;
    }

    let centralSize = 0;
    for (const c of central) centralSize += c.length;

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + centralSize + eocd.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const part of parts) { out.set(part, p); p += part.length; }
    for (const c of central) { out.set(c, p); p += c.length; }
    out.set(eocd, p);
    return out;
  }

  const ZIP = { createZip, crc32 };
  global.NCM_ZIP = ZIP;
  if (typeof module !== 'undefined' && module.exports) module.exports = ZIP;
})(typeof self !== 'undefined' ? self : globalThis);
