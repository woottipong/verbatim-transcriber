import { useMemo } from 'react';
import { AppConfig } from '../types';
import { SharedVADProps } from '../lib/audio';
import { useBackendASR } from './useBackendASR';

export const useGoogle = (config: AppConfig, sharedVAD?: SharedVADProps) => {
    const options = useMemo(() => ({
        providerName: 'Google',
        endpoint: 'google',
        sampleRate: 48000,
        bufferSize: 1024,
        startMessage: (actualSampleRate: number) => ({
            type: 'start',
            sampleRate: actualSampleRate,
        }),
    }), []);

    return useBackendASR(config, options, sharedVAD);
};
