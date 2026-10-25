# `.signage` Custom Binary Archive Format Specification

## 1. Format Identity

- **Default File Extension**: `.signage`
- **MIME Type**: `application/vnd.digital-signage.package`
- **Magic Signature**: `SIGNAGE\0` (`0x53 0x49 0x47 0x4E 0x41 0x47 0x45 0x00`)
- **Byte Order**: Little-endian (`LE`) for all multibyte numeric fields.
- **Current Format Version**: `1` (`0x0001`)

A `.signage` archive is a self-contained, directory-indexed binary container that bundles a complete signage presentation—manifest, scenes, elements, animation tracks, media assets (images, videos, audio, fonts), themes, reusable components, restricted scripts, and cryptographic integrity metadata—so a standalone player can verify and play the presentation offline without the original project directory.

---

## 2. Container Architecture

```
+-------------------------------------------------------------------+
| 1. SIGNAGE HEADER (Fixed 64 Bytes, Offset 0)                      |
|    Magic Signature ("SIGNAGE\0")                                  |
|    Format Version (uint16 LE)                                     |
|    Header Size (uint16 LE = 64)                                   |
|    Feature Flags (uint32 LE)                                      |
|    Directory Offset (uint64 LE)                                   |
|    Directory Length (uint64 LE)                                   |
|    Manifest Entry ID (uint32 LE)                                  |
|    Entry Count (uint32 LE)                                        |
|    Reserved (24 Zero Bytes)                                       |
+-------------------------------------------------------------------+
| 2. ENTRY DATA REGION (Offset 64 .. Directory Offset)              |
|    Entry #1: Project Manifest (JSON, Deflate/Store)               |
|    Entry #2..N: Independently Stored/Compressed Assets & Scripts  |
|      - Images (PNG, JPEG, WebP, SVG, GIF)                         |
|      - Videos (MP4, WebM)                                         |
|      - Audio (WAV, MP3, OGG)                                      |
|      - Fonts (WOFF2, TTF)                                         |
|      - Scripts, Animation Data, Themes, Publisher Signature       |
+-------------------------------------------------------------------+
| 3. ENTRY DIRECTORY (Offset = Directory Offset, Len = Dir Length)  |
|    Sequential variable-length binary records (Entry Count items)  |
|    Readable without decompressing any entry payload               |
+-------------------------------------------------------------------+
```

---

## 3. 64-Byte Binary Header Layout

| Offset | Size (Bytes) | Type        | Field Name         | Description |
|-------:|-------------:|-------------|--------------------|-------------|
| `0`    | `8`          | `uint8[8]`  | `magic`            | Exact ASCII bytes `SIGNAGE\0` (`53 49 47 4E 41 47 45 00`). |
| `8`    | `2`          | `uint16 LE` | `formatVersion`    | Container specification version (`1`). |
| `10`   | `2`          | `uint16 LE` | `headerSize`       | Size of the header in bytes (`64`). |
| `12`   | `4`          | `uint32 LE` | `featureFlags`     | Bitmask: `0x01` = Compact Compression, `0x02` = Signed Package, `0x04` = Encrypted Payload, `0x08` = Has Scripts. |
| `16`   | `8`          | `uint64 LE` | `directoryOffset`  | Byte offset from start of file where the Entry Directory begins (`>= 64`). |
| `24`   | `8`          | `uint64 LE` | `directoryLength`  | Total byte length of the Entry Directory region. |
| `32`   | `4`          | `uint32 LE` | `manifestEntryId`  | Entry ID of the primary `manifest.json` entry (conventionally `1`). |
| `36`   | `4`          | `uint32 LE` | `entryCount`       | Total number of entries in the directory (`>= 1`). |
| `40`   | `24`         | `uint8[24]` | `reserved`         | Must be all zero (`0x00`) in Version 1. Non-zero values are rejected unless an understood version extension applies. |

---

## 4. Directory Entry Record Encoding

The Entry Directory starts at `directoryOffset` and consists of `entryCount` back-to-back binary records. Each record has a fixed 68-byte prefix followed by two UTF-8 strings (`path` and `mimeType`):

| Relative Offset | Size (Bytes) | Type        | Field Name            | Description |
|----------------:|-------------:|-------------|-----------------------|-------------|
| `0`             | `4`          | `uint32 LE` | `entryId`             | Unique non-zero integer ID within the archive. |
| `4`             | `1`          | `uint8`     | `entryType`           | `1`=Manifest, `2`=Scene, `3`=Image, `4`=Video, `5`=Audio, `6`=Font, `7`=Script, `8`=Animation, `9`=Theme, `10`=Component, `11`=Signature, `12`=Other. |
| `5`             | `1`          | `uint8`     | `compressionMethod`   | `0`=None (Store), `1`=Deflate (`deflate-raw`/RFC 1951 or `deflate`), `2`=Gzip. |
| `6`             | `2`          | `uint16 LE` | `flags`               | Entry flags (`0x01`=Required for startup, `0x02`=Lazy-loadable, `0x04`=Executable Script, `0x08`=Derivative/Optimized). |
| `8`             | `8`          | `uint64 LE` | `dataOffset`          | Absolute byte offset of the entry payload in the archive (`>= 64`). |
| `16`            | `8`          | `uint64 LE` | `storedLength`        | Compressed byte length stored in the archive. |
| `24`            | `8`          | `uint64 LE` | `originalLength`      | Uncompressed byte length of the original payload. |
| `32`            | `32`         | `uint8[32]` | `contentHash`         | Raw 32-byte SHA-256 digest of the **uncompressed** entry data. |
| `64`            | `2`          | `uint16 LE` | `pathLength`          | Byte length of `logicalPath` UTF-8 string (`1..512`). |
| `66`            | `2`          | `uint16 LE` | `mimeLength`          | Byte length of `mimeType` UTF-8 string (`1..128`). |
| `68`            | `pathLength` | `utf8`      | `logicalPath`         | Normalized relative archive path (e.g., `manifest.json`, `assets/logo.svg`). Must not start with `/`, contain `\`, or include `..` segments. |
| `68+pathLength` | `mimeLength` | `utf8`      | `mimeType`            | Standard MIME type (e.g., `application/json`, `image/png`, `video/mp4`). |

---

## 5. Compression Strategy & Export Profiles

1. **Already-Compressed Media (Store Unchanged / `compressionMethod = 0`)**:
   - `image/png`, `image/jpeg`, `image/webp`, `image/gif`
   - `video/mp4`, `video/webm`
   - `audio/mpeg`, `audio/ogg`
   - `font/woff2`
2. **Compressible Text & Structured Data (`Deflate` / `compressionMethod = 1`)**:
   - `application/json` (Manifest, scenes, animations, themes)
   - `image/svg+xml`
   - `application/javascript`, `text/plain`, `application/vnd.digital-signage.script+json`
   - Uncompressed `audio/wav` or raw bitmaps
3. **Export Profiles**:
   - **Fast Export**: Compresses the manifest; stores media and small assets directly for rapid packaging; skips trial compression when payload `< 256` bytes.
   - **Compact Export**: Compresses all eligible text/JSON/SVG/script/uncompressed-audio entries and only keeps the compressed version if `storedLength < originalLength`.

---

## 6. Versioned Manifest Schema (`manifest.json`)

```json
{
  "format": "SIGNAGE",
  "manifestVersion": 1,
  "createdAt": "2026-10-25T12:00:00.000Z",
  "exportProfile": "compact",
  "publisher": {
    "name": "Digital Signage Studio",
    "keyId": "pub-default-01",
    "signatureHex": "..."
  },
  "project": {
    "id": "project-001",
    "name": "Corporate Lobby Display",
    "width": 1920,
    "height": 1080,
    "frameRate": 30,
    "scalingMode": "contain",
    "theme": { ... }
  },
  "entrySceneId": "scene-welcome",
  "scenes": [ ... ],
  "assets": [ ... ],
  "playlists": [ ... ],
  "schedules": [ ... ],
  "scripts": [ ... ],
  "permissions": [ ... ]
}
```

---

## 7. Security & Integrity Validation Rules

Every reader and server upload handler enforces the 12-point validation pipeline before trusting a `.signage` package:

1. **Magic Signature**: Bytes `0..7` must equal `SIGNAGE\0`.
2. **Format Version**: `formatVersion` must be supported (`1`).
3. **Header Bounds**: File length must be `>= 64`, `headerSize == 64`, and `reserved` bytes `40..63` must be zero.
4. **Directory Bounds**: `directoryOffset >= 64` and `directoryOffset + directoryLength <= fileByteLength` without 64-bit integer overflow.
5. **Non-Overlapping Entry Ranges**: Every entry's `[dataOffset, dataOffset + storedLength)` must lie within `[64, directoryOffset)` and must not overlap any other entry or the header/directory.
6. **Entry Count Limits**: `entryCount` must be between `1` and `maxEntries` (default `4,096`).
7. **Decompression Bomb Protection**: Each entry's `originalLength` must not exceed `maxSingleEntryBytes` (default `512 MB`), total uncompressed archive size must not exceed `maxTotalUncompressedBytes` (default `2 GB`), and decompression streams abort immediately if output exceeds `originalLength`.
8. **Path Traversal Protection**: Every `logicalPath` is rejected if it starts with `/`, contains `\`, null bytes, or `..` path traversal segments.
9. **SHA-256 Content Integrity**: When any entry is read, its uncompressed bytes are hashed with SHA-256 and compared against the 32-byte `contentHash` in the directory entry. Any mismatch raises an integrity error.
10. **Manifest Schema Validation**: The manifest entry referenced by `manifestEntryId` must parse as valid JSON matching `manifestVersion: 1` and contain valid project dimensions, scenes, and entrySceneId.
11. **Asset & Script Reference Verification**: Every asset ID and script ID referenced by a scene element must exist in the manifest and correspond to a valid directory entry.
12. **Zero Execution During Validation**: Validation is strictly side-effect-free; scripts are never evaluated during archive validation or import inspection.
