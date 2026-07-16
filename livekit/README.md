# Local LiveKit server

Docker Compose setup for local Thai Verbatim Transcriber development.

## Requirements

- Docker with Docker Compose
- Available ports 7880/TCP, 7881/TCP, 7882/UDP, 50000-50100/UDP, and 6379/TCP

## Start

```bash
cp .env.example .env
docker compose up -d
docker compose ps
docker compose logs -f livekit
```

Stop with:

```bash
docker compose down
```

Use `docker compose down -v` only when intentionally deleting the local Redis volume.

## Development credentials

| Setting | Default |
| --- | --- |
| API key | `devkey` |
| API secret | `secret` |
| WebSocket URL | `ws://localhost:7880` |
| HTTP URL | `http://localhost:7880` |

These credentials are public development defaults. Never use them for a remote or production server.

Copy the same key, secret, and WebSocket URL into `backend-go/.env`. The frontend normally uses `VITE_LIVEKIT_URL=ws://localhost:7880`.

## Containers and ports

| Service/port | Purpose |
| --- | --- |
| `livekit` | LiveKit development server |
| `redis` | Local Redis container/volume reserved by the Compose stack |
| `7880/TCP` | HTTP signaling and WebSocket |
| `7881/TCP` | WebRTC TCP fallback |
| `7882/UDP` | WebRTC UDP in development mode |
| `50000-50100/UDP` | Exposed RTC UDP range |
| `6379/TCP` | Redis |

The Compose service launches LiveKit with `--dev --bind 0.0.0.0`. `livekit.yaml` documents production-oriented RTC, Redis, room, and TURN settings but is not passed to the development command by default.

## Verify

```bash
curl http://localhost:7880

curl -X POST http://localhost:3000/livekit/token \
  -H 'Content-Type: application/json' \
  -d '{"identity":"user1","roomName":"test"}'
```

The second command requires the Go backend to be running with matching LiveKit credentials.

## Production checklist

- Replace the development key and secret.
- Use TLS and a `wss://` URL.
- Configure external IP discovery for the deployment environment.
- Open the required TCP/UDP ports.
- Configure TURN for restrictive NAT/firewall environments.
- Decide whether Redis/multi-node support is required.
- Mount and pass an explicit LiveKit configuration rather than relying on `--dev`.

## Troubleshooting

### Port conflict

```bash
lsof -nP -iTCP:7880 -sTCP:LISTEN
lsof -nP -iUDP:7882
```

### Container unhealthy

```bash
docker compose ps
docker compose logs livekit
docker compose restart livekit
```

### Browser cannot connect

1. Confirm backend and frontend use the same LiveKit host.
2. Confirm API key/secret match between Compose and `backend-go/.env`.
3. Check WebRTC UDP/firewall rules.
4. For remote access, configure external IP and TURN.

See the root [README](../README.md) for the complete application setup.
