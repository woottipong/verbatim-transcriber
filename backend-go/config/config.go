package config

import "os"

type Config struct {
	Port                         string
	Host                         string
	GeminiAPIKey                 string
	GoogleAPIKey                 string
	GoogleApplicationCredentials string
	AzureSubscriptionKey         string
	AzureRegion                  string
	LiveKitAPIKey                string
	LiveKitAPISecret             string
	LiveKitWsUrl                 string
	GeminiConfig                 GeminiConfig
	GoogleConfig                 GoogleConfig
	AzureConfig                  AzureConfig
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

type GoogleConfig struct {
	Model        string
	LanguageCode string
	SampleRate   int
	UseEnhanced  bool
}

type AzureConfig struct {
	Language                   string
	SampleRate                 int
	BitsPerSample              int
	Channels                   int
	SegmentationSilenceTimeout int // milliseconds - ลดค่านี้เพื่อให้ตัดประโยคเร็วขึ้น
}

func Load() *Config {
	return &Config{
		Port:                         getEnv("PORT", "3000"),
		Host:                         getEnv("HOST", "localhost"),
		GeminiAPIKey:                 os.Getenv("GEMINI_API_KEY"),
		GoogleAPIKey:                 os.Getenv("GOOGLE_API_KEY"),
		GoogleApplicationCredentials: os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"),
		AzureSubscriptionKey:         os.Getenv("AZURE_SUBSCRIPTION_KEY"),
		AzureRegion:                  getEnv("AZURE_REGION", "southeastasia"),
		LiveKitAPIKey:                os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:             os.Getenv("LIVEKIT_API_SECRET"),
		LiveKitWsUrl:                 getEnv("LIVEKIT_WS_URL", "ws://localhost:7880"),
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
		GoogleConfig: GoogleConfig{
			Model:        "latest_long", // Best for continuous speech & conversations
			LanguageCode: "th-TH",
			SampleRate:   48000,
			UseEnhanced:  true, // Enhanced model for better accuracy
		},
		AzureConfig: AzureConfig{
			Language:                   "th-TH",
			SampleRate:                 16000,
			BitsPerSample:              16,
			Channels:                   1,
			SegmentationSilenceTimeout: 500, // 500ms - ลดลงจาก default 1000ms
		},
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// Provider availability checks
func (c *Config) HasGeminiKey() bool {
	return c.GeminiAPIKey != ""
}

func (c *Config) HasGoogleKey() bool {
	return c.GoogleAPIKey != "" || c.GoogleApplicationCredentials != ""
}

func (c *Config) HasAzureKey() bool {
	return c.AzureSubscriptionKey != "" && c.AzureRegion != ""
}

func (c *Config) HasLiveKitConfig() bool {
	return c.LiveKitAPIKey != "" && c.LiveKitAPISecret != ""
}
