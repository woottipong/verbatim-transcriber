import React from 'react';
import { Activity, Volume2, Clock, Zap } from 'lucide-react';

interface VADInfoBadgeProps {
    enabled: boolean;
    threshold: number;
    isReady: boolean;
    isLoading: boolean;
    isSpeaking: boolean;
}

export default function VADInfoBadge({
    enabled,
    threshold,
    isReady,
    isLoading,
    isSpeaking
}: VADInfoBadgeProps) {
    if (!enabled) {
        return (
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/50">
                <div className="flex items-center gap-2">
                    <Volume2 size={14} className="text-slate-500" />
                    <span className="text-xs text-slate-400">VAD: ปิดใช้งาน (ส่งเสียงทั้งหมด)</span>
                </div>
            </div>
        );
    }

    // Calculate human-readable threshold
    const thresholdPercent = Math.round(threshold * 100);
    let sensitivity = '';
    if (threshold <= 0.3) sensitivity = 'ไวมาก';
    else if (threshold <= 0.5) sensitivity = 'ไวปานกลาง';
    else if (threshold <= 0.7) sensitivity = 'ไวน้อย';
    else sensitivity = 'ไวน้อยมาก';

    // Status indicator
    const statusColor = isLoading
        ? 'bg-yellow-500'
        : isReady
            ? isSpeaking
                ? 'bg-green-500 animate-pulse'
                : 'bg-green-500'
            : 'bg-red-500';

    const statusText = isLoading
        ? 'กำลังโหลด...'
        : isReady
            ? isSpeaking
                ? 'กำลังตรวจจับเสียง'
                : 'พร้อมใช้งาน'
            : 'ไม่พร้อม';

    return (
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/50">
            <div className="flex items-center gap-3">
                {/* Status Indicator */}
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${statusColor}`} />
                    <Activity size={14} className={isSpeaking ? 'text-green-400' : 'text-slate-400'} />
                </div>

                {/* VAD Info */}
                <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5">
                        <span className="text-slate-400">VAD:</span>
                        <span className="text-slate-200 font-medium">{statusText}</span>
                    </div>

                    <div className="w-px h-3 bg-slate-700" />

                    <div className="flex items-center gap-1.5" title={`Threshold: ${thresholdPercent}%`}>
                        <Zap size={12} className="text-amber-400" />
                        <span className="text-slate-300">{sensitivity}</span>
                        <span className="text-slate-500">({thresholdPercent}%)</span>
                    </div>

                    <div className="w-px h-3 bg-slate-700" />

                    <div className="flex items-center gap-1.5" title="Pre-speech padding: 300ms">
                        <Clock size={12} className="text-blue-400" />
                        <span className="text-slate-300">300ms</span>
                    </div>
                </div>
            </div>

            {/* Additional Details (shown on hover or always visible) */}
            <div className="mt-1.5 pt-1.5 border-t border-slate-700/50 text-xs text-slate-500">
                <div className="flex items-center gap-4">
                    <span>• ความยาวขั้นต่ำ: 180ms</span>
                    <span>• หยุดพัก: 300ms</span>
                    <span>• รองรับเสียงไทย (โทนเสียง)</span>
                </div>
            </div>
        </div>
    );
}
