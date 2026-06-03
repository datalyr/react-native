// Jest harness for the RN/Expo SDK. RN-only native modules are mocked so the REAL SDK
// source (http-client, event-queue, etc.) runs under node. (The SDK previously had no
// runtime tests — only tsc.)
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test-mocks/jest-setup.js'],  // defines RN's __DEV__ global
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/test-mocks/react-native.js',
    '^@react-native-async-storage/async-storage$': '<rootDir>/test-mocks/async-storage.js',
    '^react-native-device-info$': '<rootDir>/test-mocks/device-info.js',
    '^react-native-get-random-values$': '<rootDir>/test-mocks/empty.js',
  },
};
