import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ErrorBannerProps {
    error: string;
    showConfigHint?: boolean;
    onConfigClick?: () => void;
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, showConfigHint, onConfigClick }) => {
    return (
        <div className="bg-red-900/20 border-l-4 border-red-500 p-4 rounded-r shadow-lg backdrop-blur-sm flex items-start gap-3">
            <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
            <div>
                <h3 className="text-sm font-bold text-red-300">Connection Error</h3>
                <p className="text-sm text-red-200 mt-1">{error}</p>
                {showConfigHint && onConfigClick && (
                    <button
                        onClick={onConfigClick}
                        className="text-xs text-red-400 mt-2 font-semibold underline hover:text-red-300"
                    >
                        Please configure an API Key in settings.
                    </button>
                )}
            </div>
        </div>
    );
};

export default ErrorBanner;
