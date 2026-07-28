package livekitroom

import (
	"errors"
	"testing"

	"thai-transcriber-backend/internal/application/roomoperations"

	"github.com/livekit/psrpc"
)

func TestMapErrorMapsLiveKitRoomSemantics(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want error
	}{
		{
			name: "already exists code",
			err:  psrpc.NewError(psrpc.AlreadyExists, errors.New("conflict")),
			want: roomoperations.ErrRoomAlreadyExists,
		},
		{
			name: "not found code",
			err:  psrpc.NewError(psrpc.NotFound, errors.New("missing")),
			want: roomoperations.ErrRoomNotFound,
		},
		{
			name: "legacy conflict text",
			err:  errors.New("room already exists"),
			want: roomoperations.ErrRoomAlreadyExists,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := mapError(tt.err); !errors.Is(err, tt.want) {
				t.Fatalf("mapError() = %v, want %v", err, tt.want)
			}
		})
	}
}
