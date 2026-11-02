/*
 * 纯 JS 实现的 AES-128-ECB 解密（NCM 文件头的密钥/元数据块使用 ECB 模式，
 * 浏览器 WebCrypto 不支持 ECB，故在此实现，无外部依赖）。
 * 同时兼容浏览器与 Node（用于单元测试）。
 */
(function (global) {
  'use strict';

  // ---------- GF(2^8) 运算 ----------
  const EXP = new Uint8Array(512); // 3 的幂次表（生成元为 3）
  const LOG = new Uint8Array(256);
  (function initTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      let x2 = x << 1;
      if (x & 0x80) x2 ^= 0x1b;
      x = x ^ (x2 & 0xff); // 乘以 3 = xtime(x) ^ x
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }
  function ginv(a) {
    return a === 0 ? 0 : EXP[255 - LOG[a]];
  }

  // ---------- S 盒 / 逆 S 盒（按定义生成，避免手抄常量出错） ----------
  const SBOX = new Uint8Array(256);
  const INV_SBOX = new Uint8Array(256);
  (function initSbox() {
    for (let a = 0; a < 256; a++) {
      const b = ginv(a);
      let s = b;
      for (let k = 1; k <= 4; k++) {
        s ^= ((b << k) | (b >>> (8 - k))) & 0xff;
      }
      s ^= 0x63;
      SBOX[a] = s;
      INV_SBOX[s] = a;
    }
  })();

  // ---------- 密钥扩展（AES-128 -> 44 字轮密钥，存为 176 字节） ----------
  function expandKey(key) {
    if (key.length !== 16) throw new Error('AES-128 需要 16 字节密钥');
    const w = new Uint8Array(176);
    w.set(key);
    let rcon = 0x01;
    for (let i = 16; i < 176; i += 4) {
      let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
      if ((i / 4) % 4 === 0) {
        // RotWord + SubWord + Rcon
        const u0 = SBOX[t1] ^ rcon, u1 = SBOX[t2], u2 = SBOX[t3], u3 = SBOX[t0];
        t0 = u0; t1 = u1; t2 = u2; t3 = u3;
        rcon = gmul(rcon, 2);
      }
      w[i] = w[i - 16] ^ t0;
      w[i + 1] = w[i - 15] ^ t1;
      w[i + 2] = w[i - 14] ^ t2;
      w[i + 3] = w[i - 13] ^ t3;
    }
    return w;
  }

  function addRoundKey(s, w, round) {
    const off = round * 16;
    for (let i = 0; i < 16; i++) s[i] ^= w[off + i];
  }

  function invSubBytes(s) {
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
  }

  // 状态按列主序存放（与输入字节序一致）：state[c*4+r]
  function invShiftRows(s) {
    let t;
    // 第 1 行右移 1 位
    t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
    // 第 2 行右移 2 位
    t = s[2]; s[2] = s[10]; s[10] = t;
    t = s[6]; s[6] = s[14]; s[14] = t;
    // 第 3 行右移 3 位
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
  }

  function invMixColumns(s) {
    for (let c = 0; c < 4; c++) {
      const i = c * 4;
      const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i]     = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
      s[i + 1] = gmul(a0, 9)  ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
      s[i + 2] = gmul(a0, 13) ^ gmul(a1, 9)  ^ gmul(a2, 14) ^ gmul(a3, 11);
      s[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9)  ^ gmul(a3, 14);
    }
  }

  function decryptBlock(block, w) {
    const s = Uint8Array.from(block);
    addRoundKey(s, w, 10);
    for (let round = 9; round >= 1; round--) {
      invShiftRows(s);
      invSubBytes(s);
      addRoundKey(s, w, round);
      invMixColumns(s);
    }
    invShiftRows(s);
    invSubBytes(s);
    addRoundKey(s, w, 0);
    return s;
  }

  /**
   * AES-128-ECB 解密并去除 PKCS7 填充。
   * @param {Uint8Array} data 密文（长度须为 16 的倍数）
   * @param {Uint8Array} key  16 字节密钥
   * @returns {Uint8Array} 明文
   */
  function decryptECB(data, key) {
    if (data.length === 0 || data.length % 16 !== 0) {
      throw new Error('AES-ECB 数据长度必须是 16 的倍数');
    }
    const w = expandKey(key);
    const out = new Uint8Array(data.length);
    for (let off = 0; off < data.length; off += 16) {
      out.set(decryptBlock(data.subarray(off, off + 16), w), off);
    }
    const pad = out[out.length - 1];
    if (pad > 0 && pad <= 16) {
      let valid = true;
      for (let i = out.length - pad; i < out.length; i++) {
        if (out[i] !== pad) { valid = false; break; }
      }
      if (valid) return out.subarray(0, out.length - pad);
    }
    return out;
  }

  const AES = { decryptECB, _test: { gmul, SBOX, INV_SBOX, expandKey, decryptBlock } };
  global.NCM_AES = AES;
  if (typeof module !== 'undefined' && module.exports) module.exports = AES;
})(typeof self !== 'undefined' ? self : globalThis);
