import { describe, expect, it } from 'vitest';
import { parseNmeaBatch } from './values';

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
    expect(values.satellitesUsed).toBe(8);
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

  it('returns nulls for an empty-field no-fix batch', () => {
    const values = parseNmeaBatch(NO_FIX_BATCH);

    expect(values.latitudeDeg).toBeNull();
    expect(values.longitudeDeg).toBeNull();
    expect(values.altitudeM).toBeNull();
    expect(values.speedMps).toBeNull();
    expect(values.fixQuality).toBe(0);
    expect(values.fixType).toBe(1);
    expect(values.satellitesUsed).toBeNull();
    expect(values.satellites).toHaveLength(0);
  });

  it('ignores garbage lines and empty input', () => {
    expect(parseNmeaBatch('').latitudeDeg).toBeNull();
    const values = parseNmeaBatch('garbage\n$GPGGA,110317.00,4807.0380,N,01131.0000,E,1,08,0.94,545.4,M,46.9,M,,*5B');
    expect(values.altitudeM).toBeCloseTo(545.4);
  });
});
