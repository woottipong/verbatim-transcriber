package transcriptaccess

import (
	"context"
	"errors"
	"testing"
	"time"

	"thai-transcriber-backend/internal/application/roomoperations"
)

func TestPolicyIssuesAndAuthorizesTheSameScope(t *testing.T) {
	codec := &fakeCodec{}
	policy := New(
		fakeRooms{room: roomoperations.Room{Name: "room-a", SID: "RM_1"}},
		codec,
		fakeGenerations(3),
	)

	grant, err := policy.Issue(context.Background(), Scope{Room: "room-a", Provider: " GOOGLE "})
	if err != nil {
		t.Fatal(err)
	}
	if grant.Scope.Provider != "google" || codec.provider != "google" || codec.roomSID != "RM_1" || codec.generation != 3 {
		t.Fatalf("grant or codec scope was not normalized and bound: %#v, %#v", grant, codec)
	}
	if err := policy.Authorize(context.Background(), grant.Scope, grant.Token); err != nil {
		t.Fatal(err)
	}
}

func TestPolicyRejectsInvalidProviderBeforeRoomLookup(t *testing.T) {
	rooms := &countingRooms{}
	policy := New(rooms, &fakeCodec{}, fakeGenerations(0))

	if _, err := policy.Issue(context.Background(), Scope{Room: "room-a", Provider: "openai"}); !errors.Is(err, ErrInvalidProvider) {
		t.Fatalf("Issue() error = %v, want ErrInvalidProvider", err)
	}
	if rooms.calls != 0 {
		t.Fatalf("room lookups = %d, want 0", rooms.calls)
	}
}

type fakeRooms struct {
	room roomoperations.Room
	err  error
}

func (f fakeRooms) Find(context.Context, string) (roomoperations.Room, error) {
	return f.room, f.err
}

type countingRooms struct {
	calls int
}

func (f *countingRooms) Find(context.Context, string) (roomoperations.Room, error) {
	f.calls++
	return roomoperations.Room{}, roomoperations.ErrRoomNotFound
}

type fakeGenerations uint64

func (f fakeGenerations) Generation(string) uint64 {
	return uint64(f)
}

type fakeCodec struct {
	readyErr   error
	provider   string
	purpose    string
	roomSID    string
	generation uint64
}

func (f *fakeCodec) Ready() error {
	return f.readyErr
}

func (f *fakeCodec) IssueScoped(room, provider, purpose, roomSID string, generation uint64) (string, time.Time, error) {
	f.provider = provider
	f.purpose = purpose
	f.roomSID = roomSID
	f.generation = generation
	return "token", time.Now().Add(time.Hour), nil
}

func TestPolicyChecksCodecReadinessBeforeRoomLookup(t *testing.T) {
	rooms := &countingRooms{}
	notReady := errors.New("not ready")
	policy := New(rooms, &fakeCodec{readyErr: notReady}, fakeGenerations(0))

	if _, err := policy.Issue(context.Background(), Scope{Room: "room-a"}); !errors.Is(err, notReady) {
		t.Fatalf("Issue() error = %v, want readiness error", err)
	}
	if rooms.calls != 0 {
		t.Fatalf("room lookups = %d, want 0", rooms.calls)
	}
}

func (f *fakeCodec) VerifyScoped(_ string, _, provider, purpose, roomSID string, generation uint64) error {
	f.provider = provider
	f.purpose = purpose
	f.roomSID = roomSID
	f.generation = generation
	return nil
}
