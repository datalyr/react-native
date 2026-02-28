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

/**
 * Core SDK Configuration
 *
 * @example
 * ```typescript
 * await Datalyr.initialize({
 *   apiKey: 'dk_your_api_key',
 *   debug: true,
 *   enableAutoEvents: true,
 *   enableAttribution: true,
 *   skadTemplate: 'ecommerce',
 *   meta: { appId: 'FB_APP_ID' },
 *   tiktok: { appId: 'APP_ID', tiktokAppId: 'TIKTOK_APP_ID' },
 * });
 * ```
 */
export interface DatalyrConfig {
  /** Required: API key from Datalyr dashboard (starts with 'dk_') */
  apiKey: string;

  /** Optional: Workspace ID for multi-workspace setups */
  workspaceId?: string;

  /** Enable console logging for debugging. Default: false */
  debug?: boolean;

  /**
   * API endpoint URL. Default: 'https://api.datalyr.com'
   * @deprecated Use `endpoint` instead
   */
  apiUrl?: string;

  /** API endpoint URL. Default: 'https://api.datalyr.com' */
  endpoint?: string;

  /** Use server-side tracking. Default: true */
  useServerTracking?: boolean;

  /** Maximum retry attempts for failed requests. Default: 3 */
  maxRetries?: number;

  /** Delay between retries in milliseconds. Default: 1000 */
  retryDelay?: number;

  /** Request timeout in milliseconds. Default: 15000 */
  timeout?: number;

  /** Number of events per batch. Default: 10 */
  batchSize?: number;

  /** Interval between automatic flushes in milliseconds. Default: 30000 */
  flushInterval?: number;

  /** Maximum events to store in queue. Default: 100 */
  maxQueueSize?: number;

  /**
   * Maximum events to store in queue. Default: 100
   * @deprecated Use `maxQueueSize` instead
   */
  maxEventQueueSize?: number;

  /** Respect browser Do Not Track setting. Default: true */
  respectDoNotTrack?: boolean;

  /** Enable automatic event tracking (sessions, app lifecycle). Default: true */
  enableAutoEvents?: boolean;

  /** Enable attribution tracking (deep links, install referrer). Default: true */
  enableAttribution?: boolean;

  /** Enable web-to-app attribution matching via email. Default: true */
  enableWebToAppAttribution?: boolean;

  /**
   * Auto-events configuration
   * @deprecated Use `autoEventConfig` instead
   */
  autoEvents?: AutoEventConfig;

  /** Auto-events configuration */
  autoEventConfig?: AutoEventConfig;

  /**
   * Retry configuration
   * @deprecated Use `maxRetries` and `retryDelay` instead
   */
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
  };

  /** SKAdNetwork template for automatic conversion value encoding (iOS only) */
  skadTemplate?: 'ecommerce' | 'gaming' | 'subscription';

  /** Meta (Facebook) SDK Configuration */
  meta?: MetaConfig;

  /** TikTok SDK Configuration */
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