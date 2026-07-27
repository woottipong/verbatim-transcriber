import React from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';

interface RecordButtonProps {
    isConnected: boolean;
    isConnecting: boolean;
    onClick: () => void;
    size?: 'sm' | 'lg';
}

const RecordButton: React.FC<RecordButtonProps> = ({ isConnected, isConnecting, onClick, size = 'lg' }) => {
    const isSmall = size === 'sm';
    const buttonSize = isSmall ? 'h-10 min-w-10 px-2.5' : 'h-14 min-w-14 px-4';
    const iconSize = isSmall ? 18 : 22;

    const buttonClasses = `
    inline-flex items-center justify-center gap-2 ${buttonSize} rounded-lg border text-sm font-semibold
    transition-colors duration-150
    ${isConnected
            ? 'border-red-400/50 bg-red-500 text-white hover:bg-red-600'
            : 'border-teal-300/35 bg-teal-700 text-white hover:bg-teal-600'}
    ${isConnecting ? 'opacity-70 cursor-wait' : 'cursor-pointer'}
  `;

    return (
        <button
            onClick={onClick}
            disabled={isConnecting}
            className={buttonClasses}
            aria-label={isConnected ? 'Stop recording' : 'Start recording'}
        >
            {isConnecting ? (
                <Loader2 className="animate-spin" size={iconSize} />
            ) : isConnected ? (
                <MicOff size={iconSize} />
            ) : (
                <Mic size={iconSize} />
            )}
            <span className={isSmall ? 'sr-only' : ''}>
                {isConnecting ? 'Connecting' : isConnected ? 'Disconnect' : 'Record'}
            </span>
        </button>
    );
};

export default RecordButton;
