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

// SKAN 4.0 / AdAttributionKit - Method for iOS 16.1+ with coarse value and lock window support
// On iOS 17.4+, this uses AdAttributionKit under the hood
RCT_EXPORT_METHOD(updatePostbackConversionValue:(NSInteger)fineValue
                  coarseValue:(NSString *)coarseValue
                  lockWindow:(BOOL)lockWindow
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // Validate fine value range
    if (fineValue < 0 || fineValue > 63) {
        reject(@"invalid_value", @"Conversion value must be between 0 and 63", nil);
        return;
    }

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
                // Return framework info along with success
                NSString *framework = @"SKAdNetwork";
                if (@available(iOS 17.4, *)) {
                    framework = @"AdAttributionKit";
                }
                resolve(@{
                    @"success": @(YES),
                    @"framework": framework,
                    @"fineValue": @(fineValue),
                    @"coarseValue": coarseValue,
                    @"lockWindow": @(lockWindow)
                });
            }
        }];
    } else if (@available(iOS 14.0, *)) {
        // Fallback to SKAN 3.0 for iOS 14.0-16.0
        @try {
            [SKAdNetwork updateConversionValue:fineValue];
            resolve(@{
                @"success": @(YES),
                @"framework": @"SKAdNetwork",
                @"fineValue": @(fineValue),
                @"coarseValue": @"n/a",
                @"lockWindow": @(NO)
            });
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

// Check if AdAttributionKit is available (iOS 17.4+)
RCT_EXPORT_METHOD(isAdAttributionKitAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 17.4, *)) {
        resolve(@(YES));
    } else {
        resolve(@(NO));
    }
}

// Check if overlapping windows are available (iOS 18.4+)
RCT_EXPORT_METHOD(isOverlappingWindowsAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 18.4, *)) {
        resolve(@(YES));
    } else {
        resolve(@(NO));
    }
}

// Register for ad network attribution (supports both AdAttributionKit and SKAdNetwork)
RCT_EXPORT_METHOD(registerForAttribution:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 17.4, *)) {
        // AdAttributionKit registration via initial conversion value update
        [SKAdNetwork updatePostbackConversionValue:0
                                       coarseValue:SKAdNetworkCoarseConversionValueLow
                                        lockWindow:NO
                                 completionHandler:^(NSError * _Nullable error) {
            if (error) {
                reject(@"attribution_error", error.localizedDescription, error);
            } else {
                resolve(@{@"framework": @"AdAttributionKit", @"registered": @(YES)});
            }
        }];
    } else if (@available(iOS 14.0, *)) {
        // Legacy SKAdNetwork registration
        [SKAdNetwork registerAppForAdNetworkAttribution];
        resolve(@{@"framework": @"SKAdNetwork", @"registered": @(YES)});
    } else {
        reject(@"ios_version_error", @"Attribution requires iOS 14.0+", nil);
    }
}

// Get attribution framework info
RCT_EXPORT_METHOD(getAttributionInfo:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    NSMutableDictionary *info = [NSMutableDictionary dictionary];

    if (@available(iOS 17.4, *)) {
        info[@"framework"] = @"AdAttributionKit";
        info[@"version"] = @"1.0";
        info[@"reengagement_available"] = @(YES);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @63};
        info[@"coarse_values"] = @[@"low", @"medium", @"high"];
        if (@available(iOS 18.4, *)) {
            info[@"overlapping_windows"] = @(YES);
        } else {
            info[@"overlapping_windows"] = @(NO);
        }
    } else if (@available(iOS 16.1, *)) {
        info[@"framework"] = @"SKAdNetwork";
        info[@"version"] = @"4.0";
        info[@"reengagement_available"] = @(NO);
        info[@"overlapping_windows"] = @(NO);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @63};
        info[@"coarse_values"] = @[@"low", @"medium", @"high"];
    } else if (@available(iOS 14.0, *)) {
        info[@"framework"] = @"SKAdNetwork";
        info[@"version"] = @"3.0";
        info[@"reengagement_available"] = @(NO);
        info[@"overlapping_windows"] = @(NO);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @63};
        info[@"coarse_values"] = @[];
    } else {
        info[@"framework"] = @"none";
        info[@"version"] = @"0";
        info[@"reengagement_available"] = @(NO);
        info[@"overlapping_windows"] = @(NO);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @0};
        info[@"coarse_values"] = @[];
    }

    resolve(info);
}

// Update conversion value for re-engagement (AdAttributionKit iOS 17.4+ only)
// Re-engagement tracks users who return to the app via an ad after initial install
RCT_EXPORT_METHOD(updateReengagementConversionValue:(NSInteger)fineValue
                  coarseValue:(NSString *)coarseValue
                  lockWindow:(BOOL)lockWindow
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 17.4, *)) {
        // Validate fine value range
        if (fineValue < 0 || fineValue > 63) {
            reject(@"invalid_value", @"Conversion value must be between 0 and 63", nil);
            return;
        }

        // Convert string to SKAdNetwork.CoarseConversionValue
        SKAdNetworkCoarseConversionValue coarse;
        if ([coarseValue isEqualToString:@"high"]) {
            coarse = SKAdNetworkCoarseConversionValueHigh;
        } else if ([coarseValue isEqualToString:@"medium"]) {
            coarse = SKAdNetworkCoarseConversionValueMedium;
        } else {
            coarse = SKAdNetworkCoarseConversionValueLow;
        }

        // In AdAttributionKit, re-engagement uses the same API
        // The framework distinguishes based on user attribution state
        [SKAdNetwork updatePostbackConversionValue:fineValue
                                       coarseValue:coarse
                                        lockWindow:lockWindow
                                 completionHandler:^(NSError * _Nullable error) {
            if (error) {
                reject(@"reengagement_error", error.localizedDescription, error);
            } else {
                resolve(@{
                    @"success": @(YES),
                    @"type": @"reengagement",
                    @"framework": @"AdAttributionKit",
                    @"fineValue": @(fineValue),
                    @"coarseValue": coarseValue,
                    @"lockWindow": @(lockWindow)
                });
            }
        }];
    } else {
        reject(@"unsupported", @"Re-engagement attribution requires iOS 17.4+ (AdAttributionKit)", nil);
    }
}

// iOS 18.4+ - Check if geo-level postback data is available
RCT_EXPORT_METHOD(isGeoPostbackAvailable:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 18.4, *)) {
        resolve(@(YES));
    } else {
        resolve(@(NO));
    }
}

// iOS 18.4+ - Set postback environment for testing
// environment: "production" or "sandbox"
RCT_EXPORT_METHOD(setPostbackEnvironment:(NSString *)environment
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    if (@available(iOS 18.4, *)) {
        // Note: In iOS 18.4+, development postbacks are controlled via
        // the developer mode setting in device settings, not programmatically.
        // This method validates the environment string and logs for debugging.
        BOOL isSandbox = [environment isEqualToString:@"sandbox"];
        NSLog(@"[Datalyr] Postback environment set to: %@ (note: actual sandbox mode is controlled via device Developer Mode)", environment);
        resolve(@{
            @"environment": environment,
            @"isSandbox": @(isSandbox),
            @"note": @"Enable Developer Mode in iOS Settings for sandbox postbacks"
        });
    } else {
        reject(@"unsupported", @"Development postbacks require iOS 18.4+", nil);
    }
}

// iOS 18.4+ - Get enhanced attribution info including geo availability
RCT_EXPORT_METHOD(getEnhancedAttributionInfo:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    NSMutableDictionary *info = [NSMutableDictionary dictionary];

    if (@available(iOS 18.4, *)) {
        info[@"framework"] = @"AdAttributionKit";
        info[@"version"] = @"2.0";
        info[@"reengagement_available"] = @(YES);
        info[@"overlapping_windows"] = @(YES);
        info[@"geo_postback_available"] = @(YES);
        info[@"development_postbacks"] = @(YES);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @63};
        info[@"coarse_values"] = @[@"low", @"medium", @"high"];
        info[@"features"] = @[
            @"overlapping_windows",
            @"geo_level_postbacks",
            @"development_postbacks",
            @"reengagement"
        ];
    } else if (@available(iOS 17.4, *)) {
        info[@"framework"] = @"AdAttributionKit";
        info[@"version"] = @"1.0";
        info[@"reengagement_available"] = @(YES);
        info[@"overlapping_windows"] = @(NO);
        info[@"geo_postback_available"] = @(NO);
        info[@"development_postbacks"] = @(NO);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @63};
        info[@"coarse_values"] = @[@"low", @"medium", @"high"];
        info[@"features"] = @[@"reengagement"];
    } else if (@available(iOS 16.1, *)) {
        info[@"framework"] = @"SKAdNetwork";
        info[@"version"] = @"4.0";
        info[@"reengagement_available"] = @(NO);
        info[@"overlapping_windows"] = @(NO);
        info[@"geo_postback_available"] = @(NO);
        info[@"development_postbacks"] = @(NO);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @63};
        info[@"coarse_values"] = @[@"low", @"medium", @"high"];
        info[@"features"] = @[];
    } else if (@available(iOS 14.0, *)) {
        info[@"framework"] = @"SKAdNetwork";
        info[@"version"] = @"3.0";
        info[@"reengagement_available"] = @(NO);
        info[@"overlapping_windows"] = @(NO);
        info[@"geo_postback_available"] = @(NO);
        info[@"development_postbacks"] = @(NO);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @63};
        info[@"coarse_values"] = @[];
        info[@"features"] = @[];
    } else {
        info[@"framework"] = @"none";
        info[@"version"] = @"0";
        info[@"reengagement_available"] = @(NO);
        info[@"overlapping_windows"] = @(NO);
        info[@"geo_postback_available"] = @(NO);
        info[@"development_postbacks"] = @(NO);
        info[@"fine_value_range"] = @{@"min": @0, @"max": @0};
        info[@"coarse_values"] = @[];
        info[@"features"] = @[];
    }

    resolve(info);
}

// iOS 18.4+ - Update postback with overlapping window support
// windowIndex: 0 = first window (0-2 days), 1 = second window (3-7 days), 2 = third window (8-35 days)
RCT_EXPORT_METHOD(updatePostbackWithWindow:(NSInteger)fineValue
                  coarseValue:(NSString *)coarseValue
                  lockWindow:(BOOL)lockWindow
                  windowIndex:(NSInteger)windowIndex
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // Validate fine value range
    if (fineValue < 0 || fineValue > 63) {
        reject(@"invalid_value", @"Conversion value must be between 0 and 63", nil);
        return;
    }

    // Validate window index
    if (windowIndex < 0 || windowIndex > 2) {
        reject(@"invalid_window", @"Window index must be 0, 1, or 2", nil);
        return;
    }

    if (@available(iOS 18.4, *)) {
        // Convert string to SKAdNetwork.CoarseConversionValue
        SKAdNetworkCoarseConversionValue coarse;
        if ([coarseValue isEqualToString:@"high"]) {
            coarse = SKAdNetworkCoarseConversionValueHigh;
        } else if ([coarseValue isEqualToString:@"medium"]) {
            coarse = SKAdNetworkCoarseConversionValueMedium;
        } else {
            coarse = SKAdNetworkCoarseConversionValueLow;
        }

        // iOS 18.4 uses the same API but handles overlapping windows automatically
        // based on timing. The windowIndex is for SDK tracking purposes.
        [SKAdNetwork updatePostbackConversionValue:fineValue
                                       coarseValue:coarse
                                        lockWindow:lockWindow
                                 completionHandler:^(NSError * _Nullable error) {
            if (error) {
                reject(@"postback_error", error.localizedDescription, error);
            } else {
                resolve(@{
                    @"success": @(YES),
                    @"framework": @"AdAttributionKit",
                    @"version": @"2.0",
                    @"fineValue": @(fineValue),
                    @"coarseValue": coarseValue,
                    @"lockWindow": @(lockWindow),
                    @"windowIndex": @(windowIndex),
                    @"overlappingWindows": @(YES)
                });
            }
        }];
    } else if (@available(iOS 16.1, *)) {
        // Fallback for iOS 16.1-18.3 (no overlapping windows)
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
                reject(@"postback_error", error.localizedDescription, error);
            } else {
                NSString *framework = @"SKAdNetwork";
                NSString *version = @"4.0";
                if (@available(iOS 17.4, *)) {
                    framework = @"AdAttributionKit";
                    version = @"1.0";
                }
                resolve(@{
                    @"success": @(YES),
                    @"framework": framework,
                    @"version": version,
                    @"fineValue": @(fineValue),
                    @"coarseValue": coarseValue,
                    @"lockWindow": @(lockWindow),
                    @"windowIndex": @(windowIndex),
                    @"overlappingWindows": @(NO),
                    @"note": @"Overlapping windows require iOS 18.4+"
                });
            }
        }];
    } else {
        reject(@"unsupported", @"This method requires iOS 16.1+", nil);
    }
}

@end