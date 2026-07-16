export type SessionStepState = 'idle' | 'pending' | 'complete' | 'error';

export interface LiveKitSessionPresentation {
  headline: string;
  detail: string;
  canSpeak: boolean;
  tone: 'neutral' | 'pending' | 'ready' | 'warning' | 'error';
  steps: [SessionStepState, SessionStepState, SessionStepState];
  health: SessionHealthItem[];
}

export interface SessionHealthItem {
  label: 'Room' | 'Microphone' | 'Transcriber';
  value: string;
  state: SessionStepState;
}

type ConnectionStateValue = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

function createSessionHealth(
  steps: [SessionStepState, SessionStepState, SessionStepState],
): SessionHealthItem[] {
  const values = [
    { label: 'Room' as const, complete: 'Connected', pending: 'Connecting...', idle: 'Disconnected' },
    { label: 'Microphone' as const, complete: 'On', pending: 'Starting', idle: 'Off' },
    { label: 'Transcriber' as const, complete: 'Connected', pending: 'Waiting', idle: 'Disconnected' },
  ];

  return values.map((item, index) => {
    const state = steps[index];
    const value = state === 'complete'
      ? item.complete
      : state === 'pending'
        ? item.pending
        : state === 'error'
          ? 'Error'
          : item.idle;

    return { label: item.label, value, state };
  });
}

export function getLiveKitSessionPresentation(
  connectionState: ConnectionStateValue,
  isMicrophoneEnabled: boolean,
  isAgentConnected: boolean,
): LiveKitSessionPresentation {
  if (connectionState === 'ERROR') {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = ['error', 'idle', 'idle'];
    return {
      headline: 'Connection Failed',
      detail: 'Check your connection and microphone permission, then try again.',
      canSpeak: false,
      tone: 'error',
      steps,
      health: createSessionHealth(steps),
    };
  }

  if (connectionState === 'CONNECTING') {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = ['pending', 'pending', 'idle'];
    return {
      headline: 'Connecting and starting microphone...',
      detail: 'Please allow microphone access when prompted by your browser.',
      canSpeak: false,
      tone: 'pending',
      steps,
      health: createSessionHealth(steps),
    };
  }

  if (connectionState === 'DISCONNECTED') {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = ['idle', 'idle', 'idle'];
    return {
      headline: 'Ready to Connect',
      detail: 'Connect to the room to start sending your audio.',
      canSpeak: false,
      tone: 'neutral',
      steps,
      health: createSessionHealth(steps),
    };
  }

  const roomStep: SessionStepState = 'complete';
  const microphoneStep: SessionStepState = isMicrophoneEnabled ? 'complete' : 'idle';
  const transcriptionStep: SessionStepState = isAgentConnected ? 'complete' : 'pending';

  if (!isMicrophoneEnabled) {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = [roomStep, microphoneStep, transcriptionStep];
    return {
      headline: 'Microphone is muted',
      detail: 'Unmute your microphone when you are ready to speak.',
      canSpeak: false,
      tone: 'warning',
      steps,
      health: createSessionHealth(steps),
    };
  }

  if (!isAgentConnected) {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = [roomStep, microphoneStep, transcriptionStep];
    return {
      headline: 'Waiting for transcriber',
      detail: 'You are connected. Waiting for the transcription service to start.',
      canSpeak: false,
      tone: 'pending',
      steps,
      health: createSessionHealth(steps),
    };
  }

  const steps: [SessionStepState, SessionStepState, SessionStepState] = [roomStep, microphoneStep, transcriptionStep];
  return {
    headline: 'Ready to speak',
    detail: 'Your microphone is live and transcription is running.',
    canSpeak: true,
    tone: 'ready',
    steps,
    health: createSessionHealth(steps),
  };
}
