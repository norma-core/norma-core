package vesc_trampa

import (
	"bytes"
	"encoding/binary"
	"testing"

	vescpb "norma_core/target/generated-sources/protobuf/drivers/vesc-trampa/vesc_trampa"
	commandspb "norma_core/target/generated-sources/protobuf/station/commands"
	driverspb "norma_core/target/generated-sources/protobuf/station/drivers"
)

func TestSetCurrentStationCommand(t *testing.T) {
	commandID := []byte{0x01, 0x02}
	uuid := []byte{0xaa, 0xbb, 0xcc}

	command := SetCurrentStationCommand(commandID, uuid, -1250)
	payload := stationBoardCommandPayload(t, command, commandID, uuid)

	if payload[0] != commandSetCurrent {
		t.Fatalf("payload command = %d", payload[0])
	}
	if got := int32(binary.BigEndian.Uint32(payload[1:])); got != -1250 {
		t.Fatalf("current payload = %d", got)
	}
}

func TestSetMotorModeStationCommand(t *testing.T) {
	commandID := []byte{0x05, 0x06}
	uuid := []byte{0x11, 0x22, 0x33}

	command := SetMotorModeStationCommand(
		commandID,
		uuid,
		vescpb.VescTrampaMotorMode_VESC_TRAMPA_MOTOR_MODE_HOLD,
	)

	reader := commandspb.NewDriverCommandReader()
	if err := reader.Unmarshal(command.Marshal()); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reader.GetCommandId(), commandID) {
		t.Fatalf("command id = %x", reader.GetCommandId())
	}
	if reader.GetType() != driverspb.StationCommandType_STC_VESC_TRAMPA_COMMAND {
		t.Fatalf("type = %v", reader.GetType())
	}

	body := vescpb.NewCommandReader()
	if err := body.Unmarshal(reader.GetBody()); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(body.GetTargetBoardUuid(), uuid) {
		t.Fatalf("target uuid = %x", body.GetTargetBoardUuid())
	}

	if body.GetBoardCommand() != nil {
		t.Fatal("motor-mode command should not carry a raw board command")
	}

	motorMode := body.GetMotorMode()
	if motorMode == nil {
		t.Fatal("missing motor-mode command")
	}
	if motorMode.GetMode() != vescpb.VescTrampaMotorMode_VESC_TRAMPA_MOTOR_MODE_HOLD {
		t.Fatalf("motor mode = %v", motorMode.GetMode())
	}
}

func stationBoardCommandPayload(
	t *testing.T,
	command *commandspb.DriverCommand,
	commandID []byte,
	uuid []byte,
) []byte {
	t.Helper()

	reader := commandspb.NewDriverCommandReader()
	if err := reader.Unmarshal(command.Marshal()); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reader.GetCommandId(), commandID) {
		t.Fatalf("command id = %x", reader.GetCommandId())
	}
	if reader.GetType() != driverspb.StationCommandType_STC_VESC_TRAMPA_COMMAND {
		t.Fatalf("type = %v", reader.GetType())
	}

	body := vescpb.NewCommandReader()
	if err := body.Unmarshal(reader.GetBody()); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(body.GetTargetBoardUuid(), uuid) {
		t.Fatalf("target uuid = %x", body.GetTargetBoardUuid())
	}
	if body.GetMotorMode() != nil {
		t.Fatal("raw board command should not carry motor mode")
	}

	boardCommand := body.GetBoardCommand()
	if boardCommand == nil {
		t.Fatal("missing board command")
	}
	if boardCommand.GetResponseExpected() {
		t.Fatal("board command should not expect a response")
	}

	payload := boardCommand.GetPayload()
	if len(payload) != 5 {
		t.Fatalf("payload len = %d", len(payload))
	}
	return payload
}
