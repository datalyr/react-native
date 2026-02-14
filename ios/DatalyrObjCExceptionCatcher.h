#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Catches ObjC NSExceptions (from Meta/TikTok SDKs) and converts them to NSErrors.
/// Swift's do/try/catch cannot catch NSExceptions — they propagate through Hermes
/// and cause EXC_BAD_ACCESS (SIGSEGV) crashes.
@interface DatalyrObjCExceptionCatcher : NSObject

+ (BOOL)tryBlock:(void(NS_NOESCAPE ^)(void))block error:(NSError *_Nullable *_Nullable)error;

@end

NS_ASSUME_NONNULL_END
