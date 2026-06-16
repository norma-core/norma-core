package vesc_trampa

import "fmt"

const fullValuesMask uint32 = 0xffffffff

type MotorTelemetry struct {
	CommandID uint8
	Mask      uint32

	TempFetC         float64
	TempMotorC       float64
	AvgMotorCurrentA float64
	AvgInputCurrentA float64
	AvgID            float64
	AvgIQ            float64
	DutyCycle        float64
	RPM              float64
	InputVoltageV    float64
	AmpHours         float64
	AmpHoursCharged  float64
	WattHours        float64
	WattHoursCharged float64
	Tachometer       int32
	TachometerAbs    int32
	FaultCode        uint8
	PIDPosition      float64
	ControllerID     uint8
	MosfetTempsC     [3]float64
	Vd               float64
	Vq               float64
	Status           uint8
	TimeoutActive    bool
	KillSwitchActive bool
	RawPayloadLen    int
	ExtraBytes       []byte
}

func ParseMotorTelemetry(payload []byte) (*MotorTelemetry, error) {
	commandID, body, err := expectCommand(payload, CommandGetValues, CommandGetValuesSel)
	if err != nil {
		return nil, err
	}

	r := newPacketReader(body)
	values := &MotorTelemetry{
		CommandID:     commandID,
		Mask:          fullValuesMask,
		RawPayloadLen: len(payload),
	}

	if commandID == CommandGetValuesSel {
		values.Mask, err = r.u32("values_mask")
		if err != nil {
			return nil, err
		}
	}

	if values.has(0) {
		if values.TempFetC, err = r.float16("temp_fet_c", 10); err != nil {
			return nil, err
		}
	}
	if values.has(1) {
		if values.TempMotorC, err = r.float16("temp_motor_c", 10); err != nil {
			return nil, err
		}
	}
	if values.has(2) {
		if values.AvgMotorCurrentA, err = r.float32("avg_motor_current_a", 100); err != nil {
			return nil, err
		}
	}
	if values.has(3) {
		if values.AvgInputCurrentA, err = r.float32("avg_input_current_a", 100); err != nil {
			return nil, err
		}
	}
	if values.has(4) {
		if values.AvgID, err = r.float32("avg_id", 100); err != nil {
			return nil, err
		}
	}
	if values.has(5) {
		if values.AvgIQ, err = r.float32("avg_iq", 100); err != nil {
			return nil, err
		}
	}
	if values.has(6) {
		if values.DutyCycle, err = r.float16("duty_cycle", 1000); err != nil {
			return nil, err
		}
	}
	if values.has(7) {
		if values.RPM, err = r.float32("rpm", 1); err != nil {
			return nil, err
		}
	}
	if values.has(8) {
		if values.InputVoltageV, err = r.float16("input_voltage_v", 10); err != nil {
			return nil, err
		}
	}
	if values.has(9) {
		if values.AmpHours, err = r.float32("amp_hours", 10000); err != nil {
			return nil, err
		}
	}
	if values.has(10) {
		if values.AmpHoursCharged, err = r.float32("amp_hours_charged", 10000); err != nil {
			return nil, err
		}
	}
	if values.has(11) {
		if values.WattHours, err = r.float32("watt_hours", 10000); err != nil {
			return nil, err
		}
	}
	if values.has(12) {
		if values.WattHoursCharged, err = r.float32("watt_hours_charged", 10000); err != nil {
			return nil, err
		}
	}
	if values.has(13) {
		if values.Tachometer, err = r.i32("tachometer"); err != nil {
			return nil, err
		}
	}
	if values.has(14) {
		if values.TachometerAbs, err = r.i32("tachometer_abs"); err != nil {
			return nil, err
		}
	}
	if values.has(15) {
		if values.FaultCode, err = r.u8("fault_code"); err != nil {
			return nil, err
		}
	}
	if values.has(16) {
		if values.PIDPosition, err = r.float32("pid_position", 1000000); err != nil {
			return nil, err
		}
	}
	if values.has(17) {
		if values.ControllerID, err = r.u8("controller_id"); err != nil {
			return nil, err
		}
	}
	if values.has(18) {
		for i := range values.MosfetTempsC {
			if values.MosfetTempsC[i], err = r.float16(fmt.Sprintf("mosfet_temp_%d_c", i+1), 10); err != nil {
				return nil, err
			}
		}
	}
	if values.has(19) {
		if values.Vd, err = r.float32("vd", 1000); err != nil {
			return nil, err
		}
	}
	if values.has(20) {
		if values.Vq, err = r.float32("vq", 1000); err != nil {
			return nil, err
		}
	}
	if values.has(21) {
		if values.Status, err = r.u8("status"); err != nil {
			return nil, err
		}
		values.TimeoutActive = values.Status&0x01 != 0
		values.KillSwitchActive = values.Status&0x02 != 0
	}

	values.ExtraBytes = r.extra()
	return values, nil
}

func (v *MotorTelemetry) has(bit uint) bool {
	return v.Mask&(1<<bit) != 0
}

func (v *MotorTelemetry) String() string {
	if v == nil {
		return "<nil>"
	}

	return fmt.Sprintf(
		"values: temp_fet=%.1fC temp_motor=%.1fC motor_current=%.2fA input_current=%.2fA duty=%.3f rpm=%.0f input=%.1fV fault=%d tach=%d controller_id=%d vd=%.3f vq=%.3f status=0x%02x timeout=%t kill_switch=%t raw_payload_len=%d extra=%d",
		v.TempFetC,
		v.TempMotorC,
		v.AvgMotorCurrentA,
		v.AvgInputCurrentA,
		v.DutyCycle,
		v.RPM,
		v.InputVoltageV,
		v.FaultCode,
		v.Tachometer,
		v.ControllerID,
		v.Vd,
		v.Vq,
		v.Status,
		v.TimeoutActive,
		v.KillSwitchActive,
		v.RawPayloadLen,
		len(v.ExtraBytes),
	)
}
