import { debugLog, errorLog, Storage } from './utils';

interface AutoEventConfig {
  trackSessions: boolean;
  trackScreenViews: boolean;
  trackAppUpdates: boolean;
  trackPerformance: boolean;
  sessionTimeoutMs: number;
}

export interface SessionData {
  sessionId: string;
  startTime: number;
  lastActivity: number;
  screenViews: number;
  events: number;
}

export class AutoEventsManager {
  private config: AutoEventConfig;
  private currentSession: SessionData | null = null;
  private lastScreenName: string | null = null;
  // Event tracking callback
  private trackEvent: (eventName: string, properties: Record<string, any>) => Promise<void>;
  // Returns the canonical wire session id (state.sessionId from getOrCreateSessionId), so
  // session_start/session_end's session_id MATCHES every event's context.session_id and the
  // two are joinable. Without it, auto-events emitted a separate `sess_...` id no event carried.
  private getSessionId?: () => string;

  constructor(
    trackEvent: (eventName: string, properties: Record<string, any>) => Promise<void>,
    config: Partial<AutoEventConfig> = {},
    getSessionId?: () => string
  ) {
    this.trackEvent = trackEvent;
    this.getSessionId = getSessionId;
    this.config = {
      trackSessions: true,
      trackScreenViews: true,
      trackAppUpdates: true,
      trackPerformance: true,
      sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
      ...config,
    };
  }

  /** Canonical session id — the wire context.session_id when a getter is wired. */
  private resolveSessionId(): string {
    const fromSdk = this.getSessionId?.();
    if (fromSdk) return fromSdk;
    // Fallback (no getter wired): keep the legacy self-generated id so nothing crashes.
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize automatic event tracking
   */
  async initialize(): Promise<void> {
    try {
      debugLog('Initializing automatic events manager...');

      // Start session tracking
      if (this.config.trackSessions) {
        // Fire session_start ONLY when the canonical session id is genuinely NEW. On a cold
        // start within 30 min of the last launch, getOrCreateSessionId() RESUMES the prior
        // context session — emitting session_start there inflated session counts and fired
        // multiple session_starts inside one context session.
        const canonicalId = this.resolveSessionId();
        const stored = await Storage.getItem<SessionData>('@datalyr/current_session');
        if (stored && stored.sessionId === canonicalId) {
          // Resume the existing session (no session_start event).
          this.currentSession = { ...stored, lastActivity: Date.now() };
          await Storage.setItem('@datalyr/current_session', this.currentSession);
          debugLog('Session resumed (context session unchanged):', canonicalId);
        } else {
          await this.startSession();
        }
        this.setupSessionMonitoring();
      }

      // Auto events: session_start, session_end only
      // app_install is tracked by the SDK directly, not via AutoEventsManager

      debugLog('Automatic events manager initialized');

    } catch (error) {
      errorLog('Failed to initialize automatic events manager:', error as Error);
    }
  }

  /**
   * Start a new session
   */
  private async startSession(): Promise<void> {
    try {
      // Use the canonical wire session id so session_start/end join to the session's events.
      const sessionId = this.resolveSessionId();
      const now = Date.now();

      this.currentSession = {
        sessionId,
        startTime: now,
        lastActivity: now,
        screenViews: 0,
        events: 0,
      };

      // Save session to storage
      await Storage.setItem('@datalyr/current_session', this.currentSession);

      // Track session start event
      await this.trackEvent('session_start', {
        session_id: sessionId,
        timestamp: now,
      });

      debugLog('Session started:', sessionId);

    } catch (error) {
      errorLog('Error starting session:', error as Error);
    }
  }

  /**
   * End current session
   */
  private async endSession(): Promise<void> {
    try {
      if (!this.currentSession) return;

      // Duration is measured to LAST ACTIVITY, not "now" (the foreground-return moment) —
      // endSession() is reached after the 30-min timeout when the user comes back, so
      // `now` would include the entire background gap (e.g. a 2-min session that resumes
      // the next day reported ~24h). Stamp the session_end timestamp from lastActivity too.
      const endTime = this.currentSession.lastActivity;
      const duration = Math.max(0, endTime - this.currentSession.startTime);

      // Track session end event
      await this.trackEvent('session_end', {
        session_id: this.currentSession.sessionId,
        duration_ms: duration,
        duration_seconds: Math.round(duration / 1000),
        pageviews: this.currentSession.screenViews,
        events: this.currentSession.events,
        timestamp: endTime,
      });

      debugLog('Session ended:', {
        sessionId: this.currentSession.sessionId,
        duration: duration / 1000,
        screenViews: this.currentSession.screenViews,
      });

      this.currentSession = null;
      await Storage.removeItem('@datalyr/current_session');

    } catch (error) {
      errorLog('Error ending session:', error as Error);
    }
  }

  /**
   * Setup session monitoring (app state changes)
   * In a real implementation, this would use React Native's AppState
   */
  private setupSessionMonitoring(): void {
    try {
      // For React Native, this would be:
      // AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      //   if (nextAppState === 'active') {
      //     await this.handleAppForeground();
      //   } else if (nextAppState === 'background') {
      //     await this.handleAppBackground();
      //   }
      // });

      debugLog('Session monitoring set up (requires React Native AppState)');

    } catch (error) {
      errorLog('Error setting up session monitoring:', error as Error);
    }
  }

  /**
   * Handle app coming to foreground (optimized - less noise)
   */
  async handleAppForeground(): Promise<void> {
    try {
      if (this.currentSession) {
        const timeSinceLastActivity = Date.now() - this.currentSession.lastActivity;
        
        if (timeSinceLastActivity > this.config.sessionTimeoutMs) {
          // Session expired, end old and start new
          await this.endSession();
          await this.startSession();
        } else {
          // Resume existing session - just update activity time, don't track event
          this.currentSession.lastActivity = Date.now();
          debugLog('Session resumed after', timeSinceLastActivity, 'ms');
        }
      } else {
        // No active session, start new one
        await this.startSession();
      }
    } catch (error) {
      errorLog('Error handling app foreground:', error as Error);
    }
  }

  /**
   * Handle app going to background (optimized - less noise)
   */
  async handleAppBackground(): Promise<void> {
    try {
      if (this.currentSession) {
        // Just update last activity time - don't track background event
        this.currentSession.lastActivity = Date.now();
        debugLog('App backgrounded, session updated');
      }
    } catch (error) {
      errorLog('Error handling app background:', error as Error);
    }
  }

  /**
   * Update session counters for a screen view.
   * The actual pageview event is fired by the SDK's screen() method —
   * this only updates internal session state to avoid double-firing.
   */
  async recordScreenView(screenName: string): Promise<void> {
    try {
      if (!this.config.trackScreenViews) return;

      // Don't count the same screen twice in a row
      if (this.lastScreenName === screenName) return;

      // Update session counters (no event fired here)
      if (this.currentSession) {
        this.currentSession.screenViews++;
        this.currentSession.lastActivity = Date.now();
      }

      this.lastScreenName = screenName;
      debugLog('Screen view counted:', screenName);

    } catch (error) {
      errorLog('Error updating screen view:', error as Error);
    }
  }

  /**
   * Get session data to enrich a pageview event.
   * Called by the SDK's screen() method *before* recordScreenView(),
   * so we add 1 to account for the current view being tracked.
   */
  getScreenViewEnrichment(): Record<string, any> | null {
    if (!this.currentSession) return null;
    return {
      session_id: this.currentSession.sessionId,
      pageviews_in_session: this.currentSession.screenViews + 1,
      previous_screen: this.lastScreenName,
    };
  }

  /**
   * Track app launch performance
   */
  /**
   * Track custom automatic event (called by SDK)
   * Updates session counters for activity tracking
   */
  async onEvent(eventName: string): Promise<void> {
    try {
      if (this.currentSession) {
        this.currentSession.events++;
        this.currentSession.lastActivity = Date.now();
      }
    } catch (error) {
      errorLog('Error handling automatic event:', error as Error);
    }
  }

  /**
   * Get current session info
   */
  getCurrentSession(): SessionData | null {
    return this.currentSession;
  }

  /**
   * Force end current session
   */
  async forceEndSession(): Promise<void> {
    await this.endSession();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AutoEventConfig>): void {
    this.config = { ...this.config, ...newConfig };
    debugLog('Auto-events config updated:', this.config);
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    try {
      // End current session
      if (this.currentSession) {
        this.endSession();
      }
      
      debugLog('Auto-events manager destroyed');

    } catch (error) {
      errorLog('Error destroying auto-events manager:', error as Error);
    }
  }
}

// Export singleton instance (will be initialized by main SDK)
export let autoEventsManager: AutoEventsManager | null = null;

export const createAutoEventsManager = (
  trackEvent: (eventName: string, properties: Record<string, any>) => Promise<void>,
  config?: Partial<AutoEventConfig>,
  getSessionId?: () => string
): AutoEventsManager => {
  autoEventsManager = new AutoEventsManager(trackEvent, config, getSessionId);
  return autoEventsManager;
}; 