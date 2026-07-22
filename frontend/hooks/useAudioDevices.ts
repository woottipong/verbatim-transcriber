/**
 * Hook for managing audio input devices (microphones)
 */

import { useState, useEffect } from 'react';
import { getErrorMessage } from '../lib/runtime';

export interface AudioDevice {
    deviceId: string;
    label: string;
    groupId: string;
}

export const useAudioDevices = () => {
    const [devices, setDevices] = useState<AudioDevice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        const getDevices = async () => {
            try {
                setIsLoading(true);
                setError(null);

                // Device enumeration is permission-free. Microphone permission
                // belongs to the explicit publisher Connect action.
                const allDevices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = allDevices
                    .filter((device) => device.kind === 'audioinput')
                    .map((device) => ({
                        deviceId: device.deviceId,
                        label: device.label || `Microphone ${device.deviceId.substring(0, 8)}`,
                        groupId: device.groupId,
                    }));

                if (mounted) {
                    setDevices(audioInputs);
                }
            } catch (err: unknown) {
                if (mounted) {
                    setError(getErrorMessage(err, 'Failed to get audio devices'));
                }
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };

        getDevices();

        // Listen for device changes
        const handleDeviceChange = () => {
            getDevices();
        };

        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

        return () => {
            mounted = false;
            navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
        };
    }, []);

    return { devices, isLoading, error };
};
