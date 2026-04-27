import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

export class ChartRenderer {
  /**
   * Generates a chart image using Playwright and Lightweight Charts
   * @param data Array of {time, open, high, low, close}
   * @param symbol Symbol name (e.g. 'AAPL')
   * @returns Buffer containing the PNG image
   */
  static async renderChart(data: any[], symbol: string, indicators?: any): Promise<Buffer | null> {
    if (!data || data.length === 0) return null;

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      
      // We build a simple HTML string that includes TradingView Lightweight Charts via CDN
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background-color: #131722; color: #d1d4dc; font-family: sans-serif; }
            #container { width: 800px; height: 400px; }
            .title { position: absolute; top: 10px; left: 10px; z-index: 10; font-size: 20px; font-weight: bold; }
          </style>
          <script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
        </head>
        <body>
          <div class="title">${symbol} - AI Technical Analysis</div>
          <div id="container"></div>
          <script>
            const chartOptions = { 
              layout: { textColor: '#d1d4dc', backgroundColor: '#131722' },
              grid: { vertLines: { color: '#363c4e' }, horzLines: { color: '#363c4e' } }
            };
            const chart = LightweightCharts.createChart(document.getElementById('container'), chartOptions);
            const candlestickSeries = chart.addCandlestickSeries({
                upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
                wickUpColor: '#26a69a', wickDownColor: '#ef5350',
            });
            
            // Inject data from Node
            const chartData = ${JSON.stringify(data.map(d => ({
              time: d.time / 1000, // Lightweight charts expects unix timestamp in seconds
              open: d.open, high: d.high, low: d.low, close: d.close
            })))};
            
            candlestickSeries.setData(chartData);
            chart.timeScale().fitContent();

            // Tell playwright we are done rendering
            window.chartReady = true;
          </script>
        </body>
        </html>
      `;

      await page.setContent(htmlContent);
      // Wait for the chart script to set the flag
      await page.waitForFunction(() => (window as any).chartReady === true);
      
      // Wait just a tiny bit more for canvas to fully paint
      await page.waitForTimeout(500);

      const container = await page.$('#container');
      if (container) {
          const screenshot = await container.screenshot();
          return screenshot;
      }
      return null;
    } catch (error) {
      console.error('Error rendering chart:', error);
      return null;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
