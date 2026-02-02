package config

import "os"

type Config struct {
	Port           string
	Host           string
	DeepgramAPIKey string
	GeminiAPIKey   string
	DeepgramConfig DeepgramConfig
	GeminiConfig   GeminiConfig
}

type DeepgramConfig struct {
	Model          string
	Language       string
	SmartFormat    bool
	InterimResults bool
	Punctuate      bool
	FillerWords    bool
	Diarize        bool
	Utterances     bool
	Endpointing    int
	VADTurnoff     int
}

type GeminiConfig struct {
	Model             string
	Temperature       float32
	TopP              float32
	TopK              int
	MaxOutputTokens   int
	BatchSizeBytes    int
	SystemInstruction string
}

func Load() *Config {
	return &Config{
		Port:           getEnv("PORT", "3000"),
		Host:           getEnv("HOST", "localhost"),
		DeepgramAPIKey: os.Getenv("DEEPGRAM_API_KEY"),
		GeminiAPIKey:   os.Getenv("GEMINI_API_KEY"),
		DeepgramConfig: DeepgramConfig{
			Model:          "nova-2",
			Language:       "th",
			SmartFormat:    true,
			InterimResults: true,
			Punctuate:      true,
			FillerWords:    false,
			Diarize:        false,
			Utterances:     false,
			Endpointing:    2000,
			VADTurnoff:     2000,
		},
		GeminiConfig: GeminiConfig{
			Model:           "gemini-2.0-flash",
			Temperature:     0,
			TopP:            1,
			TopK:            1,
			MaxOutputTokens: 512,
			BatchSizeBytes:  64000,
			SystemInstruction: `คุณเป็น Speech-to-Text Transcriber ถอดเสียงแบบ verbatim เท่านั้น

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
		},
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
