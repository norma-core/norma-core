package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	normfs "github.com/norma-core/normfs/normfs_go"

	vesc "norma_core/software/drivers/vesc-trampa"
	"norma_core/software/station/shared/station"
	vescpb "norma_core/target/generated-sources/protobuf/drivers/vesc-trampa/vesc_trampa"
)

const rxQueueID = "vesc-trampa/rx"

func main() {
	server := flag.String("server", "localhost", "station host or host:port")
	flag.Parse()

	if err := run(*server); err != nil {
		fmt.Fprintf(os.Stderr, "vesc-trampa-rx-go: %v\n", err)
		os.Exit(1)
	}
}

func run(server string) error {
	client, err := station.NewStationClient(server)
	if err != nil {
		return fmt.Errorf("connect to station %q: %w", server, err)
	}

	fmt.Printf("following queue %q on %s\n", rxQueueID, server)

	entries := make(chan station.StreamEntry, 64)
	errs := client.Follow(rxQueueID, entries)
	rates := newMonitorRates()

	for {
		select {
		case err, ok := <-errs:
			if !ok {
				return nil
			}
			if err != nil {
				return err
			}
			return nil
		case entry, ok := <-entries:
			if !ok {
				return nil
			}
			if err := printEntry(entry, rates); err != nil {
				fmt.Fprintf(os.Stderr, "failed to decode entry %s: %v\n", formatEntryID(entry.ID), err)
			}
		}
	}
}

type monitorRates struct {
	lastEntryAt  time.Time
	lastValuesAt map[string]time.Time
}

func newMonitorRates() *monitorRates {
	return &monitorRates{
		lastValuesAt: make(map[string]time.Time),
	}
}

func (r *monitorRates) updateEntry(now time.Time) float64 {
	hz := hertzSince(r.lastEntryAt, now)
	r.lastEntryAt = now
	return hz
}

func (r *monitorRates) updateValues(boardKey string, now time.Time) float64 {
	hz := hertzSince(r.lastValuesAt[boardKey], now)
	r.lastValuesAt[boardKey] = now
	return hz
}

func (r *monitorRates) clearBoard(boardKey string) {
	delete(r.lastValuesAt, boardKey)
}

func hertzSince(last time.Time, now time.Time) float64 {
	if last.IsZero() {
		return 0
	}
	elapsed := now.Sub(last).Seconds()
	if elapsed <= 0 {
		return 0
	}
	return 1 / elapsed
}

func printEntry(entry station.StreamEntry, rates *monitorRates) error {
	if entry.Err != nil {
		return entry.Err
	}

	envelope := vescpb.NewRxEnvelopeReader()
	if err := envelope.Unmarshal(entry.Data); err != nil {
		return err
	}

	signalType := envelope.GetSignalType()
	board := envelope.GetBoard()
	boardKey := rateBoardKey(board)
	now := time.Now()
	queueHz := rates.updateEntry(now)

	fmt.Printf(
		"[%s] entry=%s queue_hz=%s signal=%s monotonic=%d local=%d board=%s\n",
		now.Format(time.RFC3339Nano),
		formatEntryID(entry.ID),
		formatHz(queueHz),
		signalType.String(),
		envelope.GetMonotonicStampNs(),
		envelope.GetLocalStampNs(),
		formatBoardSummary(board),
	)

	switch signalType {
	case vescpb.VescTrampaSignalType_VESC_TRAMPA_BOARD_CONNECT:
		fmt.Printf("  board: %s\n", formatBoardDetails(board))
	case vescpb.VescTrampaSignalType_VESC_TRAMPA_BOARD_DISCONNECT:
		rates.clearBoard(boardKey)
		fmt.Println("  board: disconnected")
	case vescpb.VescTrampaSignalType_VESC_TRAMPA_BOARD_PACKET:
		printBoardPacket(envelope.GetBoardPacket(), boardKey, now, rates)
	case vescpb.VescTrampaSignalType_VESC_TRAMPA_COMMAND_FAILED:
		if errText := envelope.GetError(); errText != "" {
			fmt.Printf("  error: %s\n", errText)
		}
	default:
		if errText := envelope.GetError(); errText != "" {
			fmt.Printf("  error: %s\n", errText)
		}
	}

	return nil
}

func printBoardPacket(packet *vescpb.VescTrampaBoardPacketReader, boardKey string, now time.Time, rates *monitorRates) {
	if packet == nil {
		fmt.Println("  packet: <nil>")
		return
	}

	payload := packet.GetPayload()
	fmt.Printf(
		"  packet: command_id=%d payload_len=%d crc=0x%04x raw_payload_len=%d\n",
		packet.GetCommandId(),
		packet.GetPayloadLen(),
		packet.GetCrc(),
		len(payload),
	)

	parsed, err := vesc.ParsePayload(payload)
	if err != nil {
		fmt.Printf("  payload_parse_error: %v\n", err)
		return
	}

	switch parsed.Kind {
	case vesc.PayloadKindValues:
		valuesHz := rates.updateValues(boardKey, now)
		fmt.Printf("  motor: values_hz=%s %s\n", formatHz(valuesHz), parsed.Values)
	case vesc.PayloadKindMotorConfig, vesc.PayloadKindAppConfig:
		fmt.Printf("  config: %s\n", parsed)
	default:
		fmt.Printf("  payload: %s\n", parsed)
	}
}

func formatBoardSummary(board *vescpb.VescTrampaBoardReader) string {
	if board == nil {
		return "<nil>"
	}

	parts := []string{
		fmt.Sprintf("port=%s", valueOrNA(board.GetPortName())),
		fmt.Sprintf("uuid=%s", bytesHexOrNA(board.GetUuid())),
		fmt.Sprintf("hw=%s", valueOrNA(board.GetHardwareName())),
		fmt.Sprintf("fw=%d.%d", board.GetFirmwareMajor(), board.GetFirmwareMinor()),
	}

	if serial := board.GetSerialNumber(); serial != "" {
		parts = append(parts, fmt.Sprintf("serial=%s", serial))
	}

	return strings.Join(parts, " ")
}

func rateBoardKey(board *vescpb.VescTrampaBoardReader) string {
	if board == nil {
		return "<nil>"
	}
	if uuid := board.GetUuid(); len(uuid) > 0 {
		return "uuid:" + hex.EncodeToString(uuid)
	}
	if port := board.GetPortName(); port != "" {
		return "port:" + port
	}
	return "<unknown>"
}

func formatBoardDetails(board *vescpb.VescTrampaBoardReader) string {
	if board == nil {
		return "<nil>"
	}

	return fmt.Sprintf(
		"port=%s vid=0x%04x pid=0x%04x serial=%s manufacturer=%s product=%s baud=%d fw=%d.%d hardware=%s uuid=%s pairing_done=%t test_version=%d hardware_type=%d custom_config_count=%d phase_filters=%t qml_hw=%d qml_app=%d nrf_flags=0x%02x firmware_name=%s hardware_config_crc=0x%08x raw_firmware_payload_len=%d extra_firmware_bytes=%d",
		valueOrNA(board.GetPortName()),
		board.GetVid(),
		board.GetPid(),
		valueOrNA(board.GetSerialNumber()),
		valueOrNA(board.GetManufacturer()),
		valueOrNA(board.GetProduct()),
		board.GetPortBaudRate(),
		board.GetFirmwareMajor(),
		board.GetFirmwareMinor(),
		valueOrNA(board.GetHardwareName()),
		bytesHexOrNA(board.GetUuid()),
		board.GetPairingDone(),
		board.GetTestVersionNumber(),
		board.GetHardwareType(),
		board.GetCustomConfigCount(),
		board.GetHasPhaseFilters(),
		board.GetQmlHw(),
		board.GetQmlApp(),
		board.GetNrfFlags(),
		valueOrNA(board.GetFirmwareName()),
		board.GetHardwareConfigCrc(),
		len(board.GetFirmwareInfoRawPayload()),
		len(board.GetFirmwareInfoExtraBytes()),
	)
}

func formatEntryID(id normfs.StreamEntryId) string {
	if id.ID == nil {
		return "<nil>"
	}
	return id.ID.String()
}

func formatHz(hz float64) string {
	if hz <= 0 {
		return "N/A"
	}
	return fmt.Sprintf("%.1fHz", hz)
}

func bytesHexOrNA(value []byte) string {
	if len(value) == 0 {
		return "N/A"
	}
	return hex.EncodeToString(value)
}

func valueOrNA(value string) string {
	if value == "" {
		return "N/A"
	}
	return value
}
