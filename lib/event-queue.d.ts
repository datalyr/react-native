import { EventPayload } from './types';
import { HttpClient } from './http-client';
interface QueueConfig {
    maxQueueSize: number;
    batchSize: number;
    flushInterval: number;
    maxRetryCount: number;
}
export declare class EventQueue {
    private config;
    private httpClient;
    private queue;
    private flushTimer;
    private isProcessing;
    private isOnline;
    constructor(httpClient: HttpClient, config: QueueConfig);
    /**
     * Initialize the queue by loading persisted events
     */
    private initializeQueue;
    /**
     * Add an event to the queue
     */
    enqueue(payload: EventPayload): Promise<void>;
    /**
     * Process the queue and send events
     */
    private processQueue;
    /**
     * Remove an event from the queue
     */
    private removeFromQueue;
    /**
     * Persist queue to storage
     */
    private persistQueue;
    /**
     * Start the periodic flush timer
     */
    private startFlushTimer;
    /**
     * Stop the flush timer
     */
    private stopFlushTimer;
    /**
     * Manually flush the queue
     */
    flush(): Promise<void>;
    /**
     * Set online/offline status
     */
    setOnlineStatus(isOnline: boolean): void;
    /**
     * Get queue statistics
     */
    getStats(): {
        queueSize: number;
        isProcessing: boolean;
        isOnline: boolean;
        oldestEventAge: number | null;
    };
    /**
     * Clear all events from the queue
     */
    clear(): Promise<void>;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<QueueConfig>): void;
    /**
     * Destroy the queue and cleanup
     */
    destroy(): void;
}
/**
 * Default event queue factory
 */
export declare const createEventQueue: (httpClient: HttpClient, config?: Partial<QueueConfig>) => EventQueue;
export {};
