"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/auth";
import { Plus, RefreshCw, X, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface WaferRow {
  ticker: string;
  name: string;
  signal: string | null;
  health_score: number | null;
  price: number | null;
  ema200: number | null;
  delta_ema: number | null;
  rsi: number | null;
  rsi_label: string | null;
  macd_label: string | null;
  refreshed_at: string | null;
  accounts?: string[];
}

function fmt(n: number | null, d = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtUSD(n: number | null) {
  if (n == null) return "—";
  return "$" + fmt(n);
}

function SignalBadge({ signal }: { signal: string | null }) {
  if (!signal) return <span className="text-gray-300 text-xs">—</span>;
  const styles: Record<string, string> = {
    buy:   "bg-green-100 text-green-700",
    sell:  "bg-red-100 text-red-700",
    watch: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${styles[signal] ?? "bg-gray-100 text-gray-600"}`}>
      {signal}
    </span>
  );
}

function HealthBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-gray-300 text-xs">—</span>;
  const color = score >= 70 ? "bg-green-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-gray-500">{score}</span>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-gray-300 text-xs">—</span>;
  const pos = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${pos ? "text-green-600" : "text-red-500"}`}>
      {pos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {pos ? "+" : ""}{fmt(delta)}%
    </span>
  );
}

function WaferRow({ row, onAnalyze, analyzing }: {
  row: WaferRow;
  onAnalyze: (ticker: string) => void;
  analyzing: boolean;
}) {
  const router = useRouter();
  return (
    <tr
      className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
      onClick={() => router.push(`/sensor/${row.ticker}`)}
    >
      <td className="px-4 py-3">
        <div className="font-mono font-semibold text-gray-900">{row.ticker}</div>
        <div className="text-xs text-gray-400 truncate max-w-[160px]">{row.name || ""}</div>
      </td>
      <td className="px-4 py-3 text-right font-mono text-gray-900">{fmtUSD(row.price)}</td>
      <td className="px-4 py-3 text-right font-mono text-gray-500 hidden md:table-cell">{fmtUSD(row.ema200)}</td>
      <td className="px-4 py-3 text-right hidden md:table-cell"><DeltaBadge delta={row.delta_ema} /></td>
      <td className="px-4 py-3 text-right hidden lg:table-cell">
        <span className="text-xs text-gray-600">{row.rsi != null ? fmt(row.rsi, 1) : "—"}</span>
        {row.rsi_label && <span className="text-xs text-gray-400 ml-1">({row.rsi_label})</span>}
      </td>
      <td className="px-4 py-3 text-center hidden lg:table-cell">
        <SignalBadge signal={row.signal} />
      </td>
      <td className="px-4 py-3 hidden md:table-cell"><HealthBar score={row.health_score} /></td>
      <td className="px-4 py-3 text-right hidden lg:table-cell">
        <span className="text-xs text-gray-400">{timeAgo(row.refreshed_at)}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={e => { e.stopPropagation(); onAnalyze(row.ticker); }}
          disabled={analyzing}
          className="px-2.5 py-1 text-xs rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {analyzing ? <RefreshCw size={11} className="animate-spin inline" /> : "Analyze"}
        </button>
      </td>
    </tr>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}


function fmtRefreshTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function SensorPage() {
  const [tab, setTab]                   = useState<"portfolio" | "research">("portfolio");
  const [portfolioTickers, setPortfolioTickers] = useState<WaferRow[]>([]);
  const [watchlist, setWatchlist]       = useState<string[]>([]);
  const [analysisMap, setAnalysisMap]   = useState<Record<string, WaferRow>>({});
  const [analyzing, setAnalyzing]       = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [sensorRefreshedAt, setSensorRefreshedAt] = useState<Date | null>(null);
  const [newTicker, setNewTicker]       = useState("");
  const [adding, setAdding]             = useState(false);
  const [msg, setMsg]                   = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [portRes, watchRes, analysisRes] = await Promise.all([
        apiFetch("/api/v1/sensor/portfolio/tickers").then(r => r.json()),
        apiFetch("/api/v1/sensor/watchlist").then(r => r.json()),
        apiFetch("/api/v1/sensor/tickers").then(r => r.json()),
      ]);

      // Build analysis map
      const amap: Record<string, WaferRow> = {};
      if (Array.isArray(analysisRes)) {
        analysisRes.forEach((r: WaferRow) => { amap[r.ticker] = r; });
      }
      setAnalysisMap(amap);

      // Portfolio rows — merge with analysis data
      if (Array.isArray(portRes)) {
        const rows: WaferRow[] = portRes.map((p: { ticker: string; accounts: string[] }) => ({
          ...(amap[p.ticker] ?? {}),
          ticker:   p.ticker,
          accounts: p.accounts,
          name:     amap[p.ticker]?.name ?? p.ticker,
          signal:   amap[p.ticker]?.signal ?? null,
          health_score: amap[p.ticker]?.health_score ?? null,
          price:    amap[p.ticker]?.price ?? null,
          ema200:   amap[p.ticker]?.ema200 ?? null,
          delta_ema: amap[p.ticker]?.delta_ema ?? null,
          rsi:      amap[p.ticker]?.rsi ?? null,
          rsi_label: amap[p.ticker]?.rsi_label ?? null,
          macd_label: amap[p.ticker]?.macd_label ?? null,
          refreshed_at: amap[p.ticker]?.refreshed_at ?? null,
        }));
        setPortfolioTickers(rows);
      }

      if (Array.isArray(watchRes)) {
        setWatchlist(watchRes.map((r: { ticker: string }) => r.ticker));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAnalyze(ticker: string) {
    setAnalyzing(ticker);
    setMsg(null);
    try {
      const res  = await apiFetch(`/api/v1/sensor/${ticker}/refresh`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMsg(`Error: ${data.detail || "Analysis failed"}`);
      } else {
        setMsg(`✓ ${ticker} analyzed — ${data.analysis?.signal?.toUpperCase()} (${data.analysis?.health_score}/100)`);
        await load();
      }
    } catch { setMsg(`Error analyzing ${ticker}`); }
    setAnalyzing(null);
  }

  async function handleRefreshAll() {
    setRefreshingAll(true);
    setMsg(null);
    try {
      // Call backend directly to bypass Next.js proxy 30s timeout
      // This request can take 10-15 minutes for a full portfolio refresh
      const token = typeof window !== "undefined" ? sessionStorage.getItem("fineos_token") : null;
      const res  = await fetch("http://localhost:8000/api/v1/sensor/refresh/all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-auth-token": token } : {}),
        },
        signal: AbortSignal.timeout(20 * 60 * 1000), // 20 minute timeout
      });
      const data = await res.json();
      const ok   = data.refreshed?.length ?? 0;
      const fail = data.failed?.length ?? 0;
      const total = data.total ?? ok + fail;
      setSensorRefreshedAt(new Date());
      setMsg(`✓ Refreshed ${ok}/${total} tickers${fail > 0 ? ` (${fail} failed)` : ""}`);
      await load();
    } catch { setSensorRefreshedAt(new Date()); setMsg("Refresh all failed — request may have timed out"); }
    setRefreshingAll(false);
  }

  async function handleAddTicker() {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    setAdding(true);
    setMsg(null);
    try {
      const res  = await apiFetch("/api/v1/sensor/watchlist", {
        method: "POST",
        body: JSON.stringify({ ticker: t }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(`Error: ${data.detail}`);
      } else {
        setNewTicker("");
        await load();
      }
    } catch { setMsg("Failed to add ticker"); }
    setAdding(false);
  }

  async function handleRemoveTicker(ticker: string) {
    await apiFetch(`/api/v1/sensor/watchlist/${ticker}`, { method: "DELETE" });
    await load();
  }

  const researchRows: WaferRow[] = watchlist.map(t => ({
    ...(analysisMap[t] ?? {}),
    ticker:   t,
    name:     analysisMap[t]?.name ?? t,
    signal:   analysisMap[t]?.signal ?? null,
    health_score: analysisMap[t]?.health_score ?? null,
    price:    analysisMap[t]?.price ?? null,
    ema200:   analysisMap[t]?.ema200 ?? null,
    delta_ema: analysisMap[t]?.delta_ema ?? null,
    rsi:      analysisMap[t]?.rsi ?? null,
    rsi_label: analysisMap[t]?.rsi_label ?? null,
    macd_label: analysisMap[t]?.macd_label ?? null,
    refreshed_at: analysisMap[t]?.refreshed_at ?? null,
  }));

  const rows = tab === "portfolio" ? portfolioTickers : researchRows;

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Claude Sensor</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefreshAll}
            disabled={refreshingAll || loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshingAll ? "animate-spin" : ""} />
            {refreshingAll ? "Refreshing…" : "Refresh All"}
          </button>
          {sensorRefreshedAt && (
            <span className="text-xs text-gray-400">Updated {fmtRefreshTime(sensorRefreshedAt)}</span>
          )}
        </div>

      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(["portfolio", "research"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize
              ${tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t === "portfolio" ? "Portfolio" : "Research"}
          </button>
        ))}
      </div>

      {/* Research tab — add ticker */}
      {tab === "research" && (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Ticker (e.g. NVDA)"
            value={newTicker}
            onChange={e => setNewTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleAddTicker()}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-40 font-mono focus:outline-none focus:border-indigo-400"
          />
          <button
            onClick={handleAddTicker}
            disabled={adding || !newTicker.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            <Plus size={13} />
            Add
          </button>
        </div>
      )}

      {msg && (
        <p className={`text-sm ${msg.startsWith("Error") ? "text-red-500" : "text-green-600"}`}>{msg}</p>
      )}

      {/* Wafer table */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
          {tab === "portfolio"
            ? "No holdings imported yet. Import broker files on the Holdings page."
            : "No tickers yet. Add a ticker above to start tracking."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                <th className="text-left px-4 py-3">Ticker</th>
                <th className="text-right px-4 py-3">Price</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">EMA 200</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Δ EMA</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">RSI</th>
                <th className="text-center px-4 py-3 hidden lg:table-cell">Signal</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Health</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <WaferRow
                  key={row.ticker}
                  row={row}
                  onAnalyze={handleAnalyze}
                  analyzing={analyzing === row.ticker}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Research tab — remove buttons */}
      {tab === "research" && watchlist.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {watchlist.map(t => (
            <div key={t} className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 rounded-full text-xs text-gray-600">
              {t}
              <button onClick={() => handleRemoveTicker(t)} className="text-gray-400 hover:text-red-400 ml-1">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
