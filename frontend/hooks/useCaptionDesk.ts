import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DataPacket_Kind, Room, RoomEvent, type RemoteParticipant } from 'livekit-client';
import { createCaptionDeskToken } from '../lib/api';
import {
  buildCaptionPublishCommand,
  buildCaptionReviewModeCommand,
  buildCaptionSubscribeCommand,
  CAPTION_COMMAND_TOPIC,
  CAPTION_OPERATOR_TOPIC,
  isCaptionAgentIdentity,
  type CaptionPublishCommand,
} from '../lib/captionDeskMessages';
import { CaptionDeskSession } from '../lib/captionDeskSession';
import type { AgentProvider } from '../lib/providers';
import { ConnectionState } from '../types';

export function useCaptionDesk(backendUrl: string, roomName: string, provider: AgentProvider) {
  const sessionRef = useRef<CaptionDeskSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new CaptionDeskSession();
  const session = sessionRef.current;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const roomRef = useRef<Room | null>(null);
  const scopeRef = useRef('');
  const interimReviewRef = useRef(false);
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const sendSubscribe = useCallback(async (room: Room) => {
    await room.localParticipant.publishData(buildCaptionSubscribeCommand(provider), {
      reliable: true,
      topic: CAPTION_COMMAND_TOPIC,
    });
    await room.localParticipant.publishData(
      buildCaptionReviewModeCommand(provider, interimReviewRef.current),
      { reliable: true, topic: CAPTION_COMMAND_TOPIC },
    );
    for (const command of session.waitingCommands(provider)) {
      await room.localParticipant.publishData(buildCaptionPublishCommand(command), {
        reliable: true,
        topic: CAPTION_COMMAND_TOPIC,
      });
    }
  }, [provider, session]);

  useEffect(() => {
    if (!roomName || !provider) return;
    const scope = `${roomName}:${provider}`;
    if (scopeRef.current !== scope) {
      session.clear();
      scopeRef.current = scope;
    }
    let disposed = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const matchesAgent = (participant?: RemoteParticipant) =>
      isCaptionAgentIdentity(participant?.identity, provider);
    const refreshAgent = () => setAgentConnected(
      Array.from(room.remoteParticipants.values()).some(participant => matchesAgent(participant)),
    );
    const onData = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: DataPacket_Kind,
      topic?: string,
    ) => {
      if (topic !== CAPTION_OPERATOR_TOPIC || !matchesAgent(participant)) return;
      session.ingestOperatorPacket(payload);
    };
    const onReconnecting = () => setConnectionState(ConnectionState.CONNECTING);
    const onReconnected = () => {
      setConnectionState(ConnectionState.CONNECTED);
      void sendSubscribe(room).catch(cause => setError(errorMessage(cause)));
    };
    const onDisconnected = () => {
      if (!disposed) setConnectionState(ConnectionState.DISCONNECTED);
      setAgentConnected(false);
    };
    const onParticipantConnected = (participant: RemoteParticipant) => {
      refreshAgent();
      if (matchesAgent(participant)) {
        void sendSubscribe(room).catch(cause => setError(errorMessage(cause)));
      }
    };
    const onParticipantDisconnected = () => refreshAgent();

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    const connect = async () => {
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);
      try {
        const credentials = await createCaptionDeskToken(backendUrl, roomName, provider);
        if (disposed) return;
        await room.connect(credentials.wsUrl, credentials.token);
        if (disposed) return;
        setConnectionState(ConnectionState.CONNECTED);
        refreshAgent();
        await sendSubscribe(room);
      } catch (cause) {
        if (!disposed) {
          setError(errorMessage(cause));
          setConnectionState(ConnectionState.ERROR);
        }
      }
    };
    void connect();

    return () => {
      disposed = true;
      room.removeAllListeners();
      void room.disconnect();
      roomRef.current = null;
    };
  }, [backendUrl, provider, reconnectNonce, roomName, sendSubscribe, session]);

  useEffect(() => () => session.clear(), [session]);

  const edit = useCallback((text: string) => session.edit(text), [session]);
  const restore = useCallback(() => session.restore(), [session]);
  const setInterimEnabled = useCallback((enabled: boolean) => session.setInterimEnabled(enabled), [session]);
  const setInterimReviewEnabled = useCallback(async (enabled: boolean): Promise<boolean> => {
    const room = roomRef.current;
    if (!room || connectionState !== ConnectionState.CONNECTED) return false;
    try {
      await room.localParticipant.publishData(buildCaptionReviewModeCommand(provider, enabled), {
        reliable: true,
        topic: CAPTION_COMMAND_TOPIC,
      });
      interimReviewRef.current = enabled;
      session.setInterimReviewEnabled(enabled);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }, [connectionState, provider, session]);
  const publish = useCallback(async (splitIndex?: number): Promise<boolean> => {
    const room = roomRef.current;
    if (!room || connectionState !== ConnectionState.CONNECTED) return false;
    const command: CaptionPublishCommand | null = session.release(provider, splitIndex);
    if (!command) return false;
    try {
      await room.localParticipant.publishData(buildCaptionPublishCommand(command), {
        reliable: true,
        topic: CAPTION_COMMAND_TOPIC,
      });
      return true;
    } catch (cause) {
      session.reject({
        type: 'caption.rejected',
        requestId: command.requestId,
        provider,
        code: 'send_failed',
        message: errorMessage(cause),
      });
      return false;
    }
  }, [connectionState, provider, session]);
  const reconnect = useCallback(() => {
    setError(null);
    setReconnectNonce(current => current + 1);
  }, []);

  return {
    snapshot, connectionState, error, agentConnected,
    edit, restore, setInterimEnabled, setInterimReviewEnabled, publish, reconnect,
  };
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'Caption Desk connection failed.';
}
