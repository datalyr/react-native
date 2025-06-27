#import <React/RCTBridgeModule.h>
#import <StoreKit/StoreKit.h>

@interface DatalyrSKAdNetwork : NSObject <RCTBridgeModule>
@end

@implementation DatalyrSKAdNetwork

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(updateConversionValue:(NSInteger)value
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 14.0, *)) {
        @try {
            [SKAdNetwork updateConversionValue:value];
            resolve(@(YES));
        } @catch (NSException *exception) {
            reject(@"skadnetwork_error", exception.reason, nil);
        }
    } else {
        reject(@"ios_version_error", @"SKAdNetwork requires iOS 14.0+", nil);
    }
}

@end 