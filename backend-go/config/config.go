package config

import "os"

type Config struct {
	Port                         string
	Host                         string
	GoogleAPIKey                 string
	GoogleApplicationCredentials string
	AzureSubscriptionKey         string
	AzureRegion                  string
	LiveKitAPIKey                string
	LiveKitAPISecret             string
	LiveKitURL                   string
	GoogleConfig                 GoogleConfig
	AzureConfig                  AzureConfig
	LiveKitConfig                LiveKitConfig
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

type LiveKitConfig struct {
	TokenExpiry int // seconds
}

func Load() *Config {
	return &Config{
		Port:                         getEnv("PORT", "3000"),
		Host:                         getEnv("HOST", "localhost"),
		GoogleAPIKey:                 os.Getenv("GOOGLE_API_KEY"),
		GoogleApplicationCredentials: os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"),
		AzureSubscriptionKey:         os.Getenv("AZURE_SUBSCRIPTION_KEY"),
		AzureRegion:                  getEnv("AZURE_REGION", "southeastasia"),
		LiveKitAPIKey:                os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:             os.Getenv("LIVEKIT_API_SECRET"),
		LiveKitURL:                   getEnv("LIVEKIT_WS_URL", "ws://localhost:7880"),
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
		LiveKitConfig: LiveKitConfig{
			TokenExpiry: 3600, // 1 hour
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
func (c *Config) HasGoogleKey() bool {
	return c.GoogleAPIKey != "" || c.GoogleApplicationCredentials != ""
}

func (c *Config) HasAzureKey() bool {
	return c.AzureSubscriptionKey != "" && c.AzureRegion != ""
}

func (c *Config) HasLiveKitKey() bool {
	return c.LiveKitAPIKey != "" && c.LiveKitAPISecret != ""
}
