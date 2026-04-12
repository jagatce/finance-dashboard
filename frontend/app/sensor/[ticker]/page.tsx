"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/auth";
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Zap } from "lucide-react";

interface Technicals {
  price: number;
  ema200: number;
  delta_ema: number;
  ath: number;
  delta_ath: number;
  rsi: number;
  rsi_label: string;
  macd: number;
  macd_signal: number;
  macd_hist: number;
  macd_label: string;
  bb_upper: number;
  bb_mid: number;
  bb_lower: number;
  bb_width: number;
  bb_position: string;
  fundamentals: {
    name: string;
    sector: string;
    market_cap: number;
    pe_ratio: number;
    forward_pe: number;
    dividend_yield: number;
    revenue_growth: number;
    week_52_high: number;
    week_52_low: number;
  };
}

interface Analysis {
  signal: string;
  health_score: number;
  summary: string;
  reasoning: string;
  risks: string[];
  catalysts: string[];
  technicals_summary: string;
  fundamentals_summary: string;
}

function fmt(n: number | null, d = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtUSD(n: number | null) {
  if (n == null) return "—";
  return "$" + fmt(n);
}

function fmtBig(n: number | null) {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function SignalBadge({ signal }: { signal: string }) {
  const styles: Record<string, string> = {
    buy:   "bg-green-100 text-green-700 border-green-200",
    sell:  "bg-red-100 text-red-700 border-red-200",
    watch: "bg-amber-100 text-amber-700 border-amber-200",
  };
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-bold uppercase border ${styles[signal] ?? "bg-gray-100 text-gray-600"}`}>
      {signal}
    </span>
  );
}

function Delta({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="text-gray-400">—</span>;
  const pos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${pos ? "text-green-600" : "text-red-500"}`}>
      {pos ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {pos ? "+" : ""}{fmt(value)}{suffix}
    </span>
  );
}

export default function TickerPage() {
  const { ticker }            = useParams<{ ticker: string }>();
  const router                = useRouter();
  const [data, setData]       = useState<{ analysis: Analysis; technicals: Technicals; refreshed_at: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/sensor/${ticker}`);
      if (res.status === 404) {
        setData(null);
      } else {
        const d = await res.json();
        setData(d);
      }
    } catch { setError("Failed to load analysis."); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [ticker]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/sensor/${ticker}/refresh`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail || "Refresh failed");
      } else {
        await load();
      }
    } catch { setError("Refresh failed."); }
    setRefreshing(false);
  }

  const t = data?.technicals;
  const a = data?.analysis;

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/sensor")} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">{ticker}</h1>
              {a && <SignalBadge signal={a.signal} />}
            </div>
            {t?.fundamentals?.name && (
              <p className="text-sm text-gray-500 mt-0.5">{t.fundamentals.name}</p>
            )}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">Loading...</div>
      ) : !data ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center space-y-2">
          <p className="text-gray-600 font-medium">No analysis yet for {ticker}</p>
          <p className="text-gray-400 text-sm">Click Analyze to fetch technicals and generate Claude analysis.</p>
        </div>
      ) : (
        <div className="space-y-4">

          {/* Price hero */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Current Price</p>
                <p className="text-2xl font-bold text-gray-900">{fmtUSD(t?.price ?? null)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">EMA 200</p>
                <p className="text-xl font-semibold text-gray-900">{fmtUSD(t?.ema200 ?? null)}</p>
                <Delta value={t?.delta_ema ?? null} />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">All-Time High</p>
                <p className="text-xl font-semibold text-gray-900">{fmtUSD(t?.ath ?? null)}</p>
                <Delta value={t?.delta_ath ?? null} />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Health Score</p>
                <p className="text-xl font-semibold text-gray-900">{a?.health_score ?? "—"}<span className="text-sm text-gray-400">/100</span></p>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1 w-24">
                  <div
                    className={`h-full rounded-full ${(a?.health_score ?? 0) >= 70 ? "bg-green-500" : (a?.health_score ?? 0) >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${a?.health_score ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Technicals */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">Technicals</h2>
              {[
                { label: "RSI (14)",      value: `${fmt(t?.rsi ?? null, 1)} — ${t?.rsi_label ?? ""}` },
                { label: "MACD Histogram",value: `${fmt(t?.macd_hist ?? null, 4)} — ${t?.macd_label ?? ""}` },
                { label: "MACD / Signal", value: `${fmt(t?.macd ?? null, 4)} / ${fmt(t?.macd_signal ?? null, 4)}` },
                { label: "BB Upper",      value: fmtUSD(t?.bb_upper ?? null) },
                { label: "BB Mid",        value: fmtUSD(t?.bb_mid ?? null) },
                { label: "BB Lower",      value: fmtUSD(t?.bb_lower ?? null) },
                { label: "BB Position",   value: t?.bb_position ?? "—" },
                { label: "BB Width",      value: t?.bb_width != null ? `${t.bb_width}%` : "—" },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{r.label}</span>
                  <span className="text-gray-900 font-medium">{r.value}</span>
                </div>
              ))}
              {a?.technicals_summary && (
                <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">{a.technicals_summary}</p>
              )}
            </div>

            {/* Fundamentals */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">Fundamentals</h2>
              {[
                { label: "Sector",         value: t?.fundamentals?.sector ?? "—" },
                { label: "Market Cap",     value: fmtBig(t?.fundamentals?.market_cap ?? null) },
                { label: "P/E (trailing)", value: fmt(t?.fundamentals?.pe_ratio ?? null) },
                { label: "P/E (forward)",  value: fmt(t?.fundamentals?.forward_pe ?? null) },
                { label: "Div Yield",      value: t?.fundamentals?.dividend_yield != null ? `${fmt(t.fundamentals.dividend_yield * 100)}%` : "—" },
                { label: "Revenue Growth", value: t?.fundamentals?.revenue_growth != null ? `${fmt(t.fundamentals.revenue_growth * 100)}%` : "—" },
                { label: "52w High",       value: fmtUSD(t?.fundamentals?.week_52_high ?? null) },
                { label: "52w Low",        value: fmtUSD(t?.fundamentals?.week_52_low ?? null) },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{r.label}</span>
                  <span className="text-gray-900 font-medium">{r.value}</span>
                </div>
              ))}
              {a?.fundamentals_summary && (
                <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">{a.fundamentals_summary}</p>
              )}
            </div>
          </div>

          {/* Claude Analysis */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Claude Analysis</h2>
              {data.refreshed_at && (
                <span className="text-xs text-gray-400">
                  {new Date(data.refreshed_at).toLocaleString()}
                </span>
              )}
            </div>

            <p className="text-gray-700 leading-relaxed">{a?.summary}</p>
            <p className="text-gray-600 text-sm leading-relaxed">{a?.reasoning}</p>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-red-600 uppercase mb-2">
                  <AlertTriangle size={12} /> Risks
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {a?.risks?.map((r, i) => (
                    <span key={i} className="px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-full border border-red-100">{r}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-green-600 uppercase mb-2">
                  <Zap size={12} /> Catalysts
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {a?.catalysts?.map((c, i) => (
                    <span key={i} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full border border-green-100">{c}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
