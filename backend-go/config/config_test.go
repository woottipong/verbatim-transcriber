package config

import "testing"

func TestLoadOpenAITranscriptionConfiguration(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "openai-test-key")
	t.Setenv("OPENAI_LANGUAGE_CODE", "th")

	cfg := Load()
	if cfg.OpenAIAPIKey != "openai-test-key" {
		t.Fatalf("OpenAI API key = %q", cfg.OpenAIAPIKey)
	}
	if cfg.OpenAIConfig.LanguageCode != "th" {
		t.Fatalf("OpenAI languages = %#v", cfg.OpenAIConfig)
	}
	if cfg.OpenAIConfig.SampleRate != 24000 {
		t.Fatalf("OpenAI sample rate = %d, want 24000", cfg.OpenAIConfig.SampleRate)
	}
	if !cfg.HasOpenAITranscriptionKey() {
		t.Fatal("HasOpenAITranscriptionKey() = false with API key")
	}
}

func TestLoadOpenAITranscriptionLanguageDefaults(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("OPENAI_LANGUAGE_CODE", "")

	cfg := Load()
	if cfg.OpenAIConfig.LanguageCode != "th" {
		t.Fatalf("OpenAI language default = %#v, want th", cfg.OpenAIConfig)
	}
}
