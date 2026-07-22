import type { AudioSource } from '../types';

type DisplayCapture = (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;

export const AUDIO_SOURCE_LABELS: Record<AudioSource, string> = {
  microphone: 'Microphone',
  'chrome-tab': 'Chrome Tab',
};

function getBrowserDisplayCapture(): DisplayCapture | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return null;
  }
  return navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
}

export async function captureChromeTabAudio(
  capture: DisplayCapture | null = getBrowserDisplayCapture(),
): Promise<{ stream: MediaStream; audioTrack: MediaStreamTrack }> {
  if (!capture) {
    throw new Error('Chrome Tab audio sharing is not supported in this browser.');
  }

  const stream = await capture({ video: true, audio: true });
  const [audioTrack] = stream.getAudioTracks();

  if (!audioTrack) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('No tab audio was shared. Select a Chrome tab and enable Share tab audio.');
  }

  stream.getVideoTracks().forEach(track => track.stop());
  return { stream, audioTrack };
}

export function getChromeTabCaptureError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Tab sharing was cancelled or not allowed.';
  }
  return error instanceof Error ? error.message : 'Unable to share Chrome Tab audio.';
}
