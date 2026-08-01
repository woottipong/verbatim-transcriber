import React from 'react';
import { ConnectionState } from '../types';

interface ConnectionBadgeProps {
    state: ConnectionState;
}

const ConnectionBadge: React.FC<ConnectionBadgeProps> = ({ state }) => {
    const isConnected = state === ConnectionState.CONNECTED;
    const isConnecting = state === ConnectionState.CONNECTING;
    const isError = state === ConnectionState.ERROR;
    const tone = isConnected ? 'success' : isConnecting ? 'warning' : isError ? 'danger' : 'neutral';
    const label = isConnected ? 'Connected' : isConnecting ? 'Connecting' : isError ? 'Connection error' : 'Disconnected';
    const dotTone = tone === 'success' ? 'live' : tone === 'warning' ? 'pending' : tone === 'danger' ? 'error' : '';

    return (
        <span className={`admin-status admin-status--${tone}`} role="status" aria-live="polite">
            <span className={`status-dot ${dotTone ? `status-dot--${dotTone}` : ''}`} aria-hidden="true" />
            {label}
        </span>
    );
};

export default ConnectionBadge;
