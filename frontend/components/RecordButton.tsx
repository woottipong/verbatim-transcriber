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
    const buttonSize = isSmall ? 'w-10 h-10' : 'w-20 h-20';
    const iconSize = isSmall ? 18 : 32;
    const ringSize = isSmall ? 'ring-2' : 'ring-4';
    const shadowSize = isSmall ? 'shadow-lg' : 'shadow-2xl';

    const buttonClasses = `
    group relative flex items-center justify-center ${buttonSize} rounded-full ${shadowSize} 
    transition-all transform hover:scale-110 active:scale-95
    ${isConnected
            ? `bg-red-500 hover:bg-red-600 text-white ${ringSize} ring-red-500/30 shadow-red-500/50`
            : `bg-indigo-600 hover:bg-indigo-700 text-white ${ringSize} ring-indigo-500/30 shadow-indigo-500/50`}
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
        </button>
    );
};

export default RecordButton;
