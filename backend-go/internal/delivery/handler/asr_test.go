package handler

import "testing"

func TestValidateSampleRate(t *testing.T) {
	tests := []struct {
		name       string
		sampleRate int
		wantErr    bool
	}{
		{name: "use provider default", sampleRate: 0},
		{name: "minimum", sampleRate: 8000},
		{name: "common WebRTC rate", sampleRate: 48000},
		{name: "maximum", sampleRate: 96000},
		{name: "negative", sampleRate: -1, wantErr: true},
		{name: "too low", sampleRate: 7999, wantErr: true},
		{name: "too high", sampleRate: 96001, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSampleRate(tt.sampleRate)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateSampleRate(%d) error = %v, wantErr %v", tt.sampleRate, err, tt.wantErr)
			}
		})
	}
}
