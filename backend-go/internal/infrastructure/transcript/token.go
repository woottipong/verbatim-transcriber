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
	ErrTokenServiceDisabled   = errors.New("transcript token service is disabled")
	ErrInvalidTranscriptToken = errors.New("invalid transcript token")
	ErrInvalidTranscriptRoom  = errors.New("invalid transcript room")
)

// Claims are intentionally limited to a room-scoped, read-only subscription.
type Claims struct {
	Room string `json:"room"`
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

func (s *TokenService) Issue(room string) (string, time.Time, error) {
	if s == nil || len(s.secret) < MinimumSecretLength {
		return "", time.Time{}, ErrTokenServiceDisabled
	}
	room = strings.TrimSpace(room)
	if room == "" {
		return "", time.Time{}, ErrInvalidTranscriptRoom
	}
	if s.ttl <= 0 {
		return "", time.Time{}, errors.New("transcript token ttl must be positive")
	}

	now := s.now()
	expiresAt := now.Add(s.ttl)
	claims := Claims{
		Room: room,
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
	if s == nil || len(s.secret) < MinimumSecretLength {
		return nil, ErrTokenServiceDisabled
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
	if err != nil || !parsed.Valid || claims.Room == "" || claims.Room != strings.TrimSpace(expectedRoom) {
		return nil, ErrInvalidTranscriptToken
	}
	return claims, nil
}
