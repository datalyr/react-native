#import <React/RCTBridgeModule.h>
#import <StoreKit/StoreKit.h>

@interface DatalyrSKAdNetwork : NSObject <RCTBridgeModule>
@end

@implementation DatalyrSKAdNetwork

RCT_EXPORT_MODULE();

// SKAN 3.0 - Legacy method for iOS 14.0-16.0
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

// SKAN 4.0 - New method for iOS 16.1+ with coarse value and lock window support
RCT_EXPORT_METHOD(updatePostbackConversionValue:(NSInteger)fineValue
                  coarseValue:(NSString *)coarseValue
                  lockWindow:(BOOL)lockWindow
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 16.1, *)) {
        // Convert string to SKAdNetwork.CoarseConversionValue
        SKAdNetworkCoarseConversionValue coarse;
        if ([coarseValue isEqualToString:@"high"]) {
            coarse = SKAdNetworkCoarseConversionValueHigh;
        } else if ([coarseValue isEqualToString:@"medium"]) {
            coarse = SKAdNetworkCoarseConversionValueMedium;
        } else {
            coarse = SKAdNetworkCoarseConversionValueLow;
        }

        [SKAdNetwork updatePostbackConversionValue:fineValue
                                       coarseValue:coarse
                                        lockWindow:lockWindow
                                 completionHandler:^(NSError * _Nullable error) {
            if (error) {
                reject(@"skadnetwork_error", error.localizedDescription, error);
            } else {
                resolve(@(YES));
            }
        }];
    } else if (@available(iOS 14.0, *)) {
        // Fallback to SKAN 3.0 for iOS 14.0-16.0
        @try {
            [SKAdNetwork updateConversionValue:fineValue];
            resolve(@(YES));
        } @catch (NSException *exception) {
            reject(@"skadnetwork_error", exception.reason, nil);
        }
    } else {
        reject(@"ios_version_error", @"SKAdNetwork requires iOS 14.0+", nil);
    }
}

// Check if SKAN 4.0 is available (iOS 16.1+)
RCT_EXPORT_METHOD(isSKAN4Available:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 16.1, *)) {
        resolve(@(YES));
    } else {
        resolve(@(NO));
    }
}

@end