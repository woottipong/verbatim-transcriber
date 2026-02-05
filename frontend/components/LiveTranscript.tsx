import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, User, Volume2 } from 'lucide-react';

interface TranscriptMessage {
  text: string;
  isFinal: boolean;
  confidence: number;
  speaker: string;
  timestamp: number;
}

interface LiveTranscriptProps {
  isConnected?: boolean;
}

export function LiveTranscript({ isConnected = false }: LiveTranscriptProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleTranscript = (msg: TranscriptMessage) => {
    if (msg.isFinal) {
      setSegments(prev => [...prev, {
        id: `seg-${Date.now()}`,
        text: msg.text,
        isFinal: true,
        speaker: msg.speaker,
        confidence: msg.confidence,
        timestamp: msg.timestamp,
      }]);
      setInterim('');
    } else {
      setInterim(msg.text);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [segments, interim]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-medium text-slate-200">Live Transcription</span>
        </div>
        <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs ${isConnected ? 'bg-green-900/50 text-green-400' : 'bg-slate-700 text-slate-400'}`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
          {isConnected ? 'Live' : 'Disconnected'}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {segments.length === 0 && !interim && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <User className="w-12 h-12 mb-2 opacity-50" />
            <p className="text-sm">Waiting for audio input...</p>
          </div>
        )}

        {segments.map(seg => (
          <div key={seg.id} className="p-3 bg-slate-800 rounded-lg border border-slate-700">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-3 h-3 text-indigo-400" />
              <span className="text-xs text-slate-400">{seg.speaker}</span>
            </div>
            <p className="text-slate-200">{seg.text}</p>
          </div>
        ))}

        {interim && (
          <div className="p-3 bg-indigo-900/20 rounded-lg border-l-4 border-indigo-400">
            <p className="text-slate-200">
              <span className="animate-pulse inline-block w-2 h-2 bg-indigo-400 rounded-full mr-2" />
              {interim}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface TranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  speaker: string;
  confidence: number;
  timestamp: number;
}
