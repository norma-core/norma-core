package vesc_trampa

import (
	"encoding/binary"
	"fmt"
	"math"
)

const (
	CommandGetValues      uint8 = 4
	CommandGetMotorConfig uint8 = 14
	CommandGetAppConfig   uint8 = 17
	CommandGetValuesSel   uint8 = 50
)

type packetReader struct {
	data []byte
	off  int
}

func newPacketReader(data []byte) *packetReader {
	return &packetReader{data: data}
}

func (r *packetReader) remaining() int {
	return len(r.data) - r.off
}

func (r *packetReader) extra() []byte {
	if r.off >= len(r.data) {
		return nil
	}
	return r.data[r.off:]
}

func (r *packetReader) need(field string, n int) error {
	if r.remaining() < n {
		return fmt.Errorf("vesc payload too short for %s: need %d bytes, have %d", field, n, r.remaining())
	}
	return nil
}

func (r *packetReader) u8(field string) (uint8, error) {
	if err := r.need(field, 1); err != nil {
		return 0, err
	}
	v := r.data[r.off]
	r.off++
	return v, nil
}

func (r *packetReader) i8(field string) (int8, error) {
	v, err := r.u8(field)
	return int8(v), err
}

func (r *packetReader) bool8(field string) (bool, error) {
	v, err := r.u8(field)
	return v != 0, err
}

func (r *packetReader) u16(field string) (uint16, error) {
	if err := r.need(field, 2); err != nil {
		return 0, err
	}
	v := binary.BigEndian.Uint16(r.data[r.off:])
	r.off += 2
	return v, nil
}

func (r *packetReader) i16(field string) (int16, error) {
	v, err := r.u16(field)
	return int16(v), err
}

func (r *packetReader) u32(field string) (uint32, error) {
	if err := r.need(field, 4); err != nil {
		return 0, err
	}
	v := binary.BigEndian.Uint32(r.data[r.off:])
	r.off += 4
	return v, nil
}

func (r *packetReader) i32(field string) (int32, error) {
	v, err := r.u32(field)
	return int32(v), err
}

func (r *packetReader) float16(field string, scale float64) (float64, error) {
	v, err := r.i16(field)
	if err != nil {
		return 0, err
	}
	return float64(v) / scale, nil
}

func (r *packetReader) float32(field string, scale float64) (float64, error) {
	v, err := r.i32(field)
	if err != nil {
		return 0, err
	}
	return float64(v) / scale, nil
}

func (r *packetReader) float32Auto(field string) (float64, error) {
	res, err := r.u32(field)
	if err != nil {
		return 0, err
	}

	exp := int((res >> 23) & 0xff)
	sigI := res & 0x7fffff
	neg := res&(1<<31) != 0

	sig := 0.0
	if exp != 0 || sigI != 0 {
		sig = float64(sigI)/(8388608.0*2.0) + 0.5
		exp -= 126
	}
	if neg {
		sig = -sig
	}
	return math.Ldexp(sig, exp), nil
}

func expectCommand(payload []byte, expected ...uint8) (uint8, []byte, error) {
	if len(payload) == 0 {
		return 0, nil, fmt.Errorf("empty VESC payload")
	}
	commandID := payload[0]
	for _, id := range expected {
		if commandID == id {
			return commandID, payload[1:], nil
		}
	}
	return 0, nil, fmt.Errorf("unexpected VESC command id %d", commandID)
}
