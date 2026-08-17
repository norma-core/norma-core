import type { arduino_pro_4g_gnss } from '@/api/proto.js';

const KNOTS_TO_MPS = 0.514444;

const TALKER_SYSTEMS: Record<string, string> = {
  GP: 'GPS',
  GL: 'GLONASS',
  GA: 'Galileo',
  GB: 'BeiDou',
  BD: 'BeiDou',
  // Quectel proprietary BeiDou sentences ($PQGSA/$PQGSV).
  PQ: 'BeiDou',
  GQ: 'QZSS',
  GN: 'GNSS',
};

/** NMEA 4.10/4.11 GSA trailing system id → constellation. */
const GSA_SYSTEM_IDS: Record<number, string> = {
  1: 'GPS',
  2: 'GLONASS',
  3: 'Galileo',
  4: 'BeiDou',
  5: 'QZSS',
};

export interface GnssSatellite {
  system: string;
  prn: number | null;
  elevationDeg: number | null;
  azimuthDeg: number | null;
  snrDb: number | null;
  /** Listed in a GSA sentence, i.e. contributing to the current fix. */
  used: boolean;
}

/** SBAS and QZSS satellites are reported under the GPS talker but occupy
 * reserved PRN ranges. */
function classifySystem(talkerSystem: string, prn: number | null): string {
  if (talkerSystem === 'GPS' && prn !== null) {
    if (prn >= 33 && prn <= 64) {
      return 'SBAS';
    }
    if (prn >= 193 && prn <= 202) {
      return 'QZSS';
    }
  }
  return talkerSystem;
}

export interface GnssValues {
  utcTime: string | null;
  utcDate: string | null;
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  courseDeg: number | null;
  fixQuality: number | null;
  /** GSA fix type: 1 = none, 2 = 2D, 3 = 3D. */
  fixType: number | null;
  satellitesUsed: number | null;
  satellitesInView: number | null;
  hdop: number | null;
  pdop: number | null;
  vdop: number | null;
  satellites: GnssSatellite[];
}

function emptyValues(): GnssValues {
  return {
    utcTime: null,
    utcDate: null,
    latitudeDeg: null,
    longitudeDeg: null,
    altitudeM: null,
    speedMps: null,
    courseDeg: null,
    fixQuality: null,
    fixType: null,
    satellitesUsed: null,
    satellitesInView: null,
    hdop: null,
    pdop: null,
    vdop: null,
    satellites: [],
  };
}

function parseNumber(field: string | undefined): number | null {
  if (field === undefined || field === '') {
    return null;
  }
  const value = Number(field);
  return Number.isFinite(value) ? value : null;
}

/** `ddmm.mmmm` / `dddmm.mmmm` plus N/S/E/W hemisphere to signed degrees. */
function parseCoordinate(field: string | undefined, hemisphere: string | undefined): number | null {
  if (!field || !hemisphere) {
    return null;
  }
  const dot = field.indexOf('.');
  const minutesStart = (dot === -1 ? field.length : dot) - 2;
  if (minutesStart < 1) {
    return null;
  }
  const degrees = Number(field.slice(0, minutesStart));
  const minutes = Number(field.slice(minutesStart));
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) {
    return null;
  }
  const value = degrees + minutes / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -value : value;
}

/** Splits a sentence into fields with the `$` address kept at index 0 and the checksum removed. */
function sentenceFields(sentence: string): string[] | null {
  if (!sentence.startsWith('$')) {
    return null;
  }
  const star = sentence.lastIndexOf('*');
  const body = star === -1 ? sentence : sentence.slice(0, star);
  return body.slice(1).split(',');
}

export function parseNmeaBatch(text: string): GnssValues {
  const values = emptyValues();
  const inViewBySystem = new Map<string, number>();
  // Satellite ids listed by GSA sentences: scoped per system when the
  // sentence says which one, plus a global pool for unscoped GN lines.
  const usedBySystem = new Map<string, Set<number>>();
  const usedUnscoped = new Set<number>();

  for (const raw of text.split('\n')) {
    const fields = sentenceFields(raw.trim());
    if (!fields || fields[0].length < 5) {
      continue;
    }
    const talker = fields[0].slice(0, 2);
    const type = fields[0].slice(2);

    switch (type) {
      case 'RMC': {
        values.utcTime = fields[1] || values.utcTime;
        values.utcDate = fields[9] || values.utcDate;
        values.latitudeDeg = parseCoordinate(fields[3], fields[4]) ?? values.latitudeDeg;
        values.longitudeDeg = parseCoordinate(fields[5], fields[6]) ?? values.longitudeDeg;
        const speedKnots = parseNumber(fields[7]);
        values.speedMps = speedKnots === null ? values.speedMps : speedKnots * KNOTS_TO_MPS;
        values.courseDeg = parseNumber(fields[8]) ?? values.courseDeg;
        break;
      }
      case 'GGA': {
        values.utcTime = fields[1] || values.utcTime;
        values.latitudeDeg = parseCoordinate(fields[2], fields[3]) ?? values.latitudeDeg;
        values.longitudeDeg = parseCoordinate(fields[4], fields[5]) ?? values.longitudeDeg;
        values.fixQuality = parseNumber(fields[6]) ?? values.fixQuality;
        values.satellitesUsed = parseNumber(fields[7]) ?? values.satellitesUsed;
        values.hdop = parseNumber(fields[8]) ?? values.hdop;
        values.altitudeM = parseNumber(fields[9]) ?? values.altitudeM;
        break;
      }
      case 'GSA': {
        const fixType = parseNumber(fields[2]);
        if (fixType !== null) {
          values.fixType = Math.max(values.fixType ?? 0, fixType);
        }
        values.pdop = parseNumber(fields[15]) ?? values.pdop;
        values.hdop = parseNumber(fields[16]) ?? values.hdop;
        values.vdop = parseNumber(fields[17]) ?? values.vdop;

        const systemId = parseNumber(fields[18]);
        const scope =
          (systemId !== null ? GSA_SYSTEM_IDS[systemId] : undefined) ??
          (talker !== 'GN' ? TALKER_SYSTEMS[talker] : undefined);
        for (let i = 3; i <= 14 && i < fields.length; i += 1) {
          const id = parseNumber(fields[i]);
          if (id === null) {
            continue;
          }
          if (scope) {
            let ids = usedBySystem.get(scope);
            if (!ids) {
              ids = new Set<number>();
              usedBySystem.set(scope, ids);
            }
            ids.add(id);
          } else {
            usedUnscoped.add(id);
          }
        }
        break;
      }
      case 'VTG': {
        values.courseDeg = parseNumber(fields[1]) ?? values.courseDeg;
        const speedKnots = parseNumber(fields[5]);
        values.speedMps = speedKnots === null ? values.speedMps : speedKnots * KNOTS_TO_MPS;
        break;
      }
      case 'GSV': {
        const system = TALKER_SYSTEMS[talker] ?? talker;
        const inView = parseNumber(fields[3]);
        if (inView !== null) {
          inViewBySystem.set(system, inView);
        }
        for (let i = 4; i < fields.length; i += 4) {
          const prn = parseNumber(fields[i]);
          if (prn === null) {
            continue;
          }
          values.satellites.push({
            system: classifySystem(system, prn),
            prn,
            elevationDeg: parseNumber(fields[i + 1]),
            azimuthDeg: parseNumber(fields[i + 2]),
            snrDb: parseNumber(fields[i + 3]),
            used: false,
          });
        }
        break;
      }
    }
  }

  if (inViewBySystem.size > 0) {
    values.satellitesInView = [...inViewBySystem.values()].reduce((a, b) => a + b, 0);
  }
  for (const sat of values.satellites) {
    if (sat.prn === null) {
      continue;
    }
    sat.used = usedBySystem.get(sat.system)?.has(sat.prn) ?? usedUnscoped.has(sat.prn);
  }
  return values;
}

export function decodeBatchText(data: Uint8Array | null | undefined): string {
  if (!data || data.length === 0) {
    return '';
  }
  return new TextDecoder().decode(data);
}

export function gnssDeviceLabel(device: arduino_pro_4g_gnss.IArduinoPro4gGnssDevice | null | undefined): string {
  const port = device?.nmeaPort;
  return port ? `GNSS ${port}` : 'GNSS';
}
