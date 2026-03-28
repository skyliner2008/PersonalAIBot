import { Settings as SettingsIcon, Shield } from 'lucide-react';

interface Props {
  settings: Record<string, string>;
  onSettingChange: (key: string, value: string) => void;
}

export function GeneralSettings({ settings, onSettingChange }: Props) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <SettingsIcon className="w-4 h-4 text-gray-400" /> ตั้งค่าทั่วไป (General Settings)
      </h3>
      <p className="text-xs text-gray-500">
        การตั้งค่าที่ส่งผลต่อการทำงานของเซิร์ฟเวอร์หลักโดยตรง (การตั้งค่าบราวเซอร์จะมีผลเมื่อเปิดบราวเซอร์ครั้งถัดไป)
      </p>

      {/* Chat Behavior */}
      <div className="space-y-3 pb-4 border-b border-gray-800">
        <h4 className="text-xs font-medium text-gray-400 uppercase">พฤติกรรมการสนทนา (Chat Behavior)</h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">หน่วงเวลาตอบแชท (ms)</label>
            <input
              type="number"
              value={settings['chat_reply_delay'] || '3000'}
              onChange={e => onSettingChange('chat_reply_delay', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">เวลาที่รอไตร่ตรองก่อนส่งข้อความตอบแชท (มิลลิวินาที)</p>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">หน่วงเวลาตอบคอมเมนต์ (ms)</label>
            <input
              type="number"
              value={settings['comment_reply_delay'] || '5000'}
              onChange={e => onSettingChange('comment_reply_delay', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">เวลาที่รอไตร่ตรองก่อนคอมเมนต์ตอบกลับ (มิลลิวินาที)</p>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">ตอบแชทอัตโนมัติ</label>
            <select
              value={settings['auto_reply_enabled'] || 'true'}
              onChange={e => onSettingChange('auto_reply_enabled', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
            >
              <option value="true">เปิดใช้งาน</option>
              <option value="false">ปิดใช้งาน</option>
            </select>
            <p className="text-[10px] text-gray-600 mt-1">อนุญาตให้บอทตอบแชทที่เข้ามาโดยอัตโนมัติ</p>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">ตอบคอมเมนต์อัตโนมัติ</label>
            <select
              value={settings['auto_comment_reply_enabled'] || 'true'}
              onChange={e => onSettingChange('auto_comment_reply_enabled', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
            >
              <option value="true">เปิดใช้งาน</option>
              <option value="false">ปิดใช้งาน</option>
            </select>
            <p className="text-[10px] text-gray-600 mt-1">อนุญาตให้บอทตอบกลับคอมเมนต์โดยอัตโนมัติ</p>
          </div>
        </div>
      </div>

      {/* Browser & Memory */}
      <div className="space-y-3 pb-4 border-b border-gray-800">
        <h4 className="text-xs font-medium text-gray-400 uppercase">บราวเซอร์ & ความจำ (Browser & Memory)</h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">ซ่อนหน้าต่างบราวเซอร์ (Headless)</label>
            <select
              value={settings['browser_headless'] || 'false'}
              onChange={e => onSettingChange('browser_headless', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
            >
              <option value="false">ไม่ซ่อน (แสดงหน้าต่าง)</option>
              <option value="true">ซ่อน (รันพื้นหลัง)</option>
            </select>
            <p className="text-[10px] text-gray-600 mt-1">ซ่อนหน้าต่างเว็บเวลาบอทเปิดบราวเซอร์ทำงาน</p>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">ความจำสูงสุดต่อรอบสนทนา</label>
            <input
              type="number"
              value={settings['max_memory_messages'] || '25'}
              onChange={e => onSettingChange('max_memory_messages', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">จำนวนข้อความย้อนหลังสูงสุดที่จะจำในแต่ละ Context</p>
          </div>
        </div>
      </div>

      {/* AI Processing */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-gray-400 uppercase">การประมวลผล (AI Processing)</h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">โควต้าลองใช้ Tool ใหม่เมื่อผิดพลาด</label>
            <input
              type="number"
              value={settings['max_tool_retries'] || '3'}
              onChange={e => onSettingChange('max_tool_retries', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">จำนวนครั้งสูงสุดที่จะให้ AI ลองทำงานซ้ำเมื่อเกิด Error</p>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">จำกัดเวลา Swarm Timeout (ms)</label>
            <input
              type="number"
              value={settings['swarm_timeout_ms'] || '30000'}
              onChange={e => onSettingChange('swarm_timeout_ms', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">เวลาสูงสุดที่อนุญาตให้ระบบ Swarm ของ AI ทำงาน (มิลลิวินาที)</p>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">ภาษาหลักของ AI (AI Language)</label>
            <select
              value={settings['ai_preferred_language'] || 'th'}
              onChange={e => onSettingChange('ai_preferred_language', e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
            >
              <option value="th">ภาษาไทย (Thai)</option>
              <option value="en">English (English)</option>
            </select>
            <p className="text-[10px] text-gray-600 mt-1">เลือกภาษาที่ต้องการให้ AI ตอบกลับเป็นหลัก</p>
          </div>
        </div>
      </div>
      {/* Admin Security */}
      <div className="space-y-3 pt-4 border-t border-gray-800">
        <h4 className="text-xs font-medium text-gray-400 uppercase flex items-center gap-1">
          <Shield className="w-3.5 h-3.5" /> ความปลอดภัยและผู้ดูแล (Admin Security)
        </h4>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">รหัสผ่านแอดมิน (Admin Password)</label>
            <input
              type="password"
              value={settings['admin_password'] || ''}
              onChange={e => onSettingChange('admin_password', e.target.value)}
              placeholder="********"
              className="w-full px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">รหัสผ่านสำหรับเข้าสู่ระบบ Dashboard (หากเว้นว่างจะใช้ค่าเริ่มต้น admin)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
