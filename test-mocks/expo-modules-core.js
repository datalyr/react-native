// requireNativeModule throws so the SDK's bridges fall to their null/NativeModules path —
// i.e. the "no native modules" runtime (Expo Go / no dev build).
module.exports = {
  requireNativeModule: () => { throw new Error('native module unavailable (test)'); },
  requireOptionalNativeModule: () => null,
  NativeModule: class {},
  EventEmitter: class { addListener() { return { remove() {} }; } removeAllListeners() {} },
};
