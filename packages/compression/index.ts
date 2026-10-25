// ============================================================================
// @packages/compression — Bounded Compression & Decompression Engine
// Supports Store (0), Deflate/LZ Block (1), and Gzip/WebStream (2)
// Enforces strict decompression bomb limits before & during allocation.
// ============================================================================

import { concatBytes } from '@packages/shared';

export enum CompressionMethod {
  NONE = 0,
  DEFLATE = 1,
  GZIP = 2,
}

export const DEFAULT_MAX_DECOMPRESSED_ENTRY_BYTES = 128 * 1024 * 1024; // 128 MB

/**
 * Checks whether a MIME type is already compressed media and should not be
 * recompressed by default (Spec Section 7.5).
 */
export function shouldCompressMimeType(
  mimeType: string,
  profile: 'fast' | 'compact' = 'compact',
  byteLength = 0
): boolean {
  const mime = mimeType.toLowerCase();

  // Never recompress already-compressed images, videos, or WOFF2 fonts
  if (
    mime.includes('image/png') ||
    mime.includes('image/jpeg') ||
    mime.includes('image/jpg') ||
    mime.includes('image/webp') ||
    mime.includes('image/gif') ||
    mime.includes('video/mp4') ||
    mime.includes('video/webm') ||
    mime.includes('font/woff2') ||
    mime.includes('audio/mpeg') ||
    mime.includes('audio/mp3') ||
    mime.includes('audio/ogg')
  ) {
    return false;
  }

  if (byteLength < 64) {
    return false;
  }

  if (profile === 'fast') {
    // Fast export only compresses primary JSON manifests/scenes over 512 bytes
    return mime.includes('application/json') && byteLength >= 512;
  }

  // Compact export compresses JSON, SVG, scripts, text, and uncompressed WAV audio
  return (
    mime.includes('json') ||
    mime.includes('svg') ||
    mime.includes('javascript') ||
    mime.includes('text/') ||
    mime.includes('xml') ||
    mime.includes('audio/wav') ||
    mime.includes('script')
  );
}

/**
 * Deterministic, bounded LZ77 + Run-Length byte compressor (`CompressionMethod.DEFLATE = 1`).
 * Runs synchronously in both Browser and Node.js without native addons and guarantees
 * exact bit-for-bit round-trip reconstruction and strict decompression-bomb enforcement.
 *
 * Frame layout:
 *   Bytes 0..3: Magic "SGLZ" (0x53 0x47 0x4C 0x5A)
 *   Bytes 4..7: Uncompressed length (uint32 LE)
 *   Tokens:
 *     - Literal run: [0x00..0x7F] => count = (token + 1) literal bytes follow (1..128)
 *     - Match back-reference: [0x80..0xFF] => length = ((token & 0x7F) + 3) (3..130),
 *       followed by 2-byte uint16 LE backward distance (1..65535)
 */
export function compressBytes(
  input: Uint8Array,
  method: CompressionMethod = CompressionMethod.DEFLATE
): { data: Uint8Array; methodUsed: CompressionMethod } {
  if (method === CompressionMethod.NONE || input.byteLength === 0) {
    return { data: input, methodUsed: CompressionMethod.NONE };
  }

  const out: number[] = [0x53, 0x47, 0x4c, 0x5a, 0, 0, 0, 0];
  const len = input.byteLength;
  out[4] = len & 0xff;
  out[5] = (len >>> 8) & 0xff;
  out[6] = (len >>> 16) & 0xff;
  out[7] = (len >>> 24) & 0xff;

  const hashTable = new Int32Array(4096).fill(-1);
  const literalBuf: number[] = [];

  const flushLiterals = () => {
    let idx = 0;
    while (idx < literalBuf.length) {
      const chunkLen = Math.min(128, literalBuf.length - idx);
      out.push(chunkLen - 1); // 0..127
      for (let j = 0; j < chunkLen; j++) {
        out.push(literalBuf[idx + j]);
      }
      idx += chunkLen;
    }
    literalBuf.length = 0;
  };

  let pos = 0;
  while (pos < len) {
    let bestMatchLen = 0;
    let bestMatchDist = 0;

    if (pos + 3 <= len) {
      const h = ((input[pos] << 8) ^ (input[pos + 1] << 4) ^ input[pos + 2]) & 0xfff;
      const candidate = hashTable[h];
      hashTable[h] = pos;

      if (candidate >= 0 && pos - candidate <= 65535 && pos - candidate > 0) {
        const maxLen = Math.min(130, len - pos);
        let mLen = 0;
        while (mLen < maxLen && input[candidate + mLen] === input[pos + mLen]) {
          mLen++;
        }
        if (mLen >= 4) {
          bestMatchLen = mLen;
          bestMatchDist = pos - candidate;
        }
      }
    }

    if (bestMatchLen >= 4) {
      flushLiterals();
      const token = 0x80 | (bestMatchLen - 3);
      out.push(token);
      out.push(bestMatchDist & 0xff);
      out.push((bestMatchDist >>> 8) & 0xff);
      // Update hashes for intermediate positions
      for (let k = 1; k < bestMatchLen; k++) {
        if (pos + k + 3 <= len) {
          const hk = ((input[pos + k] << 8) ^ (input[pos + k + 1] << 4) ^ input[pos + k + 2]) & 0xfff;
          hashTable[hk] = pos + k;
        }
      }
      pos += bestMatchLen;
    } else {
      literalBuf.push(input[pos]);
      if (literalBuf.length >= 128) {
        flushLiterals();
      }
      pos++;
    }
  }

  flushLiterals();

  // Only keep compressed representation if it actually reduces size (Spec 7.5)
  if (out.length >= input.byteLength) {
    return { data: input, methodUsed: CompressionMethod.NONE };
  }

  return {
    data: new Uint8Array(out),
    methodUsed: method,
  };
}

export function decompressBytes(
  compressed: Uint8Array,
  method: CompressionMethod,
  expectedOriginalLength: number,
  maxAllowedBytes: number = DEFAULT_MAX_DECOMPRESSED_ENTRY_BYTES
): Uint8Array {
  if (expectedOriginalLength < 0 || expectedOriginalLength > maxAllowedBytes) {
    throw new Error(
      `Decompression bomb protection triggered: declared size ${expectedOriginalLength} exceeds maximum allowed ${maxAllowedBytes} bytes.`
    );
  }

  if (method === CompressionMethod.NONE) {
    if (compressed.byteLength !== expectedOriginalLength) {
      throw new Error(
        `Uncompressed entry length mismatch: stored ${compressed.byteLength} != declared ${expectedOriginalLength}`
      );
    }
    return compressed;
  }

  if (method !== CompressionMethod.DEFLATE && method !== CompressionMethod.GZIP) {
    throw new Error(`Unsupported compression method: ${method}`);
  }

  if (
    compressed.byteLength < 8 ||
    compressed[0] !== 0x53 ||
    compressed[1] !== 0x47 ||
    compressed[2] !== 0x4c ||
    compressed[3] !== 0x5a
  ) {
    throw new Error('Malformed compressed stream header');
  }

  const headerLen =
    (compressed[4] |
      (compressed[5] << 8) |
      (compressed[6] << 16) |
      (compressed[7] << 24)) >>>
    0;

  if (headerLen > maxAllowedBytes) {
    throw new Error(
      `Decompression bomb protection triggered: stream header size ${headerLen} exceeds limit ${maxAllowedBytes}`
    );
  }

  if (headerLen !== expectedOriginalLength) {
    throw new Error(
      `Compressed stream size (${headerLen}) does not match directory originalLength (${expectedOriginalLength})`
    );
  }

  const output = new Uint8Array(headerLen);
  let outPos = 0;
  let inPos = 8;

  while (inPos < compressed.byteLength) {
    const token = compressed[inPos++];
    if ((token & 0x80) === 0) {
      // Literal run
      const count = token + 1;
      if (inPos + count > compressed.byteLength) {
        throw new Error('Truncated literal run in compressed entry');
      }
      if (outPos + count > headerLen) {
        throw new Error('Decompression output overflow beyond declared originalLength');
      }
      output.set(compressed.subarray(inPos, inPos + count), outPos);
      inPos += count;
      outPos += count;
    } else {
      // Back-reference match
      const matchLen = (token & 0x7f) + 3;
      if (inPos + 2 > compressed.byteLength) {
        throw new Error('Truncated match distance in compressed entry');
      }
      const dist = compressed[inPos] | (compressed[inPos + 1] << 8);
      inPos += 2;
      if (dist <= 0 || dist > outPos) {
        throw new Error(`Invalid LZ back-reference distance ${dist} at output offset ${outPos}`);
      }
      if (outPos + matchLen > headerLen) {
        throw new Error('Decompression match overflow beyond declared originalLength');
      }
      let copySrc = outPos - dist;
      for (let i = 0; i < matchLen; i++) {
        output[outPos++] = output[copySrc++];
      }
    }
  }

  if (outPos !== headerLen) {
    throw new Error(`Decompressed byte count (${outPos}) does not match expected (${headerLen})`);
  }

  return output;
}

/**
 * Web CompressionStream async helper where native browser/Node stream compression is requested.
 */
export async function compressStreamAsync(
  data: Uint8Array,
  format: 'deflate' | 'gzip' = 'deflate'
): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    return compressBytes(data, CompressionMethod.DEFLATE).data;
  }
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  await writer.write(new Uint8Array(data));
  await writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatBytes(chunks);
}
