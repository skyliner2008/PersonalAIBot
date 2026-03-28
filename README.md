<div align="center">
  <img src="https://raw.githubusercontent.com/skyliner2008/PersonalAIBot/main/dashboard/public/logo.png" alt="PersonalAIBot Logo" width="160" />
  <h1>🤖 PersonalAIBot V2: The Sovereign AI Agent</h1>
  <p><strong>ระบบนิเวศ AI Agentic ที่เปรียบเสมือน Jarvis ในชีวิตจริง: แพลตฟอร์มที่ผสมผสาน Multi-Agent Swarm, 4-Layer Memory และวิวัฒนาการตัวเองเข้าด้วยกันอย่างสมบูรณ์</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Version-2.5_Enterprise-blueviolet?style=for-the-badge" alt="Version" />
    <img src="https://img.shields.io/badge/Architecture-Swarm_Orchestration-orange?style=for-the-badge" alt="Architecture" />
    <img src="https://img.shields.io/badge/Memory-4--Layer_MemGPT-red?style=for-the-badge" alt="Memory" />
    <img src="https://img.shields.io/badge/Evolution-Second_Brain_Enabled-green?style=for-the-badge" alt="Evolution" />
  </p>
  
  <p>
    <a href="#-สถาปัตยกรรมหลัก-core-architecture">สถาปัตยกรรม</a> •
    <a href="#-ฟีเจอร์โดดเด่น-killer-features">ฟีเจอร์หลัก</a> •
    <a href="#-สมองที่สอง-second-brain--evolution">วิวัฒนาการตัวเอง</a> •
    <a href="#-การติดตั้ง-quick-start">การติดตั้ง</a> •
    <a href="#-ความปลอดภัย-resilience">ความปลอดภัย</a>
  </p>
</div>

---

## 🌟 ปรัชญาของโปรเจค (Project Philosophy)

**PersonalAIBot** ไม่ใช่แค่บอทตอบคำถาม แต่เป็น **Autonomous AI Sovereign** ที่ออกแบบมาเพื่ออาศัยอยู่ในเครื่องคอมพิวเตอร์ของคุณ มันถูกสร้างขึ้นด้วยแนวคิด "Agentic-First" คือการให้ AI มีความสามารถในการวางแผน (Planning), การใช้เครื่องมือ (Tooling), การจำ (Memory) และการแก้ไขตัวเอง (Self-Correction) เพื่อทำงานซับซ้อนแทนผู้ใช้ได้จริง

---

## 🧠 สถาปัตยกรรมหลัก (Core Architecture)

### 1. ระบบหน่วยความจำ 4 ชั้น (4-Layer MemGPT Architecture)
พิกัดความจำที่เหนือกว่า LLM ทั่วไป ด้วยการจัดการ Context Budget (16,000 Tokens) อย่างมีประสิทธิภาพ:
*   **Layer 1: Core Memory** - บันทึกตัวตนผู้ใช้และความต้องการหลัก โหลดเข้า System Prompt ทุกครั้ง
*   **Layer 2: Working Memory** - RAM-based Cache สำหรับบทสนทนาปัจจุบัน เพื่อการตอบโต้ที่รวดเร็ว
*   **Layer 3: Recall Memory** - ฐานข้อมูล SQLite ที่ค้นหาประวัติย้อนหลังได้ทุกข้อความ
*   **Layer 4: Archival Memory** - ระบบ Semantic Memory ใช้ HNSW Vector Search ค้นหา "ข้อเท็จจริง" ในอดีตตามความหมาย

### 2. Multi-Agent Swarm Orchestration
ระบบกระจายงานแบบฝูงบิน (Swarm) โดยใช้ **Jarvis Planner** เป็นสมองกลาง:
*   **Planner**: วิเคราะห์เป้าหมายและย่อยงานเป็น Sub-tasks
*   **Specialists**: Agent เฉพาะทาง (Coder, Doc Expert, Web Scanner) ที่ทำงานร่วมกันใน Roundtable
*   **Dynamic Routing**: เลือกใช้โมเดลที่เหมาะสมที่สุดตามงาน (เช่น Gemini 2.5 Flash สำหรับงานทั่วไป, Coder Model สำหรับงานเขียนโปรแกรม)

---

## 🎙️ ฟีเจอร์โดดเด่น (Killer Features)

### 🔊 Jarvis Live Call (Voice Intelligence)
สัมผัสประสบการณ์คุยกับ AI ด้วยเสียงที่เหมือนมนุษย์ที่สุด:
*   **Dual-Transport System**: รองรับทั้ง Browser STT (ประหยัด) และ Gemini Live Voice (หน่วงต่ำ/เป็นธรรมชาติ)
*   **File Analysis in Call**: สามารถแนบไฟล์ส่งให้ Jarvis วิเคราะห์และอธิบายให้ฟังผ่านเสียงได้ทันที
*   **Thai Fluency**: ปรับแต่งให้รองรับภาษาไทยอย่างสมบูรณ์แบบ ทั้งการฟังและการพูด

### 👥 Facebook & Social Automation
*   **Chat & Comment Monitor**: ระบบตรวจจับแชทและคอมเมนต์บนหน้า Facebook และตอบโต้ด้วย AI อัตโนมัติ
*   **Post Scheduler**: สร้างคอนเทนต์และตั้งเวลาโพสต์ด้วยการวางแผนของ AI
*   **Anti-Detection**: ระบบจำลองพฤติกรรมมนุษย์ (Random Typing Speed, Delay) เพื่อความปลอดภัยของบัญชี

---

## ⚙️ สมองที่สอง (Second Brain) & Self-Evolution

นี่คือส่วนที่ **ปรับแต่งแก้ไขและพัฒนาพิเศษ** มากที่สุดในโปรเจคนี้:

###ระบบวิวัฒนาการ 11 ขั้นตอน (Self-Evolution Pipeline)
Jarvis สามารถสแกน codebase ของตัวเองเพื่อหาจุดบกพร่องและอัปเกรดฟีเจอร์ใหม่:
1.  **Architecture Mapping**: สแกนโค้ดและสร้างแผนผังโครงสร้าง (Exports/Dependencies)
2.  **Static Analysis**: สกัด Call Graph เพื่อดูว่าฟังก์ชันไหนเรียกใช้ฟังก์ชันไหน
3.  **Autonomous Proposal**: เสนอแผนการแก้ไขโค้ดพร้อมประเมินความเสี่ยง (Risk Scoring)
4.  **AST-Aware Implementation**: แก้ไขโค้ดผ่าน Abstract Syntax Tree (AST) เพื่อรักษาความถูกต้องของ Logic
5.  **Multi-File Batching**: แก้ไขหลายไฟล์พร้อมกันในรอบเดียวอย่างเป็นระบบ
6.  **Safety Lock**: ระบบล็อคไฟล์ระหว่างอัปเกรดเพื่อป้องกัน TSX Restart ที่อาจทำให้โค้ดพัง

---

## 🛡️ ความปลอดภัยและความเสถียร (Resilience)

*   ❄️ **Cold Boot Protection**: ระบบจะไม่รันงานค้างเก่าทันทีเมื่อเปิดเครื่อง เพื่อให้โอกาสผู้ใช้ตรวจสอบความปลอดภัย
*   🛡️ **Boot Guardian**: ระบบเฝ้าระวังการรันครั้งแรก (First-run watch) หากแก้ไขโค้ดแล้วพัง จะทำ Auto-Rollback ทันที
*   🔐 **Master Credentials Encryption**: ข้อมูลสำคัญทุกอย่างถูกเข้ารหัสด้วย AES-256-GCM ภายใต้ Master Key
*   🚥 **Tool Circuit Breaker**: ระบบตัดการทำงานของเครื่องมือที่ทำงานผิดพลาดซ้ำๆ เพื่อป้องกันระบบล่มแบบต่อเนื่อง

---

## 💻 วิธีเริ่มใช้งาน (Quick Start)

### ความต้องการของระบบ (Prerequisites)
*   **Node.js**: v22.x ขึ้นไป
*   **Database**: SQLite (แถมมาให้ในตัว)
*   **API Key**: Google Gemini API Key (หลัก)

### ขั้นตอนการติดตั้ง (Windows)
```bat
git clone https://github.com/skyliner2008/PersonalAIBot.git
cd PersonalAIBot
install.bat
```

### การเปิดระบบ
```bat
# รันทุกอย่างในคำสั่งเดียว (Server + Dashboard)
start_unified.bat
```
📌 **Dashboard**: เข้าใช้งานได้ที่ `http://localhost:3000` (User: `admin` / Password: `admin`)

---

## 📁 โครงสร้างโปรเจค (Project Discovery)

*   `server/src/evolution/`: ระบบสมองกลางและการอัปเกรดตัวเอง
*   `server/src/bot_agents/tools/`: คลังเครื่องมือกว่า 40+ รายการ (OS, Browser, Files, Media)
*   `server/src/swarm/`: ระบบจัดการ Agent หลายตัวทำงานร่วมกัน
*   `dashboard/src/pages/`: หน้าควบคุมระบบทั้งหมดแบบ Visual UI

---

<div align="center">
  <p><i>"I am Jarvis. Ready to evolve and assist, sir."</i></p>
  <sub>Built with ❤️ by Developer Team | Last updated: 28 March 2026</sub>
</div>
