#import "ObjCExceptionHelper.h"

@implementation ObjCExceptionHelper

+ (BOOL)tryBlock:(void (NS_NOESCAPE ^)(void))block error:(NSError **)error {
    @try {
        block();
        return YES;
    } @catch (NSException *exception) {
        if (error) {
            NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
            userInfo[NSLocalizedDescriptionKey] = exception.reason ?: @"Unknown NSException";
            userInfo[@"ExceptionName"] = exception.name;
            if (exception.userInfo) {
                userInfo[@"ExceptionUserInfo"] = exception.userInfo;
            }
            *error = [NSError errorWithDomain:@"com.datalyr.exception"
                                         code:-1
                                     userInfo:userInfo];
        }
        return NO;
    }
}

@end
