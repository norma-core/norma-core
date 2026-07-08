package vesc_trampa

import (
	"fmt"
	"strings"
)

type configKind uint8

const (
	configU8 configKind = iota
	configI8
	configBool
	configU16
	configU32
	configI32
	configFloat16
	configFloat32Auto
)

type configSpec struct {
	name  string
	kind  configKind
	scale float64
}

type ConfigField struct {
	Name  string
	Value any
}

type MotorConfig struct {
	CommandID     uint8
	Signature     uint32
	Fields        []ConfigField
	RawPayloadLen int
	ExtraBytes    []byte
}

type AppConfig struct {
	CommandID     uint8
	Signature     uint32
	Fields        []ConfigField
	RawPayloadLen int
	ExtraBytes    []byte
}

func ParseMotorConfig(payload []byte) (*MotorConfig, error) {
	commandID, body, err := expectCommand(payload, CommandGetMotorConfig)
	if err != nil {
		return nil, err
	}

	signature, fields, extra, err := parseConfigBody(body, motorConfigSpecs)
	if err != nil {
		return nil, err
	}

	return &MotorConfig{
		CommandID:     commandID,
		Signature:     signature,
		Fields:        fields,
		RawPayloadLen: len(payload),
		ExtraBytes:    extra,
	}, nil
}

func ParseAppConfig(payload []byte) (*AppConfig, error) {
	commandID, body, err := expectCommand(payload, CommandGetAppConfig)
	if err != nil {
		return nil, err
	}

	signature, fields, extra, err := parseConfigBody(body, appConfigSpecs)
	if err != nil {
		return nil, err
	}

	return &AppConfig{
		CommandID:     commandID,
		Signature:     signature,
		Fields:        fields,
		RawPayloadLen: len(payload),
		ExtraBytes:    extra,
	}, nil
}

func parseConfigBody(body []byte, specs []configSpec) (uint32, []ConfigField, []byte, error) {
	r := newPacketReader(body)
	signature, err := r.u32("signature")
	if err != nil {
		return 0, nil, nil, err
	}

	fields := make([]ConfigField, 0, len(specs))
	for _, spec := range specs {
		value, err := readConfigField(r, spec)
		if err != nil {
			return 0, nil, nil, err
		}
		fields = append(fields, ConfigField{Name: spec.name, Value: value})
	}

	return signature, fields, r.extra(), nil
}

func readConfigField(r *packetReader, spec configSpec) (any, error) {
	switch spec.kind {
	case configU8:
		return r.u8(spec.name)
	case configI8:
		return r.i8(spec.name)
	case configBool:
		return r.bool8(spec.name)
	case configU16:
		return r.u16(spec.name)
	case configU32:
		return r.u32(spec.name)
	case configI32:
		return r.i32(spec.name)
	case configFloat16:
		return r.float16(spec.name, spec.scale)
	case configFloat32Auto:
		return r.float32Auto(spec.name)
	default:
		return nil, fmt.Errorf("unknown config field kind for %s", spec.name)
	}
}

func (c *MotorConfig) Field(name string) (ConfigField, bool) {
	if c == nil {
		return ConfigField{}, false
	}
	return findConfigField(c.Fields, name)
}

func (c *AppConfig) Field(name string) (ConfigField, bool) {
	if c == nil {
		return ConfigField{}, false
	}
	return findConfigField(c.Fields, name)
}

func findConfigField(fields []ConfigField, name string) (ConfigField, bool) {
	for _, field := range fields {
		if field.Name == name {
			return field, true
		}
	}
	return ConfigField{}, false
}

func (c *MotorConfig) String() string {
	if c == nil {
		return "<nil>"
	}
	return fmt.Sprintf(
		"motor_config: command_id=%d signature=0x%08x fields={%s} raw_payload_len=%d extra=%d",
		c.CommandID,
		c.Signature,
		formatConfigFields(c.Fields),
		c.RawPayloadLen,
		len(c.ExtraBytes),
	)
}

func (c *AppConfig) String() string {
	if c == nil {
		return "<nil>"
	}
	return fmt.Sprintf(
		"app_config: command_id=%d signature=0x%08x fields={%s} raw_payload_len=%d extra=%d",
		c.CommandID,
		c.Signature,
		formatConfigFields(c.Fields),
		c.RawPayloadLen,
		len(c.ExtraBytes),
	)
}

func formatConfigFields(fields []ConfigField) string {
	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		parts = append(parts, field.String())
	}
	return strings.Join(parts, ", ")
}

func (f ConfigField) String() string {
	switch v := f.Value.(type) {
	case float64:
		return fmt.Sprintf("%s=%.6g", f.Name, v)
	default:
		return fmt.Sprintf("%s=%v", f.Name, v)
	}
}

func u8(name string) configSpec {
	return configSpec{name: name, kind: configU8}
}

func i8(name string) configSpec {
	return configSpec{name: name, kind: configI8}
}

func b8(name string) configSpec {
	return configSpec{name: name, kind: configBool}
}

func u16(name string) configSpec {
	return configSpec{name: name, kind: configU16}
}

func u32(name string) configSpec {
	return configSpec{name: name, kind: configU32}
}

func i32(name string) configSpec {
	return configSpec{name: name, kind: configI32}
}

func f16(name string, scale float64) configSpec {
	return configSpec{name: name, kind: configFloat16, scale: scale}
}

func fa(name string) configSpec {
	return configSpec{name: name, kind: configFloat32Auto}
}

var motorConfigSpecs = []configSpec{
	u8("pwm_mode"),
	u8("comm_mode"),
	u8("motor_type"),
	u8("sensor_mode"),
	fa("l_current_max"),
	fa("l_current_min"),
	fa("l_in_current_max"),
	fa("l_in_current_min"),
	f16("l_in_current_map_start", 10000),
	f16("l_in_current_map_filter", 10000),
	fa("l_abs_current_max"),
	fa("l_min_erpm"),
	fa("l_max_erpm"),
	f16("l_erpm_start", 10000),
	fa("l_max_erpm_fbrake"),
	fa("l_max_erpm_fbrake_cc"),
	f16("l_min_vin", 10),
	f16("l_max_vin", 10),
	f16("l_battery_cut_start", 10),
	f16("l_battery_cut_end", 10),
	f16("l_battery_regen_cut_start", 10),
	f16("l_battery_regen_cut_end", 10),
	b8("l_slow_abs_current"),
	u8("l_temp_fet_start"),
	u8("l_temp_fet_end"),
	u8("l_temp_motor_start"),
	u8("l_temp_motor_end"),
	f16("l_temp_accel_dec", 10000),
	f16("l_min_duty", 10000),
	f16("l_max_duty", 10000),
	fa("l_watt_max"),
	fa("l_watt_min"),
	f16("l_current_max_scale", 10000),
	f16("l_current_min_scale", 10000),
	f16("l_duty_start", 10000),
	u8("l_additional_faults"),
	fa("sl_min_erpm"),
	fa("sl_min_erpm_cycle_int_limit"),
	fa("sl_max_fullbreak_current_dir_change"),
	f16("sl_cycle_int_limit", 10),
	f16("sl_phase_advance_at_br", 10000),
	fa("sl_cycle_int_rpm_br"),
	fa("sl_bemf_coupling_k"),
	i8("hall_table[0]"),
	i8("hall_table[1]"),
	i8("hall_table[2]"),
	i8("hall_table[3]"),
	i8("hall_table[4]"),
	i8("hall_table[5]"),
	i8("hall_table[6]"),
	i8("hall_table[7]"),
	fa("hall_sl_erpm"),
	fa("foc_current_kp"),
	fa("foc_current_ki"),
	fa("foc_f_zv"),
	fa("foc_dt_us"),
	b8("foc_encoder_inverted"),
	fa("foc_encoder_offset"),
	fa("foc_encoder_ratio"),
	u8("foc_sensor_mode"),
	fa("foc_pll_kp"),
	fa("foc_pll_ki"),
	fa("foc_motor_l"),
	fa("foc_motor_ld_lq_diff"),
	fa("foc_motor_r"),
	fa("foc_motor_flux_linkage"),
	fa("foc_observer_gain"),
	fa("foc_observer_gain_slow"),
	f16("foc_observer_offset", 1000),
	fa("foc_duty_dowmramp_kp"),
	fa("foc_duty_dowmramp_ki"),
	f16("foc_start_curr_dec", 10000),
	fa("foc_start_curr_dec_rpm"),
	fa("foc_openloop_rpm"),
	f16("foc_openloop_rpm_low", 1000),
	f16("foc_sl_openloop_hyst", 100),
	f16("foc_sl_openloop_time_lock", 100),
	f16("foc_sl_openloop_time_ramp", 100),
	f16("foc_sl_openloop_time", 100),
	f16("foc_sl_openloop_boost_q", 100),
	f16("foc_sl_openloop_max_q", 100),
	u8("foc_hall_table[0]"),
	u8("foc_hall_table[1]"),
	u8("foc_hall_table[2]"),
	u8("foc_hall_table[3]"),
	u8("foc_hall_table[4]"),
	u8("foc_hall_table[5]"),
	u8("foc_hall_table[6]"),
	u8("foc_hall_table[7]"),
	fa("foc_hall_interp_erpm"),
	fa("foc_sl_erpm_start"),
	fa("foc_sl_erpm"),
	u8("foc_control_sample_mode"),
	u8("foc_current_sample_mode"),
	u8("foc_sat_comp_mode"),
	f16("foc_sat_comp", 1000),
	b8("foc_temp_comp"),
	f16("foc_temp_comp_base_temp", 100),
	f16("foc_current_filter_const", 10000),
	u8("foc_cc_decoupling"),
	u8("foc_observer_type"),
	u8("foc_hfi_amb_mode"),
	f16("foc_hfi_amb_current", 10),
	u8("foc_hfi_amb_tres"),
	f16("foc_hfi_voltage_start", 10),
	f16("foc_hfi_voltage_run", 10),
	f16("foc_hfi_voltage_max", 10),
	f16("foc_hfi_gain", 1000),
	f16("foc_hfi_max_err", 1000),
	f16("foc_hfi_hyst", 100),
	fa("foc_sl_erpm_hfi"),
	fa("foc_hfi_reset_erpm"),
	u16("foc_hfi_start_samples"),
	fa("foc_hfi_obs_ovr_sec"),
	u8("foc_hfi_samples"),
	u8("foc_offsets_cal_mode"),
	fa("foc_offsets_current[0]"),
	fa("foc_offsets_current[1]"),
	fa("foc_offsets_current[2]"),
	f16("foc_offsets_voltage[0]", 10000),
	f16("foc_offsets_voltage[1]", 10000),
	f16("foc_offsets_voltage[2]", 10000),
	f16("foc_offsets_voltage_undriven[0]", 10000),
	f16("foc_offsets_voltage_undriven[1]", 10000),
	f16("foc_offsets_voltage_undriven[2]", 10000),
	b8("foc_phase_filter_enable"),
	b8("foc_phase_filter_disable_fault"),
	fa("foc_phase_filter_max_erpm"),
	u8("foc_mtpa_mode"),
	fa("foc_fw_current_max"),
	f16("foc_fw_duty_start", 10000),
	f16("foc_fw_ramp_time", 1000),
	f16("foc_fw_q_current_factor", 10000),
	f16("foc_fw_backoff", 1000),
	u8("foc_speed_source"),
	b8("foc_short_ls_on_zero_duty"),
	f16("foc_overmod_factor", 10000),
	f16("foc_mag_vd_max", 10000),
	u8("sp_pid_loop_rate"),
	fa("s_pid_kp"),
	fa("s_pid_ki"),
	fa("s_pid_kd"),
	f16("s_pid_kd_filter", 10000),
	fa("s_pid_min_erpm"),
	b8("s_pid_allow_braking"),
	fa("s_pid_ramp_erpms_s"),
	u8("s_pid_speed_source"),
	fa("p_pid_kp"),
	fa("p_pid_ki"),
	fa("p_pid_kd"),
	fa("p_pid_kd_proc"),
	f16("p_pid_kd_filter", 10000),
	fa("p_pid_ang_div"),
	f16("p_pid_gain_dec_angle", 10),
	fa("p_pid_offset"),
	f16("cc_startup_boost_duty", 10000),
	fa("cc_min_current"),
	fa("cc_gain"),
	f16("cc_ramp_step_max", 10000),
	i32("m_fault_stop_time_ms"),
	f16("m_duty_ramp_step", 10000),
	fa("m_current_backoff_gain"),
	u32("m_encoder_counts"),
	f16("m_encoder_sin_amp", 1000),
	f16("m_encoder_cos_amp", 1000),
	f16("m_encoder_sin_offset", 1000),
	f16("m_encoder_cos_offset", 1000),
	f16("m_encoder_sincos_filter_constant", 1000),
	f16("m_encoder_sincos_phase_correction", 1000),
	u8("m_sensor_port_mode"),
	b8("m_invert_direction"),
	u8("m_drv8301_oc_mode"),
	u8("m_drv8301_oc_adj"),
	fa("m_bldc_f_sw_min"),
	fa("m_bldc_f_sw_max"),
	fa("m_dc_f_sw"),
	fa("m_ntc_motor_beta"),
	u8("m_out_aux_mode"),
	u8("m_motor_temp_sens_type"),
	fa("m_ptc_motor_coeff"),
	f16("m_ntcx_ptcx_res", 0.1),
	f16("m_ntcx_ptcx_temp_base", 10),
	u8("m_hall_extra_samples"),
	u8("m_batt_filter_const"),
	u8("si_motor_poles"),
	fa("si_gear_ratio"),
	fa("si_wheel_diameter"),
	u8("si_battery_type"),
	u8("si_battery_cells"),
	fa("si_battery_ah"),
	fa("si_motor_nl_current"),
	u8("bms.type"),
	u8("bms.limit_mode"),
	u8("bms.t_limit_start"),
	u8("bms.t_limit_end"),
	f16("bms.soc_limit_start", 1000),
	f16("bms.soc_limit_end", 1000),
	f16("bms.vmin_limit_start", 1000),
	f16("bms.vmin_limit_end", 1000),
	f16("bms.vmax_limit_start", 1000),
	f16("bms.vmax_limit_end", 1000),
	u8("bms.fwd_can_mode"),
}

var appConfigSpecs = []configSpec{
	u8("controller_id"),
	u32("timeout_msec"),
	fa("timeout_brake_current"),
	u16("can_status_rate_1"),
	u16("can_status_rate_2"),
	u8("can_status_msgs_r1"),
	u8("can_status_msgs_r2"),
	u8("can_baud_rate"),
	b8("pairing_done"),
	b8("permanent_uart_enabled"),
	u8("shutdown_mode"),
	u8("can_mode"),
	u8("uavcan_esc_index"),
	u8("uavcan_raw_mode"),
	fa("uavcan_raw_rpm_max"),
	u8("uavcan_status_current_mode"),
	b8("servo_out_enable"),
	u8("kill_sw_mode"),
	u8("app_to_use"),
	u8("app_ppm_conf.ctrl_type"),
	fa("app_ppm_conf.pid_max_erpm"),
	fa("app_ppm_conf.hyst"),
	fa("app_ppm_conf.pulse_start"),
	fa("app_ppm_conf.pulse_end"),
	fa("app_ppm_conf.pulse_center"),
	b8("app_ppm_conf.median_filter"),
	u8("app_ppm_conf.safe_start"),
	fa("app_ppm_conf.throttle_exp"),
	fa("app_ppm_conf.throttle_exp_brake"),
	u8("app_ppm_conf.throttle_exp_mode"),
	fa("app_ppm_conf.ramp_time_pos"),
	fa("app_ppm_conf.ramp_time_neg"),
	b8("app_ppm_conf.multi_esc"),
	b8("app_ppm_conf.tc"),
	fa("app_ppm_conf.tc_max_diff"),
	f16("app_ppm_conf.max_erpm_for_dir", 1),
	fa("app_ppm_conf.smart_rev_max_duty"),
	fa("app_ppm_conf.smart_rev_ramp_time"),
	u8("app_adc_conf.ctrl_type"),
	fa("app_adc_conf.hyst"),
	f16("app_adc_conf.voltage_start", 1000),
	f16("app_adc_conf.voltage_end", 1000),
	f16("app_adc_conf.voltage_min", 1000),
	f16("app_adc_conf.voltage_max", 1000),
	f16("app_adc_conf.voltage_center", 1000),
	f16("app_adc_conf.voltage2_start", 1000),
	f16("app_adc_conf.voltage2_end", 1000),
	b8("app_adc_conf.use_filter"),
	u8("app_adc_conf.safe_start"),
	u8("app_adc_conf.buttons"),
	b8("app_adc_conf.voltage_inverted"),
	b8("app_adc_conf.voltage2_inverted"),
	fa("app_adc_conf.throttle_exp"),
	fa("app_adc_conf.throttle_exp_brake"),
	u8("app_adc_conf.throttle_exp_mode"),
	fa("app_adc_conf.ramp_time_pos"),
	fa("app_adc_conf.ramp_time_neg"),
	b8("app_adc_conf.multi_esc"),
	b8("app_adc_conf.tc"),
	fa("app_adc_conf.tc_max_diff"),
	u16("app_adc_conf.update_rate_hz"),
	u32("app_uart_baudrate"),
	u8("app_chuk_conf.ctrl_type"),
	fa("app_chuk_conf.hyst"),
	fa("app_chuk_conf.ramp_time_pos"),
	fa("app_chuk_conf.ramp_time_neg"),
	fa("app_chuk_conf.stick_erpm_per_s_in_cc"),
	fa("app_chuk_conf.throttle_exp"),
	fa("app_chuk_conf.throttle_exp_brake"),
	u8("app_chuk_conf.throttle_exp_mode"),
	b8("app_chuk_conf.multi_esc"),
	b8("app_chuk_conf.tc"),
	fa("app_chuk_conf.tc_max_diff"),
	b8("app_chuk_conf.use_smart_rev"),
	fa("app_chuk_conf.smart_rev_max_duty"),
	fa("app_chuk_conf.smart_rev_ramp_time"),
	f16("app_chuk_conf.coast_brake_level", 1000),
	fa("app_chuk_conf.coast_brake_ramp_time"),
	u8("app_nrf_conf.speed"),
	u8("app_nrf_conf.power"),
	u8("app_nrf_conf.crc_type"),
	u8("app_nrf_conf.retry_delay"),
	i8("app_nrf_conf.retries"),
	i8("app_nrf_conf.channel"),
	u8("app_nrf_conf.address[0]"),
	u8("app_nrf_conf.address[1]"),
	u8("app_nrf_conf.address[2]"),
	b8("app_nrf_conf.send_crc_ack"),
	u8("app_pas_conf.ctrl_type"),
	u8("app_pas_conf.sensor_type"),
	f16("app_pas_conf.current_scaling", 1000),
	f16("app_pas_conf.pedal_rpm_start", 10),
	f16("app_pas_conf.pedal_rpm_end", 10),
	b8("app_pas_conf.invert_pedal_direction"),
	u16("app_pas_conf.magnets"),
	b8("app_pas_conf.use_filter"),
	f16("app_pas_conf.ramp_time_pos", 100),
	f16("app_pas_conf.ramp_time_neg", 100),
	u16("app_pas_conf.update_rate_hz"),
	u8("imu_conf.type"),
	u8("imu_conf.mode"),
	u8("imu_conf.filter"),
	f16("imu_conf.accel_lowpass_filter_x", 1),
	f16("imu_conf.accel_lowpass_filter_y", 1),
	f16("imu_conf.accel_lowpass_filter_z", 1),
	f16("imu_conf.gyro_lowpass_filter", 1),
	u16("imu_conf.sample_rate_hz"),
	b8("imu_conf.use_magnetometer"),
	fa("imu_conf.accel_confidence_decay"),
	fa("imu_conf.mahony_kp"),
	fa("imu_conf.mahony_ki"),
	fa("imu_conf.madgwick_beta"),
	fa("imu_conf.rot_roll"),
	fa("imu_conf.rot_pitch"),
	fa("imu_conf.rot_yaw"),
	fa("imu_conf.accel_offsets[0]"),
	fa("imu_conf.accel_offsets[1]"),
	fa("imu_conf.accel_offsets[2]"),
	fa("imu_conf.gyro_offsets[0]"),
	fa("imu_conf.gyro_offsets[1]"),
	fa("imu_conf.gyro_offsets[2]"),
}
