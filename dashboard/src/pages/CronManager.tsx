import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Clock, Plus, Trash2, Edit2, Play, Pause, Save, X } from 'lucide-react';

interface CronJob {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  bot_id: string;
  chat_id: string;
  platform: string;
  is_active: number;
  created_at: string;
}

export function CronManager() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  
  // Form State
  const [name, setName] = useState('');
  const [cronExpr, setCronExpr] = useState('0 8 * * *');
  const [prompt, setPrompt] = useState('');
  const [botId, setBotId] = useState('');
  const [chatId, setChatId] = useState('');
  const [platform, setPlatform] = useState('telegram');
  
  // Helper data
  const [availableBots, setAvailableBots] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [jobsData, botsData] = await Promise.all([
        api.getCronJobs(),
        api.getBots()
      ]);
      setJobs(jobsData || []);
      setAvailableBots(botsData || []);
      if (botsData && botsData.length > 0) {
        setBotId(botsData[0].id);
        setPlatform(botsData[0].platform);
      }
    } catch (err) {
      console.error('Failed to load cron jobs/bots:', err);
    }
    setLoading(false);
  };

  const resetForm = () => {
    setName('');
    setCronExpr('0 8 * * *');
    setPrompt('');
    setChatId('');
    if (availableBots.length > 0) {
      setBotId(availableBots[0].id);
      setPlatform(availableBots[0].platform);
    }
    setIsEditing(null);
  };

  const handleEdit = (job: CronJob) => {
    setIsEditing(job.id);
    setName(job.name);
    setCronExpr(job.cron_expression);
    setPrompt(job.prompt);
    setBotId(job.bot_id);
    setChatId(job.chat_id);
    setPlatform(job.platform);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name,
        cron_expression: cronExpr,
        prompt,
        bot_id: botId,
        chat_id: chatId,
        platform
      };

      if (isEditing) {
        await api.updateCronJob(isEditing, payload);
      } else {
        await api.createCronJob({...payload, is_active: true});
      }
      resetForm();
      loadData();
    } catch (err: any) {
      alert(`Error saving job: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this Cron Job?')) return;
    try {
      await api.deleteCronJob(id);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await api.toggleCronJob(id);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-gray-400 animate-pulse">Loading scheduled jobs...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Clock className="w-6 h-6 text-blue-400" />
          Autonomous Cron Jobs
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          ตั้งเวลาให้ AI ทำงานซ้ำๆ และส่งผลลัพธ์กลับไปยังแชทที่ระบุ ไม่ต้องเปิดหน้าจอทิ้งไว้
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
        <h2 className="text-md font-medium text-white flex items-center gap-2">
          {isEditing ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {isEditing ? 'แก้ไขตารางเวลา' : 'สร้างตารางเวลาใหม่ (New Cron Job)'}
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Job Name (ชื่องาน)</label>
            <input required type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-gray-800 text-white rounded p-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
              placeholder="e.g. Daily News Summary" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Cron Expression (เวลา)</label>
            <input required type="text" value={cronExpr} onChange={e => setCronExpr(e.target.value)}
              className="w-full bg-gray-800 text-white font-mono rounded p-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
              placeholder="0 8 * * *" />
            <p className="text-[10px] text-gray-500 mt-1">Ex: "0 8 * * *" (8 โมงเช้าทุกวัน), "*/30 * * * *" (ทุก 30 นาที)</p>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">AI Prompt (คำสั่งให้ AI คิดหรือทำ)</label>
          <textarea required value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
            className="w-full bg-gray-800 text-white rounded p-2 text-sm border border-gray-700 focus:border-blue-500 outline-none resize-none"
            placeholder="e.g. สรุปข่าวเทคโนโลยี 3 ข่าว แล้วสกัดเอาเฉพาะหัวข้อที่น่าสนใจส่งมา" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Target Bot (บอทที่จะใช้ตอบ)</label>
            <select required value={botId} 
              onChange={e => {
                setBotId(e.target.value);
                const b = availableBots.find(x => x.id === e.target.value);
                if (b) setPlatform(b.platform);
              }}
              className="w-full bg-gray-800 text-white rounded p-2 text-sm border border-gray-700 outline-none">
              {availableBots.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.platform})</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Target Chat ID (รหัสแชทปลายทาง)</label>
            <input required type="text" value={chatId} onChange={e => setChatId(e.target.value)}
              className="w-full bg-gray-800 text-white rounded p-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
              placeholder="e.g. telegram_12345678" />
             <p className="text-[10px] text-gray-500 mt-1">ต้องระบุ Platform Prefix นำหน้า เช่น telegram_XXXXXXXX, line_UYYYYYYYY</p>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2 transition-colors">
            <Save className="w-4 h-4" /> {isEditing ? 'Save Changes' : 'Create Cron Job'}
          </button>
          {isEditing && (
             <button type="button" onClick={resetForm} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2 transition-colors">
               <X className="w-4 h-4" /> Cancel
             </button>
          )}
        </div>
      </form>

      {/* List */}
      <div className="space-y-3">
        {jobs.length === 0 ? (
          <div className="text-center text-gray-500 py-10 bg-gray-900/50 rounded-lg border border-gray-800 border-dashed">
            ไม่มีตารางเวลาอัตโนมัติ (No active cron jobs)
          </div>
        ) : (
          jobs.map(job => (
            <div key={job.id} className={`bg-gray-900 border rounded-lg p-4 flex gap-4 ${job.is_active ? 'border-gray-800' : 'border-gray-800 opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                  <h3 className="text-white font-medium flex items-center gap-2">
                    {job.name}
                    {!job.is_active && <span className="text-xs px-2 py-0.5 rounded bg-amber-900/30 text-amber-500 border border-amber-800/50">Paused</span>}
                  </h3>
                  <code className="text-xs bg-gray-800 text-blue-400 px-2 py-0.5 rounded font-mono">{job.cron_expression}</code>
                </div>
                
                <div className="text-sm text-gray-400 bg-gray-950 p-2 rounded border border-gray-800 mb-3 whitespace-pre-wrap">
                  {job.prompt}
                </div>
                
                <div className="flex flex-wrap text-xs gap-4 text-gray-500">
                  <span><strong className="text-gray-400">Target:</strong> {job.chat_id}</span>
                  <span><strong className="text-gray-400">Bot ID:</strong> {job.bot_id}</span>
                  <span className="capitalize"><strong className="text-gray-400">Platform:</strong> {job.platform}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 justify-start items-end border-l border-gray-800 pl-4">
                 <button onClick={() => handleToggle(job.id)} className={`flex items-center justify-center p-2 rounded transition-colors ${job.is_active ? 'text-amber-400 hover:bg-amber-900/30' : 'text-green-400 hover:bg-green-900/30'}`} title={job.is_active ? 'Pause Job' : 'Resume Job'}>
                    {job.is_active ? <Pause className="w-5 h-5"/> : <Play className="w-5 h-5" />}
                 </button>
                 <button onClick={() => handleEdit(job)} className="text-blue-400 hover:bg-blue-900/30 p-2 rounded transition-colors" title="Edit">
                    <Edit2 className="w-5 h-5" />
                 </button>
                 <button onClick={() => handleDelete(job.id)} className="text-red-400 hover:bg-red-900/30 p-2 rounded transition-colors" title="Delete">
                    <Trash2 className="w-5 h-5" />
                 </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
