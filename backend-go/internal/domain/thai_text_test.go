package domain

import "testing"

func TestNormalizeTranscriptSpacing(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "preserves spaces between Thai text",
			input: "ทด สอบ ถอด ความ 1 2 3 4",
			want:  "ทด สอบ ถอด ความ 1 2 3 4",
		},
		{
			name:  "preserves intentional Thai phrase boundary",
			input: "ค่ะ ครับ",
			want:  "ค่ะ ครับ",
		},
		{
			name:  "preserves boundaries around Latin text and numbers",
			input: "ทดสอบ Google 123 ภาษาไทย",
			want:  "ทดสอบ Google 123 ภาษาไทย",
		},
		{
			name:  "collapses repeated whitespace",
			input: "  ทดสอบ   1  2  ",
			want:  "ทดสอบ 1 2",
		},
		{
			name:  "inserts spaces at Latin-Thai boundaries if missing",
			input: "Smartเป็นAI",
			want:  "Smart เป็น AI",
		},
		{
			name:  "inserts spaces at Thai-Number boundaries if missing",
			input: "พระราม9และ10ชิ้น",
			want:  "พระราม 9 และ 10 ชิ้น",
		},
		{
			name:  "does not insert space around punctuation in abbreviations",
			input: "ม.3และร.5",
			want:  "ม.3 และร.5",
		},
		{
			name:  "inserts spaces in user test case",
			input: "รายงานคืนAppleนะ",
			want:  "รายงานคืน Apple นะ",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeTranscriptSpacing(tt.input); got != tt.want {
				t.Fatalf("NormalizeTranscriptSpacing(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeThaiSpacingCompatibility(t *testing.T) {
	const input = "ค่ะ ครับ สระภาษาอังกฤษคือ a e i o u"
	if got, want := NormalizeThaiSpacing(input), NormalizeTranscriptSpacing(input); got != want {
		t.Fatalf("NormalizeThaiSpacing(%q) = %q, want %q", input, got, want)
	}
}

func TestNormalizeProviderTranscriptSpacing(t *testing.T) {
	tests := []struct {
		name         string
		provider     string
		languageCode string
		input        string
		want         string
	}{
		{
			name:         "compacts Google Thai word spacing",
			provider:     "google",
			languageCode: "th-TH",
			input:        "ความ ชอบ ของ แต่ ละ คน คือ อย่าง ผม",
			want:         "ความชอบของแต่ละคนคืออย่างผม",
		},
		{
			name:         "preserves Google Thai boundaries around Latin text",
			provider:     "google",
			languageCode: "th",
			input:        "ไม่ ได้ มี วัน นึง ที่ จะ ขาย เรือ แล้ว ซื้อ private jet มั้ย",
			want:         "ไม่ได้มีวันนึงที่จะขายเรือแล้วซื้อ private jet มั้ย",
		},
		{
			name:         "preserves Google Thai boundaries around numbers",
			provider:     "google",
			languageCode: "th_TH",
			input:        "พระราม 9 และ 10 ชิ้น",
			want:         "พระราม 9 และ 10 ชิ้น",
		},
		{
			name:         "preserves Google Thai punctuation boundaries",
			provider:     "google",
			languageCode: "th-TH",
			input:        "สวัสดี ครับ, วัน นี้ เป็น อย่าง ไร บ้าง?",
			want:         "สวัสดีครับ, วันนี้เป็นอย่างไรบ้าง?",
		},
		{
			name:         "does not change Gemini spacing policy",
			provider:     "gemini",
			languageCode: "th",
			input:        "ความ ชอบ ของ แต่ ละ คน",
			want:         "ความ ชอบ ของ แต่ ละ คน",
		},
		{
			name:         "does not change GPT spacing policy",
			provider:     "gpt-realtime-whisper",
			languageCode: "th",
			input:        "ความ ชอบ ของ แต่ ละ คน",
			want:         "ความ ชอบ ของ แต่ ละ คน",
		},
		{
			name:         "does not compact non-Thai Google transcripts",
			provider:     "google",
			languageCode: "en-US",
			input:        "hello world",
			want:         "hello world",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeProviderTranscriptSpacing(tt.provider, tt.languageCode, tt.input); got != tt.want {
				t.Fatalf("NormalizeProviderTranscriptSpacing() = %q, want %q", got, tt.want)
			}
		})
	}
}
