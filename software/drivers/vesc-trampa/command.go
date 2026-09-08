package vesc_trampa

import (
	"encoding/binary"

	vescpb "norma_core/target/generated-sources/protobuf/drivers/vesc-trampa/vesc_trampa"
	commandspb "norma_core/target/generated-sources/protobuf/station/commands"
	driverspb "norma_core/target/generated-sources/protobuf/station/drivers"
)

const (
	CommandSetCurrent uint8 = 6
	CommandSetRPM     uint8 = 8
)

type CurrentStep struct {
	CurrentMA  int32
	DurationMS uint32
}

type RPMStep struct {
	RPM        int32
	DurationMS uint32
}

type BoardCommandStep struct {
	Payload    []byte
	DurationMS uint32
}

func setCurrentPayload(currentMA int32) []byte {
	return SetCurrentPayload(currentMA)
}

func SetCurrentPayload(currentMA int32) []byte {
	return int32Payload(CommandSetCurrent, currentMA)
}

func SetRPMPayload(rpm int32) []byte {
	return int32Payload(CommandSetRPM, rpm)
}

func int32Payload(commandID uint8, value int32) []byte {
	payload := make([]byte, 5)
	payload[0] = commandID
	binary.BigEndian.PutUint32(payload[1:], uint32(value))
	return payload
}

func motorModeCommand(targetBoardUUID []byte, mode vescpb.VescTrampaMotorMode) *vescpb.Command {
	return &vescpb.Command{
		TargetBoardUuid: targetBoardUUID,
		MotorMode: &vescpb.VescTrampaMotorModeCommand{
			Mode: mode,
		},
	}
}

func SetCurrentStationCommand(commandID []byte, targetBoardUUID []byte, currentMA int32) *commandspb.DriverCommand {
	return SetCurrentSequenceStationCommand(commandID, targetBoardUUID, []CurrentStep{
		{CurrentMA: currentMA},
	})
}

func SetCurrentForDurationStationCommand(
	commandID []byte,
	targetBoardUUID []byte,
	currentMA int32,
	durationMS uint32,
	finalCurrentMA int32,
) *commandspb.DriverCommand {
	return SetCurrentSequenceStationCommand(commandID, targetBoardUUID, []CurrentStep{
		{CurrentMA: currentMA, DurationMS: durationMS},
		{CurrentMA: finalCurrentMA},
	})
}

func SetCurrentSequenceStationCommand(
	commandID []byte,
	targetBoardUUID []byte,
	steps []CurrentStep,
) *commandspb.DriverCommand {
	boardSteps := make([]BoardCommandStep, 0, len(steps))
	for _, step := range steps {
		boardSteps = append(boardSteps, BoardCommandStep{
			Payload:    SetCurrentPayload(step.CurrentMA),
			DurationMS: step.DurationMS,
		})
	}
	return SetBoardCommandSequenceStationCommand(commandID, targetBoardUUID, boardSteps)
}

func SetRPMStationCommand(commandID []byte, targetBoardUUID []byte, rpm int32) *commandspb.DriverCommand {
	return SetRPMSequenceStationCommand(commandID, targetBoardUUID, []RPMStep{
		{RPM: rpm},
	})
}

func SetRPMForDurationStationCommand(
	commandID []byte,
	targetBoardUUID []byte,
	rpm int32,
	durationMS uint32,
	finalRPM int32,
) *commandspb.DriverCommand {
	return SetRPMSequenceStationCommand(commandID, targetBoardUUID, []RPMStep{
		{RPM: rpm, DurationMS: durationMS},
		{RPM: finalRPM},
	})
}

func SetRPMSequenceStationCommand(
	commandID []byte,
	targetBoardUUID []byte,
	steps []RPMStep,
) *commandspb.DriverCommand {
	boardSteps := make([]BoardCommandStep, 0, len(steps))
	for _, step := range steps {
		boardSteps = append(boardSteps, BoardCommandStep{
			Payload:    SetRPMPayload(step.RPM),
			DurationMS: step.DurationMS,
		})
	}
	return SetBoardCommandSequenceStationCommand(commandID, targetBoardUUID, boardSteps)
}

func SetBoardCommandSequenceStationCommand(
	commandID []byte,
	targetBoardUUID []byte,
	steps []BoardCommandStep,
) *commandspb.DriverCommand {
	commands := make([]*vescpb.VescTrampaBoardCommand, 0, len(steps))
	for _, step := range steps {
		commands = append(commands, &vescpb.VescTrampaBoardCommand{
			Payload:          step.Payload,
			ResponseExpected: false,
			DurationMs:       step.DurationMS,
		})
	}

	command := &vescpb.Command{
		TargetBoardUuid: targetBoardUUID,
		BoardCommands:   commands,
	}

	return &commandspb.DriverCommand{
		CommandId: commandID,
		Type:      driverspb.StationCommandType_STC_VESC_TRAMPA_COMMAND,
		Body:      command.Marshal(),
	}
}

func SetMotorModeStationCommand(
	commandID []byte,
	targetBoardUUID []byte,
	mode vescpb.VescTrampaMotorMode,
) *commandspb.DriverCommand {
	return &commandspb.DriverCommand{
		CommandId: commandID,
		Type:      driverspb.StationCommandType_STC_VESC_TRAMPA_COMMAND,
		Body:      motorModeCommand(targetBoardUUID, mode).Marshal(),
	}
}
