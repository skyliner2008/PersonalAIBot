# คู่มือการใช้งาน Local Embeddings และ GraphRAG Fallback

คู่มือนี้แนะนำการตั้งค่าระบบความจำระยะยาว (Long-term Memory) ให้ทำงานแบบ Local 100% เพื่อลดการพึ่งพา API ภายนอกและเพิ่มความเป็นส่วนตัว

## 1. Local Embeddings (โมเดลเวกเตอร์บนเครื่อง)

ระบบรองรับการทำงานผ่าน [Transformers.js](https://huggingface.co/docs/transformers.js/) ทำให้สามารถประมวลผล Vector Embeddings บนเครื่องได้ทันที

### โมเดลที่แนะนำ:
- **Xenova/bge-m3 (ค่ามาตรฐาน)**:
    - **ข้อดี**: แม่นยำสูงมาก รองรับภาษาไทยได้ดีเยี่ยม (Dimensions: 1024)
    - **ขนาด**: ประมาณ 2.2GB (ดาวน์โหลดอัตโนมัติในการรันครั้งแรก)
- **Xenova/paraphrase-multilingual-MiniLM-L12-v2**:
    - **ข้อดี**: ทำงานเร็วมาก กินทรัพยากรน้อย (Dimensions: 384)
    - **ขนาด**: ประมาณ 118MB

### วิธีการเปิดใช้งาน:
1. ไปที่ **Dashboard > AI Settings**
2. ค้นหา Provider **"Local Embeddings (Transformers.js)"**
3. คลิก **Enable**
4. ระบบจะดาวน์โหลดโมเดลมาเก็บไว้ในเครื่องอัตโนมัติ

---

## 2. GraphRAG Fallback System

แม้ว่าคุณจะใช้ Local Embeddings แต่ส่วนของ **Knowledge Extraction** (การดึงความสัมพันธ์เป็นกราฟ) ยังคงต้องใช้ LLM (โมเดลภาษา) ในการประมวลผล

### การทำงานของระบบ Fallback:
- ระบบจะพยายามใช้ Provider ตัวแรกที่มีประสิทธิภาพสูง (เช่น Gemini หรือ OpenAI)
- หากพบข้อผิดพลาด (เช่น API Key หมดอายุ, Error 403) **ระบบจะสลับไปใช้ตัวถัดไปในรายการที่เปิดใช้งานอยู่โดยอัตโนมัติ**
- ป้องกันปัญหา "ApiError: 403 PERMISSION_DENIED" ที่เคยเกิดขึ้นในงานเบื้องหลัง

### ข้อแนะนำ:
- ควรเปิดใช้งาน Provider สำรองอย่างน้อย 1-2 ตัว (เช่น OpenRouter) เพื่อให้ระบบความจำ (Subconscious) ทำงานได้อย่างต่อเนื่องไม่สะดุด

---

## 3. การตรวจสอบสถานะ
คุณสามารถตรวจสอบการทำงานได้จาก:
- **Dashboard > Logs**: ดูสถานะการดึงข้อมูล (Extracted X triples)
- **Subconscious Status**: ดูว่ามีการทำงานของ GraphRAG สำเร็จหรือไม่
