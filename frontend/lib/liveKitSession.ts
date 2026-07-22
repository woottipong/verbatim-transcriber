import type { AudioSource } from '../types';

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
  label: 'Room' | 'Audio Input' | 'Transcriber';
  value: string;
  state: SessionStepState;
}

type ConnectionStateValue = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

function createSessionHealth(
  steps: [SessionStepState, SessionStepState, SessionStepState],
  audioInputIdleValue = 'Off',
): SessionHealthItem[] {
  const values = [
    { label: 'Room' as const, complete: 'Connected', pending: 'Connecting...', idle: 'Disconnected' },
    { label: 'Audio Input' as const, complete: 'On', pending: 'Starting', idle: audioInputIdleValue },
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
  isAudioInputEnabled: boolean,
  isAgentConnected: boolean,
  audioSource: AudioSource = 'microphone',
  isAudioInputStopped = false,
): LiveKitSessionPresentation {
  if (connectionState === 'ERROR') {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = ['error', 'idle', 'idle'];
    return {
      headline: 'Connection Failed',
      detail: audioSource === 'chrome-tab'
        ? 'Check tab-sharing permission, then try again.'
        : 'Check your connection and microphone permission, then try again.',
      canSpeak: false,
      tone: 'error',
      steps,
      health: createSessionHealth(steps),
    };
  }

  if (connectionState === 'CONNECTING') {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = ['pending', 'pending', 'idle'];
    return {
      headline: audioSource === 'chrome-tab'
        ? 'Connecting Chrome Tab audio...'
        : 'Connecting and starting microphone...',
      detail: audioSource === 'chrome-tab'
        ? 'Select a Chrome tab and enable Share tab audio.'
        : 'Please allow microphone access when prompted by your browser.',
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
  const audioInputStep: SessionStepState = isAudioInputEnabled ? 'complete' : 'idle';
  const transcriptionStep: SessionStepState = isAgentConnected ? 'complete' : 'pending';

  if (isAudioInputStopped) {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = [roomStep, 'idle', transcriptionStep];
    return {
      headline: 'Tab audio stopped',
      detail: 'Disconnect and reconnect to choose a Chrome tab again.',
      canSpeak: false,
      tone: 'warning',
      steps,
      health: createSessionHealth(steps, 'Stopped'),
    };
  }

  if (!isAudioInputEnabled) {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = [roomStep, audioInputStep, transcriptionStep];
    return {
      headline: audioSource === 'chrome-tab' ? 'Chrome Tab audio is muted' : 'Microphone is muted',
      detail: audioSource === 'chrome-tab'
        ? 'Resume the audio input to continue transcription.'
        : 'Unmute your microphone when you are ready to speak.',
      canSpeak: false,
      tone: 'warning',
      steps,
      health: createSessionHealth(steps),
    };
  }

  if (!isAgentConnected) {
    const steps: [SessionStepState, SessionStepState, SessionStepState] = [roomStep, audioInputStep, transcriptionStep];
    return {
      headline: 'Waiting for transcriber',
      detail: 'You are connected. Waiting for the transcription service to start.',
      canSpeak: false,
      tone: 'pending',
      steps,
      health: createSessionHealth(steps),
    };
  }

  const steps: [SessionStepState, SessionStepState, SessionStepState] = [roomStep, audioInputStep, transcriptionStep];
  return {
    headline: audioSource === 'chrome-tab' ? 'Ready to transcribe' : 'Ready to speak',
    detail: audioSource === 'chrome-tab'
      ? 'Chrome Tab audio is live and transcription is running.'
      : 'Your microphone is live and transcription is running.',
    canSpeak: true,
    tone: 'ready',
    steps,
    health: createSessionHealth(steps),
  };
}
