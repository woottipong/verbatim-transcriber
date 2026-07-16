type ScheduleUpdate = (callback: () => void, delayMs: number) => number;
type CancelUpdate = (timerId: number) => void;

export class TranscriptUpdateBuffer<T> {
    private readonly pending: T[] = [];
    private timerId: number | null = null;
    private readonly deliver: (update: T) => void;
    private readonly intervalMs: number;
    private readonly schedule: ScheduleUpdate;
    private readonly cancel: CancelUpdate;

    constructor(
        deliver: (update: T) => void,
        intervalMs = 50,
        schedule: ScheduleUpdate = (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: CancelUpdate = timerId => window.clearTimeout(timerId)
    ) {
        this.deliver = deliver;
        this.intervalMs = intervalMs;
        this.schedule = schedule;
        this.cancel = cancel;
    }

    push(update: T): void {
        this.pending.push(update);
        if (this.timerId === null) {
            this.deliverNext();
        }
    }

    clear(): void {
        this.pending.length = 0;
        if (this.timerId !== null) {
            this.cancel(this.timerId);
            this.timerId = null;
        }
    }

    private deliverNext(): void {
        const update = this.pending.shift() as T;
        this.deliver(update);

        this.timerId = this.schedule(() => {
            this.timerId = null;
            if (this.pending.length > 0) {
                this.deliverNext();
            }
        }, this.intervalMs);
    }
}
