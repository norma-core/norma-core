/* Media Foundation capture for usbvideo on Windows. Every call is made on a
 * thread that called nc_mf_thread_init. */
#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <mfreadwrite.h>
#include <stdint.h>
#include <string.h>

#define NC_MF_ID_MAX 512
#define NC_MF_NAME_MAX 256

struct nc_mf_device {
	char id[NC_MF_ID_MAX];
	char name[NC_MF_NAME_MAX];
};

struct nc_mf_format {
	uint32_t index;
	uint32_t fourcc;
	uint32_t width;
	uint32_t height;
	uint32_t fps_num;
	uint32_t fps_den;
};

struct nc_mf_frame {
	const uint8_t *data;
	uint32_t len;
	uint32_t width;
	uint32_t height;
	uint32_t fourcc;
};

struct nc_mf_capture {
	IMFSourceReader *reader;
	IMFMediaSource *source;
	IMFMediaBuffer *buffer;
	BYTE *packed;
	DWORD packed_cap;
	uint32_t width;
	uint32_t height;
	uint32_t fourcc;
};

/* MF subtypes for FOURCC formats are the base GUID with the code in Data1. */
static const GUID nc_mf_base = {0, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};

/* 0, or a negative HRESULT with nothing to undo. Each 0 is paired with
 * nc_mf_thread_done on the same thread. */
int
nc_mf_thread_init(void)
{
	HRESULT hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);

	if (FAILED(hr))
		return (int)hr;
	hr = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
	if (FAILED(hr)) {
		CoUninitialize();
		return (int)hr;
	}
	return 0;
}

void
nc_mf_thread_done(void)
{
	MFShutdown();
	CoUninitialize();
}

/* The fourcc as its four bytes read big-endian, as usbvideo stores it; 0 for
 * a subtype that is not FOURCC-based (RGB24, RGB32 and the like). */
static uint32_t
nc_mf_fourcc(const GUID *subtype)
{
	GUID g = *subtype;
	uint32_t d1 = (uint32_t)g.Data1;

	g.Data1 = 0;
	if (!IsEqualGUID(&g, &nc_mf_base) || d1 < 0x20202020u)
		return 0;
	return (d1 & 0xffu) << 24 | ((d1 >> 8) & 0xffu) << 16 | ((d1 >> 16) & 0xffu) << 8 |
	    (d1 >> 24);
}

static void
nc_mf_utf8(const WCHAR *w, char *out, int cap)
{
	out[0] = '\0';
	if (w != NULL && WideCharToMultiByte(CP_UTF8, 0, w, -1, out, cap, NULL, NULL) == 0)
		out[0] = '\0';
}

static HRESULT
nc_mf_enum(IMFActivate ***devices, UINT32 *count)
{
	IMFAttributes *attrs = NULL;
	HRESULT hr = MFCreateAttributes(&attrs, 1);

	if (SUCCEEDED(hr))
		hr = IMFAttributes_SetGUID(attrs, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
		    &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
	if (SUCCEEDED(hr))
		hr = MFEnumDeviceSources(attrs, devices, count);
	if (attrs != NULL)
		IMFAttributes_Release(attrs);
	return hr;
}

static void
nc_mf_release_all(IMFActivate **devices, UINT32 count)
{
	UINT32 i;

	for (i = 0; i < count; i++)
		IMFActivate_Release(devices[i]);
	CoTaskMemFree(devices);
}

/* Up to cap devices into out; the number found, or a negative HRESULT. */
int
nc_mf_list(struct nc_mf_device *out, int cap)
{
	IMFActivate **devices = NULL;
	UINT32 count = 0, i;
	int n = 0;
	HRESULT hr = nc_mf_enum(&devices, &count);

	if (FAILED(hr))
		return (int)hr;
	for (i = 0; i < count && n < cap; i++) {
		WCHAR *link = NULL, *name = NULL;
		UINT32 len;

		if (FAILED(IMFActivate_GetAllocatedString(devices[i],
		    &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &link, &len)))
			continue;
		(void)IMFActivate_GetAllocatedString(devices[i], &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
		    &name, &len);
		nc_mf_utf8(link, out[n].id, NC_MF_ID_MAX);
		nc_mf_utf8(name, out[n].name, NC_MF_NAME_MAX);
		CoTaskMemFree(link);
		CoTaskMemFree(name);
		if (out[n].id[0] != '\0')
			n++;
	}
	nc_mf_release_all(devices, count);
	return n;
}

static HRESULT
nc_mf_open_source(const char *id, IMFMediaSource **source)
{
	IMFActivate **devices = NULL;
	UINT32 count = 0, i;
	HRESULT hr = nc_mf_enum(&devices, &count);

	*source = NULL;
	if (FAILED(hr))
		return hr;
	hr = MF_E_NOT_FOUND;
	for (i = 0; i < count; i++) {
		WCHAR *link = NULL;
		UINT32 len;
		char utf8[NC_MF_ID_MAX];

		if (FAILED(IMFActivate_GetAllocatedString(devices[i],
		    &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &link, &len)))
			continue;
		nc_mf_utf8(link, utf8, NC_MF_ID_MAX);
		CoTaskMemFree(link);
		if (strcmp(utf8, id) == 0) {
			hr = IMFActivate_ActivateObject(devices[i], &IID_IMFMediaSource, (void **)source);
			break;
		}
	}
	nc_mf_release_all(devices, count);
	return hr;
}

static HRESULT
nc_mf_reader(IMFMediaSource *source, IMFSourceReader **reader)
{
	IMFAttributes *attrs = NULL;
	HRESULT hr = MFCreateAttributes(&attrs, 1);

	/* Native types only: no decoder or converter is put in front of the camera. */
	if (SUCCEEDED(hr))
		hr = IMFAttributes_SetUINT32(attrs, &MF_READWRITE_DISABLE_CONVERTERS, TRUE);
	if (SUCCEEDED(hr))
		hr = MFCreateSourceReaderFromMediaSource(source, attrs, reader);
	if (attrs != NULL)
		IMFAttributes_Release(attrs);
	return hr;
}

static void
nc_mf_describe(IMFMediaType *type, uint32_t index, struct nc_mf_format *f)
{
	GUID subtype;
	UINT64 packed;

	memset(f, 0, sizeof(*f));
	f->index = index;
	if (SUCCEEDED(IMFMediaType_GetGUID(type, &MF_MT_SUBTYPE, &subtype)))
		f->fourcc = nc_mf_fourcc(&subtype);
	/* MFGetAttributeSize and MFGetAttributeRatio are C++ only: both pack the
	 * pair as high and low 32 bits. */
	if (SUCCEEDED(IMFMediaType_GetUINT64(type, &MF_MT_FRAME_SIZE, &packed))) {
		f->width = (uint32_t)(packed >> 32);
		f->height = (uint32_t)packed;
	}
	if (SUCCEEDED(IMFMediaType_GetUINT64(type, &MF_MT_FRAME_RATE, &packed))) {
		f->fps_num = (uint32_t)(packed >> 32);
		f->fps_den = (uint32_t)packed;
	}
}

/* Up to cap native formats of the camera into out; the number found, or a
 * negative HRESULT. index is the native type index nc_mf_open takes. */
int
nc_mf_formats(const char *id, struct nc_mf_format *out, int cap)
{
	IMFMediaSource *source = NULL;
	IMFSourceReader *reader = NULL;
	DWORD i;
	int n = 0;
	HRESULT hr = nc_mf_open_source(id, &source);

	if (SUCCEEDED(hr))
		hr = nc_mf_reader(source, &reader);
	for (i = 0; SUCCEEDED(hr) && n < cap; i++) {
		IMFMediaType *type = NULL;

		hr = IMFSourceReader_GetNativeMediaType(reader,
		    (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, i, &type);
		if (hr == MF_E_NO_MORE_TYPES) {
			hr = S_OK;
			break;
		}
		if (SUCCEEDED(hr)) {
			nc_mf_describe(type, (uint32_t)i, &out[n++]);
			IMFMediaType_Release(type);
		}
	}
	if (reader != NULL)
		IMFSourceReader_Release(reader);
	if (source != NULL) {
		IMFMediaSource_Shutdown(source);
		IMFMediaSource_Release(source);
	}
	return FAILED(hr) ? (int)hr : n;
}

static void
nc_mf_unlock(struct nc_mf_capture *c)
{
	if (c->buffer != NULL) {
		IMFMediaBuffer_Unlock(c->buffer);
		IMFMediaBuffer_Release(c->buffer);
		c->buffer = NULL;
	}
}

void
nc_mf_close(struct nc_mf_capture *c)
{
	if (c == NULL)
		return;
	nc_mf_unlock(c);
	CoTaskMemFree(c->packed);
	if (c->reader != NULL)
		IMFSourceReader_Release(c->reader);
	if (c->source != NULL) {
		IMFMediaSource_Shutdown(c->source);
		IMFMediaSource_Release(c->source);
	}
	CoTaskMemFree(c);
}

/* Opens the camera at native type index; NULL with *err set on failure. */
struct nc_mf_capture *
nc_mf_open(const char *id, uint32_t index, int *err)
{
	struct nc_mf_capture *c = CoTaskMemAlloc(sizeof(*c));
	IMFMediaType *type = NULL;
	struct nc_mf_format f;
	HRESULT hr;

	if (c == NULL) {
		*err = (int)E_OUTOFMEMORY;
		return NULL;
	}
	memset(c, 0, sizeof(*c));
	hr = nc_mf_open_source(id, &c->source);
	if (SUCCEEDED(hr))
		hr = nc_mf_reader(c->source, &c->reader);
	if (SUCCEEDED(hr))
		hr = IMFSourceReader_GetNativeMediaType(c->reader,
		    (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, index, &type);
	if (SUCCEEDED(hr))
		hr = IMFSourceReader_SetCurrentMediaType(c->reader,
		    (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, NULL, type);
	if (SUCCEEDED(hr)) {
		nc_mf_describe(type, index, &f);
		c->width = f.width;
		c->height = f.height;
		c->fourcc = f.fourcc;
	}
	if (type != NULL)
		IMFMediaType_Release(type);
	if (FAILED(hr)) {
		*err = (int)hr;
		nc_mf_close(c);
		return NULL;
	}
	*err = 0;
	return c;
}

/* Ends a capture blocked in nc_mf_read from another thread; the read then
 * fails with MF_E_SHUTDOWN. 0 or a negative HRESULT. */
int
nc_mf_interrupt(struct nc_mf_capture *c)
{
	HRESULT hr = IMFMediaSource_Shutdown(c->source);

	return FAILED(hr) ? (int)hr : 0;
}

/* A 2D buffer's rows can be padded, and a planar format's planes follow the
 * padded rows; ContiguousCopyTo writes the frame packed. */
static HRESULT
nc_mf_pack(struct nc_mf_capture *c, IMF2DBuffer *b, struct nc_mf_frame *frame)
{
	DWORD len = 0;
	HRESULT hr = IMF2DBuffer_GetContiguousLength(b, &len);

	if (SUCCEEDED(hr) && len > c->packed_cap) {
		BYTE *p = CoTaskMemRealloc(c->packed, len);

		if (p == NULL)
			return E_OUTOFMEMORY;
		c->packed = p;
		c->packed_cap = len;
	}
	if (SUCCEEDED(hr))
		hr = IMF2DBuffer_ContiguousCopyTo(b, c->packed, len);
	if (SUCCEEDED(hr)) {
		frame->data = c->packed;
		frame->len = (uint32_t)len;
	}
	return hr;
}

/* Blocks for the next frame. 0 with *frame valid until the next call or
 * nc_mf_close, 1 for a gap without a frame, or a negative HRESULT; the end
 * of the stream is MF_E_END_OF_STREAM, and a format the source switched to
 * is MF_E_INVALIDMEDIATYPE, as the frame size would no longer hold. */
int
nc_mf_read(struct nc_mf_capture *c, struct nc_mf_frame *frame)
{
	IMFSample *sample = NULL;
	IMF2DBuffer *b2 = NULL;
	DWORD flags = 0;
	BYTE *data = NULL;
	DWORD max = 0, len = 0;
	HRESULT hr;

	nc_mf_unlock(c);
	hr = IMFSourceReader_ReadSample(c->reader, (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0,
	    NULL, &flags, NULL, &sample);
	if (FAILED(hr))
		return (int)hr;
	if (flags & (MF_SOURCE_READERF_ENDOFSTREAM | MF_SOURCE_READERF_ERROR |
	    MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED | MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED)) {
		if (sample != NULL)
			IMFSample_Release(sample);
		return (int)((flags & (MF_SOURCE_READERF_ENDOFSTREAM | MF_SOURCE_READERF_ERROR)) ?
		    MF_E_END_OF_STREAM : MF_E_INVALIDMEDIATYPE);
	}
	if (sample == NULL)
		return 1;
	hr = IMFSample_ConvertToContiguousBuffer(sample, &c->buffer);
	IMFSample_Release(sample);
	if (FAILED(hr))
		return (int)hr;
	frame->width = c->width;
	frame->height = c->height;
	frame->fourcc = c->fourcc;
	if (SUCCEEDED(IMFMediaBuffer_QueryInterface(c->buffer, &IID_IMF2DBuffer, (void **)&b2))) {
		hr = nc_mf_pack(c, b2, frame);
		IMF2DBuffer_Release(b2);
		IMFMediaBuffer_Release(c->buffer);
		c->buffer = NULL;
		return FAILED(hr) ? (int)hr : 0;
	}
	hr = IMFMediaBuffer_Lock(c->buffer, &data, &max, &len);
	if (FAILED(hr)) {
		IMFMediaBuffer_Release(c->buffer);
		c->buffer = NULL;
		return (int)hr;
	}
	frame->data = data;
	frame->len = (uint32_t)len;
	return 0;
}
