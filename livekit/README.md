# 🎙️ LiveKit Server - Thai Transcription

LiveKit Server สำหรับระบบ Real-time Thai Speech-to-Text

## 📋 Prerequisites

- Docker & Docker Compose
- Port 7880, 7881, 7882 available

## 🚀 Quick Start

### 1. Start Server

```bash
cd livekit
docker-compose up -d
```

### 2. Verify Running

```bash
# Check containers
docker-compose ps

# Check logs
docker-compose logs -f livekit

# Health check
curl http://localhost:7880
```

### 3. Stop Server

```bash
docker-compose down
```

## 🔑 Credentials (Development)

| Key           | Value                   |
| ------------- | ----------------------- |
| API Key       | `devkey`                |
| API Secret    | `secret`                |
| WebSocket URL | `ws://localhost:7880`   |
| HTTP URL      | `http://localhost:7880` |

## 🌐 Ports

| Port | Protocol | Usage                 |
| ---- | -------- | --------------------- |
| 7880 | TCP      | HTTP / WebSocket      |
| 7881 | TCP      | WebRTC TCP (fallback) |
| 7882 | UDP      | WebRTC UDP (primary)  |
| 6379 | TCP      | Redis                 |

## 📁 Files

```
livekit/
├── docker-compose.yml  # Docker services definition
├── livekit.yaml        # LiveKit server configuration
├── .env.example        # Environment variables template
└── README.md           # This file
```

## 🔧 Configuration

### Development Mode (Default)

ใช้ `--dev` flag ใน docker-compose ซึ่ง:
- ไม่ต้องการ Redis
- Auto-generate credentials
- Permissive CORS

### Production Mode

1. Copy `.env.example` to `.env`
2. Update credentials
3. Modify `livekit.yaml`:
   - Set `use_external_ip: true`
   - Configure TURN server
   - Update Redis settings

## 🧪 Testing Connection

### Using LiveKit CLI

```bash
# Install CLI
brew install livekit-cli

# Test connection
livekit-cli room list \
  --url http://localhost:7880 \
  --api-key devkey \
  --api-secret secret
```

### Using curl

```bash
# Health endpoint
curl http://localhost:7880

# Get token (requires token service)
curl -X POST http://localhost:3000/livekit/token \
  -H "Content-Type: application/json" \
  -d '{"identity": "user1", "roomName": "test-room"}'
```

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Find process using port
lsof -i :7880

# Kill process
kill -9 <PID>
```

### Container Won't Start

```bash
# View logs
docker-compose logs livekit

# Restart with rebuild
docker-compose down && docker-compose up -d --build
```

### WebRTC Connection Failed

1. Check firewall allows UDP 7882
2. For remote connections, set `use_external_ip: true`
3. Consider using TURN server

## 📚 Resources

- [LiveKit Docs](https://docs.livekit.io)
- [LiveKit GitHub](https://github.com/livekit/livekit)
- [WebRTC Troubleshooting](https://docs.livekit.io/guides/troubleshooting/)
