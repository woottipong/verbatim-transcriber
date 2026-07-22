package transcript

import (
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestTokenServiceIssueAndVerify(t *testing.T) {
	fixedNow := time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC)
	service := NewTokenService("test-secret-at-least-32-bytes-long", 24*time.Hour)
	service.now = func() time.Time { return fixedNow }

	rawToken, expiresAt, err := service.Issue("daily-briefing")
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	if !expiresAt.Equal(fixedNow.Add(24 * time.Hour)) {
		t.Fatalf("expiresAt = %v, want %v", expiresAt, fixedNow.Add(24*time.Hour))
	}

	claims, err := service.Verify(rawToken, "daily-briefing")
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if claims.Room != "daily-briefing" {
		t.Fatalf("claims.Room = %q, want %q", claims.Room, "daily-briefing")
	}
	if claims.Issuer != TokenIssuer || claims.Subject != TokenSubject {
		t.Fatalf("claims issuer/subject = %q/%q, want %q/%q", claims.Issuer, claims.Subject, TokenIssuer, TokenSubject)
	}
}

func TestTokenServiceRejectsInvalidTokens(t *testing.T) {
	fixedNow := time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC)
	service := NewTokenService("test-secret-at-least-32-bytes-long", time.Hour)
	service.now = func() time.Time { return fixedNow }

	validToken, _, err := service.Issue("room-a")
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}

	otherService := NewTokenService("different-secret-at-least-32-bytes", time.Hour)
	otherService.now = func() time.Time { return fixedNow }
	otherToken, _, err := otherService.Issue("room-a")
	if err != nil {
		t.Fatalf("other Issue() error = %v", err)
	}

	tests := []struct {
		name  string
		token string
		room  string
	}{
		{name: "empty token", room: "room-a"},
		{name: "wrong secret", token: otherToken, room: "room-a"},
		{name: "wrong room", token: validToken, room: "room-b"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := service.Verify(tt.token, tt.room); err == nil {
				t.Fatal("Verify() returned nil error")
			}
		})
	}

	expiredClaims := Claims{
		Room: "room-a",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    TokenIssuer,
			Subject:   TokenSubject,
			IssuedAt:  jwt.NewNumericDate(fixedNow.Add(-2 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(fixedNow.Add(-time.Hour)),
		},
	}
	expiredToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, expiredClaims).SignedString(service.secret)
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}
	if _, err := service.Verify(expiredToken, "room-a"); !errors.Is(err, ErrInvalidTranscriptToken) {
		t.Fatalf("expired Verify() error = %v, want ErrInvalidTranscriptToken", err)
	}
}

func TestTokenServiceRequiresSecret(t *testing.T) {
	service := NewTokenService("", time.Hour)
	if _, _, err := service.Issue("room"); !errors.Is(err, ErrTokenServiceDisabled) {
		t.Fatalf("Issue() error = %v, want ErrTokenServiceDisabled", err)
	}
	if _, err := service.Verify("token", "room"); !errors.Is(err, ErrTokenServiceDisabled) {
		t.Fatalf("Verify() error = %v, want ErrTokenServiceDisabled", err)
	}
}

func TestTokenServiceBindsTokenToRoomGeneration(t *testing.T) {
	service := NewTokenService("test-secret-at-least-32-bytes-long", time.Hour)
	token, _, err := service.IssueForGeneration("room-a", 3)
	if err != nil {
		t.Fatalf("IssueForGeneration() error = %v", err)
	}
	if _, err := service.VerifyForGeneration(token, "room-a", 3); err != nil {
		t.Fatalf("VerifyForGeneration() error = %v", err)
	}
	if _, err := service.VerifyForGeneration(token, "room-a", 4); !errors.Is(err, ErrInvalidTranscriptToken) {
		t.Fatalf("VerifyForGeneration() error = %v, want invalid token", err)
	}
}

func TestTokenServiceBindsTokenToLiveKitRoom(t *testing.T) {
	service := NewTokenService("test-secret-at-least-32-bytes-long", time.Hour)
	token, _, err := service.IssueForRoom("room-a", "RM_old", 0)
	if err != nil {
		t.Fatalf("IssueForRoom() error = %v", err)
	}
	if _, err := service.VerifyForRoom(token, "room-a", "RM_old", 0); err != nil {
		t.Fatalf("VerifyForRoom() error = %v", err)
	}
	if _, err := service.VerifyForRoom(token, "room-a", "RM_new", 0); !errors.Is(err, ErrInvalidTranscriptToken) {
		t.Fatalf("VerifyForRoom() error = %v, want invalid token", err)
	}
}
