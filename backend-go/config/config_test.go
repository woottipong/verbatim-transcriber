package config

import "testing"

func TestHasGoogleKeyRequiresApplicationCredentials(t *testing.T) {
	cfg := &Config{
		GoogleCloudProject: "project",
	}
	if cfg.HasGoogleKey() {
		t.Fatal("HasGoogleKey() = true without Application Default Credentials")
	}
	cfg.GoogleApplicationCredentials = "/tmp/service-account.json"
	if !cfg.HasGoogleKey() {
		t.Fatal("HasGoogleKey() = false with Application Default Credentials")
	}
}

func TestLoadGeminiProofreadConfiguration(t *testing.T) {
	t.Setenv("GEMINI_API_KEY", "gemini-test-key")
	t.Setenv("GEMINI_PROOFREAD_MODEL", " gemini-3.5-flash-lite ")

	cfg := Load()
	if cfg.GeminiProofreadConfig.Model != "gemini-3.5-flash-lite" {
		t.Fatalf("proofread model = %q", cfg.GeminiProofreadConfig.Model)
	}
	if !cfg.HasGeminiProofread() {
		t.Fatal("HasGeminiProofread() = false with key and model")
	}
}

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
