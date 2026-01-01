// Automatic Events Configuration
export interface AutoEventConfig {
  trackSessions?: boolean;
  trackScreenViews?: boolean;
  trackAppUpdates?: boolean;
  trackPerformance?: boolean;
  sessionTimeoutMs?: number;
}

// Meta (Facebook) SDK Configuration
export interface MetaConfig {
  appId: string;                     // Facebook App ID
  clientToken?: string;              // Client Token for advanced features
  enableDeferredDeepLink?: boolean;  // Default: true
  enableAppEvents?: boolean;         // Default: true
  advertiserTrackingEnabled?: boolean; // iOS ATT status (auto-detected if not set)
}

// TikTok SDK Configuration
export interface TikTokConfig {
  appId: string;                     // Your App ID (for Datalyr)
  tiktokAppId: string;               // TikTok App ID
  accessToken?: string;              // Access Token for Events API
  enableAppEvents?: boolean;         // Default: true
}

// Deferred Deep Link Result (from platform SDKs)
export interface DeferredDeepLinkResult {
  url?: string;
  source?: string;
  fbclid?: string;
  ttclid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
}

// Core SDK Configuration
export interface DatalyrConfig {
  apiKey: string; // Required for server-side tracking
  workspaceId?: string; // Optional for backward compatibility
  debug?: boolean;
  apiUrl?: string;
  endpoint?: string;
  useServerTracking?: boolean; // Default: true for v1.0.0
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  batchSize?: number;
  flushInterval?: number;
  maxQueueSize?: number;
  maxEventQueueSize?: number;
  respectDoNotTrack?: boolean;
  enableAutoEvents?: boolean;
  enableAttribution?: boolean;
  enableWebToAppAttribution?: boolean;
  autoEvents?: AutoEventConfig;
  autoEventConfig?: AutoEventConfig;
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
  };
  skadTemplate?: 'ecommerce' | 'gaming' | 'subscription';

  // Meta (Facebook) SDK Configuration
  meta?: MetaConfig;

  // TikTok SDK Configuration
  tiktok?: TikTokConfig;
}
// Event Types
export interface EventData {
  [key: string]: any;
  userId?: string;
  value?: number;
  currency?: string;
  screen?: string;
  app_version?: string;
  platform?: 'ios' | 'android' | 'windows' | 'macos' | 'web';
  os_version?: string;
  device_model?: string;
  app_build?: string;
  network_type?: string;
}

export interface FingerprintData {
  deviceId?: string;
  deviceInfo?: {
    model: string;
    manufacturer: string;
    osVersion: string;
    screenSize: string;
    timezone: string;
    locale?: string;
    carrier?: string;
    isEmulator?: boolean;
  };
}

export interface EventPayload {
  workspaceId: string;
  visitorId: string;
  anonymousId: string;  // Persistent anonymous identifier
  sessionId: string;
  eventId: string;
  eventName: string;
  eventData?: EventData;
  fingerprintData?: FingerprintData;
  source: 'mobile_app';
  timestamp: string;
  userId?: string;
  userProperties?: Record<string, any>;
}

// User Properties
export interface UserProperties {
  [key: string]: any;
  email?: string;
  name?: string;
  phone?: string;
  age?: number;
  gender?: string;
}

// SDK State
export interface SDKState {
  initialized: boolean;
  config: DatalyrConfig;
  visitorId: string;
  anonymousId: string;  // Persistent anonymous identifier
  sessionId: string;
  currentUserId?: string;
  userProperties: UserProperties;
  eventQueue: QueuedEvent[];
  isOnline: boolean;
}

export interface QueuedEvent {
  payload: EventPayload;
  timestamp: number;
  retryCount: number;
}

// App State - Updated for React Native 0.80
export type AppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';
export type AppStateType = AppState;

// Network State
export interface NetworkState {
  isConnected: boolean;
  type: string;
}

// Device Information
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

// Attribution Data
export interface AttributionData {
  campaign?: string;
  source?: string;
  medium?: string;
  term?: string;
  content?: string;
  clickId?: string;
  installTime?: string;
} 