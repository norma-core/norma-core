# Thermal mirror

The thermal view renders the decoded sensor image and restores saved mirror preferences.
Decoding uses the thermal Worker with one frame in flight and one latest pending
frame. Hidden tabs dispose the Worker and scheduled drawing.

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
readings. Fullscreen stretches the sensor image to fill the entire viewport, including
when its aspect ratio differs from the sensor. Text branding (`// C //`) and stream status float over the image. Fullscreen always uses the T-800 HUD;
it has no on-screen buttons. Escape exits fullscreen through the shared
fullscreen hook. The compact widget retains its fullscreen entry button. Compact widgets keep
their regular palette and readings and have no HUD overlay.

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
90-degree rotation of pixels.

T-800 mode overlays a translucent horizontal heat-distribution history across
the full video width. Fullscreen stretches the video to the viewport.
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

Fullscreen connection feedback lives in the stream indicator: LIVE (or SYNTHETIC
DEMO), CONNECTING / WAITING FOR FRAME, SIGNAL DELAYED / LAST FRAME, or RECOVERING.
Unavailable input uses amber, decoder errors use red, and retained pixels remain
visible without a banner. The indicator announces status changes politely;
new decoded frames restore the normal status automatically. The compact widget
keeps its existing connection notice.
