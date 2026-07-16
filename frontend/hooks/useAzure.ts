import { useMemo } from 'react';
import { AppConfig } from '../types';
import { SharedVADProps } from '../lib/audio';
import { useBackendASR } from './useBackendASR';

export const useAzure = (config: AppConfig, sharedVAD?: SharedVADProps) => {
    const options = useMemo(() => ({
        providerName: 'Azure',
        endpoint: 'azure',
        sampleRate: 16000,
        bufferSize: 512,
        startMessage: () => ({ type: 'start' }),
    }), []);

    return useBackendASR(config, options, sharedVAD);
};
