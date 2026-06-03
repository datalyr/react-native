// react-native-device-info mock (default export).
module.exports = {
  getModel: () => 'iPhone15', getSystemVersion: () => '17.0', getVersion: () => '1.0.0',
  getBuildNumber: () => '1', getBundleId: () => 'com.test.app',
  getCarrier: async () => '', isEmulator: async () => false,
  getManufacturerSync: () => 'Apple', getDeviceId: () => 'iPhone15,2',
};
