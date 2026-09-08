import { ObjectDetector } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import modelAssetPath from './efficientdet_lite0.tflite?url';
import type { DetectionResponse, ObjectBox } from './protocol';

const send = (response: DetectionResponse) => self.postMessage(response);

try {
  const detector = await ObjectDetector.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath, delegate: 'CPU' },
    runningMode: 'IMAGE',
    scoreThreshold: 0.5,
    maxResults: 10,
  });
  self.onmessage = ({ data }: MessageEvent<{ bitmap: ImageBitmap }>) => {
    const { bitmap } = data;
    try {
      const boxes: ObjectBox[] = [];
      for (const detection of detector.detect(bitmap).detections) {
        const box = detection.boundingBox;
        const category = detection.categories[0];
        if (!box || !category) continue;
        boxes.push({
          label: category.categoryName,
          score: category.score,
          x: box.originX / bitmap.width,
          y: box.originY / bitmap.height,
          width: box.width / bitmap.width,
          height: box.height / bitmap.height,
        });
      }
      send({ type: 'result', boxes, width: bitmap.width, height: bitmap.height });
    } catch {
      send({ type: 'error' });
    } finally {
      bitmap.close();
    }
  };
  send({ type: 'ready' });
} catch {
  send({ type: 'error' });
}
