import { Storage, STORAGE_KEYS, debugLog, errorLog } from './utils';
export class EventQueue {
    constructor(httpClient, config) {
        this.queue = [];
        this.flushTimer = null;
        this.isProcessing = false;
        this.isOnline = true;
        this.httpClient = httpClient;
        this.config = config;
        this.initializeQueue();
    }
    /**
     * Initialize the queue by loading persisted events
     */
    async initializeQueue() {
        try {
            const persistedQueue = await Storage.getItem(STORAGE_KEYS.EVENT_QUEUE);
            if (persistedQueue && Array.isArray(persistedQueue)) {
                this.queue = persistedQueue;
                debugLog(`Loaded ${this.queue.length} events from storage`);
            }
            // Start the flush timer
            this.startFlushTimer();
        }
        catch (error) {
            errorLog('Failed to initialize event queue:', error);
        }
    }
    /**
     * Add an event to the queue
     */
    async enqueue(payload) {
        const queuedEvent = {
            payload,
            timestamp: Date.now(),
            retryCount: 0,
        };
        // Check queue size limit
        if (this.queue.length >= this.config.maxQueueSize) {
            debugLog('Queue is full, removing oldest event');
            this.queue.shift(); // Remove oldest event
        }
        this.queue.push(queuedEvent);
        debugLog(`Event queued: ${payload.eventName} (queue size: ${this.queue.length})`);
        // Persist to storage
        await this.persistQueue();
        // Try to flush immediately if online
        if (this.isOnline && !this.isProcessing) {
            this.processQueue();
        }
    }
    /**
     * Process the queue and send events
     */
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }
        this.isProcessing = true;
        debugLog(`Processing queue with ${this.queue.length} events`);
        try {
            // Get events to process (up to batch size)
            const eventsToProcess = this.queue.slice(0, this.config.batchSize);
            const failedEvents = [];
            // Process events
            for (const queuedEvent of eventsToProcess) {
                try {
                    const response = await this.httpClient.sendEvent(queuedEvent.payload);
                    if (response.success) {
                        debugLog(`Event sent successfully: ${queuedEvent.payload.eventName}`);
                        // Remove from queue
                        this.removeFromQueue(queuedEvent);
                    }
                    else {
                        // Increment retry count
                        queuedEvent.retryCount++;
                        if (queuedEvent.retryCount >= this.config.maxRetryCount) {
                            debugLog(`Event exceeded max retries, dropping: ${queuedEvent.payload.eventName}`);
                            this.removeFromQueue(queuedEvent);
                        }
                        else {
                            debugLog(`Event failed, will retry: ${queuedEvent.payload.eventName} (attempt ${queuedEvent.retryCount})`);
                            failedEvents.push(queuedEvent);
                        }
                    }
                }
                catch (error) {
                    errorLog(`Error processing event: ${queuedEvent.payload.eventName}`, error);
                    queuedEvent.retryCount++;
                    if (queuedEvent.retryCount >= this.config.maxRetryCount) {
                        this.removeFromQueue(queuedEvent);
                    }
                    else {
                        failedEvents.push(queuedEvent);
                    }
                }
            }
            // Persist updated queue
            await this.persistQueue();
        }
        catch (error) {
            errorLog('Error processing event queue:', error);
        }
        finally {
            this.isProcessing = false;
        }
    }
    /**
     * Remove an event from the queue
     */
    removeFromQueue(eventToRemove) {
        const index = this.queue.findIndex(event => event.payload.eventId === eventToRemove.payload.eventId);
        if (index !== -1) {
            this.queue.splice(index, 1);
        }
    }
    /**
     * Persist queue to storage
     */
    async persistQueue() {
        try {
            await Storage.setItem(STORAGE_KEYS.EVENT_QUEUE, this.queue);
        }
        catch (error) {
            errorLog('Failed to persist event queue:', error);
        }
    }
    /**
     * Start the periodic flush timer
     */
    startFlushTimer() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        this.flushTimer = setInterval(() => {
            if (this.isOnline && this.queue.length > 0) {
                this.processQueue();
            }
        }, this.config.flushInterval);
        debugLog(`Flush timer started with interval: ${this.config.flushInterval}ms`);
    }
    /**
     * Stop the flush timer
     */
    stopFlushTimer() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
            debugLog('Flush timer stopped');
        }
    }
    /**
     * Manually flush the queue
     */
    async flush() {
        debugLog('Manual flush requested');
        await this.processQueue();
    }
    /**
     * Set online/offline status
     */
    setOnlineStatus(isOnline) {
        const wasOnline = this.isOnline;
        this.isOnline = isOnline;
        debugLog(`Network status changed: ${isOnline ? 'online' : 'offline'}`);
        // If we just came online, try to process the queue
        if (isOnline && !wasOnline && this.queue.length > 0) {
            this.processQueue();
        }
    }
    /**
     * Get queue statistics
     */
    getStats() {
        const oldestEvent = this.queue.length > 0 ? this.queue[0] : null;
        const oldestEventAge = oldestEvent ? Date.now() - oldestEvent.timestamp : null;
        return {
            queueSize: this.queue.length,
            isProcessing: this.isProcessing,
            isOnline: this.isOnline,
            oldestEventAge,
        };
    }
    /**
     * Clear all events from the queue
     */
    async clear() {
        this.queue = [];
        await Storage.removeItem(STORAGE_KEYS.EVENT_QUEUE);
        debugLog('Event queue cleared');
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        debugLog('Event queue config updated:', this.config);
        // Restart flush timer with new interval
        if (config.flushInterval) {
            this.startFlushTimer();
        }
    }
    /**
     * Destroy the queue and cleanup
     */
    destroy() {
        this.stopFlushTimer();
        this.queue = [];
        debugLog('Event queue destroyed');
    }
}
/**
 * Default event queue factory
 */
export const createEventQueue = (httpClient, config) => {
    const defaultConfig = {
        maxQueueSize: 100,
        batchSize: 10,
        flushInterval: 10000, // 10 seconds
        maxRetryCount: 3,
    };
    return new EventQueue(httpClient, { ...defaultConfig, ...config });
};
