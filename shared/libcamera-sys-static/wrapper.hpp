#ifndef LIBCAMERA_WRAPPER_HPP
#define LIBCAMERA_WRAPPER_HPP

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Opaque types
typedef struct lc_camera_manager lc_camera_manager_t;
typedef struct lc_camera lc_camera_t;
typedef struct lc_camera_configuration lc_camera_configuration_t;
typedef struct lc_stream_configuration lc_stream_configuration_t;
typedef struct lc_stream_formats lc_stream_formats_t;
typedef struct lc_stream lc_stream_t;
typedef struct lc_framebuffer_allocator lc_framebuffer_allocator_t;
typedef struct lc_framebuffer lc_framebuffer_t;
typedef struct lc_request lc_request_t;
typedef struct lc_control_list lc_control_list_t;

// Status codes
typedef enum {
    LC_STATUS_OK = 0,
    LC_STATUS_ERROR = -1,
    LC_STATUS_INVALID_ARGUMENT = -2,
    LC_STATUS_NOT_FOUND = -3,
    LC_STATUS_BUSY = -4,
} lc_status_t;

// Stream roles
typedef enum {
    LC_STREAM_ROLE_RAW = 0,
    LC_STREAM_ROLE_STILL_CAPTURE = 1,
    LC_STREAM_ROLE_VIDEO_RECORDING = 2,
    LC_STREAM_ROLE_VIEWFINDER = 3,
} lc_stream_role_t;

// Pixel formats (subset for OV5647)
typedef enum {
    LC_PIXEL_FORMAT_UNKNOWN = 0,
    LC_PIXEL_FORMAT_RGB888 = 1,
    LC_PIXEL_FORMAT_BGR888 = 2,
    LC_PIXEL_FORMAT_YUYV = 3,
    LC_PIXEL_FORMAT_YVYU = 4,
    LC_PIXEL_FORMAT_UYVY = 5,
    LC_PIXEL_FORMAT_NV12 = 6,
    LC_PIXEL_FORMAT_NV21 = 7,
    LC_PIXEL_FORMAT_YUV420 = 8,
    LC_PIXEL_FORMAT_MJPEG = 9,
} lc_pixel_format_t;

// Size types for format enumeration
typedef struct {
    uint32_t width;
    uint32_t height;
} lc_size_t;

typedef struct {
    lc_size_t min;
    lc_size_t max;
    uint32_t hstep;
    uint32_t vstep;
} lc_size_range_info_t;

// Frame status
typedef enum {
    LC_FRAME_STATUS_SUCCESS = 0,
    LC_FRAME_STATUS_ERROR = 1,
    LC_FRAME_STATUS_CANCELLED = 2,
    LC_FRAME_STATUS_STARTUP = 3,
} lc_frame_status_t;

// Frame buffer plane info
typedef struct {
    int fd;
    uint32_t offset;
    uint32_t length;
} lc_plane_info_t;

// Request completion callback
typedef void (*lc_request_completed_cb)(lc_request_t* request, void* user_data);

// Camera manager
lc_camera_manager_t* lc_camera_manager_new(void);
void lc_camera_manager_destroy(lc_camera_manager_t* mgr);
lc_status_t lc_camera_manager_start(lc_camera_manager_t* mgr);
void lc_camera_manager_stop(lc_camera_manager_t* mgr);
size_t lc_camera_manager_camera_count(lc_camera_manager_t* mgr);
lc_camera_t* lc_camera_manager_get_camera(lc_camera_manager_t* mgr, size_t index);
lc_camera_t* lc_camera_manager_get_camera_by_id(lc_camera_manager_t* mgr, const char* id);

// Camera
const char* lc_camera_id(lc_camera_t* cam);
lc_status_t lc_camera_acquire(lc_camera_t* cam);
lc_status_t lc_camera_release(lc_camera_t* cam);
lc_camera_configuration_t* lc_camera_generate_configuration(lc_camera_t* cam, const lc_stream_role_t* roles, size_t num_roles);
lc_status_t lc_camera_configure(lc_camera_t* cam, lc_camera_configuration_t* config);
lc_request_t* lc_camera_create_request(lc_camera_t* cam, uint64_t cookie);
lc_status_t lc_camera_start(lc_camera_t* cam);
lc_status_t lc_camera_stop(lc_camera_t* cam);
lc_status_t lc_camera_queue_request(lc_camera_t* cam, lc_request_t* request);
void lc_camera_set_request_completed_callback(lc_camera_t* cam, lc_request_completed_cb cb, void* user_data);

// Camera configuration
void lc_camera_configuration_destroy(lc_camera_configuration_t* config);
lc_status_t lc_camera_configuration_validate(lc_camera_configuration_t* config);
size_t lc_camera_configuration_size(lc_camera_configuration_t* config);
lc_stream_configuration_t* lc_camera_configuration_at(lc_camera_configuration_t* config, size_t index);

// Stream configuration
lc_stream_t* lc_stream_configuration_stream(lc_stream_configuration_t* cfg);
uint32_t lc_stream_configuration_width(lc_stream_configuration_t* cfg);
uint32_t lc_stream_configuration_height(lc_stream_configuration_t* cfg);
uint32_t lc_stream_configuration_stride(lc_stream_configuration_t* cfg);
lc_pixel_format_t lc_stream_configuration_pixel_format(lc_stream_configuration_t* cfg);
void lc_stream_configuration_set_size(lc_stream_configuration_t* cfg, uint32_t width, uint32_t height);
void lc_stream_configuration_set_pixel_format(lc_stream_configuration_t* cfg, lc_pixel_format_t format);

// Stream format enumeration
lc_stream_formats_t* lc_stream_configuration_formats(lc_stream_configuration_t* cfg);
void lc_stream_formats_destroy(lc_stream_formats_t* formats);
size_t lc_stream_formats_pixel_format_count(lc_stream_formats_t* formats);
lc_pixel_format_t lc_stream_formats_pixel_format_at(lc_stream_formats_t* formats, size_t index);
size_t lc_stream_formats_sizes_count(lc_stream_formats_t* formats, lc_pixel_format_t format);
lc_status_t lc_stream_formats_size_at(lc_stream_formats_t* formats, lc_pixel_format_t format,
                                      size_t index, lc_size_t* size);
lc_status_t lc_stream_formats_range(lc_stream_formats_t* formats, lc_pixel_format_t format,
                                    lc_size_range_info_t* range);

// Frame buffer allocator
lc_framebuffer_allocator_t* lc_framebuffer_allocator_new(lc_camera_t* cam);
void lc_framebuffer_allocator_destroy(lc_framebuffer_allocator_t* alloc);
lc_status_t lc_framebuffer_allocator_allocate(lc_framebuffer_allocator_t* alloc, lc_stream_t* stream);
void lc_framebuffer_allocator_free(lc_framebuffer_allocator_t* alloc, lc_stream_t* stream);
size_t lc_framebuffer_allocator_buffer_count(lc_framebuffer_allocator_t* alloc, lc_stream_t* stream);
lc_framebuffer_t* lc_framebuffer_allocator_get_buffer(lc_framebuffer_allocator_t* alloc, lc_stream_t* stream, size_t index);

// Frame buffer
size_t lc_framebuffer_plane_count(lc_framebuffer_t* buf);
lc_status_t lc_framebuffer_plane_info(lc_framebuffer_t* buf, size_t index, lc_plane_info_t* info);
void lc_framebuffer_destroy(lc_framebuffer_t* buf);
lc_frame_status_t lc_framebuffer_metadata_status(lc_framebuffer_t* buf);
size_t lc_framebuffer_metadata_plane_count(lc_framebuffer_t* buf);
uint32_t lc_framebuffer_metadata_plane_bytesused(lc_framebuffer_t* buf, size_t index);

// Request
void lc_request_destroy(lc_request_t* req);
lc_status_t lc_request_add_buffer(lc_request_t* req, lc_stream_t* stream, lc_framebuffer_t* buffer);
lc_status_t lc_request_reuse(lc_request_t* req);
uint64_t lc_request_cookie(lc_request_t* req);
lc_framebuffer_t* lc_request_get_buffer(lc_request_t* req, lc_stream_t* stream);
uint64_t lc_request_sequence(lc_request_t* req);

// Metadata from completed request
uint64_t lc_request_metadata_timestamp(lc_request_t* req);

#ifdef __cplusplus
}
#endif

#endif // LIBCAMERA_WRAPPER_HPP
