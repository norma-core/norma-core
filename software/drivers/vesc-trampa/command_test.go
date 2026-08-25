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
	body := stationCommandBody(t, command, commandID, uuid)
	boardCommands := stationBoardCommands(t, body, 1)
	assertCurrentPayload(t, boardCommands[0].GetPayload(), -1250)
	if boardCommands[0].GetDurationMs() != 0 {
		t.Fatalf("duration_ms = %d", boardCommands[0].GetDurationMs())
	}
}

func TestSetCurrentForDurationStationCommand(t *testing.T) {
	commandID := []byte{0x03, 0x04}
	uuid := []byte{0xdd, 0xee, 0xff}

	command := SetCurrentForDurationStationCommand(commandID, uuid, 10_000, 1_500, 0)
	body := stationCommandBody(t, command, commandID, uuid)
	boardCommands := stationBoardCommands(t, body, 2)
	assertCurrentPayload(t, boardCommands[0].GetPayload(), 10_000)
	if boardCommands[0].GetDurationMs() != 1_500 {
		t.Fatalf("duration_ms = %d", boardCommands[0].GetDurationMs())
	}
	assertCurrentPayload(t, boardCommands[1].GetPayload(), 0)
	if boardCommands[1].GetDurationMs() != 0 {
		t.Fatalf("final duration_ms = %d", boardCommands[1].GetDurationMs())
	}
}

func TestSetCurrentSequenceStationCommand(t *testing.T) {
	commandID := []byte{0x07, 0x08}
	uuid := []byte{0x10, 0x20, 0x30}

	command := SetCurrentSequenceStationCommand(commandID, uuid, []CurrentStep{
		{CurrentMA: -19_000, DurationMS: 250},
		{CurrentMA: -8_000, DurationMS: 1_250},
		{CurrentMA: 0},
	})
	body := stationCommandBody(t, command, commandID, uuid)
	if body.GetMotorMode() != nil {
		t.Fatal("sequence command should not carry motor mode")
	}

	boardCommands := stationBoardCommands(t, body, 3)
	assertCurrentPayload(t, boardCommands[0].GetPayload(), -19_000)
	if boardCommands[0].GetDurationMs() != 250 {
		t.Fatalf("first duration_ms = %d", boardCommands[0].GetDurationMs())
	}
	assertCurrentPayload(t, boardCommands[1].GetPayload(), -8_000)
	if boardCommands[1].GetDurationMs() != 1_250 {
		t.Fatalf("second duration_ms = %d", boardCommands[1].GetDurationMs())
	}
	assertCurrentPayload(t, boardCommands[2].GetPayload(), 0)
	if boardCommands[2].GetDurationMs() != 0 {
		t.Fatalf("third duration_ms = %d", boardCommands[2].GetDurationMs())
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

	if len(body.GetBoardCommands()) != 0 {
		t.Fatal("motor-mode command should not carry board commands")
	}

	motorMode := body.GetMotorMode()
	if motorMode == nil {
		t.Fatal("missing motor-mode command")
	}
	if motorMode.GetMode() != vescpb.VescTrampaMotorMode_VESC_TRAMPA_MOTOR_MODE_HOLD {
		t.Fatalf("motor mode = %v", motorMode.GetMode())
	}
}

func stationCommandBody(
	t *testing.T,
	command *commandspb.DriverCommand,
	commandID []byte,
	uuid []byte,
) *vescpb.CommandReader {
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
	return body
}

func stationBoardCommands(t *testing.T, body *vescpb.CommandReader, count int) []*vescpb.VescTrampaBoardCommandReader {
	t.Helper()

	if body.GetMotorMode() != nil {
		t.Fatal("board command should not carry motor mode")
	}

	boardCommands := body.GetBoardCommands()
	if len(boardCommands) != count {
		t.Fatalf("board command count = %d, want %d", len(boardCommands), count)
	}
	for index, boardCommand := range boardCommands {
		if boardCommand.GetResponseExpected() {
			t.Fatalf("board command %d should not expect a response", index)
		}
	}
	return boardCommands
}

func assertCurrentPayload(t *testing.T, payload []byte, expectedMA int32) {
	t.Helper()

	if len(payload) != 5 {
		t.Fatalf("payload len = %d", len(payload))
	}
	if payload[0] != commandSetCurrent {
		t.Fatalf("payload command = %d", payload[0])
	}
	if got := int32(binary.BigEndian.Uint32(payload[1:])); got != expectedMA {
		t.Fatalf("current payload = %d", got)
	}
}
