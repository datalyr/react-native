/**
 * The SDK's debug-logging switch, shared by the bare and Expo builds and the native
 * bridges. Debug logs print in a development build (__DEV__) or when the app passed
 * `debug: true` to initialize(). Kept free of imports so any module can use it.
 */
let debugLoggingEnabled = false;

export const setDebugLogging = (enabled: boolean): void => {
  debugLoggingEnabled = enabled;
};

export const isDebugLogging = (): boolean => __DEV__ || debugLoggingEnabled;

/** console.log, only when debug logging is on. */
export const sdkDebugLog = (message: string, ...args: any[]): void => {
  if (isDebugLogging()) {
    console.log(message, ...args);
  }
};
