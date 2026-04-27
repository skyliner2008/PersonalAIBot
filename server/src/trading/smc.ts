export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface FVG {
  time: number;
  top: number;
  bottom: number;
  type: 'bullish' | 'bearish';
  mitigated: boolean;
}

export interface OrderBlock {
  time: number;
  top: number;
  bottom: number;
  type: 'bullish' | 'bearish';
  mitigated: boolean;
}

export interface StructureBreak {
  time: number;
  price: number;
  type: 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
}

export class SMCEngine {
  static detectFVGs(data: Candle[]): FVG[] {
    const fvgs: FVG[] = [];
    if (data.length < 3) return fvgs;

    for (let i = 2; i < data.length; i++) {
      const current = data[i];
      const prev = data[i - 1];
      const prev2 = data[i - 2];

      // Bullish FVG: Current Low is higher than Prev2 High
      if (current.low > prev2.high && prev.close > prev2.high) {
        fvgs.push({
          time: prev.time, // The FVG is formed by the middle candle
          top: current.low,
          bottom: prev2.high,
          type: 'bullish',
          mitigated: false
        });
      }

      // Bearish FVG: Current High is lower than Prev2 Low
      if (current.high < prev2.low && prev.close < prev2.low) {
        fvgs.push({
          time: prev.time,
          top: prev2.low,
          bottom: current.high,
          type: 'bearish',
          mitigated: false
        });
      }
    }
    return fvgs;
  }

  static detectSwings(data: Candle[], length: number = 5) {
    const swingHighs = [];
    const swingLows = [];

    for (let i = length; i < data.length - length; i++) {
      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= length; j++) {
        if (data[i].high <= data[i - j].high || data[i].high <= data[i + j].high) isHigh = false;
        if (data[i].low >= data[i - j].low || data[i].low >= data[i + j].low) isLow = false;
      }

      if (isHigh) swingHighs.push({ time: data[i].time, price: data[i].high, index: i });
      if (isLow) swingLows.push({ time: data[i].time, price: data[i].low, index: i });
    }
    return { swingHighs, swingLows };
  }

  // Simplified OB Detection based on the PineScript
  static detectOrderBlocks(data: Candle[], fvgs: FVG[]): OrderBlock[] {
    const obs: OrderBlock[] = [];
    const { swingHighs, swingLows } = this.detectSwings(data, 5);

    // Bullish OB: Last down candle before a strong up move (creating FVG) that breaks structure
    for (const low of swingLows) {
       // Look for a bearish candle right before or at the swing low
       let obCandle = null;
       for(let k = Math.max(0, low.index - 3); k <= low.index; k++) {
           if(data[k].close < data[k].open) {
               obCandle = data[k];
           }
       }

       if (obCandle) {
           // Check if this move created a bullish FVG shortly after
           const recentFVG = fvgs.find(f => f.type === 'bullish' && f.time > obCandle!.time && f.time < data[Math.min(data.length-1, low.index + 10)].time);
           if (recentFVG) {
               obs.push({
                   time: obCandle.time,
                   top: Math.max(obCandle.open, obCandle.close), // Strict SMC uses body
                   bottom: Math.min(obCandle.open, obCandle.close),
                   type: 'bullish',
                   mitigated: false
               });
           }
       }
    }

    // Bearish OB: Last up candle before a strong down move (creating FVG)
    for (const high of swingHighs) {
       let obCandle = null;
       for(let k = Math.max(0, high.index - 3); k <= high.index; k++) {
           if(data[k].close > data[k].open) {
               obCandle = data[k];
           }
       }

       if (obCandle) {
           const recentFVG = fvgs.find(f => f.type === 'bearish' && f.time > obCandle!.time && f.time < data[Math.min(data.length-1, high.index + 10)].time);
           if (recentFVG) {
               obs.push({
                   time: obCandle.time,
                   top: Math.max(obCandle.open, obCandle.close),
                   bottom: Math.min(obCandle.open, obCandle.close),
                   type: 'bearish',
                   mitigated: false
               });
           }
       }
    }

    return obs;
  }

  /**
   * Detect Market Structure (BOS / CHoCH)
   * Simplified logic:
   * BOS: Break in the direction of trend.
   * CHoCH: First break against the trend.
   */
  static analyzeStructure(data: Candle[], swings: { swingHighs: any[], swingLows: any[] }): { bos: any, liquidity: any, momentum: any, mtf: any } {
    if (data.length < 20) return { bos: null, liquidity: null, momentum: null, mtf: null };

    const currentPrice = data[data.length - 1].close;
    const { swingHighs, swingLows } = swings;

    // Find latest BOS
    let latestBOS = { type: 'Neutral', price: 0, time: 0 };
    if (swingHighs.length > 2) {
      const lastHigh = swingHighs[swingHighs.length - 1];
      const prevHigh = swingHighs[swingHighs.length - 2];
      if (currentPrice > lastHigh.price) {
        latestBOS = { type: 'Bullish BOS', price: lastHigh.price, time: lastHigh.time };
      } else if (currentPrice < swingLows[swingLows.length - 1].price) {
        latestBOS = { type: 'Bearish BOS', price: swingLows[swingLows.length - 1].price, time: swingLows[swingLows.length - 1].time };
      }
    }

    // Detect Liquidity (Equal Highs/Lows)
    let liquidity = { type: 'None', price: 0, strength: 0 };
    if (swingHighs.length >= 2) {
      const h1 = swingHighs[swingHighs.length - 1].price;
      const h2 = swingHighs[swingHighs.length - 2].price;
      if (Math.abs(h1 - h2) / h1 < 0.001) {
        liquidity = { type: 'Equal Highs', price: h1, strength: 4 };
      }
    }

    // Momentum (ATR / Body size comparison)
    const lastCandle = data[data.length - 1];
    const avgBody = data.slice(-10).reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / 10;
    const isHighMomentum = Math.abs(lastCandle.close - lastCandle.open) > avgBody * 2;

    return {
      bos: latestBOS,
      liquidity: liquidity,
      momentum: { isHigh: isHighMomentum, score: isHighMomentum ? 8 : 4 },
      mtf: { signal: currentPrice > data[data.length - 10].close ? 'Bullish' : 'Bearish', confluence: 2 }
    };
  }
}

