#!/usr/bin/env python3
"""按 NCM 格式规范生成一个测试文件（正向加密），用于验证 JS 解密器。"""
import base64
import json
import os
import struct
import subprocess
import tempfile

CORE_KEY = bytes([0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f,
                  0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57])
META_KEY = bytes([0x23, 0x31, 0x34, 0x6c, 0x6a, 0x6b, 0x5f, 0x21,
                  0x5c, 0x5d, 0x26, 0x30, 0x55, 0x3c, 0x27, 0x28])


def aes_ecb_encrypt(data: bytes, key: bytes) -> bytes:
    with tempfile.NamedTemporaryFile(delete=False) as fi:
        fi.write(data)
        in_path = fi.name
    out_path = in_path + ".enc"
    try:
        subprocess.run(
            ["openssl", "enc", "-aes-128-ecb", "-K", key.hex(), "-nosalt",
             "-in", in_path, "-out", out_path],
            check=True, capture_output=True)
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        os.unlink(in_path)
        os.unlink(out_path)


def build_key_box(key: bytes) -> list:
    box = list(range(256))
    c = last = key_offset = 0
    for i in range(256):
        swap = box[i]
        c = (swap + last + key[key_offset]) & 0xFF
        key_offset += 1
        if key_offset >= len(key):
            key_offset = 0
        box[i] = box[c]
        box[c] = swap
        last = c
    return box


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "fixtures")
    os.makedirs(out_dir, exist_ok=True)

    # 原始音频：以 ID3 头开头的伪 MP3 数据
    audio = b"ID3\x04\x00\x00\x00\x00\x00\x21" + bytes(
        (i * 37 + 11) & 0xFF for i in range(6000))
    with open(os.path.join(out_dir, "original.bin"), "wb") as f:
        f.write(audio)

    # 1. 密钥块
    stream_key = bytes((i * 13 + 7) & 0xFF for i in range(64))
    key_plain = b"neteasecloudmusic" + stream_key
    key_cipher = aes_ecb_encrypt(key_plain, CORE_KEY)
    key_xor = bytes(b ^ 0x64 for b in key_cipher)

    # 2. 元数据块
    meta = {
        "musicId": 123456,
        "musicName": "测试歌曲·Test Song",
        "artist": [["歌手甲", 1001], ["歌手乙", 1002]],
        "albumId": 54321,
        "album": "测试专辑",
        "albumPicDocId": "0",
        "albumPic": "",
        "bitrate": 320000,
        "mp3DocId": "x",
        "duration": 205000,
        "mvId": 0,
        "alias": [],
        "transNames": [],
        "format": "mp3",
    }
    meta_plain = b"music:" + json.dumps(meta, ensure_ascii=False).encode("utf-8")
    meta_b64 = base64.b64encode(aes_ecb_encrypt(meta_plain, META_KEY))
    meta_full = b"163 key(Don't modify):" + meta_b64
    meta_xor = bytes(b ^ 0x63 for b in meta_full)

    # 3. 封面
    cover = b"\x89PNG\r\n\x1a\n" + bytes((i * 91 + 5) & 0xFF for i in range(500))

    # 4. 音频加密
    box = build_key_box(stream_key)
    audio_cipher = bytearray(audio)
    for i in range(len(audio_cipher)):
        j = (i + 1) & 0xFF
        audio_cipher[i] ^= box[(box[j] + box[(box[j] + j) & 0xFF]) & 0xFF]

    container = (
        b"CTENFDAM" + b"\x00\x00"
        + struct.pack("<I", len(key_xor)) + key_xor
        + struct.pack("<I", len(meta_xor)) + meta_xor
        + struct.pack("<I", 0)          # CRC
        + b"\x00" * 5                    # 间隔
        + struct.pack("<I", len(cover)) + cover
        + bytes(audio_cipher)
    )
    out_path = os.path.join(out_dir, "test.ncm")
    with open(out_path, "wb") as f:
        f.write(container)
    print(f"已生成测试文件: {out_path} ({len(container)} 字节)")


if __name__ == "__main__":
    main()
