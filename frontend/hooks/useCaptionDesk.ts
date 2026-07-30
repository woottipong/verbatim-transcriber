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
import { formatCaptionDeskError } from '../lib/captionDeskPresentation';
import type { CaptionPolicy } from '../lib/appRoutes';
import type { AgentProvider } from '../lib/providers';
import { ConnectionState } from '../types';

const CAPTION_SUBSCRIBE_RETRY_MS = 1_500;

export function useCaptionDesk(
  backendUrl: string,
  roomName: string,
  provider: AgentProvider,
  captionPolicy: CaptionPolicy,
) {
  const sessionRef = useRef<CaptionDeskSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new CaptionDeskSession();
  const session = sessionRef.current;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const roomRef = useRef<Room | null>(null);
  const deskSessionIDRef = useRef(crypto.randomUUID());
  const agentParticipantSIDRef = useRef('');
  const scopeRef = useRef('');
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [captionConnected, setCaptionConnected] = useState(false);
  const [subscriptionBlockCode, setSubscriptionBlockCode] = useState<string | null>(null);
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
    const scope = `${roomName}:${provider}:${captionPolicy}`;
    if (scopeRef.current !== scope) {
      session.clear();
      agentParticipantSIDRef.current = '';
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
    const currentAgent = () =>
      Array.from(room.remoteParticipants.values()).find(participant => matchesAgent(participant));
    const hasAgent = () => Boolean(currentAgent());
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
      const participant = currentAgent();
      const nextSID = participant?.sid || '';
      if (
        nextSID &&
        agentParticipantSIDRef.current &&
        agentParticipantSIDRef.current !== nextSID
      ) {
        session.beginSourceEpoch();
      }
      if (nextSID) agentParticipantSIDRef.current = nextSID;
      const next = Boolean(participant);
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
        setSubscriptionBlockCode(message.type === 'caption.rejected' ? message.code : 'subscription_failed');
        setCaptionConnected(false);
        setError(subscriptionError);
        clearSubscribeRetry();
        session.ingestOperatorPacket(payload);
        return;
      }
      if (message.type !== 'caption.rejected' && !subscribed) {
        subscribed = true;
        setSubscriptionBlockCode(null);
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
      setSubscriptionBlockCode(null);
      try {
        const credentials = await createCaptionDeskToken(
          backendUrl,
          roomName,
          provider,
          deskSessionIDRef.current,
          captionPolicy,
        );
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
  }, [backendUrl, captionPolicy, provider, reconnectNonce, replayWaiting, roomName, sendSubscribe, session]);

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
    setSubscriptionBlockCode(null);
    setReconnectNonce(current => current + 1);
  }, []);

  return {
    snapshot, connectionState, error, agentConnected, captionConnected,
    subscriptionBlockCode, edit, publish, reconnect,
  };
}

function errorMessage(value: unknown): string {
  return formatCaptionDeskError(value);
}
