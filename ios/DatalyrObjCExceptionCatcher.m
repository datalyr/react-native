#import "DatalyrObjCExceptionCatcher.h"

@implementation DatalyrObjCExceptionCatcher

+ (BOOL)tryBlock:(void(NS_NOESCAPE ^)(void))block error:(NSError **)error {
    @try {
        block();
        return YES;
    }
    @catch (NSException *exception) {
        if (error) {
            NSString *description = exception.reason ?: exception.name;
            NSDictionary *userInfo = @{
                NSLocalizedDescriptionKey: description,
                @"ExceptionName": exception.name ?: @"Unknown",
            };
            if (exception.userInfo) {
                NSMutableDictionary *merged = [userInfo mutableCopy];
                [merged addEntriesFromDictionary:exception.userInfo];
                userInfo = merged;
            }
            *error = [NSError errorWithDomain:@"com.datalyr.objc-exception"
                                         code:-1
                                     userInfo:userInfo];
        }
        return NO;
    }
}

@end
