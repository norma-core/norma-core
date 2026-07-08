package vesc_trampa

import (
	"fmt"

	vescpb "norma_core/target/generated-sources/protobuf/drivers/vesc-trampa/vesc_trampa"
)

type ParsedPayload struct {
	CommandID     uint8
	Kind          PayloadKind
	Values        *MotorTelemetry
	MotorConfig   *MotorConfig
	AppConfig     *AppConfig
	RawPayloadLen int
}

type PayloadKind uint8

const (
	PayloadKindUnknown PayloadKind = iota
	PayloadKindValues
	PayloadKindMotorConfig
	PayloadKindAppConfig
)

type RxDisplay struct {
	SignalType vescpb.VescTrampaSignalType
	Payload    *ParsedPayload
	Error      string
}

func ParsePayload(payload []byte) (*ParsedPayload, error) {
	if len(payload) == 0 {
		return nil, fmt.Errorf("empty VESC payload")
	}

	result := &ParsedPayload{
		CommandID:     payload[0],
		RawPayloadLen: len(payload),
	}

	switch payload[0] {
	case CommandGetValues, CommandGetValuesSel:
		values, err := ParseMotorTelemetry(payload)
		if err != nil {
			return nil, err
		}
		result.Kind = PayloadKindValues
		result.Values = values
	case CommandGetMotorConfig:
		config, err := ParseMotorConfig(payload)
		if err != nil {
			return nil, err
		}
		result.Kind = PayloadKindMotorConfig
		result.MotorConfig = config
	case CommandGetAppConfig:
		config, err := ParseAppConfig(payload)
		if err != nil {
			return nil, err
		}
		result.Kind = PayloadKindAppConfig
		result.AppConfig = config
	}

	return result, nil
}

func ParseRxEnvelope(data []byte) (*RxDisplay, error) {
	envelope := vescpb.NewRxEnvelopeReader()
	if err := envelope.Unmarshal(data); err != nil {
		return nil, err
	}

	display := &RxDisplay{
		SignalType: envelope.GetSignalType(),
		Error:      envelope.GetError(),
	}

	packetReader := envelope.GetBoardPacket()
	if packetReader == nil {
		return display, nil
	}

	payloadBytes := packetReader.GetPayload()
	if len(payloadBytes) > 0 {
		payload, err := ParsePayload(payloadBytes)
		if err != nil {
			return nil, err
		}
		display.Payload = payload
	}

	return display, nil
}

func DisplayRxEnvelope(data []byte) (string, error) {
	display, err := ParseRxEnvelope(data)
	if err != nil {
		return "", err
	}
	return display.String(), nil
}

func (p *ParsedPayload) String() string {
	if p == nil {
		return "<nil>"
	}

	switch {
	case p.Values != nil:
		return p.Values.String()
	case p.MotorConfig != nil:
		return p.MotorConfig.String()
	case p.AppConfig != nil:
		return p.AppConfig.String()
	default:
		return fmt.Sprintf("payload: command_id=%d raw_payload_len=%d", p.CommandID, p.RawPayloadLen)
	}
}

func (d *RxDisplay) String() string {
	if d == nil {
		return "<nil>"
	}

	if d.Payload == nil {
		if d.Error != "" {
			return fmt.Sprintf("vesc_rx: signal=%s error=%q", d.SignalType.String(), d.Error)
		}
		return fmt.Sprintf("vesc_rx: signal=%s", d.SignalType.String())
	}

	if d.Error != "" {
		return fmt.Sprintf("vesc_rx: signal=%s error=%q %s", d.SignalType.String(), d.Error, d.Payload)
	}
	return d.Payload.String()
}
