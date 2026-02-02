/**
 * Thai Text Processing Utilities
 */

/**
 * Fix Thai text spacing issues from STT
 * Removes unwanted spaces between Thai characters and vowels
 */
export function fixThaiTranscript(text: string): string {
    if (!text) return text;

    return text
        // Fix vowel spacing
        .replace(/([ก-ฮ])\s+([ั ิ ี ึ ื ุ ู ็ ์])/g, '$1$2')
        .replace(/([ก-ฮ][ั ิ ี ึ ื ุ ู]?)\s+([ก-ฮ][ั ิ ี ึ ื ุ ู ็ ์])/g, '$1$2')
        .replace(/\s+([ั ิ ี ึ ื ุ ู เ แ โ ใ ไ ำ ็ ์])/g, '$1')
        .replace(/([ั ิ ี ึ ื ุ ู เ แ โ ใ ไ ำ ็ ์])\s+/g, '$1')
        // Fix triple character spacing
        .replace(/([ก-ฮ])\s([ก-ฮ])\s([ก-ฮ])/g, '$1$2$3')
        // Normalize whitespace
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Clean Gemini transcription output
 * Removes artifacts, greetings, timestamps, and formatting
 */
export function cleanGeminiTranscription(text: string): string {
    if (!text) return '';

    let cleaned = text
        // Remove prompt echoes
        .replace(/ถอดความเสียงนี้เป็นข้อความที่สละสวย จัดวรรคตอนให้เหมาะสม:?/gi, '')
        .replace(/ถอดความเสียงนี้.*/gi, '')
        // Remove greeting words
        .replace(/^(สวัสดีค่ะ|สวัสดีครับ|สวัสดี)[\s,]*/gi, '')
        .replace(/[\s,]*(สวัสดีค่ะ|สวัสดีครับ)[\s,]*/gi, ' ')
        // Remove timestamps
        .replace(/\[?\(?\d{1,2}:\d{2}(:\d{2})?\)?\]?/g, '')
        // Remove markdown
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`/g, '')
        // Remove empty quotes (hallucination)
        .replace(/""/g, '')
        .replace(/"\s*"/g, '')
        // Remove periods after Thai text
        .replace(/([\u0E00-\u0E7F])\./g, '$1')
        // Remove repeated words
        .replace(/\b(\S+)\s+\1\b/gi, '$1')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned;
}
