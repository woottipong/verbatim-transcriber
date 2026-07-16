import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { ConnectionState } from '../types';

interface ConnectionBadgeProps {
    state: ConnectionState;
}

const ConnectionBadge: React.FC<ConnectionBadgeProps> = ({ state }) => {
    const isConnected = state === ConnectionState.CONNECTED;
    const isConnecting = state === ConnectionState.CONNECTING;
    const isError = state === ConnectionState.ERROR;

    const badgeClasses = `
    inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide
    ${isConnected ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200' : ''}
    ${isConnecting ? 'border-amber-300/35 bg-amber-300/10 text-amber-100' : ''}
    ${isError ? 'border-red-400/35 bg-red-400/10 text-red-200' : ''}
    ${!isConnected && !isConnecting && !isError ? 'border-slate-600 bg-slate-800 text-slate-400' : ''}
  `;

    return (
        <div className={badgeClasses}>
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {state}
        </div>
    );
};

export default ConnectionBadge;
