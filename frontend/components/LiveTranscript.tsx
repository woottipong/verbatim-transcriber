import React, { useEffect, useRef } from 'react';
import { User, Volume2 } from 'lucide-react';

interface TranscriptMessage {
  text: string;
  isFinal: boolean;
  confidence: number;
  speaker: string;
  timestamp: number;
}

interface LiveTranscriptProps {
  transcripts: TranscriptMessage[];
}

export default function LiveTranscript({ transcripts }: LiveTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [transcripts]);

  const finalTranscripts = transcripts.filter((t) => t.isFinal);
  const interimTranscripts = transcripts.filter((t) => !t.isFinal);

  return (
    <div className="flex flex-col h-[500px] bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-medium text-slate-200">Live Transcription</span>
        </div>
        <span className="text-xs text-slate-400">{finalTranscripts.length} segments</span>
      </div>

      {/* Transcript Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {finalTranscripts.length === 0 && interimTranscripts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <User className="w-12 h-12 mb-2 opacity-50" />
            <p className="text-sm">Waiting for audio input...</p>
          </div>
        )}

        {/* Final Transcripts */}
        {finalTranscripts.map((seg, idx) => (
          <div key={`final-${idx}`} className="p-3 bg-slate-800 rounded-lg border border-slate-700">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-3 h-3 text-indigo-400" />
              <span className="text-xs text-slate-400">{seg.speaker}</span>
              <span className="text-xs text-slate-500">
                {new Date(seg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-slate-200">{seg.text}</p>
          </div>
        ))}

        {/* Interim Transcripts */}
        {interimTranscripts.map((interim, idx) => (
          <div key={`interim-${idx}`} className="p-3 bg-indigo-900/20 rounded-lg border-l-4 border-indigo-400">
            <p className="text-slate-200">
              <span className="animate-pulse inline-block w-2 h-2 bg-indigo-400 rounded-full mr-2" />
              {interim.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
