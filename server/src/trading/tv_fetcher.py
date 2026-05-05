import sys
import json
from tradingview_ta import get_multiple_analysis, Interval

def get_bulk_tv_data(symbols_with_exchanges, timeframe):
    try:
        # Map timeframe to tradingview_ta Interval
        interval_map = {
            "1m": Interval.INTERVAL_1_MINUTE,
            "5m": Interval.INTERVAL_5_MINUTES,
            "15m": Interval.INTERVAL_15_MINUTES,
            "1h": Interval.INTERVAL_1_HOUR,
            "4h": Interval.INTERVAL_4_HOURS,
            "1d": Interval.INTERVAL_1_DAY,
            "1w": Interval.INTERVAL_1_WEEK,
            "1M": Interval.INTERVAL_1_MONTH,
        }
        
        tv_interval = interval_map.get(timeframe, Interval.INTERVAL_1_HOUR)
        
        # symbols_with_exchanges format: "NASDAQ:AAPL,NASDAQ:TSLA,BINANCE:BTCUSDT"
        full_symbols = symbols_with_exchanges.split(",")
        
        # In tradingview_ta, get_multiple_analysis needs screener name. 
        # We'll use a smart approach: group by screener or just use 'america' for mixed stocks
        # For simplicity and speed, we assume 'america' or 'crypto' based on first symbol
        screener = "crypto" if "BINANCE" in full_symbols[0] or "KUCOIN" in full_symbols[0] else "america"
        
        analysis_results = get_multiple_analysis(
            screener=screener,
            interval=tv_interval,
            symbols=full_symbols
        )
        
        output = {}
        for sym_key, analysis in analysis_results.items():
            if analysis:
                output[sym_key] = {
                    "price": analysis.indicators.get("close"),
                    "change": analysis.indicators.get("change"),
                    "recommendation": analysis.summary.get("RECOMMENDATION"),
                    "indicators": {
                        "rsi": analysis.indicators.get("RSI"),
                        "ema20": analysis.indicators.get("EMA20"),
                        "ema50": analysis.indicators.get("EMA50"),
                        "tvRecommendation": analysis.summary.get("RECOMMENDATION")
                    }
                }
            else:
                output[sym_key] = {"error": "No data"}
                
        return output
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python tv_fetcher.py SYMBOLS_WITH_EXCHANGES TIMEFRAME"}))
        sys.exit(1)
        
    symbols = sys.argv[1]
    timeframe = sys.argv[2]
    
    data = get_bulk_tv_data(symbols, timeframe)
    print(json.dumps(data))
