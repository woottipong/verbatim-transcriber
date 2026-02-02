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
    flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider shadow-lg
    ${isConnected ? 'bg-green-500/20 text-green-400 border border-green-500/30' : ''}
    ${isConnecting ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : ''}
    ${isError ? 'bg-red-500/20 text-red-400 border border-red-500/30' : ''}
    ${!isConnected && !isConnecting && !isError ? 'bg-slate-700 text-slate-400 border border-slate-600' : ''}
  `;

    return (
        <div className={badgeClasses}>
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {state}
        </div>
    );
};

export default ConnectionBadge;
