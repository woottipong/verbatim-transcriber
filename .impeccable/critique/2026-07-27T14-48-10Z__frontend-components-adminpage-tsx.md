---
target: Admin UX/UI สำหรับ workflow ทั้งหมด
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-07-27T14-48-10Z
slug: frontend-components-adminpage-tsx
---
# Admin UX/UI Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2/4 | “Room ready” แสดงแม้ยังไม่มี audio sender หรือ provider |
| 2 | Match System / Real World | 2/4 | คำอย่าง “Interim + Final” และ “signed WebSocket” เป็นภาษาระบบมากกว่าภาษางาน |
| 3 | User Control and Freedom | 2/4 | dialog ไม่มี focus trap/restore และ Remove participant ทำทันที |
| 4 | Consistency and Standards | 3/4 | component สม่ำเสมอ แต่ “Stream link” กับ “Audio Sender” ใช้ชื่อไม่ตรงกัน |
| 5 | Error Prevention | 1/4 | ไม่มีการกัน configuration error ล่วงหน้า และการ copy อาจสร้าง credential ใหม่โดยไม่ชัดเจน |
| 6 | Recognition Rather Than Recall | 2/4 | ผู้ใช้ต้องจำลำดับ setup และรวมสถานะจากหลาย card เอง |
| 7 | Flexibility and Efficiency | 2/4 | มี search/copy/open แต่ไม่มี workflow summary หรือ next action |
| 8 | Aesthetic and Minimalist Design | 3/4 | สงบและอ่านง่าย แต่ nested cards และ metadata ซ้ำเพิ่มภาระการสแกน |
| 9 | Error Recovery | 1/4 | error อยู่ใน toast ชั่วคราวและไม่มีวิธีแก้ในบริบท |
| 10 | Help and Documentation | 2/4 | มี microcopy แต่ prerequisite และ contract ทางเทคนิคไม่ถูกเปิดเผยตามจังหวะ |
| **Total** | | **20/40** | **ฐานใช้งานได้ แต่ operational clarity และ recovery ยังอ่อน** |

## Design Specificity Verdict

หน้า Admin มีโครงสร้างที่ผูกกับผลิตภัณฑ์จริง—room, provider agent, sender/viewer link, external feed และ participants—แต่ composition ยังเป็น dashboard แบบ sidebar + cards ที่เปลี่ยนชื่อแล้วใช้กับระบบอื่นได้ทันที จุดเฉพาะของงาน transcription คือ “ห้องพร้อมรับเสียงหรือยัง และกำลังถอดจริงหรือไม่” ยังไม่ถูกยกให้เป็นแกนหลักของหน้า

Automated detector ไม่พบข้อผิดพลาดเชิงกลใน `frontend/components/AdminPage.tsx` (0 findings) ซึ่งสอดคล้องกับฐาน component ที่สะอาด แต่ detector ไม่สามารถจับ semantic mismatch เช่น “Room ready” ที่ไม่ตรงกับสถานะจริง หรือ flow ที่ผู้ใช้ต้องประกอบเองได้

Browser inspection ที่ 1680×824 พบว่า layout ไม่มี horizontal overflow, ปุ่มที่ตรวจ 13 ปุ่มสูง 44px และ hierarchy หลัก render ครบ อย่างไรก็ดี overlay injection ทำไม่ได้เพราะ browser evaluation เป็น read-only จึงใช้ DOM geometry และ full-page screenshot เป็นหลักฐานแทน

## Overall Impression

ภาพรวมสงบ เป็นมืออาชีพ และองค์ประกอบพื้นฐานไว้ใจได้ แต่หน้าให้ทุก section มีน้ำหนักใกล้กันจนผู้ปฏิบัติงานไม่รู้ว่า “สิ่งถัดไปที่ต้องทำ” คืออะไร โอกาสใหญ่ที่สุดคือเปลี่ยนจากหน้า CRUD dashboard เป็น room workflow ที่บอกสถานะและ next action หนึ่งอย่างอย่างมั่นใจ

## What’s Working

1. ปุ่มและสถานะมีรูปแบบสม่ำเสมอ มี loading state, focus-visible และ touch target 44px
2. empty states ครบทั้ง loading, no room, no search result, no feed และ no participants
3. provider feed แยกแถวชัดเจน สอดคล้องกับ contract ของ WebSocket และแสดง expiry/copy action ในบริบท

## Priority Issues

### [P1] Readiness language ไม่ตรงกับสถานะระบบจริง

- **Why it matters:** “Room ready” ปรากฏทันทีเมื่อเลือกห้อง แม้ยังไม่มี audio publisher และ agent ทำให้ผู้ใช้เชื่อว่าระบบพร้อมถอดแล้ว
- **Fix:** เปลี่ยนเป็น readiness strip ที่สรุป `Waiting for audio` → `Provider listening` → `Ready to distribute` จากสถานะจริง และให้ next action เพียงหนึ่งอย่าง
- **Suggested command:** `$impeccable clarify`

### [P1] WebSocket error ไม่มี recovery ในบริบท

- **Why it matters:** ข้อผิดพลาด `Transcript WebSocket links are not configured` หายไปกับ toast และไม่บอกว่าต้องตั้งค่า backend หรือ retry
- **Fix:** แสดง persistent inline error ภายใน External transcript feed, อธิบาย prerequisite โดยไม่เปิดเผย secret, ปิดปุ่มเมื่อรู้ว่า config ไม่พร้อม และมี Retry สำหรับ error ที่กู้คืนได้
- **Suggested command:** `$impeccable harden`

### [P1] Information architecture ไม่สะท้อนลำดับงานของ operator

- **Why it matters:** Agent, links, feed และ participants มี card weight ใกล้กัน ผู้ใช้ต้องคิดเองว่าควร connect sender, start provider หรือแชร์ viewer ก่อน
- **Fix:** จัดส่วนหลักตาม flow `Connect audio → Start transcription → Share output`; ยุบ participants และรายละเอียด protocol เป็นส่วนรองหลังระบบพร้อม
- **Suggested command:** `$impeccable distill`

### [P2] Signed-link behavior สร้างความประหลาดใจ

- **Why it matters:** `Copy URL` สามารถสร้าง credential อายุ 24 ชั่วโมงโดยอัตโนมัติ และ `Refresh link` ไม่บอกว่า link เก่าถูก revoke หรือยัง
- **Fix:** แยก Generate ออกจาก Copy, แสดง URL แบบ masked/read-only พร้อม expiry และใช้คำที่ตรงกับพฤติกรรมจริง เช่น Generate new link โดยอธิบายสถานะ link เก่า
- **Suggested command:** `$impeccable clarify`

### [P2] Destructive actions และ dialog ยังไม่แข็งแรง

- **Why it matters:** Remove participant ทำทันที รวมถึง agent; modal ไม่มี focus trap และไม่คืน focus
- **Fix:** ให้ agent ใช้ Stop agent เท่านั้น, confirm การ remove ผู้ใช้, trap/restore focus และประกาศ busy/completion ให้ assistive technology
- **Suggested command:** `$impeccable audit`

## Persona Red Flags

**Jordan — First-time administrator**

- เห็น “Room ready” แต่ไม่รู้ว่าต้องเปิด Audio Sender หรือ Start Agent ก่อน
- เจอศัพท์ “Interim + Final” และ “signed WebSocket URL” ก่อนเข้าใจเป้าหมายงาน
- เมื่อ configuration ผิด ได้ toast ที่ไม่มีขั้นตอนแก้

**Alex — Production operator**

- ต้องสแกนหลาย card เพื่อยืนยันว่าระบบรับเสียงและถอดอยู่จริง
- provider หลายตัวทำให้ feed rows ยาวขึ้น แต่ไม่มี trusted room summary หรือ next action
- agent status polling error ถูกแปลงเป็น zero agents ทำให้ข้อมูล operational ผิดได้

**Som — Low-vision/mobile operator**

- operational descriptions หลายจุดใช้ `text-xs text-slate-500` และ telemetry บางจุด 10px
- room list สูงอย่างน้อย 32rem และอยู่ก่อน controls บนจอแคบ
- Escape ใช้ได้ แต่ focus ยังออกนอก modal และไม่กลับจุดเดิม

## Minor Observations

- “Share the Stream link” ไม่ตรงกับ label “Audio Sender”
- `toLocaleString(undefined)` อาจให้รูปแบบวันที่ไม่ตรงบริบทภาษาไทย
- delete room อยู่เด่นใน header แม้เป็น action ความถี่ต่ำ
- คำว่า “Ready” ใน room list ปัจจุบันหมายถึงไม่มี agent จึงทำให้ความหมายกลับด้าน
- icon ในปุ่มบางตัวไม่ได้กำหนด `aria-hidden` อย่างสม่ำเสมอ

## Questions to Consider

- ถ้าหน้าห้องมี status sentence ที่ไว้ใจได้เพียงประโยคเดียว เช่น “Waiting for audio” หรือ “Transcribing with Gemini” จะลด card ลงได้เท่าไร?
- ผู้ปฏิบัติงานจำเป็นต้องเห็นคำว่า “Interim + Final” ก่อน copy feed หรือควรอยู่หลัง Integration details?
- WebSocket URL ในผลิตภัณฑ์นี้ควรถูกสื่อว่าเป็น share link, credential หรือทั้งสองอย่าง?
- บน mobile ควรเปลี่ยน room list เป็น compact picker เพื่อให้ active-room controls อยู่เหนือ fold หรือไม่?
