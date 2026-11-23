#pragma once
// Minimal Feetech STS/SMS (ST3215) serial bus driver. Half duplex TTL through a
// bus adapter board. Protocol: FF FF ID LEN INSTR PARAMS... CHK, little-endian words.
// Adapters may or may not echo what we send; the packet reader drops a packet that
// is byte-identical to the one just sent, so both kinds work.
#include <Arduino.h>

namespace feetech {

enum : uint8_t { INST_PING = 1, INST_READ = 2, INST_WRITE = 3, INST_SYNC_WRITE = 0x83 };
enum : uint8_t {
  REG_ID = 5, REG_BAUD = 6, REG_MODE = 33, REG_TORQUE = 40, REG_ACC = 41,
  REG_GOAL_POS = 42, REG_GOAL_TIME = 44, REG_GOAL_SPEED = 46, REG_LOCK = 55,
  REG_PRESENT_POS = 56, REG_PRESENT_SPEED = 58, REG_PRESENT_LOAD = 60,
  REG_VOLTAGE = 62, REG_TEMP = 63, REG_MOVING = 66, REG_CURRENT = 69
};

struct Status { bool ok = false; int16_t pos = 0, speed = 0, load = 0, current = 0; uint8_t volt10 = 0, temp = 0; };

class Bus {
 public:
  explicit Bus(HardwareSerial& s) : _s(s) {}
  void begin(uint32_t baud, int rx, int tx) { _rx = rx; _tx = tx; _baud = baud; _s.begin(baud, SERIAL_8N1, rx, tx); _s.setTimeout(5); }
  void reconfigure(uint32_t baud, int rx, int tx) { _s.end(); delay(5); begin(baud, rx, tx); }
  uint32_t baud() const { return _baud; }
  int rxPin() const { return _rx; }
  int txPin() const { return _tx; }

  void write(uint8_t id, uint8_t reg, const uint8_t* data, uint8_t n) {
    uint8_t p[64]; int k = 0;
    p[k++] = 0xFF; p[k++] = 0xFF; p[k++] = id; p[k++] = n + 3; p[k++] = INST_WRITE; p[k++] = reg;
    for (uint8_t i = 0; i < n; i++) p[k++] = data[i];
    p[k] = _chk(p, k); k++;
    _send(p, k);
    if (id != 0xFE) { uint8_t buf[16]; _readPacket(buf, sizeof(buf), 4, id); }   // status reply
  }
  void writeByte(uint8_t id, uint8_t reg, uint8_t v) { write(id, reg, &v, 1); }
  void writeWord(uint8_t id, uint8_t reg, uint16_t v) { uint8_t b[2] = { (uint8_t)(v & 0xFF), (uint8_t)(v >> 8) }; write(id, reg, b, 2); }

  // Sync write the same register block to several servos. data: n bytes per servo, in id order.
  void syncWrite(const uint8_t* ids, uint8_t count, uint8_t reg, const uint8_t* data, uint8_t n) {
    uint8_t p[96]; int k = 0;
    p[k++] = 0xFF; p[k++] = 0xFF; p[k++] = 0xFE; p[k++] = (n + 1) * count + 4; p[k++] = INST_SYNC_WRITE; p[k++] = reg; p[k++] = n;
    for (uint8_t s = 0; s < count; s++) { p[k++] = ids[s]; for (uint8_t i = 0; i < n; i++) p[k++] = data[s * n + i]; }
    p[k] = _chk(p, k); k++;
    _send(p, k);
  }

  // Returns number of bytes read into out (0 on timeout / bad packet).
  int read(uint8_t id, uint8_t reg, uint8_t n, uint8_t* out, uint32_t timeoutMs = 8) {
    uint8_t p[8] = { 0xFF, 0xFF, id, 4, INST_READ, reg, n, 0 }; p[7] = _chk(p, 7);
    _send(p, 8);
    uint8_t buf[64];
    int got = _readPacket(buf, sizeof(buf), timeoutMs, id);
    if (got < 6) return 0;
    uint8_t plen = buf[3];           // = n + 2
    if (plen < 2 || plen - 2 != n || got < plen + 4) return 0;
    uint8_t c = 0; for (int i = 2; i < plen + 3; i++) c += buf[i];
    if ((uint8_t)~c != buf[plen + 3]) return 0;
    memcpy(out, buf + 5, n);
    return n;
  }
  bool ping(uint8_t id) {
    uint8_t p[6] = { 0xFF, 0xFF, id, 2, INST_PING, 0 }; p[5] = _chk(p, 5);
    _send(p, 6);
    uint8_t buf[16];
    int got = _readPacket(buf, sizeof(buf), 8, id);
    return got >= 6;
  }
  // Diagnostic: send a ping and return every byte that arrives within the window, echo included.
  int rawPing(uint8_t id, uint8_t* out, int cap, uint32_t windowMs = 20) {
    uint8_t p[6] = { 0xFF, 0xFF, id, 2, INST_PING, 0 }; p[5] = _chk(p, 5);
    _send(p, 6);
    int n = 0; uint32_t t0 = millis();
    while (millis() - t0 < windowMs) { while (_s.available() && n < cap) out[n++] = _s.read(); }
    return n;
  }

  // ---- ST3215 helpers ----
  void unlock(uint8_t id) { writeByte(id, REG_LOCK, 0); }
  void lock(uint8_t id)   { writeByte(id, REG_LOCK, 1); }
  bool readByte(uint8_t id, uint8_t reg, uint8_t& v) { return read(id, reg, 1, &v) == 1; }

  // Put a servo in continuous rotation (wheel) mode, only writing EEPROM if needed.
  bool setWheelMode(uint8_t id) {
    uint8_t m = 0xFF;
    if (readByte(id, REG_MODE, m) && m == 1) { writeByte(id, REG_TORQUE, 1); return true; }
    unlock(id); delay(5);
    writeByte(id, REG_MODE, 1); delay(5);
    lock(id); delay(5);
    writeByte(id, REG_TORQUE, 1);
    return readByte(id, REG_MODE, m) && m == 1;
  }
  bool changeId(uint8_t from, uint8_t to) {
    if (!ping(from)) return false;
    unlock(from); delay(5);
    writeByte(from, REG_ID, to); delay(10);
    lock(to); delay(5);
    return ping(to);
  }
  // speed in steps/s, sign = direction. acc 0..254.
  void setSpeeds(const uint8_t* ids, uint8_t count, const int16_t* speeds, uint8_t acc) {
    uint8_t data[4 * 7];
    for (uint8_t k = 0; k < count; k++) {
      int16_t sp = speeds[k];
      uint16_t v = sp < 0 ? ((uint16_t)(-sp) | 0x8000) : (uint16_t)sp;
      uint8_t* d = data + k * 7;
      d[0] = acc; d[1] = 0; d[2] = 0; d[3] = 0; d[4] = 0; d[5] = v & 0xFF; d[6] = v >> 8;
    }
    syncWrite(ids, count, REG_ACC, data, 7);
  }
  Status status(uint8_t id) {
    Status st;
    uint8_t b[16];
    if (read(id, REG_PRESENT_POS, 8, b) != 8) return st;       // 56..63
    st.pos = (int16_t)(b[0] | (b[1] << 8));
    int16_t sp = b[2] | (b[3] << 8); st.speed = (sp & 0x8000) ? -(sp & 0x7FFF) : sp;
    int16_t ld = b[4] | (b[5] << 8); st.load  = (ld & 0x0400) ? -(ld & 0x03FF) : ld;
    st.volt10 = b[6]; st.temp = b[7];
    if (read(id, REG_CURRENT, 2, b) == 2) { int16_t c = b[0] | (b[1] << 8); st.current = (c & 0x8000) ? -(c & 0x7FFF) : c; }
    st.ok = true;
    return st;
  }

 private:
  HardwareSerial& _s;
  int _rx = -1, _tx = -1; uint32_t _baud = 0;
  uint8_t _txbuf[96]; int _txn = 0;
  static uint8_t _chk(const uint8_t* p, int n) { uint8_t c = 0; for (int i = 2; i < n; i++) c += p[i]; return (uint8_t)~c; }
  void _send(const uint8_t* p, int n) {
    while (_s.available()) _s.read();
    memcpy(_txbuf, p, n); _txn = n;
    _s.write(p, n);
    _s.flush();
  }
  // Next complete packet that is not an echo of what we just sent. Returns its length, 0 on timeout.
  int _readPacket(uint8_t* buf, int cap, uint32_t timeoutMs, int wantId = -1) {
    uint32_t t0 = millis();
    int n = 0, state = 0;
    while (millis() - t0 < timeoutMs) {
      if (!_s.available()) continue;
      uint8_t c = _s.read();
      if (state == 0) { if (c == 0xFF) state = 1; continue; }
      if (state == 1) { if (c == 0xFF) { buf[0] = buf[1] = 0xFF; n = 2; state = 2; } else state = 0; continue; }
      if (n < cap) buf[n++] = c;
      if (n >= 4 && n >= buf[3] + 4) {
        if (n == _txn && memcmp(buf, _txbuf, n) == 0) { n = 0; state = 0; continue; }   // our own echo
        if (wantId >= 0 && buf[2] != wantId) { n = 0; state = 0; continue; }           // late reply from another servo
        return n;
      }
    }
    return 0;
  }
};

}  // namespace feetech
