import { describe, expect, it } from 'vitest';
import { normfs } from './proto.js';
import { decodeEntryData } from './wire-encoding.js';

const text = Array.from({ length: 200 }, (_, i) => `${i} pid=${i} user=root status=sleeping cmd=/usr/bin/station\n`).join('');
const raw = new TextEncoder().encode(text);
// `zstd -3` (libzstd, as the station's normfs) of `raw`.
const packed = Uint8Array.from(Buffer.from('KLUv/WQ8LG0QAMabPxiQN8UG3YDWdaM34jMj+Vb2TilTIK7rD05IADEAMgBtS5IkSZIkSZIzMzMzMzMzMzJ3ZlVEv92SMwCKRcKgSAgYGEeC4UBwMFAoUCQQEAiD43AkNAIaR6GxWDAODMSRUJADQQKhIAFmZmZmZmZmVlVVVVVVVVVVVUVERERERERERET0/////////7Zt27Zt27bdtm3btm0btm3bbtu2bdu2bVuSJEmSJEmSnJmZmZmZmZkZERERERERERERmbu7u7u7u7u7uzszMwt3d3d3d3d3d3d3ZmZmZmZmZmZmZlVVVVVVVVVVVVVERERERERERERE/////////2/btm07gY+oIfSW/d+BZ5TEOhJAQOiAhOD///EPZizzrc5y32zc7pvO55zpfdZY3c+a23Wsu63Ddbd1fGdZ17eG6/rW+I5nrW85rvUt81vOcr9pXO43zec8030JPcqIAS+rNpAuqxaXVUOoBqHyB1U9qNxBFQfVN6jWoHIGlTGofEGFBdUrqKag8gRVElSOoAqCCvwDlRFwoD1SGJpfC0N7a2Foby0M7aeFof20MLRfFYb2q8LQfk0Y2q8JQ/u1YGi/Fgzt14Kh/VowtF8Lg/ZrYVBrD38e0x1eHdMcHhzDGx4bgzW8NKYz/GVMY3hhTF94XAzWFh6AxQRe4QfMX1RqPan1VK2XMqEfdW9SDwB9FX2/XsQ=', 'base64'));

describe('decodeEntryData', () => {
  it('decompresses a zstd entry to its stored bytes', () => {
    expect(decodeEntryData({ data: packed, encoding: normfs.Encoding.ENC_ZSTD })).toEqual(raw);
  });

  it('passes a raw entry through', () => {
    expect(decodeEntryData({ data: raw })).toBe(raw);
    expect(decodeEntryData({ data: raw, encoding: normfs.Encoding.ENC_NONE })).toBe(raw);
  });
});
