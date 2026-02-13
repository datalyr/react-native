#import "ObjCExceptionHelper.h"

@implementation ObjCExceptionHelper

+ (nullable NSError *)execute:(void (NS_NOESCAPE ^)(void))block {
    @try {
        block();
        return nil;
    } @catch (NSException *exception) {
        NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
        userInfo[NSLocalizedDescriptionKey] = exception.reason ?: @"Unknown NSException";
        userInfo[@"ExceptionName"] = exception.name;
        if (exception.userInfo) {
            userInfo[@"ExceptionUserInfo"] = exception.userInfo;
        }
        return [NSError errorWithDomain:@"com.datalyr.exception"
                                   code:-1
                               userInfo:userInfo];
    }
}

@end
