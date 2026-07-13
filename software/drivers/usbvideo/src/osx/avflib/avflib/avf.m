#import "avf.h"
#import <mach/mach_time.h>
#import <time.h>
#import <sys/time.h>

#define MAX_CONCURRENT_SESSIONS 10

@interface FrameDataWrapper : NSObject
@property (nonatomic, assign) CameraFrameInfo info;
@property (nonatomic, strong) NSData *data;
@end

@implementation FrameDataWrapper
- (void)dealloc {
    [_data release];
    [super dealloc];
}
@end

@interface CaptureSession : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
@property (nonatomic, strong) AVCaptureSession *session;
@property (nonatomic, strong) AVCaptureDevice *device;
@property (nonatomic, strong) AVCaptureDeviceFormat *desiredFormat;
@property (nonatomic, strong) AVCaptureDeviceInput *input;
@property (nonatomic, strong) AVCaptureVideoDataOutput *output;
@property (nonatomic, strong) dispatch_queue_t captureQueue;
@property (nonatomic, strong) NSMutableArray *frameBuffer;
@property (nonatomic, strong) NSLock *bufferLock;
@property (nonatomic, assign) int32_t bufferCapacity;
@property (nonatomic, assign) int64_t frameCounter;
@property (nonatomic, assign) int64_t droppedFrames;
@property (nonatomic, assign) BOOL isCapturing;
@property (nonatomic, assign) int32_t sessionId;
@property (nonatomic, strong) id disconnectObserver;
@end

@interface DeviceDiscoveryObserver : NSObject
@end

@implementation DeviceDiscoveryObserver
- (instancetype)init {
    self = [super init];
    if (self) {
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(deviceConnected:)
                                                     name:AVCaptureDeviceWasConnectedNotification
                                                   object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(deviceDisconnected:)
                                                     name:AVCaptureDeviceWasDisconnectedNotification
                                                   object:nil];
    }
    return self;
}

- (void)deviceConnected:(NSNotification *)notification {
    AVCaptureDevice *device = notification.object;
    NSLog(@"Camera connected: %@ (%@)", device.localizedName, device.uniqueID);
}

- (void)deviceDisconnected:(NSNotification *)notification {
    AVCaptureDevice *device = notification.object;
    NSLog(@"Camera disconnected: %@ (%@)", device.localizedName, device.uniqueID);
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [super dealloc];
}
@end

static NSMutableDictionary<NSNumber *, CaptureSession *> *g_sessions = nil;
static NSLock *g_sessionsLock = nil;
static int32_t g_nextSessionId = 0;
static AVCaptureDeviceDiscoverySession *g_discoverySession = nil;
static DeviceDiscoveryObserver *g_discoveryObserver = nil;
static NSLock *g_discoveryLock = nil;

__attribute__((constructor))
static void initializeSessionStorage() {
    g_sessions = [[NSMutableDictionary alloc] init];
    g_sessionsLock = [[NSLock alloc] init];
    g_discoveryLock = [[NSLock alloc] init];

    // Create observer on main thread for notifications
    g_discoveryObserver = [[DeviceDiscoveryObserver alloc] init];

    // Create discovery session once at startup
    NSMutableArray<AVCaptureDeviceType> *deviceTypes = [avcameras getDeviceTypes];
    g_discoverySession = [AVCaptureDeviceDiscoverySession
        discoverySessionWithDeviceTypes:deviceTypes
        mediaType:AVMediaTypeVideo
        position:AVCaptureDevicePositionUnspecified];
}

@implementation CaptureSession

- (instancetype)initWithBufferCount:(int32_t)bufferCount {
    self = [super init];
    if (self) {
        _frameBuffer = [[NSMutableArray alloc] initWithCapacity:bufferCount];
        _bufferLock = [[NSLock alloc] init];
        _bufferCapacity = bufferCount;
        _frameCounter = 0;
        _droppedFrames = 0;
        _isCapturing = NO;
        _captureQueue = dispatch_queue_create("com.avcameras.capture", DISPATCH_QUEUE_SERIAL);
        _session = [[AVCaptureSession alloc] init];
    }
    return self;
}

- (void)dealloc {
    if (_isCapturing) {
        _isCapturing = NO;
        [_session stopRunning];
    }
    
    for (AVCaptureInput *input in _session.inputs) {
        [_session removeInput:input];
    }
    for (AVCaptureOutput *output in _session.outputs) {
        [_session removeOutput:output];
    }
    
    if (_output) {
        [_output setSampleBufferDelegate:nil queue:nil];
    }

    [super dealloc];
}

- (void)captureOutput:(AVCaptureOutput *)output
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
       fromConnection:(AVCaptureConnection *)connection {
    
    if (!self.isCapturing) return;
    
    @try {
        @autoreleasepool {
            CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
            if (!imageBuffer) {
                return;
            }
            
            CVReturn lockResult = CVPixelBufferLockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
            if (lockResult != kCVReturnSuccess) {
                return;
            }
            
            void *baseAddress = CVPixelBufferGetBaseAddress(imageBuffer);
            size_t bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer);
            size_t height = CVPixelBufferGetHeight(imageBuffer);
            size_t width = CVPixelBufferGetWidth(imageBuffer);
            OSType pixelFormat = CVPixelBufferGetPixelFormatType(imageBuffer);
            
            if (!baseAddress || bytesPerRow == 0 || height == 0 || width == 0) {
                CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
                return;
            }
            
            size_t dataSize;
            NSData *frameData;

            if (CVPixelBufferIsPlanar(imageBuffer) && CVPixelBufferGetPlaneCount(imageBuffer) >= 2) {
                size_t y_plane_height = CVPixelBufferGetHeightOfPlane(imageBuffer, 0);
                size_t y_plane_bpr = CVPixelBufferGetBytesPerRowOfPlane(imageBuffer, 0);
                void* y_plane_addr = CVPixelBufferGetBaseAddressOfPlane(imageBuffer, 0);

                size_t uv_plane_height = CVPixelBufferGetHeightOfPlane(imageBuffer, 1);
                size_t uv_plane_bpr = CVPixelBufferGetBytesPerRowOfPlane(imageBuffer, 1);
                void* uv_plane_addr = CVPixelBufferGetBaseAddressOfPlane(imageBuffer, 1);

                dataSize = width * height + width * height / 2;
                NSMutableData *mutableData = [NSMutableData dataWithLength:dataSize];
                uint8_t *dest = [mutableData mutableBytes];

                // Copy Y plane
                if (y_plane_bpr == width) {
                    memcpy(dest, y_plane_addr, width * y_plane_height);
                } else {
                    for (int i = 0; i < y_plane_height; i++) {
                        memcpy(dest + i * width, y_plane_addr + i * y_plane_bpr, width);
                    }
                }

                // Copy UV plane
                dest += width * height;
                if (uv_plane_bpr == width) {
                    memcpy(dest, uv_plane_addr, width * uv_plane_height);
                } else {
                    for (int i = 0; i < uv_plane_height; i++) {
                        memcpy(dest + i * width, uv_plane_addr + i * uv_plane_bpr, width);
                    }
                }
                
                frameData = mutableData;
            } else {
                void *baseAddress = CVPixelBufferGetBaseAddress(imageBuffer);
                size_t bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer);
                dataSize = bytesPerRow * height;
                frameData = [NSData dataWithBytes:baseAddress length:dataSize];
            }
            
            CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);

            CameraFrameInfo frameInfo;
            frameInfo.width = (int32_t)width;
            frameInfo.height = (int32_t)height;
            frameInfo.pixelFormat = pixelFormat;
            frameInfo.frameNumber = self.frameCounter;
            frameInfo.dataSize = dataSize;
            
            memset(frameInfo.pixelFormatString, 0, sizeof(frameInfo.pixelFormatString));
            if (pixelFormat > 0x20) {
                frameInfo.pixelFormatString[0] = (pixelFormat >> 24) & 0xFF;
                frameInfo.pixelFormatString[1] = (pixelFormat >> 16) & 0xFF;
                frameInfo.pixelFormatString[2] = (pixelFormat >> 8) & 0xFF;
                frameInfo.pixelFormatString[3] = pixelFormat & 0xFF;
                
                BOOL isPrintable = YES;
                for (int i = 0; i < 4; i++) {
                    if (!isprint(frameInfo.pixelFormatString[i])) {
                        isPrintable = NO;
                        break;
                    }
                }
                
                if (!isPrintable) {
                    memset(frameInfo.pixelFormatString, 0, sizeof(frameInfo.pixelFormatString));
                }
            }
            
            struct timespec ts;
            clock_gettime(CLOCK_MONOTONIC_RAW, &ts);
            uint64_t monotonic_timestamp_ns = (uint64_t)ts.tv_sec * 1000000000 + (uint64_t)ts.tv_nsec;
            frameInfo.monotonicTimestampNs = monotonic_timestamp_ns;

            struct timeval tv;
            gettimeofday(&tv, NULL);
            uint64_t local_timestamp_ns = (uint64_t)tv.tv_sec * 1000000000 + (uint64_t)tv.tv_usec * 1000;
            frameInfo.localTimestampNs = local_timestamp_ns;

            FrameDataWrapper *wrapper = [[FrameDataWrapper alloc] init];
            wrapper.info = frameInfo;
            wrapper.data = frameData;
            
            self.frameCounter++;
            
            [self.bufferLock lock];
            @try {
                if (self.frameBuffer.count >= self.bufferCapacity) {
                    [self.frameBuffer removeObjectAtIndex:0];
                    self.droppedFrames++;
                }
                [self.frameBuffer addObject:wrapper];
                [wrapper release];
            }
            @finally {
                [self.bufferLock unlock];
            }
        }
    }
    @catch (NSException *exception) {
        NSLog(@"Exception in capture callback: %@", exception);
    }
}

@end

@implementation avcameras

// Helper method to get session by ID
+ (CaptureSession *)getSessionById:(int32_t)sessionId {
    [g_sessionsLock lock];
    CaptureSession *session = g_sessions[@(sessionId)];
    [g_sessionsLock unlock];
    return session;
}

+ (int32_t)requestCameraAccess {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
    
    if (status == AVAuthorizationStatusAuthorized) {
        return 0;
    } else if (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted) {
        return -1;
    }
    
    __block BOOL accessGranted = NO;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
        accessGranted = granted;
        dispatch_semaphore_signal(semaphore);
    }];
    
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    
    return accessGranted ? 0 : -1;
}

+ (void)requestCameraAccessAsync:(void (^)(BOOL granted))callback {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
    
    if (status == AVAuthorizationStatusAuthorized) {
        if (callback) callback(YES);
        return;
    } else if (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted) {
        if (callback) callback(NO);
        return;
    }
    
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:callback];
}

+ (int32_t)getCameraAuthorizationStatus {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
    
    switch (status) {
        case AVAuthorizationStatusNotDetermined:
            return 0;
        case AVAuthorizationStatusRestricted:
            return 1;
        case AVAuthorizationStatusDenied:
            return 2;
        case AVAuthorizationStatusAuthorized:
            return 3;
        default:
            return 0;
    }
}

+ (NSMutableArray<AVCaptureDeviceType> *)getDeviceTypes {
    NSMutableArray<AVCaptureDeviceType> *deviceTypes = [NSMutableArray array];
    if (@available(macOS 10.15, *)) {
        [deviceTypes addObject:AVCaptureDeviceTypeExternal];
    }
    return deviceTypes;
}

+ (BOOL)isPhoneCamera:(AVCaptureDevice *)device {
    // Skip Continuity Camera (iPhone/iPad cameras)
    NSString *deviceTypeStr = device.deviceType;
    if ([deviceTypeStr containsString:@"Continuity"]) {
        return YES;
    }
    // Also check model ID for phone indicators
    NSString *modelID = device.modelID;
    if ([modelID containsString:@"iPhone"] || [modelID containsString:@"iPad"]) {
        return YES;
    }
    return NO;
}

+ (AVCaptureDeviceDiscoverySession *)getOrCreateDiscoverySession {
    // Discovery session is created once at library initialization
    return g_discoverySession;
}

+ (int32_t)getVideoDeviceCount {
    AVCaptureDeviceDiscoverySession *discoverySession = [self getOrCreateDiscoverySession];

    int32_t count = 0;
    for (AVCaptureDevice *device in discoverySession.devices) {
        if (!device.isConnected || device.isSuspended) {
            continue;
        }

        if ([self isPhoneCamera:device]) {
            continue;
        }

        NSError *error = nil;
        if ([device lockForConfiguration:&error]) {
            [device unlockForConfiguration];
            count++;
        }
    }

    return count;
}

+ (int32_t)getVideoDeviceInfo:(int32_t)index deviceInfo:(CameraDeviceInfo *)info {
    if (!info) return -1;

    AVCaptureDeviceDiscoverySession *discoverySession = [self getOrCreateDiscoverySession];

    int32_t connectedIndex = 0;
    AVCaptureDevice *device = nil;

    for (AVCaptureDevice *d in discoverySession.devices) {
        if (!d.isConnected || d.isSuspended) {
            continue;
        }

        if ([self isPhoneCamera:d]) {
            continue;
        }

        NSError *error = nil;
        if ([d lockForConfiguration:&error]) {
            [d unlockForConfiguration];
            if (connectedIndex == index) {
                device = d;
                break;
            }
            connectedIndex++;
        }
    }

    if (!device) return -1;
    
    memset(info, 0, sizeof(CameraDeviceInfo));
    
    strncpy(info->uniqueID, [device.uniqueID UTF8String], sizeof(info->uniqueID) - 1);
    strncpy(info->modelID, [device.modelID UTF8String], sizeof(info->modelID) - 1);
    strncpy(info->localizedName, [device.localizedName UTF8String], sizeof(info->localizedName) - 1);
    strncpy(info->manufacturer, [device.manufacturer UTF8String], sizeof(info->manufacturer) - 1);
    
    switch (device.position) {
        case AVCaptureDevicePositionUnspecified:
            info->position = 0;
            break;
        case AVCaptureDevicePositionBack:
            info->position = 1;
            break;
        case AVCaptureDevicePositionFront:
            info->position = 2;
            break;
    }
    
    strncpy(info->deviceType, [device.deviceType UTF8String], sizeof(info->deviceType) - 1);
    
    info->hasFlash = device.hasFlash;
    info->hasTorch = device.hasTorch;
    info->isConnected = device.isConnected;
    info->isSuspended = device.isSuspended;
    
    return 0;
}

+ (int32_t)getFormatCountForDevice:(const char *)deviceID {
    if (!deviceID) return -1;
    
    NSString *deviceIDStr = [NSString stringWithUTF8String:deviceID];
    AVCaptureDevice *device = [AVCaptureDevice deviceWithUniqueID:deviceIDStr];
    
    if (!device) return -1;
    
    return (int32_t)device.formats.count;
}

+ (int32_t)getFormatInfo:(const char *)deviceID formatIndex:(int32_t)index formatInfo:(CameraFormatInfo *)info {
    if (!deviceID || !info) return -1;
    
    NSString *deviceIDStr = [NSString stringWithUTF8String:deviceID];
    AVCaptureDevice *device = [AVCaptureDevice deviceWithUniqueID:deviceIDStr];
    
    if (!device) return -1;
    if (index < 0 || index >= device.formats.count) return -1;
    
    AVCaptureDeviceFormat *format = device.formats[index];
    
    memset(info, 0, sizeof(CameraFormatInfo));
    
    CMVideoDimensions dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription);
    info->index = (uint32_t)index;
    info->width = dimensions.width;
    info->height = dimensions.height;
    
    AVFrameRateRange *frameRateRange = format.videoSupportedFrameRateRanges.firstObject;
    if (frameRateRange) {
        info->minFrameRate = frameRateRange.minFrameRate;
        info->maxFrameRate = frameRateRange.maxFrameRate;
    }
    
    FourCharCode pixelFormat = CMFormatDescriptionGetMediaSubType(format.formatDescription);
    info->pixelFormat = pixelFormat;
    
    memset(info->pixelFormatString, 0, sizeof(info->pixelFormatString));
    
    if (pixelFormat > 0x20) {
        info->pixelFormatString[0] = (pixelFormat >> 24) & 0xFF;
        info->pixelFormatString[1] = (pixelFormat >> 16) & 0xFF;
        info->pixelFormatString[2] = (pixelFormat >> 8) & 0xFF;
        info->pixelFormatString[3] = pixelFormat & 0xFF;
        
        BOOL isPrintable = YES;
        for (int i = 0; i < 4; i++) {
            if (!isprint(info->pixelFormatString[i])) {
                isPrintable = NO;
                break;
            }
        }
        
        if (!isPrintable) {
            memset(info->pixelFormatString, 0, sizeof(info->pixelFormatString));
        }
    }
    
    if (@available(macOS 10.15, *)) {
        info->isHighPhotoQualitySupported = format.isHighPhotoQualitySupported;
    } else {
        info->isHighPhotoQualitySupported = false;
    }
        
    return 0;
}

+ (int32_t)createCaptureSession:(const char *)deviceID
                           formatIndex:(int32_t)formatIndex
                           bufferCount:(int32_t)bufferCount {
    if (!deviceID || bufferCount <= 0) return -1;
    
    AVAuthorizationStatus authStatus = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
    if (authStatus == AVAuthorizationStatusDenied || authStatus == AVAuthorizationStatusRestricted) {
        NSLog(@"Camera access denied or restricted");
        return -1;
    } else if (authStatus == AVAuthorizationStatusNotDetermined) {
        NSLog(@"Camera access not determined. Please request permission first using requestCameraAccess()");
        return -1;
    }
    
    NSString *deviceIDStr = [NSString stringWithUTF8String:deviceID];
    AVCaptureDevice *device = [AVCaptureDevice deviceWithUniqueID:deviceIDStr];

    if (!device) return -1;

    if (!device.isConnected) {
        NSLog(@"Device %s is not connected", deviceID);
        return -1;
    }

    // Validate format index
    if (formatIndex < 0 || formatIndex >= device.formats.count) return -1;

    AVCaptureDeviceFormat *format = device.formats[formatIndex];

    // Create capture session
    CaptureSession *captureSession = [[CaptureSession alloc] initWithBufferCount:bufferCount];
    captureSession.device = device;
    // Remembered so it can be re-applied after startRunning: the session's
    // preset (High) re-overrides device.activeFormat when the session starts.
    captureSession.desiredFormat = format;

    NSError *error = nil;

    captureSession.input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
    if (!captureSession.input) {
        NSLog(@"Failed to create device input: %@", error);
        return -1;
    }

    // Configure the session as one transaction. Order matters: adding an input
    // renegotiates the device to the session's preset (AVCaptureSessionPresetHigh
    // by default), so device.activeFormat must be set AFTER addInput. Setting it
    // earlier would be overridden and the camera would capture at its high
    // resolution regardless of the requested format. On macOS, setting
    // activeFormat implicitly switches the session to input-priority so the
    // chosen format is honored.
    [captureSession.session beginConfiguration];

    if ([captureSession.session canAddInput:captureSession.input]) {
        [captureSession.session addInput:captureSession.input];
    } else {
        NSLog(@"Cannot add input to session");
        [captureSession.session commitConfiguration];
        return -1;
    }
    
    captureSession.output = [[AVCaptureVideoDataOutput alloc] init];
    captureSession.output.alwaysDiscardsLateVideoFrames = YES;
    
    [captureSession.output setSampleBufferDelegate:captureSession queue:captureSession.captureQueue];
    
    if (!captureSession.output.sampleBufferDelegate) {
        NSLog(@"Failed to set sample buffer delegate");
        [captureSession.session commitConfiguration];
        return -1;
    }
    
    NSDictionary *outputSettings = @{
        (id)kCVPixelBufferPixelFormatTypeKey: @(CMFormatDescriptionGetMediaSubType(format.formatDescription))
    };
    captureSession.output.videoSettings = outputSettings;
    
    if ([captureSession.session canAddOutput:captureSession.output]) {
        [captureSession.session addOutput:captureSession.output];
    } else {
        NSLog(@"Cannot add output to session");
        [captureSession.session commitConfiguration];
        return -1;
    }

    if ([device lockForConfiguration:&error]) {
        device.activeFormat = format;
        [device unlockForConfiguration];
    } else {
        NSLog(@"Failed to lock device for configuration: %@", error);
        [captureSession.session commitConfiguration];
        return -1;
    }

    [captureSession.session commitConfiguration];

    [g_sessionsLock lock];
    
    if (g_sessions.count >= MAX_CONCURRENT_SESSIONS) {
        [g_sessionsLock unlock];
        NSLog(@"Maximum number of concurrent sessions reached");
        return -1;
    }
    
    captureSession.sessionId = g_nextSessionId++;
    g_sessions[@(captureSession.sessionId)] = captureSession;

    int32_t sessionId = captureSession.sessionId;

    captureSession.disconnectObserver = [[NSNotificationCenter defaultCenter] addObserverForName:AVCaptureDeviceWasDisconnectedNotification
                                                                                           object:device
                                                                                            queue:nil
                                                                                       usingBlock:^(NSNotification *note) {
        NSLog(@"Device disconnected, cleaning up session %d", sessionId);
        [avcameras destroyCaptureSession:sessionId];
    }];

    [captureSession release];

    [g_sessionsLock unlock];

    return sessionId;
}

+ (int32_t)startCapture:(int32_t)sessionId {
    CaptureSession *captureSession = [self getSessionById:sessionId];
    if (!captureSession) return -1;
    
    if (captureSession.isCapturing) return 0;
    
    captureSession.isCapturing = YES;
    captureSession.frameCounter = 0;
    captureSession.droppedFrames = 0;

    [captureSession.session startRunning];

    // startRunning re-applies the session preset (High), overriding the
    // activeFormat chosen in createCaptureSession. Re-apply the requested format
    // now that the session is running so capture matches the configured
    // resolution instead of the camera's high-preset default.
    if (captureSession.desiredFormat &&
        captureSession.device.activeFormat != captureSession.desiredFormat) {
        NSError *fmtError = nil;
        if ([captureSession.device lockForConfiguration:&fmtError]) {
            captureSession.device.activeFormat = captureSession.desiredFormat;
            [captureSession.device unlockForConfiguration];
        } else {
            NSLog(@"Failed to re-apply active format after startRunning: %@", fmtError);
        }
    }

    if (!captureSession.session.isRunning) {
        NSLog(@"Failed to start capture session");
        captureSession.isCapturing = NO;
        return -1;
    }

    return 0;
}

+ (int32_t)stopCapture:(int32_t)sessionId {
    CaptureSession *captureSession = [self getSessionById:sessionId];
    if (!captureSession) return -1;
    
    captureSession.isCapturing = NO;
    [captureSession.session stopRunning];
    
    [captureSession.bufferLock lock];
    [captureSession.frameBuffer removeAllObjects];
    [captureSession.bufferLock unlock];
    
    return 0;
}

+ (int32_t)isCapturing:(int32_t)sessionId {
    CaptureSession *captureSession = [self getSessionById:sessionId];
    if (!captureSession) return -1;
    
    return (captureSession.isCapturing && captureSession.session.isRunning) ? 1 : 0;
}

+ (int32_t)getNextFrame:(int32_t)sessionId
              frameInfo:(CameraFrameInfo *)frameInfo
                 buffer:(uint8_t *)buffer
             bufferSize:(size_t)bufferSize
             actualSize:(size_t *)actualSize {
    if (!frameInfo || !buffer || !actualSize) return -2;
    
    CaptureSession *captureSession = [self getSessionById:sessionId];
    if (!captureSession) return -2;
    
    [captureSession.bufferLock lock];

    if (captureSession.frameBuffer.count == 0) {
        [captureSession.bufferLock unlock];
        return -1;
    }

    FrameDataWrapper *wrapper = captureSession.frameBuffer[0];
    [wrapper retain];
    [captureSession.frameBuffer removeObjectAtIndex:0];

    [captureSession.bufferLock unlock];

    NSData *frameData = wrapper.data;
    *actualSize = frameData.length;

    if (bufferSize < frameData.length) {
        [wrapper release];
        return -2;
    }

    memcpy(buffer, frameData.bytes, frameData.length);

    *frameInfo = wrapper.info;

    [wrapper release];
    return 0;
}

+ (int32_t)getAvailableFrameCount:(int32_t)sessionId {
    CaptureSession *captureSession = [self getSessionById:sessionId];
    if (!captureSession) return -1;
    
    [captureSession.bufferLock lock];
    int32_t count = (int32_t)captureSession.frameBuffer.count;
    [captureSession.bufferLock unlock];
    
    return count;
}

+ (int64_t)getDroppedFrameCount:(int32_t)sessionId {
    CaptureSession *captureSession = [self getSessionById:sessionId];
    if (!captureSession) return -1;
    
    return captureSession.droppedFrames;
}

+ (int32_t)destroyCaptureSession:(int32_t)sessionId {
    NSLog(@"destroyCaptureSession called for session %d", sessionId);

    CaptureSession *captureSession = [self getSessionById:sessionId];
    if (!captureSession) {
        NSLog(@"Session %d not found", sessionId);
        return -1;
    }

    if (captureSession.isCapturing) {
        NSLog(@"Stopping capture for session %d", sessionId);
        [self stopCapture:sessionId];
    }

    if (captureSession.disconnectObserver) {
        [[NSNotificationCenter defaultCenter] removeObserver:captureSession.disconnectObserver];
        captureSession.disconnectObserver = nil;
    }

    NSLog(@"Tearing down AVCaptureSession for session %d", sessionId);
    [captureSession.session stopRunning];
    [captureSession.session removeInput:captureSession.input];
    [captureSession.session removeOutput:captureSession.output];
    captureSession.session = nil;
    captureSession.device = nil;
    captureSession.input = nil;
    captureSession.output = nil;
    captureSession.frameBuffer = nil;
    captureSession.bufferLock = nil;

    [g_sessionsLock lock];
    [g_sessions removeObjectForKey:@(sessionId)];
    [g_sessionsLock unlock];

    NSLog(@"Session %d destroyed successfully", sessionId);
    return 0;
}

+ (int32_t)getMaxConcurrentSessions {
    return MAX_CONCURRENT_SESSIONS;
}

+ (void)processMainRunLoop {
    @autoreleasepool {
        // Process main run loop for a short time to handle notifications
        [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
    }
}

@end

// C wrapper for Rust FFI
void processMainRunLoop(void) {
    [avcameras processMainRunLoop];
}

int32_t requestCameraAccess(void) {
    return [avcameras requestCameraAccess];
}

void requestCameraAccessAsync(void (*callback)(int granted)) {
    [avcameras requestCameraAccessAsync:^(BOOL granted) {
        if (callback) {
            callback(granted ? 1 : 0);
        }
    }];
}

int32_t getCameraAuthorizationStatus(void) {
    return [avcameras getCameraAuthorizationStatus];
}

int32_t getVideoDeviceCount(void) {
    return [avcameras getVideoDeviceCount];
}

int32_t getVideoDeviceInfo(int32_t index, CameraDeviceInfo *info) {
    return [avcameras getVideoDeviceInfo:index deviceInfo:info];
}

int32_t getFormatCountForDevice(const char *deviceID) {
    return [avcameras getFormatCountForDevice:deviceID];
}

int32_t getFormatInfo(const char *deviceID, int32_t index, CameraFormatInfo *info) {
    return [avcameras getFormatInfo:deviceID formatIndex:index formatInfo:info];
}

int32_t createCaptureSession(const char *deviceID, int32_t formatIndex, int32_t bufferCount) {
    return [avcameras createCaptureSession:deviceID formatIndex:formatIndex bufferCount:bufferCount];
}

int32_t startCapture(int32_t sessionId) {
    return [avcameras startCapture:sessionId];
}

int32_t stopCapture(int32_t sessionId) {
    return [avcameras stopCapture:sessionId];
}

int32_t isCapturing(int32_t sessionId) {
    return [avcameras isCapturing:sessionId];
}

int32_t getNextFrame(int32_t sessionId, CameraFrameInfo *frameInfo, uint8_t *buffer, size_t bufferSize, size_t *actualSize) {
    return [avcameras getNextFrame:sessionId frameInfo:frameInfo buffer:buffer bufferSize:bufferSize actualSize:actualSize];
}

int32_t getAvailableFrameCount(int32_t sessionId) {
    return [avcameras getAvailableFrameCount:sessionId];
}

int64_t getDroppedFrameCount(int32_t sessionId) {
    return [avcameras getDroppedFrameCount:sessionId];
}

int32_t destroyCaptureSession(int32_t sessionId) {
    return [avcameras destroyCaptureSession:sessionId];
}

int32_t getMaxConcurrentSessions(void) {
    return [avcameras getMaxConcurrentSessions];
}
