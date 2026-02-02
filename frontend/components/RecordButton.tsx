import React from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';

interface RecordButtonProps {
    isConnected: boolean;
    isConnecting: boolean;
    onClick: () => void;
}

const RecordButton: React.FC<RecordButtonProps> = ({ isConnected, isConnecting, onClick }) => {
    const buttonClasses = `
    group relative flex items-center justify-center w-20 h-20 rounded-full shadow-2xl 
    transition-all transform hover:scale-110 active:scale-95
    ${isConnected
            ? 'bg-red-500 hover:bg-red-600 text-white ring-4 ring-red-500/30 shadow-red-500/50'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white ring-4 ring-indigo-500/30 shadow-indigo-500/50'}
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
                <Loader2 className="animate-spin" size={32} />
            ) : isConnected ? (
                <MicOff size={32} />
            ) : (
                <Mic size={32} />
            )}
        </button>
    );
};

export default RecordButton;
