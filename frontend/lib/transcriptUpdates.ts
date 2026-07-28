type ScheduleUpdate = (callback: () => void, delayMs: number) => number;
type CancelUpdate = (timerId: number) => void;
type FinalDelivery = 'next-interval' | 'immediate';

export const INTERIM_TRANSCRIPT_UPDATE_INTERVAL_MS = 33;
export const GEMINI_TRANSCRIPT_UPDATE_INTERVAL_MS = 50;

export class TranscriptUpdateBuffer<T> {
    private readonly pending = new Map<string, T>();
    private readonly pendingFinals = new Map<string, T>();
    private timerId: number | null = null;
    private readonly deliver: (update: T) => void;
    private readonly intervalMs: number;
    private readonly schedule: ScheduleUpdate;
    private readonly cancel: CancelUpdate;
    private readonly isFinal: (update: T) => boolean;
    private readonly getKey: (update: T) => string;
    private readonly finalDelivery: FinalDelivery;

    constructor(
        deliver: (update: T) => void,
        intervalMs = 50,
        schedule: ScheduleUpdate = (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: CancelUpdate = timerId => window.clearTimeout(timerId),
        isFinal: (update: T) => boolean = () => false,
        getKey: (update: T) => string = () => 'default',
        finalDelivery: FinalDelivery = 'next-interval',
    ) {
        this.deliver = deliver;
        this.intervalMs = intervalMs;
        this.schedule = schedule;
        this.cancel = cancel;
        this.isFinal = isFinal;
        this.getKey = getKey;
        this.finalDelivery = finalDelivery;
    }

    push(update: T): void {
        const key = this.getKey(update);

        if (this.isFinal(update)) {
            const latestInterim = this.pending.get(key);
            this.pending.delete(key);

            if (latestInterim) {
                this.deliver(latestInterim);
            }

            if (this.finalDelivery === 'immediate') {
                this.pendingFinals.delete(key);
                this.deliver(update);
                return;
            }

            if (this.timerId === null) {
                this.deliver(update);
                return;
            }

            // Give React and the browser one render turn to paint the latest
            // interim snapshot before replacing it with the final transcript.
            this.pendingFinals.set(key, update);
            this.cancel(this.timerId);
            this.timerId = null;
            this.scheduleFlush();
            return;
        }

        if (this.timerId === null) {
            this.deliver(update);
            this.scheduleFlush();
            return;
        }

        // Reinsert so updates from multiple transcript keys retain latest-arrival order.
        this.pending.delete(key);
        this.pending.set(key, update);
    }

    clear(): void {
        this.pending.clear();
        this.pendingFinals.clear();
        if (this.timerId !== null) {
            this.cancel(this.timerId);
            this.timerId = null;
        }
    }

    removeWhere(predicate: (update: T) => boolean): void {
        for (const [key, update] of this.pending) {
            if (predicate(update)) this.pending.delete(key);
        }
        for (const [key, update] of this.pendingFinals) {
            if (predicate(update)) this.pendingFinals.delete(key);
        }
    }

    private scheduleFlush(): void {
        this.timerId = this.schedule(() => {
            this.timerId = null;
            if (this.pending.size === 0 && this.pendingFinals.size === 0) return;

            const finals = Array.from(this.pendingFinals.values());
            const updates = Array.from(this.pending.values());
            this.pendingFinals.clear();
            this.pending.clear();
            finals.forEach(update => this.deliver(update));
            updates.forEach(update => this.deliver(update));
            if (updates.length > 0) this.scheduleFlush();
        }, this.intervalMs);
    }
}
