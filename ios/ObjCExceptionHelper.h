#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ObjCExceptionHelper : NSObject

+ (nullable NSError *)execute:(void (NS_NOESCAPE ^)(void))block;

@end

NS_ASSUME_NONNULL_END
