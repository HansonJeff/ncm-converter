# NCM to MP3 · Local Converter

[中文文档](README.md)

A browser-based, fully local audio toolkit: **NCM decryption** + **vocal removal (instrumental extraction)**. Zero dependencies, zero uploads — your files never leave your device.

## Features

- 🎵 **NCM to MP3/FLAC/OGG**: drag & drop `.ncm` files, batch conversion, output format auto-detected
- 🏷️ **Metadata preserved**: title, artists, album and cover art are extracted automatically; files are renamed to `Artist - Title`
- 🎤 **Vocal removal**: center-channel extraction with a 4th-order Butterworth low-frequency preservation stage (keeps kick & bass intact), outputs lossless WAV
- 📦 **Batch export**: download all converted tracks as a single ZIP
- 🔒 **100% local**: AES decryption and audio processing run entirely in the browser — no network requests, no servers

## Usage

This is a pure static site — any static file server works:

```bash
npm run dev        # local preview at http://localhost:7100/
```

Or deploy the repository root directly to GitHub Pages / Vercel / Nginx. No build step required.

## How it works

- **NCM decryption**: the stream key and metadata blocks are decrypted with AES-128-ECB (WebCrypto doesn't support ECB, so a dependency-free pure-JS implementation is included — its S-boxes are generated mathematically from GF(2⁸) rather than hardcoded), followed by key-schedule stream decryption to restore the audio
- **Vocal removal**: lead vocals in mainstream mixes are usually panned dead center; attenuating the content shared by the left/right channels removes them, while a 4th-order Butterworth low-pass keeps the centered low end (kick drum, bass) below 200 Hz intact
- **Limitations**: works best on center-panned vocals in typical pop productions; live recordings, off-center vocals or mono tracks will see limited effect

## Tests

```bash
npm test
```

Includes a byte-for-byte round-trip test (encrypt → decrypt through the real NCM container format) and spectral (Goertzel) assertions for the vocal-removal DSP. The parser has also been validated against 348 real-world `.ncm` files with a 100% success rate.

## Disclaimer

This tool is for learning and technical research only. Please process only audio files you have legally obtained, and respect music copyright.

## License

MIT
