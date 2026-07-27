import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomEvent, type Room, type RoomOptions } from 'livekit-client';
import { LiveKitRoomLifecycle, type RoomEndReason } from './liveKitRoomLifecycle.ts';

class FakeRoom {
    listeners = new Map<string, Array<() => void>>();
    connectCalls: Array<[string, string]> = [];
    disconnectCalls = 0;
    connectGate: Promise<void> = Promise.resolve();

    on(event: string, listener: () => void) {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
        return this;
    }

    async connect(serverUrl: string, token: string) {
        this.connectCalls.push([serverUrl, token]);
        await this.connectGate;
    }

    disconnect() {
        this.disconnectCalls++;
        this.emit(RoomEvent.Disconnected);
    }

    emit(event: string) {
        this.listeners.get(event)?.forEach(listener => listener());
    }
}

function asRoom(room: FakeRoom): Room {
    return room as unknown as Room;
}

function connectionOptions(
    room: FakeRoom,
    ended: RoomEndReason[],
    getToken: () => Promise<string> = async () => 'token',
) {
    return {
        serverUrl: 'ws://livekit',
        getToken,
        prepare: async () => undefined,
        roomOptions: {} as RoomOptions,
        createRoom: () => asRoom(room),
        registerAdapterEvents: () => undefined,
        callbacks: {
            onEnded: (reason: RoomEndReason) => ended.push(reason),
        },
    };
}

test('owns room creation, connection, lifecycle events, and manual teardown', async () => {
    const lifecycle = new LiveKitRoomLifecycle();
    const room = new FakeRoom();
    const ended: RoomEndReason[] = [];

    const connected = await lifecycle.connect(connectionOptions(room, ended));
    assert.equal(connected, asRoom(room));
    assert.deepEqual(room.connectCalls, [['ws://livekit', 'token']]);
    assert.equal(lifecycle.room, asRoom(room));

    lifecycle.disconnect();
    assert.equal(room.disconnectCalls, 1);
    assert.deepEqual(ended, ['manual']);
    assert.equal(lifecycle.room, null);
});

test('invalidates an older token request and never creates its room', async () => {
    const lifecycle = new LiveKitRoomLifecycle();
    const firstRoom = new FakeRoom();
    const secondRoom = new FakeRoom();
    const ended: RoomEndReason[] = [];
    let releaseFirstToken: ((token: string) => void) | undefined;
    const firstToken = new Promise<string>(resolve => {
        releaseFirstToken = resolve;
    });

    const firstConnect = lifecycle.connect(connectionOptions(firstRoom, ended, () => firstToken));
    const secondConnect = lifecycle.connect(connectionOptions(secondRoom, ended));
    releaseFirstToken?.('stale');

    assert.equal(await firstConnect, null);
    assert.equal(await secondConnect, asRoom(secondRoom));
    assert.equal(firstRoom.connectCalls.length, 0);
    assert.equal(lifecycle.room, asRoom(secondRoom));
});

test('reports remote disconnect once and ignores the stale room afterward', async () => {
    const lifecycle = new LiveKitRoomLifecycle();
    const room = new FakeRoom();
    const ended: RoomEndReason[] = [];
    await lifecycle.connect(connectionOptions(room, ended));

    room.emit(RoomEvent.Disconnected);
    room.emit(RoomEvent.Disconnected);

    assert.deepEqual(ended, ['remote']);
    assert.equal(lifecycle.room, null);
});
