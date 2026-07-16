package handler

import (
	"testing"

	"thai-transcriber-backend/config"
)

func TestValidateAgentProvider(t *testing.T) {
	cfg := &config.Config{
		GoogleCloudProject:           "project",
		GoogleApplicationCredentials: "credentials.json",
		GeminiAPIKey:                 "gemini-key",
		AzureSubscriptionKey:         "azure-key",
		AzureRegion:                  "southeastasia",
	}

	tests := []struct {
		name     string
		provider string
		want     string
		wantErr  bool
	}{
		{name: "normalizes Google", provider: " Google ", want: "google"},
		{name: "accepts Azure", provider: "azure", want: "azure"},
		{name: "accepts Gemini", provider: " GEMINI ", want: "gemini"},
		{name: "rejects empty", wantErr: true},
		{name: "rejects unknown", provider: "other", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := validateAgentProvider(cfg, tt.provider)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateAgentProvider(%q) error = %v, wantErr %v", tt.provider, err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("validateAgentProvider(%q) = %q, want %q", tt.provider, got, tt.want)
			}
		})
	}
}

func TestValidateAgentProviderRejectsUnavailableProvider(t *testing.T) {
	if _, err := validateAgentProvider(&config.Config{}, "google"); err == nil {
		t.Fatal("validateAgentProvider() accepted Google without credentials")
	}
}
