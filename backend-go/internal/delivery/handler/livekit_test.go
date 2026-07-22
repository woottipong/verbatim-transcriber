package handler

import (
	"errors"
	"strings"
	"testing"

	"github.com/livekit/protocol/livekit"
	"github.com/livekit/psrpc"
)

func TestValidateRoomName(t *testing.T) {
	tests := []struct {
		name    string
		room    string
		wantErr bool
	}{
		{name: "letters and numbers", room: "daily-briefing_01"},
		{name: "one character", room: "a"},
		{name: "128 characters", room: strings.Repeat("a", 128)},
		{name: "empty", room: "", wantErr: true},
		{name: "leading whitespace", room: " room", wantErr: true},
		{name: "trailing whitespace", room: "room ", wantErr: true},
		{name: "punctuation", room: "room.name", wantErr: true},
		{name: "slash", room: "room/name", wantErr: true},
		{name: "too long", room: strings.Repeat("a", 129), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateRoomName(tt.room); (err != nil) != tt.wantErr {
				t.Fatalf("validateRoomName(%q) error = %v, wantErr %v", tt.room, err, tt.wantErr)
			}
		})
	}
}

func TestIsRoomConflictError(t *testing.T) {
	if !isRoomConflictError(errors.New("room already exists")) {
		t.Fatal("already exists error was not recognized")
	}
	if isRoomConflictError(errors.New("permission denied")) {
		t.Fatal("unrelated error was recognized as a conflict")
	}
	if !isRoomConflictError(psrpc.NewError(psrpc.AlreadyExists, errors.New("room conflict"))) {
		t.Fatal("typed already_exists error was not recognized")
	}
}

func TestContainsRoom(t *testing.T) {
	rooms := []*livekit.Room{
		{Name: "daily-briefing"},
		{Name: "test_room"},
	}

	if !containsRoom(rooms, "test_room") {
		t.Fatal("existing room was not found")
	}
	if containsRoom(rooms, "missing-room") {
		t.Fatal("missing room was reported as existing")
	}
	if containsRoom(append(rooms, nil), "missing-room") {
		t.Fatal("nil room entry should not match")
	}
}
