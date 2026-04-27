export function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j];
      }
      sma.push(sum / period);
    }
  }
  return sma;
}

export function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      ema.push(data[i]); // Start with SMA (or just the first value for simplicity)
    } else {
      ema.push((data[i] - ema[i - 1]) * multiplier + ema[i - 1]);
    }
  }
  return ema;
}

export function calculateRSI(data: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  let gains = 0;
  let losses = 0;

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      rsi.push(NaN);
      continue;
    }

    const difference = data[i] - data[i - 1];
    
    if (i <= period) {
      if (difference >= 0) gains += difference;
      else losses -= difference;

      if (i === period) {
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));
      } else {
        rsi.push(NaN);
      }
    } else {
      const prevAvgGain = (gains * (period - 1) + (difference >= 0 ? difference : 0)) / period;
      const prevAvgLoss = (losses * (period - 1) + (difference < 0 ? -difference : 0)) / period;
      
      gains = prevAvgGain;
      losses = prevAvgLoss;

      const rs = prevAvgLoss === 0 ? 100 : prevAvgGain / prevAvgLoss;
      rsi.push(prevAvgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));
    }
  }
  return rsi;
}

export function calculateBollingerBands(data: number[], period: number = 20, multiplier: number = 2) {
  const sma = calculateSMA(data, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      let sumSq = 0;
      for (let j = 0; j < period; j++) {
        sumSq += Math.pow(data[i - j] - sma[i], 2);
      }
      const stdev = Math.sqrt(sumSq / period);
      upper.push(sma[i] + (multiplier * stdev));
      lower.push(sma[i] - (multiplier * stdev));
    }
  }
  return { sma, upper, lower };
}
