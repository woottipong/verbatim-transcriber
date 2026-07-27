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
