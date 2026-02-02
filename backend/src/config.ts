/**
 * Backend Configuration
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DeepgramOptions, GeminiConfig, AudioConfig } from './types.js';

// ============================================
// Environment Setup
// ============================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ============================================
// Server Config
// ============================================

export const SERVER_CONFIG = {
    PORT: parseInt(process.env.PORT || '3000', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
} as const;

// ============================================
// API Keys
// ============================================

export const API_KEYS = {
    DEEPGRAM: process.env.DEEPGRAM_API_KEY,
    GEMINI: process.env.GEMINI_API_KEY,
} as const;

// ============================================
// Deepgram Config
// ============================================

export const DEEPGRAM_CONFIG: DeepgramOptions = {
    model: 'nova-2',
    language: 'th',
    smart_format: false,
    interim_results: true,
    punctuate: false,
    diarize: false,
    utterances: false,
    filler_words: false,
    endpointing: false,
    vad_turnoff: 0,
    encoding: 'linear16',
    sample_rate: 48000,
    channels: 1,
};

// ============================================
// Gemini Config
// ============================================

export const GEMINI_CONFIG: GeminiConfig = {
    model: 'gemini-2.0-flash',
    temperature: 0,
    topP: 1,
    topK: 1,
    maxOutputTokens: 512,
    systemInstruction: `คุณเป็น Speech-to-Text Transcriber ถอดเสียงแบบ verbatim เท่านั้น

⚠️ ABSOLUTE RULES - ห้ามละเมิดเด็ดขาด:

1. ถอดเฉพาะเสียงพูดที่ได้ยินชัดจริงๆ เท่านั้น
2. ห้ามเพิ่มคำใดๆ ที่ไม่ได้ยินในเสียง - ห้าม 100%
3. ห้ามเพิ่ม filler words: อ่า, เอ่อ, อืม, อ้า, เอ้อ, ฮะ, เนาะ, นะ, ครับ, ค่ะ ถ้าไม่ได้ยินจริง
4. ถ้าเสียงไม่ชัด/ไม่แน่ใจ = ไม่ต้องใส่
5. ถ้าไม่มีเสียงพูด = ตอบเป็น empty string ""
6. ห้ามแปลภาษา ห้ามตีความ ห้ามเดา

OUTPUT FORMAT:
- เขียนติดกัน ไม่ต้องเว้นวรรค
- ภาษาอังกฤษ: เว้น space ตามปกติ
- ถ้าไม่มีเสียงพูด: ตอบ "" (empty)

EXAMPLES:
❌ WRONG: เพิ่ม "อ่า" หรือ "เอ่อ" ที่ไม่ได้ยิน
❌ WRONG: เพิ่ม "ครับ" "ค่ะ" ที่ไม่ได้ยิน
❌ WRONG: ถอดซ้ำข้อความเดิม
✅ CORRECT: ถอดเฉพาะที่ได้ยินชัดเจน 100%`,
};

export const GEMINI_BATCH_SIZE = 64000; // ~2 seconds of audio at 16kHz

// ============================================
// Audio Config
// ============================================

export const AUDIO_CONFIG: AudioConfig = {
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
    encoding: 'linear16',
};

// ============================================
// Validation
// ============================================

export function validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!API_KEYS.DEEPGRAM) {
        errors.push('DEEPGRAM_API_KEY is required');
    }

    if (!API_KEYS.GEMINI) {
        console.warn('⚠️  WARNING: GEMINI_API_KEY not set (Gemini provider disabled)');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}
