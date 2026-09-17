#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>

@interface CameraObserver : NSObject
@end

@implementation CameraObserver

- (instancetype)init {
    self = [super init];
    if (self) {
        NSLog(@"=== Registering for device notifications ===");

        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(deviceConnected:)
                                                     name:AVCaptureDeviceWasConnectedNotification
                                                   object:nil];

        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(deviceDisconnected:)
                                                     name:AVCaptureDeviceWasDisconnectedNotification
                                                   object:nil];

        NSLog(@"=== Notification registration complete ===");
    }
    return self;
}

- (void)deviceConnected:(NSNotification *)notification {
    NSLog(@"!!! DEVICE CONNECTED NOTIFICATION FIRED !!!");
    AVCaptureDevice *device = notification.object;
    if (device) {
        NSLog(@"Device: %@ (%@)", device.localizedName, device.uniqueID);
    } else {
        NSLog(@"Device is nil in notification");
    }
}

- (void)deviceDisconnected:(NSNotification *)notification {
    NSLog(@"!!! DEVICE DISCONNECTED NOTIFICATION FIRED !!!");
    AVCaptureDevice *device = notification.object;
    if (device) {
        NSLog(@"Device: %@ (%@)", device.localizedName, device.uniqueID);
    } else {
        NSLog(@"Device is nil in notification");
    }
}

- (void)listCurrentDevices {
    NSLog(@"=== Current devices ===");

    NSMutableArray<AVCaptureDeviceType> *deviceTypes = [NSMutableArray array];
    if (@available(macOS 14.0, *)) {
        [deviceTypes addObject:AVCaptureDeviceTypeExternal];
    } else {
        [deviceTypes addObject:AVCaptureDeviceTypeExternalUnknown];
    }
    if (@available(macOS 13.0, *)) {
        [deviceTypes addObject:AVCaptureDeviceTypeContinuityCamera];
    }

    AVCaptureDeviceDiscoverySession *session = [AVCaptureDeviceDiscoverySession
        discoverySessionWithDeviceTypes:deviceTypes
        mediaType:AVMediaTypeVideo
        position:AVCaptureDevicePositionUnspecified];

    if (session.devices.count == 0) {
        NSLog(@"No devices found");
    } else {
        for (AVCaptureDevice *device in session.devices) {
            NSLog(@"  - %@ (%@) connected=%d suspended=%d",
                  device.localizedName,
                  device.uniqueID,
                  device.isConnected,
                  device.isSuspended);
        }
    }
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [super dealloc];
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSLog(@"=== AVFoundation Notification Test ===");
        NSLog(@"Thread: %@", [NSThread currentThread]);
        NSLog(@"Has run loop: %@", [NSRunLoop currentRunLoop] ? @"YES" : @"NO");

        CameraObserver *observer = [[CameraObserver alloc] init];

        // List current devices
        [observer listCurrentDevices];

        NSLog(@"\n=== Waiting for device connect/disconnect events ===");
        NSLog(@"Plug or unplug a USB camera and watch for notifications...");
        NSLog(@"Press Ctrl+C to exit\n");

        // Run the run loop in a loop (like our library code)
        NSLog(@"Using runUntilDate loop (library approach)...");
        while (YES) {
            @autoreleasepool {
                [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.0]];
            }
        }

        [observer release];
    }
    return 0;
}
