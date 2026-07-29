import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DataPacket_Kind, Room, RoomEvent, type RemoteParticipant } from 'livekit-client';
import { createCaptionDeskToken } from '../lib/api';
import {
  buildCaptionPublishCommand,
  buildCaptionSubscribeCommand,
  CAPTION_COMMAND_TOPIC,
  CAPTION_OPERATOR_TOPIC,
  getCaptionSubscriptionError,
  isCaptionAgentIdentity,
  parseCaptionOperatorPacket,
  type CaptionPublishCommand,
} from '../lib/captionDeskMessages';
import { CaptionDeskSession } from '../lib/captionDeskSession';
import type { CaptionDeskSource } from '../lib/appRoutes';
import type { AgentProvider } from '../lib/providers';
import { ConnectionState } from '../types';

const CAPTION_SUBSCRIBE_RETRY_MS = 1_500;

export function useCaptionDesk(
  backendUrl: string,
  roomName: string,
  provider: AgentProvider,
  source: CaptionDeskSource,
) {
  const sessionRef = useRef<CaptionDeskSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new CaptionDeskSession(source);
  const session = sessionRef.current;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const roomRef = useRef<Room | null>(null);
  const scopeRef = useRef('');
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [captionConnected, setCaptionConnected] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const sendSubscribe = useCallback(async (room: Room) => {
    await room.localParticipant.publishData(buildCaptionSubscribeCommand(provider), {
      reliable: true,
      topic: CAPTION_COMMAND_TOPIC,
    });
  }, [provider]);

  const replayWaiting = useCallback(async (room: Room) => {
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
    let subscribed = false;
    let subscriptionBlocked = false;
    let subscribeInFlight = false;
    let subscribeRetry: number | undefined;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const matchesAgent = (participant?: RemoteParticipant) =>
      isCaptionAgentIdentity(participant?.identity, provider);
    const hasAgent = () =>
      Array.from(room.remoteParticipants.values()).some(participant => matchesAgent(participant));
    const clearSubscribeRetry = () => {
      if (subscribeRetry !== undefined) window.clearTimeout(subscribeRetry);
      subscribeRetry = undefined;
    };
    const scheduleSubscribe = () => {
      clearSubscribeRetry();
      if (disposed || subscribed || subscriptionBlocked || !hasAgent()) return;
      subscribeRetry = window.setTimeout(() => {
        void requestSubscribe();
      }, CAPTION_SUBSCRIBE_RETRY_MS);
    };
    const requestSubscribe = async () => {
      if (disposed || subscribed || subscribeInFlight || !hasAgent()) return;
      subscribeInFlight = true;
      try {
        await sendSubscribe(room);
      } catch (cause) {
        if (!disposed) setError(errorMessage(cause));
      } finally {
        subscribeInFlight = false;
        scheduleSubscribe();
      }
    };
    const resetSubscription = () => {
      subscribed = false;
      setCaptionConnected(false);
      clearSubscribeRetry();
    };
    const refreshAgent = () => {
      const next = hasAgent();
      setAgentConnected(next);
      if (!next) resetSubscription();
      return next;
    };
    const onData = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: DataPacket_Kind,
      topic?: string,
    ) => {
      if (topic !== CAPTION_OPERATOR_TOPIC || !matchesAgent(participant)) return;
      const message = parseCaptionOperatorPacket(payload);
      if (!message) return;
      const subscriptionError = getCaptionSubscriptionError(message, subscribed);
      if (subscriptionError) {
        subscriptionBlocked = true;
        setCaptionConnected(false);
        setError(subscriptionError);
        clearSubscribeRetry();
        session.ingestOperatorPacket(payload);
        return;
      }
      if (message.type !== 'caption.rejected' && !subscribed) {
        subscribed = true;
        setCaptionConnected(true);
        setError(null);
        clearSubscribeRetry();
        void replayWaiting(room).catch(cause => setError(errorMessage(cause)));
      }
      session.ingestOperatorPacket(payload);
    };
    const onReconnecting = () => {
      resetSubscription();
      setConnectionState(ConnectionState.CONNECTING);
    };
    const onReconnected = () => {
      setConnectionState(ConnectionState.CONNECTED);
      if (refreshAgent()) void requestSubscribe();
    };
    const onDisconnected = () => {
      if (!disposed) setConnectionState(ConnectionState.DISCONNECTED);
      setAgentConnected(false);
      resetSubscription();
    };
    const onParticipantConnected = (participant: RemoteParticipant) => {
      refreshAgent();
      if (matchesAgent(participant)) {
        void requestSubscribe();
      }
    };
    const onParticipantDisconnected = (participant: RemoteParticipant) => {
      if (matchesAgent(participant)) resetSubscription();
      refreshAgent();
    };

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
        if (refreshAgent()) void requestSubscribe();
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
      clearSubscribeRetry();
      room.removeAllListeners();
      void room.disconnect();
      roomRef.current = null;
    };
  }, [backendUrl, provider, reconnectNonce, replayWaiting, roomName, sendSubscribe, session]);

  useEffect(() => () => session.clear(), [session]);

  const edit = useCallback((text: string) => session.edit(text), [session]);
  const publish = useCallback(async (splitIndex?: number): Promise<boolean> => {
    const room = roomRef.current;
    if (!room || connectionState !== ConnectionState.CONNECTED || !captionConnected) return false;
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
  }, [captionConnected, connectionState, provider, session]);
  const reconnect = useCallback(() => {
    setError(null);
    setReconnectNonce(current => current + 1);
  }, []);

  return {
    snapshot, connectionState, error, agentConnected, captionConnected,
    edit, publish, reconnect,
  };
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'Caption Desk connection failed.';
}
