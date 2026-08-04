package roomoperations

import (
	"context"
	"errors"
	"slices"
	"testing"
)

func TestOperationsFindUsesNameFilterAndReturnsRoomIdentity(t *testing.T) {
	adapter := &fakeAdapter{
		rooms: []RoomRecord{{SID: "RM_1", Name: "room-a", CreationTime: 10}},
	}
	operations := New(adapter)

	room, err := operations.Find(context.Background(), "room-a")
	if err != nil {
		t.Fatalf("Find() error = %v", err)
	}
	if room.SID != "RM_1" || room.Name != "room-a" {
		t.Fatalf("Find() = %#v", room)
	}
	if !slices.Equal(adapter.listNames, []string{"room-a"}) {
		t.Fatalf("ListRooms names = %#v, want room filter", adapter.listNames)
	}
}

func TestOperationsFindReturnsNotFound(t *testing.T) {
	operations := New(&fakeAdapter{})
	if _, err := operations.Find(context.Background(), "missing"); !errors.Is(err, ErrRoomNotFound) {
		t.Fatalf("Find() error = %v, want %v", err, ErrRoomNotFound)
	}
}

func TestOperationsDetailedFailsWhenParticipantLookupFails(t *testing.T) {
	upstreamErr := errors.New("livekit unavailable")
	adapter := &fakeAdapter{
		rooms: []RoomRecord{
			{Name: "room-a"},
			{Name: "room-b"},
		},
		participantErrors: map[string]error{"room-b": upstreamErr},
	}
	operations := New(adapter)

	details, err := operations.Detailed(context.Background())
	if !errors.Is(err, upstreamErr) {
		t.Fatalf("Detailed() error = %v, want upstream error", err)
	}
	if details != nil {
		t.Fatalf("Detailed() = %#v, want no partial response", details)
	}
}

func TestOperationsMapsAgentParticipants(t *testing.T) {
	adapter := &fakeAdapter{
		rooms: []RoomRecord{{
			SID:             "RM_1",
			Name:            "room-a",
			MaxParticipants: 20,
		}},
		participants: map[string][]ParticipantRecord{
			"room-a": {
				{Identity: "speaker-1", State: "ACTIVE"},
				{Identity: "agent-google-room-a", State: "ACTIVE"},
			},
		},
	}
	operations := New(adapter)

	details, err := operations.Get(context.Background(), "room-a")
	if err != nil {
		t.Fatal(err)
	}
	if details.Participants[0].IsAgent {
		t.Fatal("speaker classified as agent")
	}
	if !details.Participants[1].IsAgent {
		t.Fatal("agent identity not classified as agent")
	}
	if details.SID != "RM_1" || details.MaxParticipants != 20 || details.NumParticipants != 2 {
		t.Fatalf("Get() room metadata = %#v", details.Room)
	}
}

func TestOperationsGetReturnsNotFoundBeforeListingParticipants(t *testing.T) {
	adapter := &fakeAdapter{}
	operations := New(adapter)

	if _, err := operations.Get(context.Background(), "missing"); !errors.Is(err, ErrRoomNotFound) {
		t.Fatalf("Get() error = %v, want %v", err, ErrRoomNotFound)
	}
	if adapter.participantCalls != 0 {
		t.Fatalf("participant lookups = %d, want 0", adapter.participantCalls)
	}
}

func TestOperationsPropagatesCancellationAndAddsDeadline(t *testing.T) {
	adapter := &fakeAdapter{inspectContext: true}
	operations := New(adapter)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := operations.List(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("List() error = %v, want context cancellation", err)
	}
	if !adapter.sawDeadline {
		t.Fatal("List() did not add an operation deadline")
	}
}

type fakeAdapter struct {
	rooms             []RoomRecord
	participants      map[string][]ParticipantRecord
	participantErrors map[string]error
	listNames         []string
	inspectContext    bool
	sawDeadline       bool
	participantCalls  int
}

func (a *fakeAdapter) CreateRoom(context.Context, string) (RoomRecord, error) {
	return RoomRecord{}, nil
}

func (a *fakeAdapter) ListRooms(ctx context.Context, names []string) ([]RoomRecord, error) {
	a.listNames = append([]string(nil), names...)
	if a.inspectContext {
		_, a.sawDeadline = ctx.Deadline()
		return nil, ctx.Err()
	}
	return a.rooms, nil
}

func (a *fakeAdapter) ListParticipants(_ context.Context, room string) ([]ParticipantRecord, error) {
	a.participantCalls++
	if err := a.participantErrors[room]; err != nil {
		return nil, err
	}
	return a.participants[room], nil
}

func (a *fakeAdapter) DeleteRoom(context.Context, string) error {
	return nil
}

func (a *fakeAdapter) RemoveParticipant(context.Context, string, string) error {
	return nil
}
