#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DatalyrNative, NSObject)

// Meta SDK Methods
RCT_EXTERN_METHOD(initializeMetaSDK:(NSString *)appId
                  clientToken:(NSString *)clientToken
                  advertiserTrackingEnabled:(BOOL)advertiserTrackingEnabled
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(fetchDeferredAppLink:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(logMetaEvent:(NSString *)eventName
                  valueToSum:(NSNumber *)valueToSum
                  parameters:(NSDictionary *)parameters
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(logMetaPurchase:(double)amount
                  currency:(NSString *)currency
                  parameters:(NSDictionary *)parameters
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setMetaUserData:(NSDictionary *)userData
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearMetaUserData:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateMetaTrackingAuthorization:(BOOL)enabled
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// TikTok SDK Methods
RCT_EXTERN_METHOD(initializeTikTokSDK:(NSString *)appId
                  tiktokAppId:(NSString *)tiktokAppId
                  accessToken:(NSString *)accessToken
                  debug:(BOOL)debug
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(trackTikTokEvent:(NSString *)eventName
                  eventId:(NSString *)eventId
                  properties:(NSDictionary *)properties
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(identifyTikTokUser:(NSString *)externalId
                  externalUserName:(NSString *)externalUserName
                  phoneNumber:(NSString *)phoneNumber
                  email:(NSString *)email
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(logoutTikTok:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateTikTokTrackingAuthorization:(BOOL)enabled
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// SDK Availability Check
RCT_EXTERN_METHOD(getSDKAvailability:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
