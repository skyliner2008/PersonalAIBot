import express from 'express';
import { YahooFinanceService } from './yahooFinance.js';
import { SMCEngine } from './smc.js';
import { calculateEMA, calculateRSI } from './indicators.js';

export const tradingRouter = express.Router();

// 1. Chart Data Endpoint (Real-time polling optimized)
tradingRouter.get('/chart-data', async (req, res) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC-USD';
    const timeframe = (req.query.timeframe as string) || '1d';
    const range = (req.query.range as string) || '6mo';

    // Fetch OHLCV data (Now uses internal cache for incremental updates)
    const data = await YahooFinanceService.getHistoricalData(symbol, range, timeframe);

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Data not found' });
    }

    // Run SMC Calculations
    const fvgs = SMCEngine.detectFVGs(data);
    const swings = SMCEngine.detectSwings(data, 5);
    const obs = SMCEngine.detectOrderBlocks(data, fvgs);
    const advancedSMC = SMCEngine.analyzeStructure(data, swings);

    // Calculate Indicators
    const closePrices = data.map((d: any) => d.close);
    const ema20 = calculateEMA(closePrices, 20);
    const ema50 = calculateEMA(closePrices, 50);
    const rsi14 = calculateRSI(closePrices, 14);

    const latestEMA20 = ema20[ema20.length - 1];
    const latestEMA50 = ema50[ema50.length - 1];
    const latestRSI = rsi14[rsi14.length - 1];

    res.json({
      symbol,
      ohlcv: data.slice(-200), // Only return relevant recent candles to UI
      smc: {
        fvgs,
        orderBlocks: obs,
        advanced: advancedSMC
      },
      indicators: {
        ema20: latestEMA20,
        ema50: latestEMA50,
        rsi14: latestRSI
      }
    });
  } catch (error) {
    console.error('[Trading API] Error fetching chart data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. Dedicated AI Analysis Endpoint (Manual trigger)
tradingRouter.get('/analyze', async (req, res) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC-USD';
    const timeframe = (req.query.timeframe as string) || '1h';

    const data = await YahooFinanceService.getHistoricalData(symbol, '1mo', timeframe);
    if (!data || data.length < 20) return res.status(404).json({ error: 'Not enough data' });

    const closePrices = data.map((d: any) => d.close);
    const currentPrice = closePrices[closePrices.length - 1];

    // Technicals
    const rsi = calculateRSI(closePrices, 14).pop() || 50;
    const ema20 = calculateEMA(closePrices, 20).pop() || currentPrice;
    const ema50 = calculateEMA(closePrices, 50).pop() || currentPrice;

    // SMC
    const fvgs = SMCEngine.detectFVGs(data);
    const swings = SMCEngine.detectSwings(data, 5);
    const obs = SMCEngine.detectOrderBlocks(data, fvgs);
    const advanced = SMCEngine.analyzeStructure(data, swings);

    // Dynamic Analysis Logic
    let trend = ema20 > ema50 ? 'BULLISH' : 'BEARISH';
    let momentum = advanced.momentum.isHigh ? 'High Volatility' : 'Stable';
    let structure = advanced.bos.type;

    const bullFVGs = fvgs.filter(f => f.type === 'bullish' && !f.mitigated).length;
    const bearFVGs = fvgs.filter(f => f.type === 'bearish' && !f.mitigated).length;

    let bias = 'Neutral';
    if (trend === 'BULLISH' && rsi < 70) bias = 'Bullish Bias';
    if (trend === 'BEARISH' && rsi > 30) bias = 'Bearish Bias';
    if (rsi > 70) bias = 'Overbought (Caution)';
    if (rsi < 30) bias = 'Oversold (Watch for reversal)';

    const aiSummary = `[AI Analysis] Target: ${symbol} (${timeframe}). The market structure is currently ${structure} with a ${trend} trend. Price is ${currentPrice > ema20 ? 'above' : 'below'} the EMA20 ($${ema20.toFixed(2)}). RSI is at ${rsi.toFixed(1)} (${bias}). We have ${obs.length} Order Blocks and ${fvgs.length} FVGs (${bullFVGs} Bull / ${bearFVGs} Bear). Analysis suggests ${momentum} environment. Recommendation: ${trend === 'BULLISH' ? 'Look for longs at Bullish OB' : 'Look for shorts at Bearish OB'} if ${advanced.mtf.confluence}/3 confluence is met.`;

    res.json({ analysis: aiSummary, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[Analyze API] Error:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// 3. Watchlist Endpoint (Prices for shortcut bar)
tradingRouter.get('/watchlist', async (req, res) => {
  try {
    const defaultWatchlist = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'AAPL', 'TSLA'];
    const quotes = await YahooFinanceService.getWatchlistQuotes(defaultWatchlist);
    res.json({ watchlist: quotes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});
