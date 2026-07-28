package transcript

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	TokenIssuer         = "transcript:subscribe"
	TokenSubject        = "transcript:subscribe"
	MinimumSecretLength = 32
)

var (
	ErrTokenServiceDisabled      = errors.New("transcript token service is disabled")
	ErrInvalidTranscriptToken    = errors.New("invalid transcript token")
	ErrInvalidTranscriptRoom     = errors.New("invalid transcript room")
	ErrInvalidTranscriptProvider = errors.New("invalid transcript provider")
)

// Claims are intentionally limited to a room-scoped, read-only subscription.
type Claims struct {
	Room       string `json:"room"`
	Provider   string `json:"provider,omitempty"`
	RoomSID    string `json:"roomSid,omitempty"`
	Generation uint64 `json:"generation,omitempty"`
	jwt.RegisteredClaims
}

type TokenService struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

func NewTokenService(secret string, ttl time.Duration) *TokenService {
	return &TokenService{
		secret: []byte(strings.TrimSpace(secret)),
		ttl:    ttl,
		now:    time.Now,
	}
}

func (s *TokenService) Ready() error {
	if s == nil || len(s.secret) < MinimumSecretLength {
		return ErrTokenServiceDisabled
	}
	if s.ttl <= 0 {
		return errors.New("transcript token ttl must be positive")
	}
	return nil
}

func (s *TokenService) Issue(room string) (string, time.Time, error) {
	return s.IssueForGeneration(room, 0)
}

func (s *TokenService) IssueForGeneration(room string, generation uint64) (string, time.Time, error) {
	return s.IssueForRoom(room, "", generation)
}

func (s *TokenService) IssueForRoom(room, roomSID string, generation uint64) (string, time.Time, error) {
	return s.issue(room, "", roomSID, generation)
}

func (s *TokenService) IssueForProviderRoom(room, provider, roomSID string, generation uint64) (string, time.Time, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if !isSupportedProvider(provider) {
		return "", time.Time{}, ErrInvalidTranscriptProvider
	}
	return s.issue(room, provider, roomSID, generation)
}

func (s *TokenService) IssueScoped(room, provider, roomSID string, generation uint64) (string, time.Time, error) {
	if strings.TrimSpace(provider) == "" {
		return s.IssueForRoom(room, roomSID, generation)
	}
	return s.IssueForProviderRoom(room, provider, roomSID, generation)
}

func (s *TokenService) issue(room, provider, roomSID string, generation uint64) (string, time.Time, error) {
	if err := s.Ready(); err != nil {
		return "", time.Time{}, err
	}
	room = strings.TrimSpace(room)
	if room == "" {
		return "", time.Time{}, ErrInvalidTranscriptRoom
	}
	now := s.now()
	expiresAt := now.Add(s.ttl)
	claims := Claims{
		Room:       room,
		Provider:   provider,
		RoomSID:    roomSID,
		Generation: generation,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    TokenIssuer,
			Subject:   TokenSubject,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	rawToken, err := token.SignedString(s.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return rawToken, expiresAt, nil
}

func (s *TokenService) Verify(rawToken, expectedRoom string) (*Claims, error) {
	return s.VerifyForGeneration(rawToken, expectedRoom, 0)
}

func (s *TokenService) VerifyForGeneration(rawToken, expectedRoom string, expectedGeneration uint64) (*Claims, error) {
	return s.VerifyForRoom(rawToken, expectedRoom, "", expectedGeneration)
}

func (s *TokenService) VerifyForRoom(rawToken, expectedRoom, expectedRoomSID string, expectedGeneration uint64) (*Claims, error) {
	claims, err := s.verify(rawToken, expectedRoom, "", expectedRoomSID, expectedGeneration)
	if err != nil {
		return nil, err
	}
	if claims.Provider != "" {
		return nil, ErrInvalidTranscriptToken
	}
	return claims, nil
}

func (s *TokenService) VerifyForProviderRoom(rawToken, expectedRoom, expectedProvider, expectedRoomSID string, expectedGeneration uint64) (*Claims, error) {
	expectedProvider = strings.ToLower(strings.TrimSpace(expectedProvider))
	if !isSupportedProvider(expectedProvider) {
		return nil, ErrInvalidTranscriptToken
	}
	return s.verify(rawToken, expectedRoom, expectedProvider, expectedRoomSID, expectedGeneration)
}

func (s *TokenService) VerifyScoped(rawToken, room, provider, roomSID string, generation uint64) error {
	if strings.TrimSpace(provider) == "" {
		_, err := s.VerifyForRoom(rawToken, room, roomSID, generation)
		return err
	}
	_, err := s.VerifyForProviderRoom(rawToken, room, provider, roomSID, generation)
	return err
}

func (s *TokenService) verify(rawToken, expectedRoom, expectedProvider, expectedRoomSID string, expectedGeneration uint64) (*Claims, error) {
	if err := s.Ready(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(rawToken) == "" {
		return nil, ErrInvalidTranscriptToken
	}

	claims := &Claims{}
	parserOptions := []jwt.ParserOption{
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(TokenIssuer),
		jwt.WithSubject(TokenSubject),
	}
	if s.now != nil {
		parserOptions = append(parserOptions, jwt.WithTimeFunc(s.now))
	}
	parsed, err := jwt.ParseWithClaims(rawToken, claims, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidTranscriptToken
		}
		return s.secret, nil
	}, parserOptions...)
	if err != nil || !parsed.Valid || claims.Room == "" || claims.Room != strings.TrimSpace(expectedRoom) ||
		(expectedProvider != "" && claims.Provider != expectedProvider) ||
		(expectedRoomSID != "" && claims.RoomSID != expectedRoomSID) ||
		(expectedGeneration > 0 && claims.Generation != expectedGeneration) {
		return nil, ErrInvalidTranscriptToken
	}
	return claims, nil
}

func isSupportedProvider(provider string) bool {
	switch provider {
	case "google", "gemini", "azure", "gpt-realtime-whisper":
		return true
	default:
		return false
	}
}
