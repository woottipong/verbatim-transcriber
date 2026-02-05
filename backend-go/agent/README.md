# LiveKit ASR Agent

Thai transcription agent using LiveKit for real-time WebRTC audio streaming and Google Cloud Speech-to-Text.

## Setup

```bash
cd backend-go/agent

# Set environment variables
cp .env.example .env

# Edit .env with your credentials
nano .env
```

## Run Agent

```bash
# Load environment and run
export $(cat .env | xargs)
go run main.go
```

## Environment Variables

- `LIVEKIT_API_KEY` - LiveKit API key (default: devkey)
- `LIVEKIT_API_SECRET` - LiveKit API secret (default: secret123)
- `LIVEKIT_WS_URL` - LiveKit WebSocket URL (default: ws://localhost:7880)
- `LIVEKIT_ROOM_NAME` - Room name to join (default: transcription-room)
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Google Cloud credentials JSON file

## Architecture

```
LiveKit Room → Agent → Google STT → Data Channel → Browser
```
