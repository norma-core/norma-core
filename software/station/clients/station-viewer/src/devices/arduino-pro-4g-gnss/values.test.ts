import { describe, expect, it } from 'vitest';
import { mergeNmeaBatch, parseNmeaBatch } from './values';

// Sentences in EG25-G firmware order (VTG, GSA, GGA, RMC + GSV at 1 Hz).
const FIX_BATCH = [
  '$GPVTG,77.52,T,,M,0.62,N,1.15,K,A*35',
  '$GPGSA,A,3,10,32,21,,,,,,,,,,1.61,0.94,1.30*04',
  '$GLGSA,A,3,65,71,,,,,,,,,,,1.61,0.94,1.30*10',
  '$GPGGA,110317.00,4807.0380,N,01131.0000,E,1,08,0.94,545.4,M,46.9,M,,*5B',
  '$GPGSV,2,1,05,10,63,137,17,32,41,175,30,21,44,290,22,08,05,020,*7A',
  '$GPGSV,2,2,05,03,10,090,11*5C',
  '$GLGSV,1,1,02,65,60,100,28,71,30,200,25*6A',
  '$GPRMC,110317.00,A,4807.0380,N,01131.0000,E,0.62,77.52,160826,,,A*6E',
].join('\n');

const NO_FIX_BATCH = [
  '$GPVTG,,T,,M,,N,,K,N*2C',
  '$GPGSA,A,1,,,,,,,,,,,,,,,,*32',
  '$GPGGA,,,,,,0,,,,,,,,*66',
  '$GPRMC,,V,,,,,,,,,,N,V*29',
].join('\n');

describe('parseNmeaBatch', () => {
  it('extracts position, motion and fix data from a full batch', () => {
    const values = parseNmeaBatch(FIX_BATCH);

    expect(values.latitudeDeg).toBeCloseTo(48 + 7.038 / 60, 6);
    expect(values.longitudeDeg).toBeCloseTo(11 + 31.0 / 60, 6);
    expect(values.altitudeM).toBeCloseTo(545.4);
    expect(values.speedMps).toBeCloseTo(0.62 * 0.514444, 4);
    expect(values.courseDeg).toBeCloseTo(77.52);
    expect(values.utcTime).toBe('110317.00');
    expect(values.utcDate).toBe('160826');
    expect(values.fixQuality).toBe(1);
    expect(values.fixType).toBe(3);
    // From GSA (GPS 10,32,21 + GLONASS 65,71), not GGA's GPS-only count.
    expect(values.satellitesUsed).toBe(5);
    expect(values.hdop).toBeCloseTo(0.94);
    expect(values.pdop).toBeCloseTo(1.61);
    expect(values.vdop).toBeCloseTo(1.3);
  });

  it('reports southern and western coordinates as negative', () => {
    const values = parseNmeaBatch(
      '$GPGGA,110317.00,3352.0000,S,15112.0000,W,1,05,1.0,10.0,M,0.0,M,,*7D',
    );
    expect(values.latitudeDeg).toBeCloseTo(-(33 + 52 / 60), 6);
    expect(values.longitudeDeg).toBeCloseTo(-(151 + 12 / 60), 6);
  });

  it('collects satellites across constellations from GSV', () => {
    const values = parseNmeaBatch(FIX_BATCH);

    expect(values.satellitesInView).toBe(7); // 5 GPS + 2 GLONASS
    expect(values.satellites).toHaveLength(7);
    const gps10 = values.satellites.find(s => s.system === 'GPS' && s.prn === 10);
    expect(gps10).toMatchObject({ elevationDeg: 63, azimuthDeg: 137, snrDb: 17 });
    const glonass = values.satellites.filter(s => s.system === 'GLONASS');
    expect(glonass).toHaveLength(2);
    // Satellite tracked but with no signal: SNR field empty.
    const gps8 = values.satellites.find(s => s.prn === 8);
    expect(gps8?.snrDb).toBeNull();
  });

  it('classifies SBAS and QZSS satellites hiding under the GPS talker', () => {
    const values = parseNmeaBatch(
      '$GPGSV,1,1,03,10,63,137,17,44,30,180,25,195,50,160,33*7D',
    );
    expect(values.satellites.map(s => s.system)).toEqual(['GPS', 'SBAS', 'QZSS']);
  });

  it('marks satellites listed in GSA as used in the fix', () => {
    const values = parseNmeaBatch(FIX_BATCH);

    const used = values.satellites.filter(s => s.used).map(s => `${s.system}:${s.prn}`);
    expect(used).toContain('GPS:10');
    expect(used).toContain('GPS:32');
    expect(used).toContain('GLONASS:65');
    expect(used).toContain('GLONASS:71');
    const gps8 = values.satellites.find(s => s.prn === 8);
    expect(gps8?.used).toBe(false);
  });

  it('scopes GSA used-satellite ids by NMEA 4.10 system id when present', () => {
    const values = parseNmeaBatch(
      [
        // GN talker, systemId field: 1 = GPS, 3 = Galileo.
        '$GNGSA,A,3,05,12,,,,,,,,,,,1.5,0.9,1.2,1*00',
        '$GNGSA,A,3,05,,,,,,,,,,,,1.5,0.9,1.2,3*00',
        '$GPGSV,1,1,02,05,10,100,20,12,20,200,21*00',
        '$GAGSV,1,1,02,05,15,150,22,09,25,250,23*00',
      ].join('\n'),
    );

    const galileo5 = values.satellites.find(s => s.system === 'Galileo' && s.prn === 5);
    const galileo9 = values.satellites.find(s => s.system === 'Galileo' && s.prn === 9);
    const gps5 = values.satellites.find(s => s.system === 'GPS' && s.prn === 5);
    const gps12 = values.satellites.find(s => s.system === 'GPS' && s.prn === 12);
    expect(gps5?.used).toBe(true);
    expect(gps12?.used).toBe(true);
    expect(galileo5?.used).toBe(true);
    expect(galileo9?.used).toBe(false);
  });

  it('classifies Quectel proprietary PQ sentences as BeiDou', () => {
    const values = parseNmeaBatch(
      [
        '$PQGSV,1,1,02,201,50,100,30,205,40,200,28*00',
        '$PQGSA,A,3,201,205,,,,,,,,,,,1.5,0.9,1.2*00',
      ].join('\n'),
    );
    const beidou = values.satellites.filter(s => s.system === 'BeiDou');
    expect(beidou).toHaveLength(2);
    expect(beidou.every(s => s.used)).toBe(true);
  });

  it('returns nulls for an empty-field no-fix batch', () => {
    const values = parseNmeaBatch(NO_FIX_BATCH);

    expect(values.latitudeDeg).toBeNull();
    expect(values.longitudeDeg).toBeNull();
    expect(values.altitudeM).toBeNull();
    expect(values.speedMps).toBeNull();
    expect(values.fixQuality).toBe(0);
    expect(values.fixType).toBe(1);
    // Fix quality 0 means 0 satellites in the solution, not "unknown".
    expect(values.satellitesUsed).toBe(0);
    expect(values.satellites).toHaveLength(0);
  });

  it('ignores garbage lines and empty input', () => {
    expect(parseNmeaBatch('').latitudeDeg).toBeNull();
    const values = parseNmeaBatch('garbage\n$GPGGA,110317.00,4807.0380,N,01131.0000,E,1,08,0.94,545.4,M,46.9,M,,*5B');
    expect(values.altitudeM).toBeCloseTo(545.4);
  });
});

// The EG25-G interleaves epoch kinds: at 10 Hz most epochs carry only
// VTG/GSA/GGA/RMC; the GSV satellite burst rides in one epoch per second.
// mergeNmeaBatch folds each epoch into the previous state so per-epoch
// fields update while satellite data persists between bursts.
describe('mergeNmeaBatch', () => {
  const FIX_ONLY_BATCH = [
    '$GPVTG,80.00,T,,M,1.00,N,1.85,K,A*3F',
    '$GPGSA,A,3,10,32,,,,,,,,,,,1.70,1.00,1.40*0F',
    '$GPGGA,110318.00,4807.0390,N,01131.0010,E,1,06,1.00,546.0,M,46.9,M,,*52',
    '$GPRMC,110318.00,A,4807.0390,N,01131.0010,E,1.00,80.00,160826,,,A*63',
  ].join('\n');

  it('matches parseNmeaBatch when starting from no previous state', () => {
    expect(mergeNmeaBatch(null, FIX_BATCH)).toEqual(parseNmeaBatch(FIX_BATCH));
  });

  it('keeps satellites and in-view count across a GSV-less epoch', () => {
    const first = mergeNmeaBatch(null, FIX_BATCH);
    const next = mergeNmeaBatch(first, FIX_ONLY_BATCH);

    expect(next.satellites).toHaveLength(7);
    expect(next.satellitesInView).toBe(7);
    // While per-epoch fields track the new batch.
    expect(next.altitudeM).toBeCloseTo(546.0);
    expect(next.satellitesUsed).toBe(2); // GSA lists 10,32
    expect(next.hdop).toBeCloseTo(1.0);
  });

  it('replaces only the constellations present in a new GSV burst', () => {
    const first = mergeNmeaBatch(null, FIX_BATCH); // 5 GPS + 2 GLONASS
    const next = mergeNmeaBatch(first, [
      '$GPGSV,1,1,02,10,64,138,18,32,42,176,31*7F',
    ].join('\n'));

    const gps = next.satellites.filter(s => s.system === 'GPS');
    const glonass = next.satellites.filter(s => s.system === 'GLONASS');
    expect(gps).toHaveLength(2); // replaced by the new burst
    expect(glonass).toHaveLength(2); // kept from the previous burst
    expect(next.satellitesInView).toBe(4); // 2 GPS + 2 GLONASS
    const gps10 = gps.find(s => s.prn === 10);
    expect(gps10?.snrDb).toBe(18);
  });

  it('rebuilds used flags from the newest epoch that carries GSA', () => {
    const first = mergeNmeaBatch(null, FIX_BATCH); // GSA uses GPS 10, 32, 21
    // Satellite 32 drops out of the fix in the next epoch.
    const next = mergeNmeaBatch(first, [
      '$GPGSA,A,3,10,,,,,,,,,,,,1.70,1.00,1.40*0D',
    ].join('\n'));

    const gps10 = next.satellites.find(s => s.system === 'GPS' && s.prn === 10);
    const gps32 = next.satellites.find(s => s.system === 'GPS' && s.prn === 32);
    expect(gps10?.used).toBe(true);
    expect(gps32?.used).toBe(false);
  });

  it('keeps previous used flags across an epoch without GSA', () => {
    const first = mergeNmeaBatch(null, FIX_BATCH);
    const next = mergeNmeaBatch(first, [
      '$GPGGA,110318.00,4807.0390,N,01131.0010,E,1,06,1.00,546.0,M,46.9,M,,*52',
    ].join('\n'));

    const gps10 = next.satellites.find(s => s.system === 'GPS' && s.prn === 10);
    expect(gps10?.used).toBe(true);
  });

  it('lets the fix degrade: a later no-fix epoch overrides fix type and quality', () => {
    const first = mergeNmeaBatch(null, FIX_BATCH);
    const next = mergeNmeaBatch(first, NO_FIX_BATCH);

    expect(next.fixQuality).toBe(0);
    expect(next.fixType).toBe(1);
    // Last-known position survives for display purposes.
    expect(next.latitudeDeg).toBeCloseTo(48 + 7.038 / 60, 6);
    expect(next.utcTime).toBe('110317.00');
  });
});

describe('multi-signal GSV deduplication', () => {
  it('keeps one entry per satellite, preferring the strongest signal', () => {
    // NMEA 4.11 receivers emit one GSV group per signal id; the same PRN
    // appears in each group (here L1 C/A at 24 dB and L5 at 31 dB).
    const values = parseNmeaBatch(
      [
        '$GPGSV,1,1,02,10,63,137,24,32,41,175,30,1*66',
        '$GPGSV,1,1,02,10,63,137,31,32,41,175,,6*63',
      ].join('\n'),
    );

    const gps10 = values.satellites.filter(s => s.system === 'GPS' && s.prn === 10);
    expect(gps10).toHaveLength(1);
    expect(gps10[0]?.snrDb).toBe(31);
    // A null-SNR duplicate must not shadow a tracked one.
    const gps32 = values.satellites.filter(s => s.system === 'GPS' && s.prn === 32);
    expect(gps32).toHaveLength(1);
    expect(gps32[0]?.snrDb).toBe(30);
  });
});

// A widget used for status judgement must not present stale numbers as
// current: when the receiver reports no fix, the used count and DOPs are
// meaningless and must not linger from the last fix.
describe('no-fix honesty', () => {
  it('zeroes the used count and clears DOPs when the fix is lost', () => {
    const first = mergeNmeaBatch(null, FIX_BATCH);
    const next = mergeNmeaBatch(first, NO_FIX_BATCH);

    expect(next.fixQuality).toBe(0);
    expect(next.satellitesUsed).toBe(0);
    expect(next.pdop).toBeNull();
    expect(next.hdop).toBeNull();
    expect(next.vdop).toBeNull();
  });

  it('restores live values when the fix returns', () => {
    let state = mergeNmeaBatch(null, FIX_BATCH);
    state = mergeNmeaBatch(state, NO_FIX_BATCH);
    state = mergeNmeaBatch(state, FIX_BATCH);

    expect(state.satellitesUsed).toBe(5);
    expect(state.pdop).toBeCloseTo(1.61);
  });
});

describe('seen count consistency', () => {
  it('reports seen as the number of satellites actually listed, not GSV totals', () => {
    // The GSV total claims 8 in view but only two entries are listed —
    // display counts must reconcile with the bars we render.
    const values = parseNmeaBatch('$GPGSV,1,1,08,10,63,137,17,32,41,175,30*00');
    expect(values.satellitesInView).toBe(2);
    expect(values.satellites).toHaveLength(2);
  });
});
