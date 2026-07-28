// Package transcriptaccess owns transcript-feed authorization policy.
package transcriptaccess

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"thai-transcriber-backend/internal/application/roomoperations"
)

var roomNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

var (
	ErrInvalidRoom     = errors.New("invalid transcript room")
	ErrInvalidProvider = errors.New("invalid transcript provider")
)

type Scope struct {
	Room     string
	Provider string
}

type Grant struct {
	Token     string
	ExpiresAt time.Time
	Scope     Scope
}

type RoomFinder interface {
	Find(ctx context.Context, name string) (roomoperations.Room, error)
}

type TokenCodec interface {
	Ready() error
	IssueScoped(room, provider, roomSID string, generation uint64) (string, time.Time, error)
	VerifyScoped(rawToken, room, provider, roomSID string, generation uint64) error
}

type GenerationSource interface {
	Generation(room string) uint64
}

type Policy struct {
	rooms       RoomFinder
	tokens      TokenCodec
	generations GenerationSource
}

func New(rooms RoomFinder, tokens TokenCodec, generations GenerationSource) *Policy {
	if rooms == nil || tokens == nil || generations == nil {
		panic("transcriptaccess: rooms, tokens, and generations are required")
	}
	return &Policy{rooms: rooms, tokens: tokens, generations: generations}
}

func (p *Policy) Issue(ctx context.Context, requested Scope) (Grant, error) {
	if err := p.tokens.Ready(); err != nil {
		return Grant{}, err
	}
	scope, err := normalizeScope(requested)
	if err != nil {
		return Grant{}, err
	}
	room, err := p.rooms.Find(ctx, scope.Room)
	if err != nil {
		return Grant{}, err
	}
	token, expiresAt, err := p.tokens.IssueScoped(
		scope.Room,
		scope.Provider,
		room.SID,
		p.generations.Generation(scope.Room),
	)
	if err != nil {
		return Grant{}, err
	}
	return Grant{Token: token, ExpiresAt: expiresAt, Scope: scope}, nil
}

func (p *Policy) Authorize(ctx context.Context, requested Scope, rawToken string) error {
	if err := p.tokens.Ready(); err != nil {
		return err
	}
	scope, err := normalizeScope(requested)
	if err != nil {
		return err
	}
	room, err := p.rooms.Find(ctx, scope.Room)
	if err != nil {
		return err
	}
	return p.tokens.VerifyScoped(
		rawToken,
		scope.Room,
		scope.Provider,
		room.SID,
		p.generations.Generation(scope.Room),
	)
}

func normalizeScope(scope Scope) (Scope, error) {
	scope.Room = strings.TrimSpace(scope.Room)
	if !roomNamePattern.MatchString(scope.Room) {
		return Scope{}, ErrInvalidRoom
	}
	scope.Provider = strings.ToLower(strings.TrimSpace(scope.Provider))
	if scope.Provider == "" {
		return scope, nil
	}
	switch scope.Provider {
	case "google", "gemini", "azure", "gpt-realtime-whisper":
		return scope, nil
	default:
		return Scope{}, ErrInvalidProvider
	}
}
