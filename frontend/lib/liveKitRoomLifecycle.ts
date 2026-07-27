import { RoomEvent, type Room, type RoomOptions } from 'livekit-client';

export type RoomEndReason = 'replaced' | 'manual' | 'remote' | 'failed' | 'disposed';

interface RoomLifecycleCallbacks {
    onConnected?: (room: Room) => void;
    onReconnecting?: (room: Room) => void;
    onReconnected?: (room: Room) => void;
    onEnded: (reason: RoomEndReason, room: Room) => void;
}

interface RoomConnectionOptions<TPreparation> {
    serverUrl: string | ((preparation: TPreparation) => string);
    getToken: (preparation: TPreparation) => Promise<string>;
    prepare: () => Promise<TPreparation>;
    disposePreparation?: (preparation: TPreparation) => void;
    roomOptions: RoomOptions;
    createRoom: (options: RoomOptions) => Room;
    registerAdapterEvents: (room: Room) => void;
    afterConnect?: (room: Room, preparation: TPreparation) => Promise<void>;
    callbacks: RoomLifecycleCallbacks;
}

interface ActiveRoom {
    room: Room;
    callbacks: RoomLifecycleCallbacks;
}

export class LiveKitRoomLifecycle {
    private active: ActiveRoom | null = null;
    private generation = 0;

    get room(): Room | null {
        return this.active?.room ?? null;
    }

    isCurrent(room: Room): boolean {
        return this.active?.room === room;
    }

    async connect<TPreparation>(options: RoomConnectionOptions<TPreparation>): Promise<Room | null> {
        const attempt = ++this.generation;
        this.endActive('replaced');
        let preparation: TPreparation | undefined;
        let room: Room | null = null;
        let completed = false;

        try {
            preparation = await options.prepare();
            if (!this.isAttemptCurrent(attempt)) return null;

            const token = await options.getToken(preparation);
            if (!this.isAttemptCurrent(attempt)) return null;

            room = options.createRoom(options.roomOptions);
            this.active = { room, callbacks: options.callbacks };
            this.registerLifecycleEvents(room, options.callbacks);
            options.registerAdapterEvents(room);

            const serverUrl = typeof options.serverUrl === 'function'
                ? options.serverUrl(preparation)
                : options.serverUrl;
            await room.connect(serverUrl, token, { autoSubscribe: true });
            if (!this.isAttemptCurrent(attempt) || !this.isCurrent(room)) return null;

            await options.afterConnect?.(room, preparation);
            if (!this.isAttemptCurrent(attempt) || !this.isCurrent(room)) return null;

            completed = true;
            return room;
        } catch (error) {
            if (room && this.isCurrent(room)) {
                this.active = null;
                room.disconnect();
                options.callbacks.onEnded('failed', room);
            }
            if (this.isAttemptCurrent(attempt)) throw error;
            return null;
        } finally {
            if (!completed && preparation !== undefined) {
                options.disposePreparation?.(preparation);
            }
            if (!completed && room && this.isCurrent(room)) {
                this.active = null;
                room.disconnect();
            }
        }
    }

    disconnect(reason: RoomEndReason = 'manual'): void {
        this.generation++;
        this.endActive(reason);
    }

    dispose(): void {
        this.disconnect('disposed');
    }

    private registerLifecycleEvents(room: Room, callbacks: RoomLifecycleCallbacks): void {
        room.on(RoomEvent.Connected, () => {
            if (this.isCurrent(room)) callbacks.onConnected?.(room);
        });
        room.on(RoomEvent.Disconnected, () => {
            if (!this.isCurrent(room)) return;
            this.generation++;
            this.active = null;
            callbacks.onEnded('remote', room);
        });
        room.on(RoomEvent.Reconnecting, () => {
            if (this.isCurrent(room)) callbacks.onReconnecting?.(room);
        });
        room.on(RoomEvent.Reconnected, () => {
            if (this.isCurrent(room)) callbacks.onReconnected?.(room);
        });
    }

    private isAttemptCurrent(attempt: number): boolean {
        return attempt === this.generation;
    }

    private endActive(reason: RoomEndReason): void {
        const active = this.active;
        if (!active) return;
        this.active = null;
        active.room.disconnect();
        active.callbacks.onEnded(reason, active.room);
    }
}
