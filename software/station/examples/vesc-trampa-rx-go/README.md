# VESC Trampa RX monitor

Print VESC Trampa board and motor state updates from the station RX queue.

## Run

```bash
go run ./software/station/examples/vesc-trampa-rx-go --server localhost
```

The app starts from the queue tail and prints new updates until Ctrl+C. Each
entry includes `queue_hz`; motor telemetry packets also include per-board
`values_hz`.
