/**
 * Journey Tracking Module for React Native
 * Mirrors the Web SDK's journey tracking capabilities:
 * - First-touch attribution with 90-day expiration
 * - Last-touch attribution with 90-day expiration
 * - Up to 30 touchpoints stored
 */

import { Storage, debugLog, errorLog } from './utils';

// Storage keys for journey data
const JOURNEY_STORAGE_KEYS = {
  FIRST_TOUCH: '@datalyr/first_touch',
  LAST_TOUCH: '@datalyr/last_touch',
  JOURNEY: '@datalyr/journey',
};

// 90-day attribution window (matching web SDK)
const ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// Maximum touchpoints to store
const MAX_TOUCHPOINTS = 30;

/**
 * Attribution data for a touch
 */
export interface TouchAttribution {
  timestamp: number;
  expires_at: number;
  captured_at: number;

  // Source attribution
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;

  // Click IDs
  clickId?: string;
  clickIdType?: string;
  fbclid?: string;
  gclid?: string;
  ttclid?: string;
  gbraid?: string;
  wbraid?: string;

  // LYR tag
  lyr?: string;

  // Context
  landingPage?: string;
  referrer?: string;
}

/**
 * A single touchpoint in the customer journey
 */
export interface TouchPoint {
  timestamp: number;
  sessionId: string;
  source?: string;
  medium?: string;
  campaign?: string;
  clickIdType?: string;
}

/**
 * Journey manager for tracking customer touchpoints
 */
export class JourneyManager {
  private firstTouch: TouchAttribution | null = null;
  private lastTouch: TouchAttribution | null = null;
  private journey: TouchPoint[] = [];
  private initialized = false;

  /**
   * Initialize journey tracking by loading persisted data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      debugLog('Initializing journey manager...');

      // Load first touch
      const savedFirstTouch = await Storage.getItem<TouchAttribution>(JOURNEY_STORAGE_KEYS.FIRST_TOUCH);
      if (savedFirstTouch && !this.isExpired(savedFirstTouch)) {
        this.firstTouch = savedFirstTouch;
      } else if (savedFirstTouch) {
        // Expired, clear it
        await Storage.removeItem(JOURNEY_STORAGE_KEYS.FIRST_TOUCH);
      }

      // Load last touch
      const savedLastTouch = await Storage.getItem<TouchAttribution>(JOURNEY_STORAGE_KEYS.LAST_TOUCH);
      if (savedLastTouch && !this.isExpired(savedLastTouch)) {
        this.lastTouch = savedLastTouch;
      } else if (savedLastTouch) {
        await Storage.removeItem(JOURNEY_STORAGE_KEYS.LAST_TOUCH);
      }

      // Load journey
      const savedJourney = await Storage.getItem<TouchPoint[]>(JOURNEY_STORAGE_KEYS.JOURNEY);
      if (savedJourney) {
        this.journey = savedJourney;
      }

      this.initialized = true;
      debugLog('Journey manager initialized', {
        hasFirstTouch: !!this.firstTouch,
        hasLastTouch: !!this.lastTouch,
        touchpointCount: this.journey.length,
      });
    } catch (error) {
      errorLog('Failed to initialize journey manager:', error as Error);
    }
  }

  /**
   * Check if attribution has expired
   */
  private isExpired(attribution: TouchAttribution): boolean {
    return Date.now() >= attribution.expires_at;
  }

  /**
   * Store first touch attribution (only if not already set or expired)
   */
  async storeFirstTouch(attribution: Partial<TouchAttribution>): Promise<void> {
    try {
      // Only store if no valid first touch exists
      if (this.firstTouch && !this.isExpired(this.firstTouch)) {
        debugLog('First touch already exists, not overwriting');
        return;
      }

      const now = Date.now();
      this.firstTouch = {
        ...attribution,
        timestamp: attribution.timestamp || now,
        captured_at: now,
        expires_at: now + ATTRIBUTION_WINDOW_MS,
      } as TouchAttribution;

      await Storage.setItem(JOURNEY_STORAGE_KEYS.FIRST_TOUCH, this.firstTouch);
      debugLog('First touch stored:', this.firstTouch);
    } catch (error) {
      errorLog('Failed to store first touch:', error as Error);
    }
  }

  /**
   * Get first touch attribution (null if expired)
   */
  getFirstTouch(): TouchAttribution | null {
    if (this.firstTouch && this.isExpired(this.firstTouch)) {
      this.firstTouch = null;
      Storage.removeItem(JOURNEY_STORAGE_KEYS.FIRST_TOUCH).catch(() => {});
    }
    return this.firstTouch;
  }

  /**
   * Store last touch attribution (always updates)
   */
  async storeLastTouch(attribution: Partial<TouchAttribution>): Promise<void> {
    try {
      const now = Date.now();
      this.lastTouch = {
        ...attribution,
        timestamp: attribution.timestamp || now,
        captured_at: now,
        expires_at: now + ATTRIBUTION_WINDOW_MS,
      } as TouchAttribution;

      await Storage.setItem(JOURNEY_STORAGE_KEYS.LAST_TOUCH, this.lastTouch);
      debugLog('Last touch stored:', this.lastTouch);
    } catch (error) {
      errorLog('Failed to store last touch:', error as Error);
    }
  }

  /**
   * Get last touch attribution (null if expired)
   */
  getLastTouch(): TouchAttribution | null {
    if (this.lastTouch && this.isExpired(this.lastTouch)) {
      this.lastTouch = null;
      Storage.removeItem(JOURNEY_STORAGE_KEYS.LAST_TOUCH).catch(() => {});
    }
    return this.lastTouch;
  }

  /**
   * Add a touchpoint to the customer journey
   */
  async addTouchpoint(sessionId: string, attribution: Partial<TouchAttribution>): Promise<void> {
    try {
      const touchpoint: TouchPoint = {
        timestamp: Date.now(),
        sessionId,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
        clickIdType: attribution.clickIdType,
      };

      this.journey.push(touchpoint);

      // Keep only last MAX_TOUCHPOINTS
      if (this.journey.length > MAX_TOUCHPOINTS) {
        this.journey = this.journey.slice(-MAX_TOUCHPOINTS);
      }

      await Storage.setItem(JOURNEY_STORAGE_KEYS.JOURNEY, this.journey);
      debugLog('Touchpoint added, total:', this.journey.length);
    } catch (error) {
      errorLog('Failed to add touchpoint:', error as Error);
    }
  }

  /**
   * Get customer journey (all touchpoints)
   */
  getJourney(): TouchPoint[] {
    return [...this.journey];
  }

  /**
   * Record attribution from a deep link or install
   * Updates first-touch (if not set), last-touch, and adds touchpoint
   */
  async recordAttribution(sessionId: string, attribution: Partial<TouchAttribution>): Promise<void> {
    // Only process if we have meaningful attribution data
    const hasAttribution = attribution.source || attribution.clickId || attribution.campaign || attribution.lyr;

    if (!hasAttribution) {
      debugLog('No attribution data to record');
      return;
    }

    // Store first touch if not set
    if (!this.getFirstTouch()) {
      await this.storeFirstTouch(attribution);
    }

    // Always update last touch
    await this.storeLastTouch(attribution);

    // Add touchpoint
    await this.addTouchpoint(sessionId, attribution);
  }

  /**
   * Get attribution data for events (mirrors Web SDK format)
   */
  getAttributionData(): Record<string, any> {
    const firstTouch = this.getFirstTouch();
    const lastTouch = this.getLastTouch();
    const journey = this.getJourney();

    return {
      // First touch (with snake_case and camelCase aliases)
      first_touch_source: firstTouch?.source,
      first_touch_medium: firstTouch?.medium,
      first_touch_campaign: firstTouch?.campaign,
      first_touch_timestamp: firstTouch?.timestamp,
      firstTouchSource: firstTouch?.source,
      firstTouchMedium: firstTouch?.medium,
      firstTouchCampaign: firstTouch?.campaign,

      // Last touch
      last_touch_source: lastTouch?.source,
      last_touch_medium: lastTouch?.medium,
      last_touch_campaign: lastTouch?.campaign,
      last_touch_timestamp: lastTouch?.timestamp,
      lastTouchSource: lastTouch?.source,
      lastTouchMedium: lastTouch?.medium,
      lastTouchCampaign: lastTouch?.campaign,

      // Journey metrics
      touchpoint_count: journey.length,
      touchpointCount: journey.length,
      days_since_first_touch: firstTouch?.timestamp
        ? Math.floor((Date.now() - firstTouch.timestamp) / 86400000)
        : 0,
      daysSinceFirstTouch: firstTouch?.timestamp
        ? Math.floor((Date.now() - firstTouch.timestamp) / 86400000)
        : 0,
    };
  }

  /**
   * Clear all journey data (for testing/reset)
   */
  async clearJourney(): Promise<void> {
    this.firstTouch = null;
    this.lastTouch = null;
    this.journey = [];

    await Promise.all([
      Storage.removeItem(JOURNEY_STORAGE_KEYS.FIRST_TOUCH),
      Storage.removeItem(JOURNEY_STORAGE_KEYS.LAST_TOUCH),
      Storage.removeItem(JOURNEY_STORAGE_KEYS.JOURNEY),
    ]);

    debugLog('Journey data cleared');
  }

  /**
   * Get journey summary for debugging
   */
  getJourneySummary(): {
    hasFirstTouch: boolean;
    hasLastTouch: boolean;
    touchpointCount: number;
    daysSinceFirstTouch: number;
    sources: string[];
  } {
    const firstTouch = this.getFirstTouch();
    const journey = this.getJourney();
    const sources = [...new Set(journey.map(t => t.source).filter(Boolean))] as string[];

    return {
      hasFirstTouch: !!firstTouch,
      hasLastTouch: !!this.getLastTouch(),
      touchpointCount: journey.length,
      daysSinceFirstTouch: firstTouch?.timestamp
        ? Math.floor((Date.now() - firstTouch.timestamp) / 86400000)
        : 0,
      sources,
    };
  }
}

// Export singleton instance
export const journeyManager = new JourneyManager();
