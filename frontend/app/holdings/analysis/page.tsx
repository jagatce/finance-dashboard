"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { RefreshCw, AlertTriangle, Info, TrendingUp, TrendingDown } from "lucide-react";

interface Flag   { level: "warning" | "info"; message: string; }
interface Alloc  { label: string; pct: number; }
interface TopPos { ticker: string; name: string; value: number; pct_of_portfolio: number; gain_pct: number | null; }
interface Analysis {
  summary: string;
  total_value: number;
  total_cost: number;
  total_gain_pct: number;
  flags: Flag[];
  allocations: Alloc[];
  top_positions: TopPos[];
  commentary: string;
}



function fmtUSD(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmt(n: number | null, d = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

const ALLOC_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-indigo-500",
  "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-gray-400",
];

function fmtRefreshTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function AnalysisPage() {
  const [analysis, setAnalysis]       = useState<Analysis | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);


  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/holdings/analysis");
      if (res.status === 404) {
        setAnalysis(null);
      } else {
        const data = await res.json();
        setAnalysis(data.analysis);
        setRefreshedAt(data.refreshed_at);
      }
    } catch { setError("Failed to load analysis."); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/holdings/analysis/refresh", { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail || "Refresh failed");
      } else {
        await load();
      }
    } catch { setError("Refresh failed."); }
    setRefreshing(false);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Analysis</h1>
          {refreshedAt && (
            <p className="text-sm text-gray-500 mt-0.5">
              Last refreshed {fmtRefreshTime(new Date(refreshedAt))}
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Analyzing…" : "Refresh Analysis"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">Loading...</div>
      ) : !analysis ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center space-y-2">
          <p className="text-gray-600 font-medium">No analysis yet</p>
          <p className="text-gray-400 text-sm">Import holdings on the Positions page, then click Refresh Analysis.</p>
        </div>
      ) : (
        <div className="space-y-5">

          {/* Summary card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Portfolio Summary</p>
            <p className="text-gray-700 leading-relaxed">{analysis.summary}</p>
            <div className="flex gap-8 mt-4 pt-4 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Total Value</p>
                <p className="text-lg font-semibold text-gray-900">{fmtUSD(analysis.total_value)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Total Cost</p>
                <p className="text-lg font-semibold text-gray-900">{fmtUSD(analysis.total_cost)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Overall Gain</p>
                <p className={`text-lg font-semibold ${analysis.total_gain_pct >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {analysis.total_gain_pct >= 0 ? "+" : ""}{fmt(analysis.total_gain_pct)}%
                </p>
              </div>
            </div>
          </div>

          {/* Flags */}
          {analysis.flags.length > 0 && (
            <div className="space-y-2">
              {analysis.flags.map((f, i) => (
                <div key={i} className={`flex items-start gap-3 rounded-xl p-4 border text-sm
                  ${f.level === "warning"
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-blue-50 border-blue-200 text-blue-800"}`}>
                  {f.level === "warning"
                    ? <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    : <Info size={15} className="mt-0.5 shrink-0" />}
                  {f.message}
                </div>
              ))}
            </div>
          )}

          {/* Allocation bar */}
          {analysis.allocations.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Allocation</h2>
              <div className="flex rounded-full overflow-hidden h-2.5 mb-3">
                {analysis.allocations.map((a, i) => (
                  <div
                    key={a.label}
                    style={{ width: `${a.pct}%` }}
                    className={`${ALLOC_COLORS[i % ALLOC_COLORS.length]}`}
                    title={`${a.label}: ${a.pct}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-4">
                {analysis.allocations.map((a, i) => (
                  <div key={a.label} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <div className={`w-2 h-2 rounded-full ${ALLOC_COLORS[i % ALLOC_COLORS.length]}`} />
                    {a.label}
                    <span className="text-gray-400">{a.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top positions */}
          {analysis.top_positions.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Top Positions</h2>
              <div className="space-y-3">
                {analysis.top_positions.map(p => (
                  <div key={p.ticker} className="flex items-center gap-3">
                    <div className="font-mono text-sm font-semibold text-gray-900 w-16 shrink-0">{p.ticker}</div>
                    <div className="flex-1 min-w-0">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.min(p.pct_of_portfolio, 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{p.name}</div>
                    </div>
                    <div className="text-xs text-gray-400 w-10 text-right shrink-0">{fmt(p.pct_of_portfolio)}%</div>
                    <div className="text-sm font-semibold text-gray-900 w-24 text-right shrink-0">{fmtUSD(p.value)}</div>
                    <div className="w-16 text-right shrink-0">
                      {p.gain_pct != null ? (
                        <span className={`text-xs font-medium inline-flex items-center justify-end gap-1
                          ${p.gain_pct >= 0 ? "text-green-600" : "text-red-500"}`}>
                          {p.gain_pct >= 0 ? <TrendingUp size={11}/> : <TrendingDown size={11}/>}
                          {p.gain_pct >= 0 ? "+" : ""}{fmt(p.gain_pct)}%
                        </span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commentary */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-2">Observations</h2>
            <p className="text-gray-600 leading-relaxed text-sm">{analysis.commentary}</p>
          </div>

        </div>
      )}


    </div>
  );
}
