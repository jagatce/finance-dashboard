"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

function fmt(n: number | null, d = 1) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtUSD(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: any; label: string }> = {
  "Outperform":  { color: "text-green-700",  bg: "bg-green-50 border-green-200",   icon: TrendingUp,   label: "Outperform"   },
  "In-line":     { color: "text-blue-700",   bg: "bg-blue-50 border-blue-200",     icon: Minus,        label: "In-line"      },
  "Underperform":{ color: "text-red-700",    bg: "bg-red-50 border-red-200",       icon: TrendingDown, label: "Underperform" },
  "Watch":       { color: "text-amber-700",  bg: "bg-amber-50 border-amber-200",   icon: AlertTriangle,label: "Watch"        },
  "N/A":         { color: "text-gray-500",   bg: "bg-gray-50 border-gray-200",     icon: Minus,        label: "N/A"          },
};

const FILTERS = ["All", "Watch", "Underperform", "In-line", "Outperform", "N/A"] as const;

export default function HoldingsReviewPage() {
  const [data, setData]         = useState<any>(null);
  const [loading, setLoading]   = useState(false);
  const [filter, setFilter]     = useState<string>("All");
  const [fetched, setFetched]     = useState(false);
  const [proxyMap, setProxyMap]   = useState<Record<string,string>>({});
  const [showProxy, setShowProxy] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);

  useEffect(() => { fetchReview(); }, []);

  useEffect(() => { fetchReview(false); }, []);

  useEffect(() => { fetchProxyMap(); }, []);

  async function fetchProxyMap() {
    const d = await apiFetch("/api/v1/holdings/review/proxy-mapping").then(r => r.json());
    setProxyMap(d.mapping || {});
  }

  async function saveProxyMap() {
    setSavingProxy(true);
    try {
      await apiFetch("/api/v1/holdings/review/proxy-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping: proxyMap }),
      });
      await fetchReview(true);
    } finally { setSavingProxy(false); }
  }

  async function fetchReview(refresh = false) {
    setLoading(true);
    try {
      const d = await apiFetch(`/api/v1/holdings/review?refresh=${refresh}`).then(r => r.json());
      setData(d);
      setFetched(true);
    } finally { setLoading(false); }
  }

  const positions = (data?.positions || []).filter((p: any) =>
    filter === "All" || p.status === filter
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Holdings Review</h1>
          <p className="text-sm text-gray-500 mt-0.5">1-year performance vs S&P 500 + 200 EMA trend</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.cached_at && (
            <p className="text-xs text-gray-400">Last run: {new Date(data.cached_at).toLocaleString()}</p>
          )}
          <button onClick={() => fetchReview(true)} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Analyzing…" : "Refresh"}
          </button>
        </div>
      </div>

      {!fetched && !loading && (
        <div className="text-center py-20 space-y-3">
          <TrendingUp className="w-12 h-12 text-gray-200 mx-auto" />
          <p className="text-sm font-medium text-gray-500">Click Run Analysis to fetch 1-year performance data</p>
          <p className="text-xs text-gray-400">This may take 30-60 seconds — fetches live data from yfinance</p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
          <p className="text-sm text-gray-500">Fetching 1-year price history for all tickers…</p>
          <p className="text-xs text-gray-400">This may take 30-60 seconds</p>
        </div>
      )}

      {fetched && !loading && data && (
        <>
          {/* Summary cards */}
          {(() => {
            // Compute weighted avg return and total value per status
            const byStatus = (status: string) => {
              const ps = data.positions?.filter((p: any) => p.status === status && p.return_1y != null) || [];
              const totalVal = ps.reduce((s: number, p: any) => s + (p.current_value || 0), 0);
              const allVal   = data.positions?.filter((p: any) => p.status === status).reduce((s: number, p: any) => s + (p.current_value || 0), 0) || 0;
              const wAvgRet  = totalVal > 0 ? ps.reduce((s: number, p: any) => s + p.return_1y * p.current_value, 0) / totalVal : null;
              return { count: data.summary?.[status === "In-line" ? "inline" : status.toLowerCase()], totalVal: allVal, wAvgRet };
            };
            const cards = [
              { label: "Portfolio 1Y",  color: "text-indigo-600", count: null,
                totalVal: data.positions?.reduce((s: number, p: any) => s + (p.current_value || 0), 0),
                wAvgRet: (() => {
                  const ps = data.positions?.filter((p: any) => p.return_1y != null) || [];
                  const tv = ps.reduce((s: number, p: any) => s + (p.current_value || 0), 0);
                  return tv > 0 ? ps.reduce((s: number, p: any) => s + p.return_1y * p.current_value, 0) / tv : null;
                })()
              },
              { label: "S&P 500 1Y",    color: "text-gray-900",  count: null, totalVal: null, wAvgRet: data.spy_return_1y },
              { label: "Outperform",    color: "text-green-600", ...byStatus("Outperform")   },
              { label: "In-line",       color: "text-blue-600",  ...byStatus("In-line")      },
              { label: "Underperform",  color: "text-red-500",   ...byStatus("Underperform") },
              { label: "Watch",         color: "text-amber-600", ...byStatus("Watch")        },
            ];
            return (
              <div className="grid grid-cols-6 gap-3">
                {cards.map(c => (
                  <div key={c.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-1">
                    <p className="text-xs text-gray-500">{c.label}</p>
                    <p className={`text-xl font-bold ${c.color}`}>
                      {c.count != null ? c.count : ""}
                      {c.wAvgRet != null ? (
                        <span className={c.count != null ? "text-sm ml-1" : ""}>
                          {c.wAvgRet >= 0 ? "+" : ""}{fmt(c.wAvgRet)}%
                        </span>
                      ) : "—"}
                    </p>
                    {c.totalVal != null && c.totalVal > 0 && (
                      <p className="text-xs text-gray-400">{fmtUSD(c.totalVal)}</p>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Filter tabs */}
          <div className="flex gap-1">
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  filter === f
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}>
                {f}
                {f !== "All" && (
                  <span className="ml-1 opacity-70">
                    ({data.positions?.filter((p: any) => p.status === f).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Proxy mapping panel for N/A funds */}
          {data.positions?.some((p: any) => p.status === "N/A") && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-700">N/A Fund Proxy Mapping</p>
                  <p className="text-xs text-gray-400 mt-0.5">Auto-assigned where possible. Override for employer-specific funds.</p>
                </div>
                <button onClick={() => setShowProxy(v => !v)}
                  className="text-xs text-indigo-600 border border-indigo-200 rounded px-2 py-1">
                  {showProxy ? "Hide" : "Edit"}
                </button>
              </div>
              {showProxy && (
                <div className="space-y-2">
                  {data.positions?.filter((p: any) => !p.has_data || p.proxy_ticker).map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <span className="text-gray-700 w-48 truncate" title={p.name}>{p.ticker}</span>
                      <span className="text-gray-400 flex-1 truncate">{p.name}</span>
                      <input
                        placeholder={p.proxy_ticker || "e.g. SPY"}
                        value={proxyMap[p.ticker] || ""}
                        onChange={e => setProxyMap(prev => ({ ...prev, [p.ticker]: e.target.value.toUpperCase() }))}
                        className="border border-gray-300 rounded px-2 py-1 w-24 text-xs"
                      />
                      {p.proxy_ticker && !proxyMap[p.ticker] && (
                        <span className="text-gray-400 text-xs">auto: {p.proxy_ticker}</span>
                      )}
                    </div>
                  ))}
                  <button onClick={saveProxyMap} disabled={savingProxy}
                    className="px-4 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50">
                    {savingProxy ? "Saving…" : "Save & Refresh"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Positions table */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Position</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">1Y Return</th>
                  <th className="px-4 py-3 text-right">vs SPY</th>
                  <th className="px-4 py-3 text-center">200 EMA</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {positions.map((p: any, i: number) => {
                  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG["N/A"];
                  const Icon = cfg.icon;
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{p.ticker}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[180px]">{p.name}</p>
                        {p.proxy_ticker && p.proxy_ticker !== p.yf_ticker && (
                          <p className="text-xs text-indigo-400">proxy: {p.proxy_ticker}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{p.account_name || p.account_id}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700">{fmtUSD(p.current_value)}</td>
                      <td className="px-4 py-3 text-right">
                        {p.return_1y != null ? (
                          <span className={p.return_1y >= 0 ? "text-green-600" : "text-red-500"}>
                            {p.return_1y >= 0 ? "+" : ""}{fmt(p.return_1y)}%
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {p.vs_spy != null ? (
                          <span className={p.vs_spy >= 0 ? "text-green-600" : "text-red-500"}>
                            {p.vs_spy >= 0 ? "+" : ""}{fmt(p.vs_spy)}%
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.above_ema200 != null ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${p.above_ema200 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                            {p.above_ema200 ? "Above" : "Below"}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${cfg.bg} ${cfg.color}`}>
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px]">{p.recommendation}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
