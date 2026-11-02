/*
 * NCM（网易云音乐加密格式）解析与解密。
 * 流程：魔数校验 -> AES-128-ECB 解出音频流密钥 -> 构建密钥盒 ->
 *       AES-128-ECB 解出元数据(JSON) -> 逐字节异或还原音频。
 * 全部在本地完成，不上传任何数据。
 */
(function (global) {
  'use strict';

  const AES = global.NCM_AES || (typeof require !== 'undefined' ? require('./aes.js') : null);

  const CORE_KEY = new Uint8Array([0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f, 0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57]);
  const META_KEY = new Uint8Array([0x23, 0x31, 0x34, 0x6c, 0x6a, 0x6b, 0x5f, 0x21, 0x5c, 0x5d, 0x26, 0x30, 0x55, 0x3c, 0x27, 0x28]);
  const MAGIC = [0x43, 0x54, 0x45, 0x4e, 0x46, 0x44, 0x41, 0x4d]; // "CTENFDAM"

  // ---------- base64 解码（无环境依赖） ----------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_REV = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) B64_REV[B64.charCodeAt(i)] = i;
  function b64decode(str) {
    const clean = str.replace(/[^A-Za-z0-9+/=]/g, '');
    const out = [];
    let acc = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
      const c = clean.charCodeAt(i);
      if (clean[i] === '=') break;
      const v = B64_REV[c];
      if (v < 0) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >>> bits) & 0xff);
      }
    }
    return new Uint8Array(out);
  }

  function ascii(bytes, start, end) {
    let s = '';
    for (let i = start; i < (end || bytes.length); i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function utf8decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    return Buffer.from(bytes).toString('utf-8');
  }

  // ---------- 密钥盒（类 RC4 KSA） ----------
  function buildKeyBox(key) {
    const box = new Uint8Array(256);
    for (let i = 0; i < 256; i++) box[i] = i;
    let c = 0, lastByte = 0, keyOffset = 0;
    for (let i = 0; i < 256; i++) {
      const swap = box[i];
      c = (swap + lastByte + key[keyOffset++]) & 0xff;
      if (keyOffset >= key.length) keyOffset = 0;
      box[i] = box[c];
      box[c] = swap;
      lastByte = c;
    }
    return box;
  }

  // ---------- 音频格式嗅探 ----------
  function sniffFormat(audio) {
    if (audio.length >= 4) {
      if (audio[0] === 0x66 && audio[1] === 0x4c && audio[2] === 0x61 && audio[3] === 0x43) return 'flac'; // fLaC
      if (audio[0] === 0x4f && audio[1] === 0x67 && audio[2] === 0x67 && audio[3] === 0x53) return 'ogg';  // OggS
    }
    if (audio.length >= 3 && audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) return 'mp3';    // ID3
    if (audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) return 'mp3';                // MP3 帧同步
    return 'bin';
  }

  /**
   * 解析并解密一个 NCM 文件。
   * @param {Uint8Array} buf 完整文件字节
   * @returns {{meta: object|null, cover: Uint8Array|null, audio: Uint8Array,
   *            format: string, musicName: string, artists: string, album: string}}
   */
  function parseNcm(buf) {
    if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== MAGIC[i]) throw new Error('不是有效的 NCM 文件（魔数不匹配）');
    }
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 10; // 跳过魔数 + 2 字节间隔

    // --- 1. 音频流密钥 ---
    const keyLen = view.getUint32(offset, true); offset += 4;
    const keyCipher = buf.slice(offset, offset + keyLen); offset += keyLen;
    for (let i = 0; i < keyCipher.length; i++) keyCipher[i] ^= 0x64;
    const keyPlain = AES.decryptECB(keyCipher, CORE_KEY);
    const streamKey = keyPlain.slice(17); // 去掉 "neteasecloudmusic" 前缀
    const box = buildKeyBox(streamKey);

    // --- 2. 元数据 ---
    let meta = null;
    const metaLen = view.getUint32(offset, true); offset += 4;
    if (metaLen > 0) {
      const metaCipher = buf.slice(offset, offset + metaLen);
      offset += metaLen;
      for (let i = 0; i < metaCipher.length; i++) metaCipher[i] ^= 0x63;
      const metaB64 = ascii(metaCipher, 22); // 去掉 "163 key(Don't modify):" 前缀
      const metaPlain = AES.decryptECB(b64decode(metaB64), META_KEY);
      try {
        meta = JSON.parse(utf8decode(metaPlain.slice(6))); // 去掉 "music:" 前缀
      } catch (e) {
        meta = null;
      }
    } else {
      offset += metaLen;
    }

    // --- 3. CRC(4) + 间隔(5) + 封面 ---
    offset += 9;
    let cover = null;
    if (offset + 4 <= buf.length) {
      const coverSize = view.getUint32(offset, true); offset += 4;
      if (coverSize > 0 && offset + coverSize <= buf.length) {
        cover = buf.slice(offset, offset + coverSize);
        offset += coverSize;
      }
    }

    // --- 4. 音频主体解密 ---
    const audio = buf.slice(offset);
    for (let i = 0; i < audio.length; i++) {
      const j = (i + 1) & 0xff;
      audio[i] ^= box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
    }

    const format = sniffFormat(audio);
    let musicName = '', artists = '', album = '';
    if (meta) {
      musicName = meta.musicName || '';
      album = meta.album || '';
      if (Array.isArray(meta.artist)) {
        artists = meta.artist.map(a => Array.isArray(a) ? a[0] : a).join(', ');
      }
    }
    return { meta, cover, audio, format, musicName, artists, album };
  }

  /** 生成安全的输出文件名 */
  function outputName(result, fallback) {
    let base = '';
    if (result.musicName) {
      base = result.artists ? result.artists + ' - ' + result.musicName : result.musicName;
    } else {
      base = fallback.replace(/\.ncm$/i, '');
    }
    base = base.replace(/[\\/:*?"<>|]/g, '_').trim() || 'output';
    return base + '.' + result.format;
  }

  const NCM = { parseNcm, outputName, sniffFormat, _test: { buildKeyBox, b64decode } };
  global.NCM_CORE = NCM;
  if (typeof module !== 'undefined' && module.exports) module.exports = NCM;
})(typeof self !== 'undefined' ? self : globalThis);
