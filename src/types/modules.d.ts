// Type declarations for modules that might not have proper TypeScript support

declare module 'react-native-device-info' {
  export interface DeviceInfo {
    deviceId: string;
    model: string;
    manufacturer: string;
    osVersion: string;
    appVersion: string;
    buildNumber: string;
    bundleId: string;
    screenWidth: number;
    screenHeight: number;
    timezone: string;
    locale: string;
    carrier?: string;
    isEmulator: boolean;
  }

  const DeviceInfo: {
    getUniqueId(): Promise<string>;
    getModel(): Promise<string>;
    getManufacturer(): Promise<string>;
    getSystemVersion(): Promise<string>;
    getVersion(): Promise<string>;
    getBuildNumber(): Promise<string>;
    getBundleId(): Promise<string>;
    getTimezone(): Promise<string>;
    getDeviceLocale(): Promise<string>;
    getCarrier(): Promise<string>;
    isEmulator(): Promise<boolean>;
    getAndroidId(): Promise<string>;
    getIosIdForVendor(): Promise<string>;
  };

  export default DeviceInfo;
}

declare module 'react-native-idfa' {
  export function getIDFA(): Promise<string>;
  export function getAdvertisingId(): Promise<string>;
}

declare module 'react-native-get-random-values' {
  // This module is imported for side effects only
}

// ---------------------------------------------------------------------------
// Optional Expo peers.
//
// `expo-application`, `expo-device` and `expo-network` are declared OPTIONAL in
// package.json `peerDependenciesMeta`, so they are deliberately not installed
// here. Without these shims `tsc` cannot resolve them, and the response to that
// used to be a `tsconfig.json` "exclude" list covering the whole Expo half of
// the package — which meant no Expo source was ever type-checked OR emitted.
// That hid a real TS2339 (`STORAGE_KEYS.LAST_IDENTITY_FINGERPRINT` missing from
// utils-expo.ts) which made the 1.7.15 identify dedupe dead code on Expo.
//
// These declare the ACTUAL surface the SDK consumes — not `any` — so a typo or
// a misused enum member still fails the build. Keep them in sync with the real
// modules when the consumed surface grows.
// ---------------------------------------------------------------------------

declare module 'expo-application' {
  export const applicationId: string | null;
  export const nativeApplicationVersion: string | null;
  export const nativeBuildVersion: string | null;
}

declare module 'expo-device' {
  export const isDevice: boolean;
  export const deviceName: string | null;
  export const modelName: string | null;
  export const manufacturer: string | null;
  export const osVersion: string | null;
}

declare module 'expo-network' {
  export enum NetworkStateType {
    NONE = 'NONE',
    UNKNOWN = 'UNKNOWN',
    CELLULAR = 'CELLULAR',
    WIFI = 'WIFI',
    BLUETOOTH = 'BLUETOOTH',
    ETHERNET = 'ETHERNET',
    WIMAX = 'WIMAX',
    VPN = 'VPN',
    OTHER = 'OTHER',
  }

  export interface NetworkState {
    type?: NetworkStateType;
    isConnected?: boolean;
    isInternetReachable?: boolean;
  }

  export function getNetworkStateAsync(): Promise<NetworkState>;
}
