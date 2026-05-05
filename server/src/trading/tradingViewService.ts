import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TVAnalysis {
  symbol: string;
  price: number;
  change: number;
  recommendation: string;
  buy: number;
  sell: number;
  neutral: number;
  indicators: any;
  error?: string;
}

export class TradingViewService {
  private static cache = new Map<string, { data: TVAnalysis, timestamp: number }>();
  private static CACHE_TTL = 30000; // 30 seconds

  private static getExchange(symbol: string): { exchange: string, cleanSymbol: string } {
    // Basic mapping for popular symbols
    const sym = symbol.toUpperCase();
    if (sym.endsWith('-USD')) return { exchange: 'BINANCE', cleanSymbol: sym.replace('-USD', 'USDT') };
    if (['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN'].includes(sym)) return { exchange: 'NASDAQ', cleanSymbol: sym };
    if (sym === 'EURUSD=X' || sym === 'EURUSD') return { exchange: 'FX_IDC', cleanSymbol: 'EURUSD' };
    
    return { exchange: 'NASDAQ', cleanSymbol: sym }; // Default to NASDAQ
  }

  static async getBulkAnalysis(symbols: string[], timeframe: string = '1h'): Promise<Record<string, TVAnalysis>> {
    const formattedSymbols = symbols.map(s => {
      const { exchange, cleanSymbol } = this.getExchange(s);
      return `${exchange}:${cleanSymbol}`;
    });

    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, 'tv_fetcher.py');
      const command = `python "${scriptPath}" "${formattedSymbols.join(',')}" ${timeframe}`;

      exec(command, (error, stdout, stderr) => {
        if (error || stderr) {
          resolve({});
          return;
        }

        try {
          const bulkData = JSON.parse(stdout);
          const results: Record<string, TVAnalysis> = {};
          
          for (const [key, data] of Object.entries(bulkData)) {
            const tvData = data as any;
            if (!tvData.error) {
              const result: TVAnalysis = {
                symbol: key.split(':')[1] || key,
                price: tvData.price,
                change: tvData.change,
                recommendation: tvData.recommendation,
                buy: 0, sell: 0, neutral: 0, // Simplified for bulk
                indicators: tvData.indicators
              };
              results[result.symbol] = result;
              
              // Update individual cache for single-fetch consistency
              this.cache.set(`${result.symbol}_${timeframe}`, { data: result, timestamp: Date.now() });
            }
          }
          resolve(results);
        } catch (e) {
          resolve({});
        }
      });
    });
  }

  static async getAnalysis(symbol: string, timeframe: string = '1h'): Promise<TVAnalysis | null> {
    const { cleanSymbol } = this.getExchange(symbol);
    const cacheKey = `${cleanSymbol}_${timeframe}`;
    
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < 15000) {
      return cached.data;
    }

    // For single fetch, we'll just do a bulk of one to reuse logic
    const results = await this.getBulkAnalysis([symbol], timeframe);
    return results[cleanSymbol] || null;
  }
}

function jsonSafeParse(str: string) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}
