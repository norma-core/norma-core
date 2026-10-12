import { decompress } from 'fzstd';
import { normfs } from './proto.js';

export const ACCEPT_ENCODINGS = [normfs.Encoding.ENC_ZSTD];

/** An entry's data as stored, decompressed when the server sent it zstd. */
export function decodeEntryData(read: normfs.IReadResponse): Uint8Array {
  const data = read.data ?? new Uint8Array(0);
  if (!read.encoding) {
    return data;
  }
  if (read.encoding !== normfs.Encoding.ENC_ZSTD) {
    throw new Error(`entry has unknown encoding ${read.encoding}`);
  }
  return decompress(data);
}
