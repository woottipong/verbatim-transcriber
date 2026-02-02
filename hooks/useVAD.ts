/**
 * VAD (Voice Activity Detection) Hook
 * Uses @ricky0123/vad-react with Silero VAD model
 */

import { useMicVAD } from '@ricky0123/vad-react';
import { useEffect, useRef } from 'react';

interface VADConfig {
    enabled: boolean;
    threshold: number;
}

interface UseVADProps {
    config: VADConfig;
    audioDeviceId?: string;
    onSpeechStart?: () => void;
    onSpeechEnd?: () => void;
    onVADMisfire?: () => void;
}

export const useVAD = ({ config, audioDeviceId, onSpeechStart, onSpeechEnd, onVADMisfire }: UseVADProps) => {
    const prevSpeakingRef = useRef(false);

    // ถ้า VAD disabled, return stub
    if (!config.enabled) {
        return {
            isLoading: false,
            isReady: false,
            isSpeaking: false,
            start: async () => { },
            pause: async () => { },
            destroy: () => { },
            error: null,
        };
    }

    // Use vad-react hook
    const vad = useMicVAD({
        positiveSpeechThreshold: config.threshold,
        negativeSpeechThreshold: config.threshold - 0.15,
        minSpeechMs: 100,        // Minimum speech duration (ms)
        preSpeechPadMs: 300,     // Prepend audio before speech (ms)
        redemptionMs: 250,       // Grace period after speech ends (ms)
        onSpeechStart: () => {
            console.log('🎤 [VAD] Speech started');
            onSpeechStart?.();
        },
        onSpeechEnd: (audio: Float32Array) => {
            console.log('🔇 [VAD] Speech ended, audio length:', audio.length);
            onSpeechEnd?.();
        },
        onVADMisfire: () => {
            console.log('❌ [VAD] Misfire');
            onVADMisfire?.();
        },
        startOnLoad: false, // Don't auto-start
    });

    // Track speaking state changes
    useEffect(() => {
        if (vad.userSpeaking !== prevSpeakingRef.current) {
            prevSpeakingRef.current = vad.userSpeaking;
        }
    }, [vad.userSpeaking]);

    return {
        isLoading: vad.loading,
        isReady: !vad.loading && !vad.errored && vad.listening,
        isSpeaking: vad.userSpeaking,
        start: vad.start,
        pause: vad.pause,
        destroy: vad.pause, // vad-react doesn't have destroy, use pause
        error: vad.errored || null,
    };
};
