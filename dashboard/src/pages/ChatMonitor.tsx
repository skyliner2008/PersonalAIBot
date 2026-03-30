import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { MessageCircle, Send, User, Bot, RefreshCw, Search, ChevronDown, ChevronUp, Terminal, Cpu, Info } from 'lucide-react';

interface Props {
  status: { browser: boolean; loggedIn: boolean; chatBot: boolean; commentBot: boolean };
  emit: (event: string, data?: any) => void;
  on: (event: string, handler: (...args: any[]) => void) => () => void;
}

export function ChatMonitor({ status, emit, on }: Props) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load conversations
  useEffect(() => {
    setLoading(true);
    loadConversations().finally(() => setLoading(false));
    const interval = setInterval(loadConversations, 10000);
    return () => clearInterval(interval);
  }, []);

  // Listen for real-time chat events
  useEffect(() => {
    const unsub = on('chatbot:sentReply', (data: any) => {
      loadConversations();
      if (selectedConv) loadMessages(selectedConv);
    });
    return unsub;
  }, [on, selectedConv]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search]);

  async function loadConversations() {
    try {
      const data = await api.getConversations();
      // Handle both paginated {items, total} and legacy array response
      setConversations(Array.isArray(data) ? data : (data?.items ?? []));
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  async function loadMessages(convId: string) {
    setLoadingMessages(true);
    try {
      const data = await api.getConversationMessages(convId);
      const sanitizeVoiceTrace = (text: string) =>
        String(text || '').replace(/^\[TS:[^\]]+\]\s*\[USER_TEXT_INPUT\]\s*/, '').trim();

      const normalized = (Array.isArray(data) ? data : []).map((msg: any) => ({
        ...msg,
        content: sanitizeVoiceTrace(String(msg?.content || '')),
      }));

      const deduped: any[] = [];
      for (const msg of normalized) {
        const prev = deduped[deduped.length - 1];
        if (!prev) {
          deduped.push(msg);
          continue;
        }
        const sameRole = String(prev.role || '') === String(msg.role || '');
        const sameContent = String(prev.content || '') === String(msg.content || '');
        const prevTs = new Date(prev.timestamp || prev.created_at || 0).getTime();
        const curTs = new Date(msg.timestamp || msg.created_at || 0).getTime();
        const nearDuplicate = Number.isFinite(prevTs) && Number.isFinite(curTs) && Math.abs(curTs - prevTs) <= 3000;
        if (sameRole && sameContent && nearDuplicate) continue;
        deduped.push(msg);
      }

      setMessages(deduped);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }

  function selectConversation(convId: string) {
    setSelectedConv(convId);
    loadMessages(convId);
  }

  const filtered = conversations.filter(c => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (c.fb_user_name || '').toLowerCase().includes(q) || String(c.id || '').toLowerCase().includes(q);
  });

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Conversation List */}
      <div className="w-80 border-r border-gray-800 flex flex-col">
        {loading && (
          <div className="absolute inset-0 bg-gray-950/50 flex items-center justify-center z-10">
            <div className="text-gray-400 animate-pulse">Loading conversations...</div>
          </div>
        )}
        <div className="p-3 border-b border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-blue-400" /> Conversations
            </h3>
            <button onClick={loadConversations} className="text-gray-500 hover:text-gray-300">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {filtered.length === 0 && (
            <p className="text-gray-600 text-xs text-center py-8">No conversations yet</p>
          )}
          {filtered.map(conv => (
            <button
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`w-full text-left px-3 py-3 border-b border-gray-800/50 hover:bg-gray-800/50 transition ${
                selectedConv === conv.id ? 'bg-blue-500/10 border-l-2 border-l-blue-500' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-gray-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 truncate">{conv.fb_user_name || 'Unknown'}</p>
                  <p className="text-[10px] text-gray-500">
                    {conv.message_count} messages · {new Date(conv.last_message_at).toLocaleDateString('th-TH')}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Chat Bot Control */}
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={() => emit(status.chatBot ? 'chatbot:stop' : 'chatbot:start')}
            disabled={!status.loggedIn}
            className={`w-full py-2 rounded-lg text-xs font-medium transition ${
              !status.loggedIn ? 'bg-gray-800 text-gray-600 cursor-not-allowed' :
              status.chatBot
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30'
            }`}
          >
            {status.chatBot ? '⏹ Stop Chat Bot' : '▶ Start Chat Bot'}
          </button>
        </div>
      </div>

      {/* Message View */}
      <div className="flex-1 flex flex-col bg-gray-950">
        {!selectedConv ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-600">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a conversation to view messages</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/50">
              <p className="text-sm font-medium text-gray-200">
                {conversations.find(c => c.id === selectedConv)?.fb_user_name || 'Chat'}
              </p>
            </div>

            {/* Loading state */}
            {loadingMessages && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-gray-400 animate-pulse">Loading messages...</div>
              </div>
            )}

            {/* Smart Content Component */}
            {(() => {
              const SmartContent = ({ content, metadata, source }: { content: string, metadata?: any, source?: string }) => {
                const [expanded, setExpanded] = useState(false);
                
                // Truncation logic
                const isTrace = source === 'swarm_trace';
                const hasLongCode = content.includes('```') && content.length > 500;
                const hasLongJson = content.trim().startsWith('{') && content.trim().endsWith('}') && content.length > 300;
                const isSystemLog = content.startsWith('[') && content.includes(']') && content.length > 200;
                
                const shouldTruncate = !expanded && (hasLongCode || hasLongJson || (isTrace && content.length > 300));
                
                if (!shouldTruncate) {
                  return (
                    <div className="relative group">
                      <p className="whitespace-pre-wrap">{content}</p>
                      {expanded && (
                        <button 
                          onClick={() => setExpanded(false)}
                          className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          <ChevronUp className="w-3 h-3" /> Show less
                        </button>
                      )}
                    </div>
                  );
                }

                const preview = content.substring(0, 250) + '...';

                return (
                  <div className="relative">
                    <p className="whitespace-pre-wrap text-gray-400 italic mb-1 text-[10px]">
                      {isTrace ? '🔍 System Trace' : '📝 Long content truncated'}
                    </p>
                    <p className="whitespace-pre-wrap opacity-60">{preview}</p>
                    <button 
                      onClick={() => setExpanded(true)}
                      className="mt-2 px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded text-[10px] flex items-center gap-1 transition"
                    >
                      <ChevronDown className="w-3 h-3" /> Expand Details
                    </button>
                  </div>
                );
              };

              {/* Message loop with enhancements */}
              return !loadingMessages && (
                <div className="flex-1 overflow-auto p-4 space-y-3">
                  {messages.map((msg, i) => {
                    const isSystem = msg.role === 'system' || msg.source === 'swarm_trace';
                    const sourceLabel = msg.source === 'swarm_trace' ? 'Swarm' : (msg.source === 'system_log' ? 'System' : null);
                    
                    return (
                      <div key={i} className={`flex gap-2 ${msg.role === 'assistant' ? '' : 'flex-row-reverse'}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          msg.role === 'assistant' ? 'bg-blue-500/20' : (isSystem ? 'bg-purple-500/20' : 'bg-gray-700')
                        }`}>
                          {msg.role === 'assistant' ? <Bot className="w-3.5 h-3.5 text-blue-400" /> : 
                           (isSystem ? <Cpu className="w-3.5 h-3.5 text-purple-400" /> : <User className="w-3.5 h-3.5 text-gray-400" />)}
                        </div>
                        <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${
                          msg.role === 'assistant'
                            ? 'bg-blue-500/10 text-gray-200 rounded-tl-sm border border-blue-500/5'
                            : (isSystem ? 'bg-purple-500/5 text-gray-300 rounded-tl-sm border border-purple-500/10' : 'bg-gray-800 text-gray-300 rounded-tr-sm')
                        }`}>
                          {sourceLabel && (
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold uppercase mb-1 ${
                              sourceLabel === 'Swarm' ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-700 text-gray-400'
                            }`}>
                              {sourceLabel}
                            </span>
                          )}
                          <SmartContent content={msg.content} source={msg.source} metadata={msg.metadata} />
                          <p className="text-[10px] text-gray-600 mt-1">
                            {new Date(msg.timestamp || msg.created_at).toLocaleTimeString('th-TH')}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
