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

## Fullscreen video HUD

The existing fullscreen thermal mirror adds a T-800 treatment inside the video
bounds: a red palette, subtle scanlines and compact thermal
readings. The header and theme stay in the existing fullscreen shell. T-800 mode hides
the side readings and uses a single video column; switching HUD off restores
the normal temperature panel and palette controls.
The fullscreen HUD button switches the treatment off/on; selecting Arctic,
Silver or Iron returns to the standard video presentation. Compact widgets keep
their regular palette and have no HUD overlay.

The overlay reads the existing decoded statistics. Calibrated readings are
labeled as differences from the scene average; uncalibrated readings explicitly
use detector counts. It adds no object detection, tracking or extra frame data.
The `/thermal-hud` route is only a synthetic preview of the actual thermal widget:
open its fullscreen control to review the result. Demo input is labeled as such.

The fullscreen video also has an eight-line machine log. All text over the video
uses Share Tech Mono 400 with a uniform size and character spacing. The
`@fontsource/share-tech-mono` package bundles the font with the app; no external
font service is needed at runtime. Unsupported glyphs use monospace fallbacks. It publishes at most four batches per second, samples only the
latest incoming Y16 frame, and displays received-frame counts, native-plane byte
addresses/hex words, and the latest decoded range/calibration state. RX is the
number of frames observed since this HUD log mounted, not a device sequence or
an estimate of dropped frames. The raw words and decoded summaries are separate
latest observations, not a frame-correlated trace. Raw addresses are unaffected
by the display's mirror control. Palette redraws alone do not create RX events.

A second, denser column on the right streams native byte addresses and four
little-endian words per row from the newest input, using the same timer.
The buffers hold eight log rows, sixteen memory rows and one latest frame; there is no history or
per-frame backlog. The timer stops in hidden tabs and when the HUD unmounts.
New rows enter subtly, the newest row is brighter, and reduced-motion preferences
disable entrance/cursor animations. The log is not an ARIA live region.


### Thermal spectrum history

All camera serials use native 256 × 192 orientation; there is no device-specific
90-degree rotation of pixels or contours.

T-800 mode overlays a translucent horizontal heat-distribution history across
the full video width. The video keeps its native aspect ratio.
The horizontal axis is the last 20 seconds; the vertical axis is temperature
(or raw detector intensity without calibration); brighter bins contain a larger
fraction of the frame's pixels. This is a thermal histogram over time, not an
audio-frequency spectrogram or object detector.

The existing Worker computes 256 fixed bins only for the Terminator palette
and transfers the histogram alongside its matching pixels. Temperature bins
span −20…400 °C, raw bins span 0…65536; out-of-range temperatures are counted at
the endpoints and flagged CLIPPED. The display crops the complete retained
history to occupied bins, redrawing all columns against the same numeric axis.
A calibration/unit change clears history so incompatible columns cannot mix.

The display samples the existing decoded-statistics updates into 80 time buckets
of 250 ms. Same-bucket updates replace the column, real gaps stay empty, and no
full frames are retained. Hidden-tab decoding already stops in the existing
preview lifecycle; the graph adds no timers or additional Worker. Exiting HUD
or losing available input unmounts the graph and releases its bounded history.
