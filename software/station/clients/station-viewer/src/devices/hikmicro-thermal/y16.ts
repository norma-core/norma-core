import { Decompress } from 'fzstd';

// fzstd trusts the frame header, so the frame is checked first: one single-segment
// frame of the expected content size and nothing after it.
function checkFrame(data: Uint8Array, size: number): void {
  const fail = (why: string): never => {
    throw new Error(`HIKMICRO Y16 frame ${why}`);
  };
  if (data.length < 6 || data[0] !== 0x28 || data[1] !== 0xb5 || data[2] !== 0x2f || data[3] !== 0xfd) {
    fail('has no zstd header');
  }
  const descriptor = data[4];
  if (!(descriptor & 0x20) || descriptor & 0x0b) fail('is not a single-segment frame without a dictionary');
  const sizeBytes = descriptor >> 6 ? 1 << (descriptor >> 6) : 1;
  let at = 5 + sizeBytes;
  if (data.length < at) fail('is truncated');
  let contentSize = 0;
  for (let i = at - 1; i >= 5; i -= 1) contentSize = contentSize * 256 + data[i];
  if (sizeBytes === 2) contentSize += 256;
  if (contentSize !== size) fail(`holds ${contentSize} bytes, expected ${size}`);
  for (let last = 0; !last;) {
    if (data.length < at + 3) fail('is truncated');
    const header = data[at] | (data[at + 1] << 8) | (data[at + 2] << 16);
    const type = (header >> 1) & 3;
    if (type === 3) fail('has a reserved block type');
    at += 3 + (type === 1 ? 1 : header >>> 3);
    last = header & 1;
  }
  if (descriptor & 4) at += 4;
  if (at !== data.length) fail(`is ${at} bytes but ${data.length} were given`);
}

function decompressExactly(data: Uint8Array, size: number): Uint8Array {
  checkFrame(data, size);
  const out = new Uint8Array(size);
  let length = 0;
  const stream = new Decompress(chunk => {
    if (length + chunk.length > size) throw new Error(`HIKMICRO Y16 frame decodes past ${size} bytes`);
    out.set(chunk, length);
    length += chunk.length;
  });
  stream.push(data, true);
  if (length !== size) throw new Error(`HIKMICRO Y16 frame decodes to ${length} bytes, expected ${size}`);
  return out;
}

// Inverse of the driver's Y16 encoder (hikmicro-thermal/src/y16.rs).
export function decodeY16(data: Uint8Array, width: number, height: number): Uint16Array {
  const pixels = width * height;
  const planes = decompressExactly(data, pixels * 2);

  const residual = (i: number): number => {
    const zigzag = planes[i] | (planes[pixels + i] << 8);
    return (zigzag >>> 1) ^ -(zigzag & 1);
  };
  // Uint16Array stores modulo 2^16, which undoes the encoder's wrapping subtraction.
  const out = new Uint16Array(pixels);
  for (let i = 0; i < width; i += 1) {
    out[i] = (i === 0 ? 0 : out[i - 1]) + residual(i);
  }
  for (let row = width; row < pixels; row += width) {
    out[row] = out[row - width] + residual(row);
    for (let i = row + 1; i < row + width; i += 1) {
      const a = out[i - 1];
      const b = out[i - width];
      const c = out[i - width - 1];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      out[i] = (c >= hi ? lo : c <= lo ? hi : a + b - c) + residual(i);
    }
  }
  return out;
}
