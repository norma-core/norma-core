#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

// YOLO11n (ESP-DL coco_detect, 320 x 320, int8) on its own task: grab a frame, run the model (about a second on the
// S3), publish the boxes, keep the analysed frame with the boxes drawn in for /analysed.jpg.
namespace det {
struct Box {
    int cls;
    float score;
    int x0, y0, x1, y1;   // pixels in the camera frame
};
struct Result {
    uint32_t seq = 0;      // counts analysed frames
    int64_t tsUs = 0;      // when the frame was taken
    int w = 0, h = 0;
    int inferMs = 0;       // model time for this frame (grab + run, without the JPEG)
    std::vector<Box> boxes;
};
bool begin();                      // starts the task, which loads the model 2 s later; false if the task could not start
bool modelOk();                    // true once the model is loaded
bool loadFinished();               // true once the load has been tried, loaded or not (main waits for it before confirming a new firmware)
const char* modelName();
void setEnabled(bool on);
bool enabled();
void setThreshold(float thr);      // 0..1
float threshold();
void setBigEndian(bool be);        // how the model reads the camera's RGB565 bytes
bool bigEndian();
Result latest();                   // copy of the newest result
float fps();                       // analysed frames per second
bool analysedJpeg(uint8_t** out, size_t* len);   // last analysed frame with boxes; free(*out)
const char* className(int cls);
}
