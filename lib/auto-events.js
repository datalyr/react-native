import { debugLog, errorLog, Storage } from './utils';
export class AutoEventsManager {
    constructor(trackEvent, config = {}) {
        this.currentSession = null;
        this.lastScreenName = null;
        this.performanceMarks = new Map();
        this.trackEvent = trackEvent;
        this.config = {
            trackSessions: true,
            trackScreenViews: true,
            trackAppUpdates: true,
            trackPerformance: true,
            sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
            ...config,
        };
    }
    /**
     * Initialize automatic event tracking
     */
    async initialize() {
        try {
            debugLog('Initializing automatic events manager...');
            // Start session tracking
            if (this.config.trackSessions) {
                await this.startSession();
                this.setupSessionMonitoring();
            }
            // Track app launch performance
            if (this.config.trackPerformance) {
                this.trackAppLaunchTime();
            }
            debugLog('Automatic events manager initialized');
        }
        catch (error) {
            errorLog('Failed to initialize automatic events manager:', error);
        }
    }
    /**
     * Start a new session
     */
    async startSession() {
        try {
            const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
        }
        catch (error) {
            errorLog('Error starting session:', error);
        }
    }
    /**
     * End current session
     */
    async endSession() {
        try {
            if (!this.currentSession)
                return;
            const now = Date.now();
            const duration = now - this.currentSession.startTime;
            // Track session end event
            await this.trackEvent('session_end', {
                session_id: this.currentSession.sessionId,
                duration_ms: duration,
                duration_seconds: Math.round(duration / 1000),
                pageviews: this.currentSession.screenViews,
                events: this.currentSession.events,
                timestamp: now,
            });
            debugLog('Session ended:', {
                sessionId: this.currentSession.sessionId,
                duration: duration / 1000,
                screenViews: this.currentSession.screenViews,
            });
            this.currentSession = null;
            await Storage.removeItem('@datalyr/current_session');
        }
        catch (error) {
            errorLog('Error ending session:', error);
        }
    }
    /**
     * Setup session monitoring (app state changes)
     * In a real implementation, this would use React Native's AppState
     */
    setupSessionMonitoring() {
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
        }
        catch (error) {
            errorLog('Error setting up session monitoring:', error);
        }
    }
    /**
     * Handle app coming to foreground (optimized - less noise)
     */
    async handleAppForeground() {
        try {
            if (this.currentSession) {
                const timeSinceLastActivity = Date.now() - this.currentSession.lastActivity;
                if (timeSinceLastActivity > this.config.sessionTimeoutMs) {
                    // Session expired, end old and start new
                    await this.endSession();
                    await this.startSession();
                }
                else {
                    // Resume existing session - just update activity time, don't track event
                    this.currentSession.lastActivity = Date.now();
                    debugLog('Session resumed after', timeSinceLastActivity, 'ms');
                }
            }
            else {
                // No active session, start new one
                await this.startSession();
            }
        }
        catch (error) {
            errorLog('Error handling app foreground:', error);
        }
    }
    /**
     * Handle app going to background (optimized - less noise)
     */
    async handleAppBackground() {
        try {
            if (this.currentSession) {
                // Just update last activity time - don't track background event
                this.currentSession.lastActivity = Date.now();
                debugLog('App backgrounded, session updated');
            }
        }
        catch (error) {
            errorLog('Error handling app background:', error);
        }
    }
    /**
     * Track automatic pageview
     */
    async trackScreenView(screenName, properties) {
        try {
            if (!this.config.trackScreenViews)
                return;
            // Don't track the same screen twice in a row
            if (this.lastScreenName === screenName)
                return;
            const screenProperties = {
                screen_name: screenName,
                previous_screen: this.lastScreenName,
                timestamp: Date.now(),
                ...properties,
            };
            // Add session data if available
            if (this.currentSession) {
                this.currentSession.screenViews++;
                screenProperties.session_id = this.currentSession.sessionId;
                screenProperties.pageviews_in_session = this.currentSession.screenViews;
            }
            await this.trackEvent('pageviews', screenProperties);
            this.lastScreenName = screenName;
            debugLog('Pageview tracked:', screenName);
        }
        catch (error) {
            errorLog('Error tracking screen view:', error);
        }
    }
    /**
     * Track app launch performance
     */
    trackAppLaunchTime() {
        try {
            // Mark app launch start
            this.performanceMarks.set('app_launch_start', Date.now());
            // Track when app is fully loaded (after a short delay)
            setTimeout(async () => {
                const launchStart = this.performanceMarks.get('app_launch_start');
                if (launchStart) {
                    const launchTime = Date.now() - launchStart;
                    await this.trackEvent('app_launch_performance', {
                        launch_time_ms: launchTime,
                        launch_time_seconds: launchTime / 1000,
                    });
                    debugLog('App launch time tracked:', launchTime);
                }
            }, 2000); // Wait 2 seconds for app to fully load
        }
        catch (error) {
            errorLog('Error tracking app launch performance:', error);
        }
    }
    /**
     * Track automatic app update
     */
    async trackAppUpdate(previousVersion, currentVersion) {
        try {
            await this.trackEvent('app_update', {
                previous_version: previousVersion,
                current_version: currentVersion,
                timestamp: Date.now(),
            });
            debugLog('App update tracked:', { from: previousVersion, to: currentVersion });
        }
        catch (error) {
            errorLog('Error tracking app update:', error);
        }
    }
    /**
     * Track revenue event (purchases, subscriptions)
     */
    async trackRevenueEvent(eventName, properties) {
        var _a;
        try {
            await this.trackEvent('revenue_event', {
                event_name: eventName,
                session_id: (_a = this.currentSession) === null || _a === void 0 ? void 0 : _a.sessionId,
                timestamp: Date.now(),
                ...properties,
            });
            debugLog('Revenue event tracked:', eventName);
        }
        catch (error) {
            errorLog('Error tracking revenue event:', error);
        }
    }
    /**
     * Track custom automatic event (called by SDK)
     */
    async onEvent(eventName) {
        try {
            if (this.currentSession) {
                this.currentSession.events++;
                this.currentSession.lastActivity = Date.now();
            }
            // Track specific automatic events based on event name
            if (eventName === 'purchase' || eventName === 'subscription' || eventName.includes('purchase')) {
                await this.trackRevenueEvent(eventName);
            }
        }
        catch (error) {
            errorLog('Error handling automatic event:', error);
        }
    }
    /**
     * Get current session info
     */
    getCurrentSession() {
        return this.currentSession;
    }
    /**
     * Force end current session
     */
    async forceEndSession() {
        await this.endSession();
    }
    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        debugLog('Auto-events config updated:', this.config);
    }
    /**
     * Cleanup and destroy
     */
    destroy() {
        try {
            // End current session
            if (this.currentSession) {
                this.endSession();
            }
            debugLog('Auto-events manager destroyed');
        }
        catch (error) {
            errorLog('Error destroying auto-events manager:', error);
        }
    }
}
// Export singleton instance (will be initialized by main SDK)
export let autoEventsManager = null;
export const createAutoEventsManager = (trackEvent, config) => {
    autoEventsManager = new AutoEventsManager(trackEvent, config);
    return autoEventsManager;
};
