import React, { useState, useCallback, useEffect } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from '@livekit/components-react';
import { Room, RoomEvent, DataPacket_Kind } from 'livekit-client';

interface TranscriptMessage {
  text: string;
  isFinal: boolean;
  confidence: number;
  speaker: string;
  timestamp: number;
}

interface TranscriptionRoomProps {
  token: string;
  serverUrl: string;
  onTranscript: (msg: TranscriptMessage) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

function RoomDataReceiver({ onTranscript }: { onTranscript: (msg: TranscriptMessage) => void }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: any,
      kind?: DataPacket_Kind
    ) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload)) as TranscriptMessage;
        onTranscript(message);
      } catch (e) {
        console.error('Failed to parse transcript message:', e);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => room.off(RoomEvent.DataReceived, handleDataReceived);
  }, [room, onTranscript]);

  return null;
}

export function TranscriptionRoom({
  token,
  serverUrl,
  onTranscript,
  onConnected,
  onDisconnected
}: TranscriptionRoomProps) {
  const [room, setRoom] = useState<Room | null>(null);

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      audio={true}
      video={false}
      onConnected={(rm) => {
        setRoom(rm);
        onConnected();
      }}
      onDisconnected={() => {
        setRoom(null);
        onDisconnected();
      }}
    >
      <RoomAudioRenderer />
      <RoomDataReceiver onTranscript={onTranscript} />
    </LiveKitRoom>
  );
}
