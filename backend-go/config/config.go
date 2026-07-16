package config

import "os"

type Config struct {
	Port                         string
	Host                         string
	AllowedOrigins               string // Comma-separated list of allowed origins
	GoogleAPIKey                 string
	GoogleApplicationCredentials string
	GoogleCloudProject           string
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
	Location              string
	LanguageCode          string
	SampleRate            int
	EnableAutoPunctuation bool // false = faster finalization (no waiting for context)
}

type AzureConfig struct {
	Language                       string
	SampleRate                     int
	BitsPerSample                  int
	Channels                       int
	SegmentationSilenceTimeout     int // milliseconds - silence ก่อน finalize segment
	SegmentationMaxSilenceDuration int // milliseconds - max silence ก่อน force finalize
}

type LiveKitConfig struct {
	TokenExpiry int // seconds
}

func Load() *Config {
	return &Config{
		Port:                         getEnv("PORT", "3000"),
		Host:                         getEnv("HOST", "localhost"),
		AllowedOrigins:               getEnv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"),
		GoogleAPIKey:                 os.Getenv("GOOGLE_API_KEY"),
		GoogleApplicationCredentials: os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"),
		GoogleCloudProject:           os.Getenv("GOOGLE_CLOUD_PROJECT"),
		AzureSubscriptionKey:         os.Getenv("AZURE_SUBSCRIPTION_KEY"),
		AzureRegion:                  getEnv("AZURE_REGION", "southeastasia"),
		LiveKitAPIKey:                os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:             os.Getenv("LIVEKIT_API_SECRET"),
		LiveKitURL:                   getEnv("LIVEKIT_WS_URL", "ws://localhost:7880"),
		GoogleConfig: GoogleConfig{
			Location:              getEnv("GOOGLE_CLOUD_LOCATION", "asia-southeast1"),
			LanguageCode:          "th-TH",
			SampleRate:            48000,
			EnableAutoPunctuation: true, // Let Google add punctuation for more natural sentence formatting
		},
		AzureConfig: AzureConfig{
			Language:                       "th-TH",
			SampleRate:                     16000,
			BitsPerSample:                  16,
			Channels:                       1,
			SegmentationSilenceTimeout:     300, // 300ms - aggressive endpointing for real-time feel
			SegmentationMaxSilenceDuration: 500, // 500ms - force finalize faster (was 800ms)
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
	return c.GoogleCloudProject != "" && (c.GoogleAPIKey != "" || c.GoogleApplicationCredentials != "")
}

func (c *Config) HasAzureKey() bool {
	return c.AzureSubscriptionKey != "" && c.AzureRegion != ""
}

func (c *Config) HasLiveKitKey() bool {
	return c.LiveKitAPIKey != "" && c.LiveKitAPISecret != ""
}
