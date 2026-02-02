# Azure Speech Service - Native SDK Issue

## ⚠️ ปัญหา

Azure Speech SDK สำหรับ Go (**github.com/Microsoft/cognitive-services-speech-sdk-go**) เป็น CGO binding ที่ต้องการ:

1. **Azure Cognitive Services Speech SDK C library** ติดตั้งในระบบ
2. Native header files: `speechapi_c_*.h`
3. Shared libraries: `.dylib` (macOS), `.so` (Linux), `.dll` (Windows)

## ❌ Error ที่พบ

```
fatal error: 'speechapi_c_common.h' file not found
```

## ✅ วิธีแก้ปัจจุบัน

เปลี่ยนไปใช้ **stub implementation** แทน:

- ไฟล์ `handlers/azure.go` → เปลี่ยนชื่อเป็น `handlers/azure.go.disabled`
- สร้าง `handlers/azure_stub.go` - implementation ที่ส่ง error message
- Azure endpoint จะยังทำงานได้ แต่จะบอกว่าต้องการ native SDK

## 🔧 ถ้าต้องการใช้ Azure จริง

### macOS:
```bash
# Download Azure Speech SDK
curl -L https://aka.ms/csspeech/macosx -o SpeechSDK.zip
unzip SpeechSDK.zip
sudo cp -R MicrosoftCognitiveServicesSpeech.xcframework/macos-arm64_x86_64/MicrosoftCognitiveServicesSpeech.framework /Library/Frameworks/

# Set environment variables
export SPEECHSDK_ROOT=/Library/Frameworks/MicrosoftCognitiveServicesSpeech.framework
export CGO_CFLAGS="-I${SPEECHSDK_ROOT}/Headers"
export CGO_LDFLAGS="-F/Library/Frameworks -framework MicrosoftCognitiveServicesSpeech"

# Restore original azure.go
mv handlers/azure.go.disabled handlers/azure.go
rm handlers/azure_stub.go

# Rebuild
go build
```

### Linux:
```bash
# Download and install Speech SDK
wget https://aka.ms/csspeech/linuxbinary
tar -xvf linuxbinary
sudo cp -R SpeechSDK-Linux-*/lib/* /usr/local/lib/
sudo cp -R SpeechSDK-Linux-*/include/* /usr/local/include/
sudo ldconfig

export CGO_CFLAGS="-I/usr/local/include"
export CGO_LDFLAGS="-L/usr/local/lib -lMicrosoft.CognitiveServices.Speech.core"
```

## 📊 สถานะ Providers ปัจจุบัน

- ✅ **Deepgram** - Pure Go, ไม่ต้อง native dependencies
- ✅ **Gemini** - Pure Go, ไม่ต้อง native dependencies  
- ✅ **Google Cloud Speech-to-Text** - Pure Go, ไม่ต้อง native dependencies
- ⚠️ **Azure** - Stub only (ต้องการ native SDK)

## 💡 แนะนำ

ถ้าไม่จำเป็นต้องใช้ Azure ให้ใช้ **Deepgram, Gemini, หรือ Google** แทน - ทั้งหมดเป็น pure Go ไม่มีปัญหา native dependencies
