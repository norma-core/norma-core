import Long from 'long';

export function formatVescTrampaUuid(uuid?: Uint8Array | null): string {
  if (!uuid || uuid.length === 0) {
    return 'unknown';
  }
  return Array.from(uuid)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function shortVescTrampaUuid(uuid?: Uint8Array | null): string {
  const formatted = formatVescTrampaUuid(uuid);
  if (formatted === 'unknown' || formatted.length <= 12) {
    return formatted;
  }
  return `${formatted.slice(0, 6)}...${formatted.slice(-6)}`;
}

export function longToNumber(value?: Long | number | null): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return Long.isLong(value) ? value.toNumber() : value;
}
