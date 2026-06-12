# 🎨 ทักษะการออกแบบและการจัดสไตล์ด้วย CSS — ADO Auto-Approve

คู่มือนี้รวบรวมกฎการออกแบบหน้าต่างและรูปแบบการเขียน CSS เพื่อให้หน้าจอของระบบ ADO Auto-Approve มีความสวยงาม น่าใช้ มีความพรีเมียม และคงเอกลักษณ์เดิมไว้

---

## 🎨 1. แนวทางการออกแบบและโทนสี (Visual Design Standard)

*   **Vanilla CSS Only:** สไตล์ทั้งหมดเขียนขึ้นด้วยมือใน [styles.css](file:///d:/Github/ado-auto-approve/ado-auto-approve/styles.css) ห้ามใช้เฟรมเวิร์กอย่าง TailwindCSS หรือ Bootstrap เด็ดขาด
*   **Curated Palette (HSL):** หลีกเลี่ยงการใช้สีสว่างจัดที่เป็น default (เช่น `red`, `blue`, `green` ตรงๆ) ให้ใช้ระบบสี HSL ในการไล่โทนสีเพื่อให้ดูเป็นมืออาชีพ เช่น:
    *   *สีหลัก (Primary):* โทนสีน้ำเงิน/ครามไล่เฉด
    *   *สถานะอันตราย (Danger/Critical):* สีแดงอ่อนเฉดหม่น (Soft Red)
    *   *สถานะสำเร็จ (Success):* สีเขียวมินต์/เขียวอ่อนหม่น
*   **Dark Mode Support:** ออกแบบโครงสร้างและเฉดสีรองรับธีมมืด (Dark-themed dashboard) โดยค่าเริ่มต้นเพื่อให้เหมาะกับการเฝ้าดูหน้าจอตลอดทั้งวันของทีมงาน IT Support
*   **Modern Typography:** โหลดฟอนต์สมัยใหม่จาก Google Fonts เช่น Inter, Outfit หรือ Roboto ในการแสดงผลแทนฟอนต์เริ่มต้นของระบบเพื่อความสวยงามและอ่านง่าย

---

## ⚡ 2. ปฏิสัมพันธ์และการตอบสนอง (Interactive Elements & Transitions)

*   **Subtle Hover Effects:** ปุ่มและลิ้งก์ที่กดได้ต้องมีการเปลี่ยนแปลงเมื่อถูกชี้ (Hover) เสมอ เช่น ปรับ opacity หรือสลับเฉดสีพื้นหลังเล็กน้อย
*   **Smooth Animations:** ใช้คีย์เวิร์ด `transition: all 0.2s ease-in-out` หรือใกล้เคียงกับการทำ Hover effects เพื่อไม่ให้ UI ดูกระตุกกระชัน
*   **Visual Status Indicators:** การแสดงคอลัมน์สถานะ (เช่น Build, Policy, Release, Attention) ต้องมีสีพื้นหลัง (Pills/Badges) ที่บอกถึงระดับความรุนแรงหรือความสมบูรณ์อย่างชัดเจนเพื่อการสแกนข้อมูลด้วยตาได้อย่างรวดเร็ว

---

## 📱 3. การรองรับหน้าจอที่หลากหลาย (Responsive Layouts)

*   **Flexbox & Grid Systems:** ใช้ `display: flex` หรือ `display: grid` เป็นหลักในการจัดสรรพื้นที่หน้าจอ เพื่อให้แผงควบคุม Dashboard ยืดหดตามความกว้างหน้าจอได้อย่างอัตโนมัติ
*   **Mobile-Friendly Check:** ถึงแม้หน้าจอจะเน้นการทำงานบน Desktop เป็นหลัก แต่โครงสร้าง CSS ต้องไม่มีปัญหาล้นทะลัก (Overflow/Horizontal Scroll) เมื่อเปิดใช้งานบนแท็บเล็ตหรือหน้าจอโน้ตบุ๊กขนาดเล็ก

---

## ⚠️ 4. การออกแบบเพื่อป้องกันความผิดพลาด (Mistake Prevention dialog)

*   **Confirm Popups:** สำหรับคำสั่งที่มีผลลัพธ์ย้อนหลังไม่ได้ เช่น การกด Approve หรือ Reject PR จะต้องมี Modal Dialog แสดงขึ้นมาครอบทับหน้าจอ
*   **Styling Dialog:** Modal Dialog ต้องถูกสไตล์ให้เด่นชัด (เช่น ฉากหลังมัว/Blur พื้นหลังมืดลง) และเน้นปุ่มตกลง/ยกเลิกให้มีสีที่แตกต่างและชัดเจนเพื่อความปลอดภัย
