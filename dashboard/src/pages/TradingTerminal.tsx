import React, { useEffect, useState, useRef } from 'react';
import { Activity, Target, Zap, BarChart2, ShieldAlert, Crosshair, BrainCircuit, Bot, TrendingUp, TrendingDown, Clock, RefreshCw } from 'lucide-react';

interface WatchlistItem {
  symbol: string;
  price: number;
  changePercent: number;
}

export const TradingTerminal: React.FC = () => {
  const [symbol, setSymbol] = useState('BTC-USD');
  const [timeframe, setTimeframe] = useState('1h');
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [chartData, setChartData] = useState<any>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>("Click 'Run AI Analysis' to get expert insights on current market structure.");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  const pollInterval = useRef<any>(null);

  // Initial load + Symbol/TF change
  useEffect(() => {
    fetchInitialData();
    fetchWatchlist();

    // Set up real-time polling (every 5 seconds)
    if (pollInterval.current) clearInterval(pollInterval.current);
    pollInterval.current = setInterval(pollPriceAndSMC, 5000);

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [symbol, timeframe]);

  const fetchInitialData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    await pollPriceAndSMC();
    setIsLoading(false);
  };

  const pollPriceAndSMC = async () => {
    try {
      const response = await fetch(`/api/trading/chart-data?symbol=${symbol}&timeframe=${timeframe}`);
      const data = await response.json();

      if (data.ohlcv) {
        setChartData(data);
        setErrorMsg(null);
      }
    } catch (error: any) {
      console.error("Polling error:", error);
    }
  };

  const fetchWatchlist = async () => {
    try {
      const response = await fetch('/api/trading/watchlist');
      const data = await response.json();
      if (data.watchlist) setWatchlist(data.watchlist);
    } catch (err) {
      console.error("Watchlist error:", err);
    }
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const response = await fetch(`/api/trading/analyze?symbol=${symbol}&timeframe=${timeframe}`);
      const data = await response.json();
      if (data.analysis) setAiAnalysis(data.analysis);
    } catch (err) {
      setAiAnalysis("Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const currentPrice = chartData?.ohlcv?.[chartData.ohlcv.length - 1]?.close?.toFixed(2) || '0.00';
  const smc = chartData?.smc || {};
  const ind = chartData?.indicators || {};
  const advanced = smc.advanced || {};

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-gray-300 p-4 overflow-y-auto custom-scrollbar">

      {/* 1. Watchlist Shortcut Bar */}
      <div className="flex space-x-3 mb-6 overflow-x-auto pb-2 no-scrollbar">
        {watchlist.map((item) => (
          <button
            key={item.symbol}
            onClick={() => setSymbol(item.symbol)}
            className={`flex-shrink-0 flex flex-col min-w-[140px] p-3 rounded-xl border transition-all ${
              symbol === item.symbol
              ? 'bg-blue-600/20 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
              : 'bg-[#131722] border-gray-800 hover:border-gray-600'
            }`}
          >
            <div className="flex justify-between items-start mb-1">
              <span className="font-bold text-sm text-white">{item.symbol.split('-')[0]}</span>
              <span className={`text-[10px] font-bold ${item.changePercent >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
              </span>
            </div>
            <span className="text-lg font-black text-gray-200">${item.price.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
          </button>
        ))}
      </div>

      {/* 2. Top Navigation & Price Info */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-6 bg-[#131722] p-4 rounded-xl border border-gray-800 shadow-lg gap-4">
        <div className="flex items-center space-x-6">
          <div className="bg-gray-900 px-4 py-2 rounded-lg border border-gray-700 flex items-center gap-3">
             <TrendingUp className="w-5 h-5 text-blue-400" />
             <span className="font-black text-xl text-white">{symbol}</span>
          </div>

          <div className="flex bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
            {['15m', '1h', '4h', '1d'].map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-4 py-2 text-xs font-black transition-all ${timeframe === tf ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 animate-pulse">
             <RefreshCw className="w-3 h-3" /> Real-time active
          </div>
        </div>

        <div className="flex items-center space-x-8">
           <div className="flex flex-col items-end">
             <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Market Price</span>
             <span className="text-3xl font-black text-[#26a69a] drop-shadow-[0_0_8px_rgba(38,166,154,0.3)]">
               ${currentPrice}
             </span>
           </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mb-4"></div>
          <p className="text-gray-400 font-mono animate-pulse">Establishing Secure Stream...</p>
        </div>
      )}

      {errorMsg && !isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center text-red-400 font-mono">
          <ShieldAlert className="w-16 h-16 mb-4" />
          <p className="text-xl">{errorMsg}</p>
        </div>
      )}

      {!isLoading && !errorMsg && chartData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-10">

          {/* AI Analysis Card */}
          <div className="col-span-1 lg:col-span-2 xl:col-span-2 bg-gradient-to-br from-[#131722] to-[#1a202c] border border-blue-900/50 rounded-2xl p-6 shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-3xl -mr-20 -mt-20 group-hover:bg-blue-600/10 transition-all duration-700"></div>
            <div className="flex items-center justify-between mb-5 border-b border-gray-800/50 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Bot className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-xl font-black text-white tracking-tight">AI Agent Intelligence</h3>
              </div>
              <button
                onClick={runAnalysis}
                disabled={isAnalyzing}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black transition-all ${
                  isAnalyzing
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 active:scale-95'
                }`}
              >
                {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
                {isAnalyzing ? 'Analyzing...' : 'Run New Analysis'}
              </button>
            </div>
            <div className="relative z-10 min-h-[120px]">
               <p className="text-gray-300 leading-relaxed text-md font-medium italic">
                  "{aiAnalysis}"
               </p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
               <Clock className="w-3 h-3" /> Updated: {new Date().toLocaleTimeString()}
            </div>
          </div>

          {/* Market Structure */}
          <div className="bg-[#131722] border border-gray-800 rounded-2xl p-6 shadow-lg hover:border-purple-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                <Activity className="w-5 h-5" />
              </div>
              <h3 className="text-md font-black text-gray-200 uppercase tracking-tighter">Structure</h3>
            </div>
            <div className="flex flex-col items-center justify-center py-6 bg-gray-900/30 rounded-2xl border border-gray-800/50">
               <span className={`text-2xl font-black tracking-tighter ${advanced.bos?.type?.includes('Bull') ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                 {advanced.bos?.type || 'No Structure'}
               </span>
               <div className="mt-3 px-3 py-1 bg-gray-800 rounded-full text-[10px] font-black text-gray-400">
                 BREAK LEVEL: ${advanced.bos?.price?.toFixed(2)}
               </div>
            </div>
          </div>

          {/* Indicators */}
          <div className="bg-[#131722] border border-gray-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-400">
                <BarChart2 className="w-5 h-5" />
              </div>
              <h3 className="text-md font-black text-gray-200 uppercase tracking-tighter">Technical Data</h3>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-gray-900/50 px-4 py-3 rounded-xl">
                <span className="text-xs font-bold text-gray-500 uppercase">RSI (14)</span>
                <span className={`text-lg font-black ${ind.rsi14 > 70 ? 'text-red-400' : ind.rsi14 < 30 ? 'text-green-400' : 'text-gray-200'}`}>
                  {ind.rsi14?.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center bg-gray-900/50 px-4 py-3 rounded-xl">
                <span className="text-xs font-bold text-gray-500 uppercase">EMA 20</span>
                <span className="text-lg font-black text-gray-200">${ind.ema20?.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Order Blocks */}
          <div className="bg-[#131722] border border-gray-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
               <div className="p-2 bg-orange-500/10 rounded-lg text-orange-400">
                 <ShieldAlert className="w-5 h-5" />
               </div>
              <h3 className="text-md font-black text-gray-200 uppercase tracking-tighter">Order Blocks</h3>
              <span className="ml-auto bg-gray-800 text-[10px] font-black px-2 py-1 rounded-full text-gray-400">{smc.orderBlocks?.length || 0}</span>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
               {smc.orderBlocks?.slice(0, 5).map((ob: any, i: number) => (
                 <div key={i} className="flex justify-between items-center bg-gray-900/40 p-3 rounded-xl border-l-4" style={{ borderColor: ob.type === 'bullish' ? '#26a69a' : '#ef5350' }}>
                    <span className="text-xs font-black text-gray-300 uppercase">{ob.type === 'bullish' ? 'Bull OB' : 'Bear OB'}</span>
                    <span className="text-[10px] font-mono text-gray-500 font-bold">${ob.top.toFixed(0)}</span>
                 </div>
               ))}
            </div>
          </div>

          {/* FVG */}
          <div className="bg-[#131722] border border-gray-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
               <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400">
                 <Zap className="w-5 h-5" />
               </div>
              <h3 className="text-md font-black text-gray-200 uppercase tracking-tighter">FVG Zones</h3>
              <span className="ml-auto bg-gray-800 text-[10px] font-black px-2 py-1 rounded-full text-gray-400">{smc.fvgs?.length || 0}</span>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
               {smc.fvgs?.slice(0, 5).map((fvg: any, i: number) => (
                 <div key={i} className="flex justify-between items-center bg-gray-900/40 p-3 rounded-xl border-l-4" style={{ borderColor: fvg.type === 'bullish' ? '#26a69a' : '#ef5350' }}>
                    <span className="text-xs font-black text-gray-300 uppercase">FVG GAP</span>
                    <span className="text-[10px] font-mono text-gray-500 font-bold">${fvg.top.toFixed(0)}</span>
                 </div>
               ))}
            </div>
          </div>

          {/* Liquidity Zones */}
          <div className="bg-[#131722] border border-gray-800 rounded-2xl p-6 shadow-lg border-dashed opacity-80 hover:opacity-100 transition-all">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-red-500/10 rounded-lg text-red-400">
                <Crosshair className="w-5 h-5" />
              </div>
              <h3 className="text-md font-black text-gray-200 uppercase tracking-tighter">Liquidity</h3>
            </div>
            <div className="flex flex-col items-center justify-center py-6 bg-gray-900/30 rounded-2xl">
               <span className="text-xl font-black text-gray-400 uppercase tracking-widest">{advanced.liquidity?.type}</span>
               <span className="text-sm font-mono text-gray-600 mt-2">${advanced.liquidity?.price?.toFixed(2)}</span>
               <div className="flex mt-3 space-x-1">
                  {[...Array(5)].map((_, i) => (
                    <span key={i} className={`text-xs ${i < advanced.liquidity?.strength ? 'text-yellow-500' : 'text-gray-800'}`}>★</span>
                  ))}
               </div>
            </div>
          </div>

          {/* Momentum */}
          <div className="bg-[#131722] border border-gray-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                <Target className="w-5 h-5" />
              </div>
              <h3 className="text-md font-black text-gray-200 uppercase tracking-tighter">Momentum</h3>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-gray-900/50 px-4 py-4 rounded-xl">
                <span className="text-xs font-black text-gray-500 uppercase">Attack Force 💥</span>
                <span className={`text-xs font-black px-3 py-1 rounded-full ${advanced.momentum?.isHigh ? 'bg-orange-500 text-white animate-pulse' : 'bg-gray-800 text-gray-500'}`}>
                  {advanced.momentum?.isHigh ? 'VOLATILE' : 'STABLE'}
                </span>
              </div>
              <div className="flex justify-between items-center bg-gray-900/50 px-4 py-4 rounded-xl">
                <span className="text-xs font-black text-gray-500 uppercase">Confluence</span>
                <span className="text-lg font-black text-[#26a69a]">{advanced.mtf?.confluence}/3</span>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
