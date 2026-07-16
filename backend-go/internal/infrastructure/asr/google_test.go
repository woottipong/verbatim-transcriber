package asr

import "testing"

func TestBuildV2StreamingConfigRequest(t *testing.T) {
	request := buildV2StreamingConfigRequest(GoogleConfig{
		ProjectID:             "thai-transcriber",
		Location:              "asia-southeast1",
		SampleRate:            48000,
		LanguageCode:          "th-TH",
		EnableAutoPunctuation: true,
	})

	if got, want := request.GetRecognizer(), "projects/thai-transcriber/locations/asia-southeast1/recognizers/_"; got != want {
		t.Fatalf("recognizer = %q, want %q", got, want)
	}

	config := request.GetStreamingConfig()
	if config == nil {
		t.Fatal("streaming config is nil")
	}
	if got, want := config.GetConfig().GetModel(), "chirp_2"; got != want {
		t.Fatalf("model = %q, want %q", got, want)
	}
	if got, want := config.GetConfig().GetLanguageCodes(), []string{"th-TH"}; len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("language codes = %v, want %v", got, want)
	}
	if got, want := config.GetConfig().GetExplicitDecodingConfig().GetSampleRateHertz(), int32(48000); got != want {
		t.Fatalf("sample rate = %d, want %d", got, want)
	}
	if !config.GetStreamingFeatures().GetInterimResults() {
		t.Fatal("interim results are disabled")
	}
}

func TestAudioChunksStayWithinV2Limit(t *testing.T) {
	audio := make([]byte, maxV2AudioRequestBytes+1)
	chunks := audioChunks(audio)

	if got, want := len(chunks), 2; got != want {
		t.Fatalf("chunk count = %d, want %d", got, want)
	}
	if got, want := len(chunks[0]), maxV2AudioRequestBytes; got != want {
		t.Fatalf("first chunk length = %d, want %d", got, want)
	}
	if got, want := len(chunks[1]), 1; got != want {
		t.Fatalf("second chunk length = %d, want %d", got, want)
	}
}
