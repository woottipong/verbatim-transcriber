# 🎙️ Thai Verbatim Transcriber - Quick Start Guide

## ✨ สิ่งที่เปลี่ยนแปลง

### 🎯 ระบบใหม่: Dual Mode Support
ตอนนี้แอปพลิเคชันรองรับ **2 โหมด**:

1. **LiveKit Mode** (แนะนำ) - ใช้ LiveKit framework เพื่อ real-time transcription แบบ low-latency
2. **WebSocket Mode** (Legacy) - เชื่อมต่อโดยตรงกับ ASR providers (Deepgram, Gemini, Google, Azure)

### 🔄 สลับ Mode ได้ง่าย
- เปิดเว็บแล้วจะเห็นปุ่มสลับ mode ที่ header ด้านบน
- การเลือก mode จะถูกบันทึกไว้ใน localStorage

---

## 🚀 วิธีใช้งาน

### 1. Start All Services
```bash
make start
# หรือ
./control.sh start
```

### 2. เปิดเว็บเบราว์เซอร์
```
http://localhost:5173
```

### 3. เลือก Mode

#### **LiveKit Mode (แนะนำ)**
1. ตรวจสอบให้แน่ใจว่า services ทั้งหมดทำงาน:
   - ✅ LiveKit Server (ws://localhost:7880)
   - ✅ Backend API (http://localhost:3000)
   - ✅ ASR Agent (auto-connects to LiveKit)
   - ✅ Frontend (http://localhost:5173)

2. ในหน้าเว็บ:
   - ตรวจสอบ Backend URL: `http://localhost:3000`
   - ตรวจสอบ Room Name: `transcription-room`
   - กด **"Connect & Start"**

3. เมื่อเชื่อมต่อแล้ว:
   - Microphone จะเปิดอัตโนมัติ
   - Transcripts จะปรากฏแบบ real-time
   - ดูสถานะ "Connected" ที่ header

#### **WebSocket Mode (Legacy)**
1. กด Settings (⚙️)
2. เลือก Provider ที่ต้องการ (Deepgram, Gemini, Google, Azure)
3. กด Start Microphone
4. กด Start ที่แต่ละ Provider panel

---

## 📋 คำสั่งที่มีประโยชน์

### Control Script
```bash
# เริ่ม services ทั้งหมด
make start
./control.sh start

# หยุด services
make stop
./control.sh stop

# ดู status
make status
./control.sh status

# รัน service เดียว
./control.sh start --frontend-only
./control.sh start --backend-only
./control.sh start --agent-only
./control.sh start --livekit-only

# ดู logs
make logs
tail -f /tmp/frontend.log
tail -f /tmp/backend.log
tail -f /tmp/agent.log

# ทำความสะอาด
make clean
./control.sh clean
```

---

## 🔍 Troubleshooting

### ปัญหา: Frontend โหลดไม่ขึ้น
```bash
# ตรวจสอบ logs
tail -50 /tmp/frontend.log

# Restart frontend
./control.sh stop --frontend-only
./control.sh start --frontend-only
```

### ปัญหา: ไม่สามารถเชื่อมต่อ LiveKit
```bash
# ตรวจสอบว่า LiveKit ทำงานหรือไม่
cd livekit
docker-compose ps

# Restart LiveKit
./control.sh stop --livekit-only
./control.sh start --livekit-only
```

### ปัญหา: Agent ไม่ทำงาน
```bash
# ดู agent logs
tail -50 /tmp/agent.log

# ตรวจสอบว่ามี .env ใน backend-go/agent/
ls backend-go/agent/.env

# Restart agent
./control.sh stop --agent-only
./control.sh start --agent-only
```

### ปัญหา: Backend ไม่ทำงาน
```bash
# ดู backend logs
tail -50 /tmp/backend.log

# Restart backend
./control.sh stop --backend-only
./control.sh start --backend-only
```

---

## 🏗️ โครงสร้างไฟล์ใหม่

```
frontend/
├── App.tsx                      # Main app with mode switcher
├── components/
│   ├── LiveKitMode.tsx         # LiveKit UI (NEW)
│   ├── WebSocketMode.tsx       # WebSocket UI (refactored)
│   ├── LiveKitRoom.tsx         # LiveKit connection handler
│   └── LiveTranscript.tsx      # LiveKit transcript display
└── ...

backend-go/
├── main.go                      # REST API + WebSocket endpoints
├── agent/                       # LiveKit agent
│   ├── main.go
│   └── .env                     # Agent configuration
└── handlers/
    ├── livekit.go              # LiveKit token generation
    └── ...

control.sh                       # Unified control script
Makefile                         # Easy commands
```

---

## 💡 Tips

1. **ใช้ LiveKit Mode** - เร็วและเสถียรกว่า WebSocket mode
2. **ตรวจสอบ Status** - ใช้ `make status` เพื่อดูว่า services ไหนทำงานอยู่
3. **ดู Logs** - ถ้ามีปัญหา ดู logs ที่ `/tmp/*.log`
4. **Restart อย่างเดียว** - ใช้ `--frontend-only`, `--backend-only` เมื่อต้องการ restart เฉพาะ service

---

## 🎯 Features

### LiveKit Mode
- ✅ Ultra-low latency (~100-200ms)
- ✅ Auto-reconnect
- ✅ Real-time bidirectional communication
- ✅ Support multiple ASR providers (configured in agent)
- ✅ Production-ready

### WebSocket Mode (Legacy)
- ✅ Direct connection to ASR APIs
- ✅ Multiple providers side-by-side
- ✅ Deepgram, Gemini, Google, Azure support
- ✅ VAD (Voice Activity Detection)
- ⚠️ Higher latency

---

## 📞 Support

หากพบปัญหา:
1. ตรวจสอบ logs: `make logs`
2. ตรวจสอบ status: `make status`
3. Restart services: `make restart`
4. Clean และ start ใหม่: `make clean && make start`

---

**สนุกกับการใช้งาน! 🎉**
