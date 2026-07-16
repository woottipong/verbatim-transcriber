package domain

import "testing"

func TestNormalizeThaiSpacing(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "removes spaces inserted between Thai characters",
			input: "ทด สอบ ถอด ความ 1 2 3 4",
			want:  "ทดสอบถอดความ 1 2 3 4",
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
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeThaiSpacing(tt.input); got != tt.want {
				t.Fatalf("NormalizeThaiSpacing(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
