package vesc_trampa

import (
	"encoding/binary"
	"strings"
	"testing"

	vescpb "norma_core/target/generated-sources/protobuf/drivers/vesc-trampa/vesc_trampa"
)

func TestParseMotorTelemetry(t *testing.T) {
	payload := []byte{CommandGetValues}
	payload = appendI16(payload, 321)
	payload = appendI16(payload, 456)
	payload = appendI32(payload, 1234)
	payload = appendI32(payload, -567)
	payload = appendI32(payload, 111)
	payload = appendI32(payload, -222)
	payload = appendI16(payload, 765)
	payload = appendI32(payload, 12345)
	payload = appendI16(payload, 501)
	payload = appendI32(payload, 123456)
	payload = appendI32(payload, 234567)
	payload = appendI32(payload, 345678)
	payload = appendI32(payload, 456789)
	payload = appendI32(payload, 777)
	payload = appendI32(payload, 888)
	payload = append(payload, 2)
	payload = appendI32(payload, 314159)
	payload = append(payload, 42)
	payload = appendI16(payload, 311)
	payload = appendI16(payload, 322)
	payload = appendI16(payload, 333)
	payload = appendI32(payload, 1200)
	payload = appendI32(payload, -1300)
	payload = append(payload, 0x03)

	values, err := ParseMotorTelemetry(payload)
	if err != nil {
		t.Fatal(err)
	}

	if values.TempFetC != 32.1 {
		t.Fatalf("TempFetC = %v", values.TempFetC)
	}
	if values.AvgInputCurrentA != -5.67 {
		t.Fatalf("AvgInputCurrentA = %v", values.AvgInputCurrentA)
	}
	if values.DutyCycle != 0.765 {
		t.Fatalf("DutyCycle = %v", values.DutyCycle)
	}
	if values.InputVoltageV != 50.1 {
		t.Fatalf("InputVoltageV = %v", values.InputVoltageV)
	}
	if values.ControllerID != 42 {
		t.Fatalf("ControllerID = %v", values.ControllerID)
	}
	if values.MosfetTempsC != [3]float64{31.1, 32.2, 33.3} {
		t.Fatalf("MosfetTempsC = %v", values.MosfetTempsC)
	}
	if !values.TimeoutActive || !values.KillSwitchActive {
		t.Fatalf("status flags were not decoded: %#v", values)
	}
}

func TestParseZeroMotorAndAppConfigs(t *testing.T) {
	motorPayload := makeZeroConfigPayload(CommandGetMotorConfig, motorConfigSpecs, 0x11223344)
	motorConfig, err := ParseMotorConfig(motorPayload)
	if err != nil {
		t.Fatal(err)
	}
	if motorConfig.Signature != 0x11223344 {
		t.Fatalf("motor signature = 0x%08x", motorConfig.Signature)
	}
	if len(motorConfig.Fields) != len(motorConfigSpecs) {
		t.Fatalf("motor fields = %d, want %d", len(motorConfig.Fields), len(motorConfigSpecs))
	}
	if _, ok := motorConfig.Field("foc_motor_r"); !ok {
		t.Fatal("missing foc_motor_r field")
	}

	appPayload := makeZeroConfigPayload(CommandGetAppConfig, appConfigSpecs, 0x55667788)
	appConfig, err := ParseAppConfig(appPayload)
	if err != nil {
		t.Fatal(err)
	}
	if appConfig.Signature != 0x55667788 {
		t.Fatalf("app signature = 0x%08x", appConfig.Signature)
	}
	if len(appConfig.Fields) != len(appConfigSpecs) {
		t.Fatalf("app fields = %d, want %d", len(appConfig.Fields), len(appConfigSpecs))
	}
	if _, ok := appConfig.Field("app_uart_baudrate"); !ok {
		t.Fatal("missing app_uart_baudrate field")
	}
}

func TestDisplayRxEnvelopeWithValuesPacket(t *testing.T) {
	payload := []byte{CommandGetValues}
	payload = appendI16(payload, 250)
	payload = appendI16(payload, 260)
	payload = appendI32(payload, 100)
	payload = appendI32(payload, 200)
	payload = appendI32(payload, 0)
	payload = appendI32(payload, 0)
	payload = appendI16(payload, 100)
	payload = appendI32(payload, 3000)
	payload = appendI16(payload, 500)
	payload = appendI32(payload, 0)
	payload = appendI32(payload, 0)
	payload = appendI32(payload, 0)
	payload = appendI32(payload, 0)
	payload = appendI32(payload, 0)
	payload = appendI32(payload, 0)
	payload = append(payload, 0)
	payload = appendI32(payload, 0)
	payload = append(payload, 1)
	payload = appendI16(payload, 0)
	payload = appendI16(payload, 0)
	payload = appendI16(payload, 0)
	payload = appendI32(payload, 0)
	payload = appendI32(payload, 0)
	payload = append(payload, 0)

	envelope := &vescpb.RxEnvelope{
		SignalType: vescpb.VescTrampaSignalType_VESC_TRAMPA_BOARD_PACKET,
		BoardPacket: &vescpb.VescTrampaBoardPacket{
			StartByte:  2,
			PayloadLen: uint32(len(payload)),
			CommandId:  uint32(CommandGetValues),
			Payload:    payload,
			Crc:        0x1234,
			EndByte:    3,
		},
	}

	text, err := DisplayRxEnvelope(envelope.Marshal())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, "VESC_TRAMPA_BOARD_PACKET") || !strings.Contains(text, "values:") {
		t.Fatalf("unexpected display: %s", text)
	}
}

func makeZeroConfigPayload(commandID uint8, specs []configSpec, signature uint32) []byte {
	payload := []byte{commandID}
	payload = appendU32(payload, signature)
	for _, spec := range specs {
		payload = append(payload, make([]byte, specSize(spec))...)
	}
	return payload
}

func specSize(spec configSpec) int {
	switch spec.kind {
	case configU8, configI8, configBool:
		return 1
	case configU16, configFloat16:
		return 2
	case configU32, configI32, configFloat32Auto:
		return 4
	default:
		return 0
	}
}

func appendI16(dst []byte, value int16) []byte {
	return appendU16(dst, uint16(value))
}

func appendU16(dst []byte, value uint16) []byte {
	var buf [2]byte
	binary.BigEndian.PutUint16(buf[:], value)
	return append(dst, buf[:]...)
}

func appendI32(dst []byte, value int32) []byte {
	return appendU32(dst, uint32(value))
}

func appendU32(dst []byte, value uint32) []byte {
	var buf [4]byte
	binary.BigEndian.PutUint32(buf[:], value)
	return append(dst, buf[:]...)
}
