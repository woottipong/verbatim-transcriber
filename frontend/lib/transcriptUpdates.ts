type ScheduleUpdate = (callback: () => void, delayMs: number) => number;
type CancelUpdate = (timerId: number) => void;

export class TranscriptUpdateBuffer<T> {
    private readonly pending = new Map<string, T>();
    private timerId: number | null = null;
    private readonly deliver: (update: T) => void;
    private readonly intervalMs: number;
    private readonly schedule: ScheduleUpdate;
    private readonly cancel: CancelUpdate;
    private readonly isFinal: (update: T) => boolean;
    private readonly getKey: (update: T) => string;

    constructor(
        deliver: (update: T) => void,
        intervalMs = 50,
        schedule: ScheduleUpdate = (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: CancelUpdate = timerId => window.clearTimeout(timerId),
        isFinal: (update: T) => boolean = () => false,
        getKey: (update: T) => string = () => 'default',
    ) {
        this.deliver = deliver;
        this.intervalMs = intervalMs;
        this.schedule = schedule;
        this.cancel = cancel;
        this.isFinal = isFinal;
        this.getKey = getKey;
    }

    push(update: T): void {
        const key = this.getKey(update);

        if (this.isFinal(update)) {
            this.pending.delete(key);
            this.deliver(update);
            return;
        }

        if (this.timerId === null) {
            this.deliver(update);
            this.scheduleFlush();
            return;
        }

        // Reinsert so updates from multiple speakers retain latest-arrival order.
        this.pending.delete(key);
        this.pending.set(key, update);
    }

    clear(): void {
        this.pending.clear();
        if (this.timerId !== null) {
            this.cancel(this.timerId);
            this.timerId = null;
        }
    }

    private scheduleFlush(): void {
        this.timerId = this.schedule(() => {
            this.timerId = null;
            if (this.pending.size === 0) return;

            const updates = Array.from(this.pending.values());
            this.pending.clear();
            updates.forEach(update => this.deliver(update));
            this.scheduleFlush();
        }, this.intervalMs);
    }
}
