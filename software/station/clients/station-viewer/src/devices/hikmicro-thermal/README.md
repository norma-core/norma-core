# Thermal mirror

The `Contours` toggle overlays lines of equal temperature across the whole scene.
The compact widget uses an icon; fullscreen adds a text label. Contours stay enabled
across fullscreen and palette changes, and follow the camera's rotation and mirror.
There are no object labels, boxes, identities, counts, or detection-model loads in
this thermal view. RGB cameras also have no object detection controls or model loads.

Contours use the decoded temperature field (raw intensity when calibration is
unavailable), independently of the display palette. A spatial filter reduces sensor
grain, then marching squares generates at most eight temperature levels on a
four-pixel grid. Quantized levels and a minimum step reduce noise in flat scenes.
They are calculated only when enabled, in the existing thermal Worker, with the
same one-in-flight / latest-pending frame bound as decoding. No frame history is
accumulated. Segments and pixels are transferred together and painted together;
stream delays retain both with the existing signal-delay notice.

The overlay canvas has a fixed backing scale relative to the small sensor image,
not the screen resolution. Disabling hides the overlay immediately and stops
contour generation on subsequent requests. Hidden tabs dispose the thermal Worker
and scheduled drawing through the existing preview lifecycle.

## Low-latency acquisition

Live discovery only lists thermal queues. Each mounted viewer independently reads
its current tail, at most once per 40 ms with one outstanding request. Older
stations with multi-frame batches are polled at the batch cadence (up to 1 s). Duplicate
entries are not decoded or published again. Hidden tabs and history mode suspend
reads; unmount disposes the loop. An outstanding NormFS request may finish (or hit
its existing timeout), but its response cannot publish after suspension/disposal.
History continues to read the exact recorded entry. No frame backlog is replayed.

The station driver publishes one frame per envelope. Rebuild and restart the
station to enable this behavior; no new configuration is needed. Old binaries
still produce 25-frame batches and roughly one displayed frame per second.
Single-frame entries also change recording granularity and repeat calibration
metadata more frequently. Raw image traffic alone is about 2.5 MB/s at 25 FPS.

The FPS label describes the configured sensor rate, not measured display FPS.
