// Package roomoperations owns LiveKit room lookup, timeout, and mapping policy.
package roomoperations

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrRoomAlreadyExists = errors.New("room already exists")
	ErrRoomNotFound      = errors.New("room not found")
)

const (
	operationTimeout = 5 * time.Second
	detailedTimeout  = 10 * time.Second
)

// RoomRecord is the room data supplied by a LiveKit adapter.
type RoomRecord struct {
	SID             string
	Name            string
	NumParticipants int
	MaxParticipants int
	CreationTime    int64
	EmptyTimeout    int
}

// ParticipantRecord is the participant data supplied by a LiveKit adapter.
type ParticipantRecord struct {
	Identity string
	Name     string
	State    string
}

// Adapter is the LiveKit behavior consumed by room operations.
type Adapter interface {
	CreateRoom(ctx context.Context, name string) (RoomRecord, error)
	ListRooms(ctx context.Context, names []string) ([]RoomRecord, error)
	ListParticipants(ctx context.Context, room string) ([]ParticipantRecord, error)
	DeleteRoom(ctx context.Context, room string) error
	RemoveParticipant(ctx context.Context, room, identity string) error
}

type Room struct {
	SID             string
	Name            string
	NumParticipants int
	MaxParticipants int
	CreationTime    int64
	EmptyTimeout    int
}

type Participant struct {
	Identity string
	Name     string
	IsAgent  bool
	State    string
}

type Details struct {
	Room
	Participants []Participant
}

type Operations struct {
	adapter Adapter
}

func New(adapter Adapter) *Operations {
	if adapter == nil {
		panic("roomoperations: adapter is required")
	}
	return &Operations{adapter: adapter}
}

func (o *Operations) Create(ctx context.Context, name string) (Room, error) {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	record, err := o.adapter.CreateRoom(ctx, name)
	if err != nil {
		return Room{}, fmt.Errorf("create room: %w", err)
	}
	return mapRoom(record), nil
}

func (o *Operations) List(ctx context.Context) ([]Room, error) {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	records, err := o.adapter.ListRooms(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("list rooms: %w", err)
	}
	return mapRooms(records), nil
}

func (o *Operations) Find(ctx context.Context, name string) (Room, error) {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	records, err := o.adapter.ListRooms(ctx, []string{name})
	if err != nil {
		return Room{}, fmt.Errorf("find room: %w", err)
	}
	for _, record := range records {
		if record.Name == name {
			return mapRoom(record), nil
		}
	}
	return Room{}, ErrRoomNotFound
}

func (o *Operations) Get(ctx context.Context, name string) (Details, error) {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	records, err := o.adapter.ListRooms(ctx, []string{name})
	if err != nil {
		return Details{}, fmt.Errorf("find room details: %w", err)
	}
	var room Room
	found := false
	for _, record := range records {
		if record.Name == name {
			room = mapRoom(record)
			found = true
			break
		}
	}
	if !found {
		return Details{}, ErrRoomNotFound
	}

	participants, err := o.adapter.ListParticipants(ctx, name)
	if err != nil {
		return Details{}, fmt.Errorf("list room participants: %w", err)
	}
	room.NumParticipants = len(participants)
	return Details{
		Room:         room,
		Participants: mapParticipants(participants),
	}, nil
}

func (o *Operations) Detailed(ctx context.Context) ([]Details, error) {
	ctx, cancel := context.WithTimeout(ctx, detailedTimeout)
	defer cancel()
	records, err := o.adapter.ListRooms(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("list detailed rooms: %w", err)
	}

	details := make([]Details, 0, len(records))
	for _, record := range records {
		participants, err := o.adapter.ListParticipants(ctx, record.Name)
		if err != nil {
			return nil, fmt.Errorf("list participants for room %q: %w", record.Name, err)
		}
		details = append(details, Details{
			Room:         mapRoom(record),
			Participants: mapParticipants(participants),
		})
	}
	return details, nil
}

func (o *Operations) Delete(ctx context.Context, name string) error {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	if err := o.adapter.DeleteRoom(ctx, name); err != nil {
		return fmt.Errorf("delete room: %w", err)
	}
	return nil
}

func (o *Operations) RemoveParticipant(ctx context.Context, room, identity string) error {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	if err := o.adapter.RemoveParticipant(ctx, room, identity); err != nil {
		return fmt.Errorf("remove participant: %w", err)
	}
	return nil
}

func mapRooms(records []RoomRecord) []Room {
	rooms := make([]Room, 0, len(records))
	for _, record := range records {
		rooms = append(rooms, mapRoom(record))
	}
	return rooms
}

func mapRoom(record RoomRecord) Room {
	return Room{
		SID:             record.SID,
		Name:            record.Name,
		NumParticipants: record.NumParticipants,
		MaxParticipants: record.MaxParticipants,
		CreationTime:    record.CreationTime,
		EmptyTimeout:    record.EmptyTimeout,
	}
}

func mapParticipants(records []ParticipantRecord) []Participant {
	participants := make([]Participant, 0, len(records))
	for _, record := range records {
		participants = append(participants, Participant{
			Identity: record.Identity,
			Name:     record.Name,
			IsAgent:  record.Identity == "asr-agent" || strings.HasPrefix(record.Identity, "agent-"),
			State:    record.State,
		})
	}
	return participants
}
