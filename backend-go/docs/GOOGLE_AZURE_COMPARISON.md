# Google Cloud STT vs Azure Speech Service - การเปรียบเทียบ

> สรุปการตั้งค่าและเปรียบเทียบ Google Cloud Speech-to-Text และ Azure Speech Service สำหรับ Thai Verbatim Transcription

---

## ⚙️ Configuration ปัจจุบัน

### Google Cloud STT
```go
GoogleConfig: GoogleConfig{
    Model:        "latest_long",  // Best for continuous speech
    LanguageCode: "th-TH",
    SampleRate:   48000,          // Dynamic from frontend
    UseEnhanced:  true,
}
```

**Settings:**
- `SingleUtterance: false` - Stream ต่อเนื่อง
- `EnableAutomaticPunctuation: true`
- `ProfanityFilter: false` - Verbatim
- Dynamic sample rate - รับจาก frontend audioContext

### Azure Speech Service
```go
AzureConfig: AzureConfig{
    Language:                   "th-TH",
    SampleRate:                 16000,
    SegmentationSilenceTimeout: 500,  // ลดจาก 1000ms → 500ms
}
```

**Settings:**
- `segmentationSilenceTimeoutMs: 500` - ตัดประโยคเร็วขึ้น
- `enableInterimResults: true`

### Google Models ที่ใช้ได้

| Model                | Best For                       | Thai Support |
| -------------------- | ------------------------------ | ------------ |
| **`latest_long`** ✅  | Long-form audio, conversations | ✅ ดีมาก       |
| `latest_short`       | Short commands (< 15 sec)      | ✅ ดี          |
| `command_and_search` | Voice commands                 | ✅ ดี          |
| `default`            | General purpose                | ✅ พอใช้       |

**❌ ห้าม:** `chirp` (ต้องใช้ Vertex AI)

---

## 📊 การเปรียบเทียบ

### ผลการทดสอบ (Thai Speech, 32 วินาที)

| Provider   | Final Count | ความยาว       | Confidence    | Latency    |
| ---------- | ----------- | ------------- | ------------- | ---------- |
| **Google** | 13 ครั้ง      | สั้น (5-15 คำ)   | **0.94-0.95** | ~200-500ms |
| **Azure**  | 7 ครั้ง       | ยาว (15-25 คำ) | 0.21-0.98     | ~1-3 sec   |

### ✅ Google: จุดแข็ง/จุดอ่อน

**จุดแข็ง:**
- ⚡ เร็ว, confidence สูงสม่ำเสมอ (0.94-0.95)
- 🎯 Real-time, user experience ดี

**จุดอ่อน:**
- ⏱️ **5-minute limit** - ต้อง restart
- 🔪 ตัดประโยคบ่อย

### ⚖️ Azure: จุดแข็ง/จุดอ่อน

**จุดแข็ง:**
- ♾️ **No time limit**
- 📖 รวมประโยคยาว, context ดี

**จุดอ่อน:**
- 🐢 ช้ากว่า Google (2-3 เท่า)
- ⚠️ Confidence แปรปรวนสูง (0.21-0.98)

---

## 💡 คำแนะนำ

| การใช้งาน                  | แนะนำ         | เหตุผล                |
| ------------------------- | ------------ | -------------------- |
| **Live Transcription**    | **Google** ✅ | เร็ว, แม่นยำ, real-time |
| **Long Sessions (>5min)** | **Azure**    | ไม่มี time limit       |
| **Meeting Minutes**       | **Azure**    | Context preservation |

### Best Practice
**ใช้ทั้ง 2 แบบ side-by-side** (ตามที่ implement) เพื่อ redundancy และให้ผู้ใช้เลือก

---

## 🔄 Sample Rate Management

**ปัญหา:** เสียงเพี้ยน หรือแปลไม่ออก → Sample rate ไม่ตรงกัน

**วิธีแก้:** Frontend ส่งค่าจริงจาก audioContext → Backend ใช้ค่านั้น

**ตรวจสอบ:**
```
Frontend: [Google] Audio context sample rate: 48000Hz
Backend:  🎤 [Google] Using sample rate from frontend: 48000 Hz
```

**ค่าที่เจอบ่อย:** 48000 Hz (macOS/Win), 44100 Hz (Linux), 16000 Hz (Mobile)

---

## 🐛 Troubleshooting

### Google: EOF Error
```
❌ [Google] Failed to send audio: EOF
```
**สาเหตุ:** 5-minute limit / Network issue
**แก้:** กด Stop → Start ใหม่

### Google: Invalid Model
```
❌ Invalid recognition 'config': Incorrect model specified
```
**แก้:** ใช้ `latest_long`, `latest_short`, `command_and_search`, `default`, `video` เท่านั้น

### Azure: ช้า
**แก้:** ลด `SegmentationSilenceTimeout: 300` (จาก 500ms)

### Sample Rate Mismatch
**แก้:** ตรวจสอบค่าตรงกันระหว่าง frontend และ backend

---

## 🎯 สรุป

### Google (latest_long + Enhanced)
- **เหมาะสำหรับ:** Real-time transcription, live events
- **จุดเด่น:** เร็ว แม่นยำ สม่ำเสมอ
- **ข้อจำกัด:** 5-minute limit
- **Cost:** ~$0.024/minute

### Azure Speech Service
- **เหมาะสำหรับ:** Long recordings, meeting transcription
- **จุดเด่น:** No time limit, context preservation
- **ข้อจำกัด:** ช้ากว่า, confidence แปรปรวน
- **Cost:** ~$1/hour

---

*เอกสารสร้างจากการปรับปรุง Thai Verbatim Transcriber (Feb 2026)*
