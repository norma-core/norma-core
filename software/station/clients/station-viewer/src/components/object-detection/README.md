# Browser object detection

The fullscreen-only `Objects` button on `CameraSurface` enables detection on the primary RGB
camera. The thermal widget exposes the same opt-in overlay as an experimental
demo, with its button available in both compact and fullscreen views for testing:
this RGB-trained model may miss or misclassify objects in thermal imagery.
It uses the current palette and accounts for mirrored display coordinates.
The detector runs locally in a
module Worker; no camera images are uploaded. The package, WASM and model are
served with the viewer, with no runtime CDN dependency.

The overlay and session code are dynamically imported only when detection is
enabled. The session then starts a module Worker, which loads the
runtime, WASM and model asynchronously. Neither opening the compact widget nor
entering fullscreen alone loads the detection assets. Thermal detection stays
active across fullscreen transitions; RGB detection stops outside fullscreen.

- Runtime: `@mediapipe/tasks-vision` 1.0.1 (Apache-2.0).
- Model: Google MediaPipe EfficientDet-Lite0, int8, version 1, COCO 80 classes.
- Source: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite
- SHA-256: `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`.
- Model guide: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector

Inference is opt-in, CPU-based, limited to three fresh frames per second and ten
results above 0.5 confidence. Frames are resized to at most 320 pixels on the
longest edge before transfer. There is one active bitmap/inference and no queue.
Results remain until the next completed inference replaces them; an empty result
removes the boxes. A delayed thermal stream pauses capture while retaining the
last detections with a visible status. Inference errors retain the last boxes
with an error status. Hidden tabs and disabled/unmounted overlays
terminate their Worker and clear timers; initialization/inference timeouts stop
detection while leaving the camera running. Toggle `Objects` off/on to retry.

Detection labels use the model's English class names. The overlay follows the
image's centered contain/cover geometry through resizing and fullscreen.
