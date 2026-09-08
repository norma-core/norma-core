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
