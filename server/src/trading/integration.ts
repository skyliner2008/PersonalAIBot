import { YahooFinanceService } from './yahooFinance';
import { calculateRSI, calculateBollingerBands, calculateSMA } from './indicators';
import { ChartRenderer } from './chartRenderer';
import fs from 'fs';
import path from 'path';

// Assuming there's a public folder for the dashboard to serve images from
const PUBLIC_DIR = path.join(__dirname, '../../public_personal_ai/charts');

export class TradingIntegration {
  static async executeAnalysisCommand(symbol: string, userId: string): Promise<{ text: string, imageUrl?: string }> {
    try {
      // 1. Fetch Data
      const quote = await YahooFinanceService.getQuote(symbol);
      const historicalData = await YahooFinanceService.getHistoricalData(symbol, '6mo', '1d');

      if (!quote || !historicalData || historicalData.length === 0) {
        return { text: `ขออภัย ไม่พบข้อมูลสำหรับ ${symbol} ในขณะนี้ครับ` };
      }

      // 2. Calculate Indicators (Example: RSI 14)
      const closePrices = historicalData.map((d: any) => d.close);
      const rsi = calculateRSI(closePrices, 14);
      const currentRsi = rsi[rsi.length - 1];
      
      const sma50 = calculateSMA(closePrices, 50);
      const currentSma50 = sma50[sma50.length - 1];

      // 3. Simple Agent Logic (This would ideally be passed to the LLM)
      let trend = "Sideway";
      if (quote.regularMarketPrice > currentSma50) trend = "Uptrend";
      else if (quote.regularMarketPrice < currentSma50) trend = "Downtrend";

      let rsiStatus = "Neutral";
      if (currentRsi > 70) rsiStatus = "Overbought (มีโอกาสย่อตัว)";
      else if (currentRsi < 30) rsiStatus = "Oversold (มีโอกาสรีบาวด์)";

      const analysisText = `📊 **วิเคราะห์ ${symbol}**\n` +
        `ราคาปัจจุบัน: ${quote.regularMarketPrice.toFixed(2)} (${quote.regularMarketChangePercent > 0 ? '+' : ''}${quote.regularMarketChangePercent.toFixed(2)}%)\n` +
        `แนวโน้มระยะกลาง (SMA50): ${trend}\n` +
        `RSI (14): ${currentRsi.toFixed(2)} - ${rsiStatus}\n\n` +
        `*คำเตือน: นี่เป็นการวิเคราะห์ทางเทคนิคเบื้องต้น ไม่ใช่คำแนะนำการลงทุน*`;

      // 4. Generate Chart
      const imageBuffer = await ChartRenderer.renderChart(historicalData, symbol);
      let imageUrl;

      if (imageBuffer) {
        // Ensure directory exists
        if (!fs.existsSync(PUBLIC_DIR)) {
          fs.mkdirSync(PUBLIC_DIR, { recursive: true });
        }
        
        const filename = `${symbol}_${Date.now()}.png`;
        const filepath = path.join(PUBLIC_DIR, filename);
        fs.writeFileSync(filepath, imageBuffer);
        
        // This URL format depends on how Express serves the public folder
        imageUrl = `/charts/${filename}`; 
      }

      // 5. TODO: Integrate with 4-Layer Memory here
      // MemoryService.saveMemory({ userId, type: 'financial_analysis', content: analysisText });

      return { text: analysisText, imageUrl };

    } catch (error) {
      console.error("Error executing trading command:", error);
      return { text: "เกิดข้อผิดพลาดในการประมวลผลข้อมูลการเทรดครับ" };
    }
  }
}
