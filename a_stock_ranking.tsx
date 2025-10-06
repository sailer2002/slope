import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Activity, Settings, X, Plus } from 'lucide-react';

// A股主要指数配置
const STOCK_INDICES = [
  { code: 'sh000001', name: '上证指数', sinaCode: 's_sh000001' },
  { code: 'sz399001', name: '深证成指', sinaCode: 's_sz399001' },
  { code: 'sz399006', name: '创业板指', sinaCode: 's_sz399006' },
  { code: 'sh000300', name: '沪深300', sinaCode: 's_sh000300' },
  { code: 'sh000016', name: '上证50', sinaCode: 's_sh000016' },
  { code: 'sh000905', name: '中证500', sinaCode: 's_sh000905' },
  { code: 'sh000852', name: '中证1000', sinaCode: 's_sh000852' },
  { code: 'sz399005', name: '中小板指', sinaCode: 's_sz399005' },
  { code: 'sz399008', name: '中小300', sinaCode: 's_sz399008' },
  { code: 'sh000688', name: '科创50', sinaCode: 's_sh000688' },
];

// 计算线性回归斜率、R²和综合得分（与Python numpy.polyfit一致）
const calcSlopeAndScore = (prices, window, annualDays = 250) => {
  if (!prices || prices.length < window) return null;
  
  const recentPrices = prices.slice(-window);
  const logPrices = recentPrices.map(p => Math.log(p));
  const xValues = Array.from({ length: window }, (_, i) => i);
  
  // 使用最小二乘法计算斜率（与np.polyfit相同的算法）
  const n = window;
  const meanX = xValues.reduce((a, b) => a + b, 0) / n;
  const meanY = logPrices.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = xValues[i] - meanX;
    const dy = logPrices[i] - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }
  
  if (Math.abs(denominator) < 1e-10) return null;
  
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  
  // 计算R²
  let ssRes = 0;  // 残差平方和
  for (let i = 0; i < n; i++) {
    const yPred = slope * xValues[i] + intercept;
    const residual = logPrices[i] - yPred;
    ssRes += residual * residual;
  }
  
  // 计算总平方和 (使用ddof=1的方差)
  let variance = 0;
  for (let i = 0; i < n; i++) {
    variance += Math.pow(logPrices[i] - meanY, 2);
  }
  variance = variance / (n - 1);  // ddof=1
  const ssTot = (n - 1) * variance;
  
  const rSquared = 1 - (ssRes / ssTot);
  
  // 计算年化收益率
  const annualizedReturns = Math.pow(Math.exp(slope), annualDays) - 1;
  
  // 综合得分 = 年化收益率 × R²
  const score = annualizedReturns * rSquared;
  
  return { slope, rSquared, annualizedReturns, score };
};

// 计算N天收益率
const calcReturns = (prices, days) => {
  if (!prices || prices.length < days + 1) return 0;
  const currentPrice = prices[prices.length - 1];
  const pastPrice = prices[prices.length - 1 - days];
  return ((currentPrice - pastPrice) / pastPrice) * 100;
};

export default function AStockSlopeRanking() {
  const [window] = useState(25);
  const [sortBy] = useState('score');
  const [indices, setIndices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // 获取历史K线数据
  const fetchHistoricalData = async (code) => {
    try {
      const secid = code.startsWith('sh') ? `1.${code.slice(2)}` : `0.${code.slice(2)}`;
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=120`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.data && data.data.klines) {
        const klines = data.data.klines;
        const prices = klines.map(k => {
          const parts = k.split(',');
          return parseFloat(parts[2]); // 收盘价
        });
        return prices;
      }
      return null;
    } catch (err) {
      console.error(`获取 ${code} 数据失败:`, err);
      return null;
    }
  };

  // 获取实时价格
  const fetchRealtimePrice = async (sinaCode) => {
    try {
      const response = await fetch(`https://hq.sinajs.cn/list=${sinaCode}`);
      const text = await response.text();
      const match = text.match(/="([^"]+)"/);
      if (match) {
        const parts = match[1].split(',');
        const currentPrice = parseFloat(parts[1]);
        const prevClose = parseFloat(parts[2]);
        const priceChange = ((currentPrice - prevClose) / prevClose) * 100;
        return { currentPrice, priceChange };
      }
      return null;
    } catch (err) {
      console.error(`获取实时价格失败:`, err);
      return null;
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const results = await Promise.all(
        STOCK_INDICES.map(async (index) => {
          const prices = await fetchHistoricalData(index.code);
          if (!prices || prices.length < Math.max(window, 25)) {
            return null;
          }

          const stats = calcSlopeAndScore(prices, window);
          if (!stats) return null;

          const returns20d = calcReturns(prices, 20);
          const returns25d = calcReturns(prices, 25);

          const realtimeData = await fetchRealtimePrice(index.sinaCode);
          
          return {
            ...index,
            slope: stats.slope,
            rSquared: stats.rSquared,
            annualizedReturns: stats.annualizedReturns,
            score: stats.score,
            returns20d,
            returns25d,
            currentPrice: realtimeData?.currentPrice || prices[prices.length - 1],
            priceChange: realtimeData?.priceChange || 0,
          };
        })
      );

      const validResults = results.filter(r => r !== null);
      
      if (validResults.length === 0) {
        setError('无法获取数据，请检查网络连接或稍后重试');
      } else {
        setIndices(validResults);
        setLastUpdate(new Date());
      }
    } catch (err) {
      setError('数据加载失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const sortedIndices = [...indices].sort((a, b) => {
    if (sortBy === 'score') return b.score - a.score;
    if (sortBy === 'returns20') return b.returns20d - a.returns20d;
    if (sortBy === 'returns25') return b.returns25d - a.returns25d;
    return 0;
  });

  // 检查指数是否符合标记条件
  const isHighlighted = (index) => {
    return index.score > 0.7 && index.returns20d > 1 && index.returns25d > 4;
  };

  const formatNumber = (num, decimals = 2) => {
    return num?.toFixed(decimals) || '0.00';
  };

  const getColor = (value) => {
    if (value > 0) return 'text-red-600';
    if (value < 0) return 'text-green-600';
    return 'text-gray-600';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-7 h-7 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">A股指数综合得分排行</h1>
                <p className="text-sm text-gray-500 mt-1">基于线性回归和拟合优度的指数动量分析</p>
              </div>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? '加载中' : '刷新'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-700">{error}</div>
          </div>
        )}

        {/* Table */}
        {indices.length > 0 ? (
          <div className="bg-white rounded border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">排名</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">代码</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">名称</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">最新</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">涨跌幅</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">综合得分</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">20日收益</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">25日收益</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedIndices.map((index, idx) => {
                    const highlighted = isHighlighted(index);
                    return (
                      <tr 
                        key={index.code} 
                        className={`hover:bg-gray-50 transition ${
                          highlighted ? 'border-l-4 border-l-yellow-400' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                            {idx + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {index.code.toUpperCase()}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {index.name}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-900">
                          {formatNumber(index.currentPrice, 2)}
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${getColor(index.priceChange)}`}>
                          {index.priceChange > 0 ? '+' : ''}{formatNumber(index.priceChange)}%
                        </td>
                        <td className={`px-4 py-3 text-right ${
                          index.score > 0.7 ? 'font-bold text-blue-600' : getColor(index.score)
                        }`}>
                          {formatNumber(index.score, 4)}
                        </td>
                        <td className={`px-4 py-3 text-right ${
                          index.returns20d > 1 ? 'font-bold text-red-600' : getColor(index.returns20d)
                        }`}>
                          {index.returns20d > 0 ? '+' : ''}{formatNumber(index.returns20d)}%
                        </td>
                        <td className={`px-4 py-3 text-right ${
                          index.returns25d > 4 ? 'font-bold text-red-600' : getColor(index.returns25d)
                        }`}>
                          {index.returns25d > 0 ? '+' : ''}{formatNumber(index.returns25d)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          !loading && !error && (
            <div className="bg-white rounded border border-gray-200 p-12 text-center text-gray-500 text-sm">
              点击刷新按钮开始加载数据
            </div>
          )
        )}

        {/* Stats */}
        {indices.length > 0 && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded border border-gray-200 p-4">
              <div className="text-xs text-gray-500 mb-1">优选指数</div>
              <div className="text-xl font-bold text-yellow-600">
                {indices.filter(i => isHighlighted(i)).length}
              </div>
            </div>
            <div className="bg-white rounded border border-gray-200 p-4">
              <div className="text-xs text-gray-500 mb-1">得分 &gt; 0.7</div>
              <div className="text-xl font-bold text-blue-600">
                {indices.filter(i => i.score > 0.7).length}
              </div>
            </div>
            <div className="bg-white rounded border border-gray-200 p-4">
              <div className="text-xs text-gray-500 mb-1">平均得分</div>
              <div className={`text-xl font-bold ${getColor(
                indices.reduce((sum, i) => sum + i.score, 0) / indices.length
              )}`}>
                {formatNumber(indices.reduce((sum, i) => sum + i.score, 0) / indices.length, 4)}
              </div>
            </div>
            <div className="bg-white rounded border border-gray-200 p-4">
              <div className="text-xs text-gray-500 mb-1">当前窗口</div>
              <div className="text-xl font-bold text-blue-600">
                {window}天
              </div>
            </div>
          </div>
        )}

        {/* Footer Notice */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded p-4">
          <p className="text-xs text-blue-800 leading-relaxed">
            <strong>计算说明：</strong>
            <br/>• 斜率：对数价格的线性回归斜率，使用numpy.polyfit算法计算
            <br/>• R²：拟合优度，表示线性回归的解释能力（0-1之间，越接近1越好）
            <br/>• 综合得分：年化收益率 × R²，综合考虑收益率和趋势稳定性
            <br/>• 20日/25日收益：最近N个交易日的累计收益率
            <br/>• 数据来源：东方财富和新浪财经公开接口
          </p>
        </div>
      </div>
    </div>
  );
}