import React, { useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { TranscriptSegment } from '../types';

interface TranscriptPanelProps {
    transcripts: TranscriptSegment[];
    interimTranscript: string;
    onClear: () => void;
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
    transcripts,
    interimTranscript,
    onClear
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new transcripts arrive
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [transcripts, interimTranscript]);

    const hasContent = transcripts.length > 0 || interimTranscript;

    return (
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-700/50 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-6 py-3 border-b border-slate-700 flex justify-between items-center bg-slate-800/70 flex-shrink-0">
                <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                    Live Transcript
                </h2>
                <button
                    onClick={onClear}
                    className="text-xs flex items-center gap-1 text-slate-400 hover:text-red-400 transition px-3 py-1.5 rounded hover:bg-red-900/20"
                    aria-label="Clear transcripts"
                >
                    <Trash2 size={14} /> Clear
                </button>
            </div>

            {/* Content - Fixed Height Scrollable */}
            <div
                ref={scrollRef}
                className="h-[160px] p-4 overflow-y-auto custom-scrollbar"
                style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#475569 #1e293b'
                }}
            >
                {!hasContent ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500">
                        <p className="italic text-center text-sm">Start recording to see Thai transcription appear here</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {transcripts.map((segment, index) => (
                            <div
                                key={segment.id}
                                className="text-slate-100 leading-relaxed p-2 rounded-lg hover:bg-slate-700/30 transition-colors border-l-2 border-slate-600/50"
                            >
                                <span className="text-xs text-slate-500 mr-2">#{index + 1}</span>
                                <span className="text-base">{segment.text}</span>
                            </div>
                        ))}
                        {/* Interim Text */}
                        {interimTranscript && (
                            <div className="text-slate-400 italic font-light leading-relaxed p-2 rounded-lg bg-slate-700/20 border-l-2 border-indigo-500/50 animate-pulse">
                                <span className="text-xs text-slate-500 mr-2">...</span>
                                <span className="text-base">{interimTranscript}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TranscriptPanel;
