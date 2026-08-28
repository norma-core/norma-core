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

/** GnssValues plus the per-constellation memory that lets epochs merge:
 * GSV bursts arrive once a second (one burst per talker system) while fix
 * epochs arrive at up to 10 Hz, so satellite data must persist between
 * bursts and be replaced per system, not wholesale. */
export interface GnssState extends GnssValues {
  /** Talker system → satellites from its latest GSV burst. */
  satellitesBySystem: Record<string, GnssSatellite[]>;
  /** Fix-satellite ids from the latest epoch that carried GSA. */
  usedBySystem: Record<string, number[]>;
  usedUnscoped: number[];
}

function emptyState(): GnssState {
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
    satellitesBySystem: {},
    usedBySystem: {},
    usedUnscoped: [],
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

/** Folds one NMEA epoch into the previous state: fields present in the
 * batch update, everything else persists. Pass `null` to start fresh. */
export function mergeNmeaBatch(prev: GnssState | null, text: string): GnssState {
  const values: GnssState = prev ? { ...prev } : emptyState();
  // GSA/GSV data collected from this batch only; merged into the
  // persistent per-system records after the loop.
  let batchFixType: number | null = null;
  let batchHasGsa = false;
  const batchSatellites = new Map<string, GnssSatellite[]>();
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
        const quality = parseNumber(fields[6]);
        values.fixQuality = quality ?? values.fixQuality;
        // The used count comes from GSA, not GGA field 7: on the EG25-G
        // that field counts only GPS satellites, which contradicts the
        // multi-constellation GSA list shown in the bars.
        if (quality === 0) {
          values.satellitesUsed = 0;
        }
        values.hdop = parseNumber(fields[8]) ?? values.hdop;
        values.altitudeM = parseNumber(fields[9]) ?? values.altitudeM;
        break;
      }
      case 'GSA': {
        batchHasGsa = true;
        const fixType = parseNumber(fields[2]);
        if (fixType !== null) {
          batchFixType = Math.max(batchFixType ?? 0, fixType);
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
        let sats = batchSatellites.get(system);
        if (!sats) {
          sats = [];
          batchSatellites.set(system, sats);
        }
        for (let i = 4; i < fields.length; i += 4) {
          const prn = parseNumber(fields[i]);
          if (prn === null) {
            continue;
          }
          sats.push({
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

  // A GSV burst is complete per talker system, so it replaces that
  // system's satellites; systems absent from this batch keep theirs.
  values.fixType = batchFixType ?? values.fixType;
  // DOPs describe the current solution; without one they are meaningless.
  if (batchFixType === 1) {
    values.pdop = null;
    values.hdop = null;
    values.vdop = null;
  }
  if (batchSatellites.size > 0) {
    values.satellitesBySystem = { ...values.satellitesBySystem };
    for (const [system, sats] of batchSatellites) {
      values.satellitesBySystem[system] = dedupeSatellites(sats);
    }
  }
  // GSA lists the fix satellites afresh each epoch it appears in.
  if (batchHasGsa) {
    values.usedBySystem = Object.fromEntries(
      [...usedBySystem].map(([system, ids]) => [system, [...ids]]),
    );
    values.usedUnscoped = [...usedUnscoped];
    values.satellitesUsed =
      [...usedBySystem.values()].reduce((total, ids) => total + ids.size, 0) +
      usedUnscoped.size;
  }

  const usedSets = new Map(
    Object.entries(values.usedBySystem).map(([system, ids]) => [system, new Set(ids)]),
  );
  const unscopedSet = new Set(values.usedUnscoped);
  values.satellites = Object.values(values.satellitesBySystem)
    .flat()
    .map(sat => ({
      ...sat,
      used:
        sat.prn !== null &&
        (usedSets.get(sat.system)?.has(sat.prn) ?? unscopedSet.has(sat.prn)),
    }));
  // Seen = the satellites we actually list (deduped), so the headline
  // number always reconciles with the bars and per-system labels; GSV
  // totals count per talker and disagree once SBAS/QZSS are split out.
  values.satellitesInView =
    Object.keys(values.satellitesBySystem).length > 0 ? values.satellites.length : null;
  return values;
}

/** NMEA 4.11 receivers emit one GSV group per signal id, so one burst can
 * list a PRN several times (L1, L5, ...); keep the strongest sighting. */
function dedupeSatellites(sats: GnssSatellite[]): GnssSatellite[] {
  const best = new Map<string, GnssSatellite>();
  for (const sat of sats) {
    const key = `${sat.system}-${sat.prn}`;
    const seen = best.get(key);
    if (!seen || (sat.snrDb ?? -1) > (seen.snrDb ?? -1)) {
      best.set(key, sat);
    }
  }
  return [...best.values()];
}

export function parseNmeaBatch(text: string): GnssValues {
  return mergeNmeaBatch(null, text);
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
