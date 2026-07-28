// Package livekitroom adapts the LiveKit RoomService client to room operations.
package livekitroom

import (
	"context"
	"strings"

	"thai-transcriber-backend/internal/application/roomoperations"

	"github.com/livekit/protocol/livekit"
	"github.com/livekit/psrpc"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

type Adapter struct {
	client *lksdk.RoomServiceClient
}

func New(url, apiKey, apiSecret string) *Adapter {
	return &Adapter{
		client: lksdk.NewRoomServiceClient(url, apiKey, apiSecret),
	}
}

func (a *Adapter) CreateRoom(ctx context.Context, name string) (roomoperations.RoomRecord, error) {
	room, err := a.client.CreateRoom(ctx, &livekit.CreateRoomRequest{Name: name})
	if err != nil {
		return roomoperations.RoomRecord{}, mapError(err)
	}
	return mapRoom(room), nil
}

func (a *Adapter) ListRooms(ctx context.Context, names []string) ([]roomoperations.RoomRecord, error) {
	response, err := a.client.ListRooms(ctx, &livekit.ListRoomsRequest{Names: names})
	if err != nil {
		return nil, mapError(err)
	}
	rooms := make([]roomoperations.RoomRecord, 0, len(response.Rooms))
	for _, room := range response.Rooms {
		if room != nil {
			rooms = append(rooms, mapRoom(room))
		}
	}
	return rooms, nil
}

func (a *Adapter) ListParticipants(ctx context.Context, room string) ([]roomoperations.ParticipantRecord, error) {
	response, err := a.client.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: room})
	if err != nil {
		return nil, mapError(err)
	}
	participants := make([]roomoperations.ParticipantRecord, 0, len(response.Participants))
	for _, participant := range response.Participants {
		if participant == nil {
			continue
		}
		participants = append(participants, roomoperations.ParticipantRecord{
			Identity: participant.Identity,
			Name:     participant.Name,
			State:    participant.State.String(),
		})
	}
	return participants, nil
}

func (a *Adapter) DeleteRoom(ctx context.Context, room string) error {
	_, err := a.client.DeleteRoom(ctx, &livekit.DeleteRoomRequest{Room: room})
	return mapError(err)
}

func (a *Adapter) RemoveParticipant(ctx context.Context, room, identity string) error {
	_, err := a.client.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{
		Room:     room,
		Identity: identity,
	})
	return mapError(err)
}

func mapRoom(room *livekit.Room) roomoperations.RoomRecord {
	return roomoperations.RoomRecord{
		SID:             room.Sid,
		Name:            room.Name,
		NumParticipants: int(room.NumParticipants),
		MaxParticipants: int(room.MaxParticipants),
		CreationTime:    room.CreationTime,
		EmptyTimeout:    int(room.EmptyTimeout),
	}
}

func mapError(err error) error {
	if err == nil {
		return nil
	}
	if code, ok := psrpc.GetErrorCode(err); ok {
		switch code {
		case psrpc.AlreadyExists:
			return roomoperations.ErrRoomAlreadyExists
		case psrpc.NotFound:
			return roomoperations.ErrRoomNotFound
		}
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "already exists"),
		strings.Contains(message, "already_exists"),
		strings.Contains(message, "room exists"),
		strings.Contains(message, "already_present"),
		strings.Contains(message, "already present"):
		return roomoperations.ErrRoomAlreadyExists
	case strings.Contains(message, "not found"):
		return roomoperations.ErrRoomNotFound
	default:
		return err
	}
}
