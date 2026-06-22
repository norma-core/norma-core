#include "wrapper.hpp"

#include <libcamera/libcamera.h>
#include <libcamera/camera.h>
#include <libcamera/camera_manager.h>
#include <libcamera/framebuffer.h>
#include <libcamera/framebuffer_allocator.h>
#include <libcamera/request.h>
#include <libcamera/stream.h>
#include <libcamera/controls.h>
#include <libcamera/property_ids.h>

#include <memory>
#include <vector>
#include <mutex>
#include <map>
#include <unordered_map>
#include <cstring>

using namespace libcamera;

// Internal structures to hold C++ objects
struct lc_camera_manager {
    std::unique_ptr<CameraManager> manager;
    std::vector<std::shared_ptr<Camera>> cameras;
};

struct lc_camera {
    std::shared_ptr<Camera> camera;
    lc_request_completed_cb callback;
    void* user_data;
    std::mutex callback_mutex;
};

struct lc_camera_configuration {
    std::unique_ptr<CameraConfiguration> config;
};

struct lc_stream_configuration {
    StreamConfiguration* config; // Non-owning pointer
};

struct lc_stream_formats {
    StreamFormats formats;
};

struct lc_stream {
    Stream* stream; // Non-owning pointer
};

struct lc_framebuffer_allocator {
    std::unique_ptr<FrameBufferAllocator> allocator;
    Camera* camera; // Non-owning reference
};

struct lc_framebuffer {
    FrameBuffer* buffer; // Non-owning pointer
};

struct lc_request {
    std::unique_ptr<Request> request;
    Camera* camera; // Non-owning reference for requeue
};

// Helper to convert pixel format
static lc_pixel_format_t to_lc_pixel_format(const PixelFormat& fmt) {
    if (fmt == formats::RGB888) return LC_PIXEL_FORMAT_RGB888;
    if (fmt == formats::BGR888) return LC_PIXEL_FORMAT_BGR888;
    if (fmt == formats::YUYV) return LC_PIXEL_FORMAT_YUYV;
    if (fmt == formats::YVYU) return LC_PIXEL_FORMAT_YVYU;
    if (fmt == formats::UYVY) return LC_PIXEL_FORMAT_UYVY;
    if (fmt == formats::NV12) return LC_PIXEL_FORMAT_NV12;
    if (fmt == formats::NV21) return LC_PIXEL_FORMAT_NV21;
    if (fmt == formats::YUV420) return LC_PIXEL_FORMAT_YUV420;
    if (fmt == formats::MJPEG) return LC_PIXEL_FORMAT_MJPEG;
    return LC_PIXEL_FORMAT_UNKNOWN;
}

static PixelFormat from_lc_pixel_format(lc_pixel_format_t fmt) {
    switch (fmt) {
        case LC_PIXEL_FORMAT_RGB888: return formats::RGB888;
        case LC_PIXEL_FORMAT_BGR888: return formats::BGR888;
        case LC_PIXEL_FORMAT_YUYV: return formats::YUYV;
        case LC_PIXEL_FORMAT_YVYU: return formats::YVYU;
        case LC_PIXEL_FORMAT_UYVY: return formats::UYVY;
        case LC_PIXEL_FORMAT_NV12: return formats::NV12;
        case LC_PIXEL_FORMAT_NV21: return formats::NV21;
        case LC_PIXEL_FORMAT_YUV420: return formats::YUV420;
        case LC_PIXEL_FORMAT_MJPEG: return formats::MJPEG;
        default: return PixelFormat();
    }
}

static StreamRole from_lc_stream_role(lc_stream_role_t role) {
    switch (role) {
        case LC_STREAM_ROLE_RAW: return StreamRole::Raw;
        case LC_STREAM_ROLE_STILL_CAPTURE: return StreamRole::StillCapture;
        case LC_STREAM_ROLE_VIDEO_RECORDING: return StreamRole::VideoRecording;
        case LC_STREAM_ROLE_VIEWFINDER: return StreamRole::Viewfinder;
        default: return StreamRole::StillCapture;
    }
}

// Camera manager implementation
extern "C" {

lc_camera_manager_t* lc_camera_manager_new(void) {
    auto mgr = new lc_camera_manager();
    mgr->manager = std::make_unique<CameraManager>();
    return mgr;
}

void lc_camera_manager_destroy(lc_camera_manager_t* mgr) {
    if (mgr) {
        mgr->cameras.clear();
        mgr->manager.reset();
        delete mgr;
    }
}

lc_status_t lc_camera_manager_start(lc_camera_manager_t* mgr) {
    if (!mgr || !mgr->manager) return LC_STATUS_INVALID_ARGUMENT;

    int ret = mgr->manager->start();
    if (ret < 0) return LC_STATUS_ERROR;

    // Cache camera list
    mgr->cameras = mgr->manager->cameras();
    return LC_STATUS_OK;
}

void lc_camera_manager_stop(lc_camera_manager_t* mgr) {
    if (mgr && mgr->manager) {
        mgr->cameras.clear();
        mgr->manager->stop();
    }
}

size_t lc_camera_manager_camera_count(lc_camera_manager_t* mgr) {
    if (!mgr) return 0;
    return mgr->cameras.size();
}

lc_camera_t* lc_camera_manager_get_camera(lc_camera_manager_t* mgr, size_t index) {
    if (!mgr || index >= mgr->cameras.size()) return nullptr;

    auto cam = new lc_camera();
    cam->camera = mgr->cameras[index];
    cam->callback = nullptr;
    cam->user_data = nullptr;
    return cam;
}

lc_camera_t* lc_camera_manager_get_camera_by_id(lc_camera_manager_t* mgr, const char* id) {
    if (!mgr || !id) return nullptr;

    auto camera = mgr->manager->get(id);
    if (!camera) return nullptr;

    auto cam = new lc_camera();
    cam->camera = camera;
    cam->callback = nullptr;
    cam->user_data = nullptr;
    return cam;
}

// Camera implementation
const char* lc_camera_id(lc_camera_t* cam) {
    if (!cam || !cam->camera) return nullptr;
    return cam->camera->id().c_str();
}

lc_status_t lc_camera_acquire(lc_camera_t* cam) {
    if (!cam || !cam->camera) return LC_STATUS_INVALID_ARGUMENT;

    int ret = cam->camera->acquire();
    if (ret < 0) {
        if (ret == -EBUSY) return LC_STATUS_BUSY;
        return LC_STATUS_ERROR;
    }
    return LC_STATUS_OK;
}

lc_status_t lc_camera_release(lc_camera_t* cam) {
    if (!cam || !cam->camera) return LC_STATUS_INVALID_ARGUMENT;

    int ret = cam->camera->release();
    return ret < 0 ? LC_STATUS_ERROR : LC_STATUS_OK;
}

lc_camera_configuration_t* lc_camera_generate_configuration(lc_camera_t* cam, const lc_stream_role_t* roles, size_t num_roles) {
    if (!cam || !cam->camera || !roles || num_roles == 0) return nullptr;

    std::vector<StreamRole> stream_roles;
    stream_roles.reserve(num_roles);
    for (size_t i = 0; i < num_roles; i++) {
        stream_roles.push_back(from_lc_stream_role(roles[i]));
    }

    auto config = cam->camera->generateConfiguration(stream_roles);
    if (!config) return nullptr;

    auto cfg = new lc_camera_configuration();
    cfg->config = std::move(config);
    return cfg;
}

lc_status_t lc_camera_configure(lc_camera_t* cam, lc_camera_configuration_t* config) {
    if (!cam || !cam->camera || !config || !config->config) return LC_STATUS_INVALID_ARGUMENT;

    int ret = cam->camera->configure(config->config.get());
    return ret < 0 ? LC_STATUS_ERROR : LC_STATUS_OK;
}

// Global maps to store callback data (needed for static callback function)
static std::mutex g_camera_map_mutex;
static std::map<Camera*, lc_camera_t*> g_camera_map;
static std::mutex g_request_map_mutex;
static std::unordered_map<Request*, lc_request_t*> g_request_map;

lc_request_t* lc_camera_create_request(lc_camera_t* cam, uint64_t cookie) {
    if (!cam || !cam->camera) return nullptr;

    // Store camera pointer in cookie for callback routing
    // The user's cookie is ignored - we use it for internal routing
    uint64_t internal_cookie = reinterpret_cast<uintptr_t>(cam);

    auto request = cam->camera->createRequest(internal_cookie);
    if (!request) return nullptr;

    auto req = new lc_request();
    req->request = std::move(request);
    req->camera = cam->camera.get();
    {
        std::lock_guard<std::mutex> lock(g_request_map_mutex);
        g_request_map[req->request.get()] = req;
    }
    return req;
}

// Static callback function that libcamera's Signal can accept
static void request_completed_handler(Request* request) {
    // Use the cookie to find our camera - we store the camera pointer as cookie
    uintptr_t cam_ptr = static_cast<uintptr_t>(request->cookie());
    lc_camera_t* cam = reinterpret_cast<lc_camera_t*>(cam_ptr);

    if (cam && cam->callback) {
        std::lock_guard<std::mutex> lock(cam->callback_mutex);
        if (cam->callback) {
            lc_request_t* req_wrapper = nullptr;
            {
                std::lock_guard<std::mutex> req_lock(g_request_map_mutex);
                auto it = g_request_map.find(request);
                if (it != g_request_map.end()) {
                    req_wrapper = it->second;
                }
            }
            if (!req_wrapper) {
                req_wrapper = reinterpret_cast<lc_request_t*>(request);
            }
            cam->callback(req_wrapper, cam->user_data);
        }
    }
}

lc_status_t lc_camera_start(lc_camera_t* cam) {
    if (!cam || !cam->camera) return LC_STATUS_INVALID_ARGUMENT;

    // Register in global map for cleanup tracking
    {
        std::lock_guard<std::mutex> lock(g_camera_map_mutex);
        g_camera_map[cam->camera.get()] = cam;
    }

    // Connect request completed signal with static function
    cam->camera->requestCompleted.connect(request_completed_handler);

    int ret = cam->camera->start();
    if (ret < 0) {
        cam->camera->requestCompleted.disconnect(request_completed_handler);
        std::lock_guard<std::mutex> lock(g_camera_map_mutex);
        g_camera_map.erase(cam->camera.get());
        return LC_STATUS_ERROR;
    }
    return LC_STATUS_OK;
}

lc_status_t lc_camera_stop(lc_camera_t* cam) {
    if (!cam || !cam->camera) return LC_STATUS_INVALID_ARGUMENT;

    int ret = cam->camera->stop();
    cam->camera->requestCompleted.disconnect(request_completed_handler);

    // Remove from global map
    {
        std::lock_guard<std::mutex> lock(g_camera_map_mutex);
        g_camera_map.erase(cam->camera.get());
    }

    return ret < 0 ? LC_STATUS_ERROR : LC_STATUS_OK;
}

lc_status_t lc_camera_queue_request(lc_camera_t* cam, lc_request_t* request) {
    if (!cam || !cam->camera || !request || !request->request) return LC_STATUS_INVALID_ARGUMENT;

    int ret = cam->camera->queueRequest(request->request.get());
    return ret < 0 ? LC_STATUS_ERROR : LC_STATUS_OK;
}

void lc_camera_set_request_completed_callback(lc_camera_t* cam, lc_request_completed_cb cb, void* user_data) {
    if (!cam) return;

    std::lock_guard<std::mutex> lock(cam->callback_mutex);
    cam->callback = cb;
    cam->user_data = user_data;
}

// Camera configuration implementation
void lc_camera_configuration_destroy(lc_camera_configuration_t* config) {
    delete config;
}

lc_status_t lc_camera_configuration_validate(lc_camera_configuration_t* config) {
    if (!config || !config->config) return LC_STATUS_INVALID_ARGUMENT;

    auto status = config->config->validate();
    if (status == CameraConfiguration::Invalid) return LC_STATUS_ERROR;
    return LC_STATUS_OK;
}

size_t lc_camera_configuration_size(lc_camera_configuration_t* config) {
    if (!config || !config->config) return 0;
    return config->config->size();
}

lc_stream_configuration_t* lc_camera_configuration_at(lc_camera_configuration_t* config, size_t index) {
    if (!config || !config->config || index >= config->config->size()) return nullptr;

    auto cfg = new lc_stream_configuration();
    cfg->config = &config->config->at(index);
    return cfg;
}

// Stream configuration implementation
lc_stream_t* lc_stream_configuration_stream(lc_stream_configuration_t* cfg) {
    if (!cfg || !cfg->config) return nullptr;

    auto stream = new lc_stream();
    stream->stream = cfg->config->stream();
    return stream;
}

uint32_t lc_stream_configuration_width(lc_stream_configuration_t* cfg) {
    if (!cfg || !cfg->config) return 0;
    return cfg->config->size.width;
}

uint32_t lc_stream_configuration_height(lc_stream_configuration_t* cfg) {
    if (!cfg || !cfg->config) return 0;
    return cfg->config->size.height;
}

uint32_t lc_stream_configuration_stride(lc_stream_configuration_t* cfg) {
    if (!cfg || !cfg->config) return 0;
    return cfg->config->stride;
}

lc_pixel_format_t lc_stream_configuration_pixel_format(lc_stream_configuration_t* cfg) {
    if (!cfg || !cfg->config) return LC_PIXEL_FORMAT_UNKNOWN;
    return to_lc_pixel_format(cfg->config->pixelFormat);
}

void lc_stream_configuration_set_size(lc_stream_configuration_t* cfg, uint32_t width, uint32_t height) {
    if (!cfg || !cfg->config) return;
    cfg->config->size.width = width;
    cfg->config->size.height = height;
}

void lc_stream_configuration_set_pixel_format(lc_stream_configuration_t* cfg, lc_pixel_format_t format) {
    if (!cfg || !cfg->config) return;
    cfg->config->pixelFormat = from_lc_pixel_format(format);
}

lc_stream_formats_t* lc_stream_configuration_formats(lc_stream_configuration_t* cfg) {
    if (!cfg || !cfg->config) return nullptr;

    auto formats = new lc_stream_formats();
    formats->formats = cfg->config->formats();
    return formats;
}

void lc_stream_formats_destroy(lc_stream_formats_t* formats) {
    delete formats;
}

size_t lc_stream_formats_pixel_format_count(lc_stream_formats_t* formats) {
    if (!formats) return 0;
    return formats->formats.pixelformats().size();
}

lc_pixel_format_t lc_stream_formats_pixel_format_at(lc_stream_formats_t* formats, size_t index) {
    if (!formats) return LC_PIXEL_FORMAT_UNKNOWN;
    const auto& pixel_formats = formats->formats.pixelformats();
    if (index >= pixel_formats.size()) return LC_PIXEL_FORMAT_UNKNOWN;

    auto it = pixel_formats.begin();
    std::advance(it, index);
    return to_lc_pixel_format(*it);
}

size_t lc_stream_formats_sizes_count(lc_stream_formats_t* formats, lc_pixel_format_t format) {
    if (!formats) return 0;
    PixelFormat pf = from_lc_pixel_format(format);
    return formats->formats.sizes(pf).size();
}

lc_status_t lc_stream_formats_size_at(lc_stream_formats_t* formats, lc_pixel_format_t format,
                                      size_t index, lc_size_t* size) {
    if (!formats || !size) return LC_STATUS_INVALID_ARGUMENT;

    PixelFormat pf = from_lc_pixel_format(format);
    const auto& sizes = formats->formats.sizes(pf);
    if (index >= sizes.size()) return LC_STATUS_INVALID_ARGUMENT;

    size->width = sizes[index].width;
    size->height = sizes[index].height;
    return LC_STATUS_OK;
}

lc_status_t lc_stream_formats_range(lc_stream_formats_t* formats, lc_pixel_format_t format,
                                    lc_size_range_info_t* range) {
    if (!formats || !range) return LC_STATUS_INVALID_ARGUMENT;

    PixelFormat pf = from_lc_pixel_format(format);
    const auto& pixel_formats = formats->formats.pixelformats();
    bool found = false;
    for (const auto& fmt : pixel_formats) {
        if (fmt == pf) {
            found = true;
            break;
        }
    }
    if (!found) return LC_STATUS_INVALID_ARGUMENT;

    const SizeRange& r = formats->formats.range(pf);
    range->min.width = r.min.width;
    range->min.height = r.min.height;
    range->max.width = r.max.width;
    range->max.height = r.max.height;
    range->hstep = r.hStep;
    range->vstep = r.vStep;
    return LC_STATUS_OK;
}

// Frame buffer allocator implementation
lc_framebuffer_allocator_t* lc_framebuffer_allocator_new(lc_camera_t* cam) {
    if (!cam || !cam->camera) return nullptr;

    auto alloc = new lc_framebuffer_allocator();
    alloc->allocator = std::make_unique<FrameBufferAllocator>(cam->camera);
    alloc->camera = cam->camera.get();
    return alloc;
}

void lc_framebuffer_allocator_destroy(lc_framebuffer_allocator_t* alloc) {
    delete alloc;
}

lc_status_t lc_framebuffer_allocator_allocate(lc_framebuffer_allocator_t* alloc, lc_stream_t* stream) {
    if (!alloc || !alloc->allocator || !stream || !stream->stream) return LC_STATUS_INVALID_ARGUMENT;

    int ret = alloc->allocator->allocate(stream->stream);
    return ret < 0 ? LC_STATUS_ERROR : LC_STATUS_OK;
}

void lc_framebuffer_allocator_free(lc_framebuffer_allocator_t* alloc, lc_stream_t* stream) {
    if (!alloc || !alloc->allocator || !stream || !stream->stream) return;
    alloc->allocator->free(stream->stream);
}

size_t lc_framebuffer_allocator_buffer_count(lc_framebuffer_allocator_t* alloc, lc_stream_t* stream) {
    if (!alloc || !alloc->allocator || !stream || !stream->stream) return 0;
    const auto& buffers = alloc->allocator->buffers(stream->stream);
    return buffers.size();
}

lc_framebuffer_t* lc_framebuffer_allocator_get_buffer(lc_framebuffer_allocator_t* alloc, lc_stream_t* stream, size_t index) {
    if (!alloc || !alloc->allocator || !stream || !stream->stream) return nullptr;

    const auto& buffers = alloc->allocator->buffers(stream->stream);
    if (index >= buffers.size()) return nullptr;

    auto buf = new lc_framebuffer();
    buf->buffer = buffers[index].get();
    return buf;
}

// Frame buffer implementation
size_t lc_framebuffer_plane_count(lc_framebuffer_t* buf) {
    if (!buf || !buf->buffer) return 0;
    return buf->buffer->planes().size();
}

lc_status_t lc_framebuffer_plane_info(lc_framebuffer_t* buf, size_t index, lc_plane_info_t* info) {
    if (!buf || !buf->buffer || !info) return LC_STATUS_INVALID_ARGUMENT;

    const auto& planes = buf->buffer->planes();
    if (index >= planes.size()) return LC_STATUS_INVALID_ARGUMENT;

    const auto& plane = planes[index];
    info->fd = plane.fd.get();
    info->offset = plane.offset;
    info->length = plane.length;
    return LC_STATUS_OK;
}

void lc_framebuffer_destroy(lc_framebuffer_t* buf) {
    delete buf;
}

lc_frame_status_t lc_framebuffer_metadata_status(lc_framebuffer_t* buf) {
    if (!buf || !buf->buffer) return LC_FRAME_STATUS_ERROR;
    return static_cast<lc_frame_status_t>(buf->buffer->metadata().status);
}

size_t lc_framebuffer_metadata_plane_count(lc_framebuffer_t* buf) {
    if (!buf || !buf->buffer) return 0;
    return buf->buffer->metadata().planes().size();
}

uint32_t lc_framebuffer_metadata_plane_bytesused(lc_framebuffer_t* buf, size_t index) {
    if (!buf || !buf->buffer) return 0;
    const auto& planes = buf->buffer->metadata().planes();
    if (index >= planes.size()) return 0;
    return planes[index].bytesused;
}

// Request implementation
void lc_request_destroy(lc_request_t* req) {
    if (req && req->request) {
        std::lock_guard<std::mutex> lock(g_request_map_mutex);
        g_request_map.erase(req->request.get());
    }
    delete req;
}

lc_status_t lc_request_add_buffer(lc_request_t* req, lc_stream_t* stream, lc_framebuffer_t* buffer) {
    if (!req || !req->request || !stream || !stream->stream || !buffer || !buffer->buffer) {
        return LC_STATUS_INVALID_ARGUMENT;
    }

    int ret = req->request->addBuffer(stream->stream, buffer->buffer);
    return ret < 0 ? LC_STATUS_ERROR : LC_STATUS_OK;
}

lc_status_t lc_request_reuse(lc_request_t* req) {
    if (!req || !req->request) return LC_STATUS_INVALID_ARGUMENT;

    req->request->reuse(Request::ReuseBuffers);
    return LC_STATUS_OK;
}

uint64_t lc_request_cookie(lc_request_t* req) {
    if (!req) return 0;
    if (req->request) {
        return req->request->cookie();
    }
    Request* request = reinterpret_cast<Request*>(req);
    return request->cookie();
}

lc_framebuffer_t* lc_request_get_buffer(lc_request_t* req, lc_stream_t* stream) {
    if (!req || !stream || !stream->stream) return nullptr;

    Request* request = nullptr;
    if (req->request) {
        request = req->request.get();
    } else {
        // For completed requests passed via callback without wrapper, cast back
        request = reinterpret_cast<Request*>(req);
    }
    const auto& buffers = request->buffers();

    auto it = buffers.find(stream->stream);
    if (it == buffers.end()) return nullptr;

    auto buf = new lc_framebuffer();
    buf->buffer = it->second;
    return buf;
}

uint64_t lc_request_sequence(lc_request_t* req) {
    if (!req) return 0;

    Request* request = nullptr;
    if (req->request) {
        request = req->request.get();
    } else {
        // For completed requests passed via callback without wrapper
        request = reinterpret_cast<Request*>(req);
    }
    return request->sequence();
}

uint64_t lc_request_metadata_timestamp(lc_request_t* req) {
    if (!req) return 0;

    Request* request = nullptr;
    if (req->request) {
        request = req->request.get();
    } else {
        request = reinterpret_cast<Request*>(req);
    }
    const auto& metadata = request->metadata();

    auto it = metadata.get(controls::SensorTimestamp);
    if (it.has_value()) {
        return it.value();
    }
    return 0;
}

} // extern "C"
