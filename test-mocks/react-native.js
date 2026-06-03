// Minimal react-native mock for jest (node).
module.exports = {
  Platform: { OS: 'ios', select: (o) => (o && (o.ios !== undefined ? o.ios : o.default)) },
  Dimensions: { get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) },
  AppState: { addEventListener: () => ({ remove: () => {} }), currentState: 'active' },
  NativeModules: {},
  Linking: { getInitialURL: async () => null, addEventListener: () => ({ remove: () => {} }) },
};
