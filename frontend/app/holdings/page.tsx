"use client";
import { useState, useEffect, useRef } from "react";
import { apiFetch, getToken } from "@/lib/auth";
import { Upload, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";

interface Position {
  id: number;
  account_id: string;
  broker: string;
  ticker: string;
  name: string;
  asset_type: string;
  quantity: number | null;
  price: number | null;
  value: number | null;
  cost_basis: number | null;
  gain_pct: number | null;
  day_change_pct: number | null;
  as_of_date: string | null;
}

interface Summary {
  total_value: number;
  total_cost: number;
  gain_pct: number | null;
  position_count: number;
  allocations: { label: string; pct: number; value: number }[];
}

function fmtUSD(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

function fmt(n: number | null, d = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function GainBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-gray-400 text-xs">—</span>;
  const pos = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${pos ? "text-green-600" : "text-red-500"}`}>
      {pos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {pos ? "+" : ""}{fmt(pct)}%
    </span>
  );
}

const ASSET_COLORS: Record<string, string> = {
  stock:  "bg-blue-100 text-blue-700",
  etf:    "bg-violet-100 text-violet-700",
  fund:   "bg-indigo-100 text-indigo-700",
  crypto: "bg-amber-100 text-amber-700",
  other:  "bg-gray-100 text-gray-600",
};

const ALLOC_BG: Record<string, string> = {
  stock:  "bg-blue-500",
  etf:    "bg-violet-500",
  fund:   "bg-indigo-500",
  crypto: "bg-amber-500",
  other:  "bg-gray-400",
};

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: string }) {
  if (sortField !== field) return <span className="text-gray-300 ml-1">↕</span>;
  return <span className="text-indigo-500 ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>;
}

export default function HoldingsPage() {
  const [positions, setPositions]   = useState<Position[]>([]);
  const [sortField, setSortField]   = useState<string>("gain_dollar");
  const [sortDir, setSortDir]       = useState<"asc"|"desc">("desc");
  const [filterAccount, setFilterAccount] = useState<string>("all");
  // summary is computed from positions client-side so it respects filters
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadMsg, setUploadMsg]   = useState<string | null>(null);
  const [accountId, setAccountId]   = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const pos = await apiFetch("/api/v1/holdings/").then(r => r.json());
      setPositions(Array.isArray(pos) ? pos : []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const accounts = ["all", ...Array.from(new Set(positions.map(p => p.account_id))).sort()];



  function toggleSort(field: string) {
    if (sortField === field) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const displayed = positions
    .filter(p => filterAccount === "all" || p.account_id === filterAccount)
    .sort((a, b) => {
      let av: number, bv: number;
      if (sortField === "value") {
        av = a.value ?? -Infinity; bv = b.value ?? -Infinity;
      } else if (sortField === "gain_dollar") {
        av = (a.value != null && a.cost_basis != null) ? a.value - a.cost_basis : -Infinity;
        bv = (b.value != null && b.cost_basis != null) ? b.value - b.cost_basis : -Infinity;
      } else {
        av = a.gain_pct ?? -Infinity; bv = b.gain_pct ?? -Infinity;
      }
      return sortDir === "desc" ? bv - av : av - bv;
    });

  // Compute summary from filtered positions so cards stay in sync with filter
  const totalValue = displayed.reduce((s, p) => s + (p.value ?? 0), 0);
  const totalCost  = displayed.reduce((s, p) => s + (p.cost_basis ?? 0), 0);
  const overallGain = totalCost > 0 ? ((totalValue - totalCost) / totalCost * 100) : null;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("account_id", accountId);
      const token = getToken();
      const res = await fetch("/api/v1/holdings/import", { method: "POST", body: form, headers: { "x-auth-token": token } });
      const data = await res.json();
      if (!res.ok) {
        setUploadMsg(`Error: ${data.detail || "Import failed"}`);
      } else {
        setUploadMsg(`Imported ${data.imported} positions for "${data.account_id}"`);
        await load();
      }
    } catch {
      setUploadMsg("Upload error — check console");
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleDeleteAccount(accountId: string) {
    if (!confirm(`Delete all holdings for "${accountId}"? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/v1/holdings/account/${encodeURIComponent(accountId)}`, { method: "DELETE" });
      if (res.ok) {
        setFilterAccount("all");
        setUploadMsg(`Deleted holdings for "${accountId}"`);
        await load();
      } else {
        setUploadMsg(`Error deleting "${accountId}"`);
      }
    } catch { setUploadMsg("Delete failed"); }
  }

  async function handleRefreshPrices() {
    setRefreshing(true);
    try {
      const res  = await apiFetch("/api/v1/holdings/prices/refresh");
      const data = await res.json();
      setUploadMsg(`Refreshed prices for ${data.refreshed} tickers`);
      await load();
    } catch { setUploadMsg("Price refresh failed"); }
    setRefreshing(false);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Holdings</h1>
        <button
          onClick={handleRefreshPrices}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          Refresh Prices
        </button>
      </div>

      {/* Account filter */}
      {positions.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {accounts.map(a => (
            <div key={a} className="flex items-center gap-1">
              <button
                onClick={() => setFilterAccount(a)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                  ${filterAccount === a
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}
              >
                {a === "all" ? "All Accounts" : a}
              </button>
              {a !== "all" && (
                <button
                  onClick={() => handleDeleteAccount(a)}
                  className="text-gray-300 hover:text-red-400 text-xs px-1 transition-colors"
                  title={`Delete all ${a} holdings`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Summary cards — computed from filtered positions */}
      {positions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Value",  value: fmtUSD(totalValue), color: "text-gray-900" },
            { label: "Total Cost",   value: fmtUSD(totalCost),  color: "text-gray-900" },
            { label: "Overall Gain", value: overallGain != null ? `${overallGain >= 0 ? "+" : ""}${fmt(overallGain)}%` : "—",
              color: overallGain != null ? overallGain >= 0 ? "text-green-600" : "text-red-500" : "text-gray-900" },
            { label: "Positions",    value: String(displayed.length), color: "text-gray-900" },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">{c.label}</p>
              <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Allocation bar — computed from filtered positions */}
      {displayed.length > 0 && (() => {
        const byType: Record<string, number> = {};
        displayed.forEach(p => {
          const t = p.asset_type || "other";
          byType[t] = (byType[t] ?? 0) + (p.value ?? 0);
        });
        const allocs = Object.entries(byType)
          .sort((a, b) => b[1] - a[1])
          .map(([label, val]) => ({ label, value: val, pct: totalValue > 0 ? Math.round(val / totalValue * 1000) / 10 : 0 }));
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Allocation</h2>
            <div className="flex rounded-full overflow-hidden h-2.5 mb-3">
              {allocs.map(a => (
                <div key={a.label} style={{ width: `${a.pct}%` }}
                  className={`${ALLOC_BG[a.label] ?? "bg-gray-400"}`}
                  title={`${a.label}: ${a.pct}%`} />
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              {allocs.map(a => (
                <div key={a.label} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <div className={`w-2 h-2 rounded-full ${ALLOC_BG[a.label] ?? "bg-gray-400"}`} />
                  {a.label}
                  <span className="text-gray-400">{a.pct}%</span>
                  <span className="text-gray-400">{fmtUSD(a.value)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Import section */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Import Holdings</h2>
        <p className="text-xs text-gray-500">Tag each file with an account name — this is how re-imports stay isolated. Example: <span className="font-mono">fidelity-dell</span>, <span className="font-mono">robinhood</span></p>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex flex-col gap-1">
            <input
              type="text"
              placeholder="Account name (required)"
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className={`border rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none text-gray-700
                ${accountId.trim() ? "border-gray-200 focus:border-indigo-400" : "border-red-300 focus:border-red-400"}`}
            />
            {!accountId.trim() && (
              <span className="text-xs text-red-400">Required before uploading</span>
            )}
          </div>
          <label className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium
            ${!accountId.trim() || uploading
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"}`}>
            <Upload size={13} />
            {uploading ? "Importing…" : "Upload CSV / PDF"}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.pdf"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading || !accountId.trim()}
            />
          </label>
        </div>
        {uploadMsg && (
          <p className={`text-sm ${uploadMsg.startsWith("Error") ? "text-red-500" : "text-green-600"}`}>
            {uploadMsg}
          </p>
        )}
        <p className="text-xs text-gray-400">Supports: Betterment, Fidelity, M1 Finance, Empower, Robinhood</p>
      </div>

      {/* Positions table */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">Loading...</div>
      ) : positions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
          No positions yet. Import a broker file above.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                <th className="text-left px-4 py-3">Position</th>
                <th className="text-left px-4 py-3">Account</th>
                <th className="text-right px-4 py-3">Cost Basis</th>
                <th className="text-right px-4 py-3">Price</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Qty</th>
                <th className="text-right px-4 py-3 cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort("value")}>
                  Value<SortIcon field="value" sortField={sortField} sortDir={sortDir} />
                </th>
                <th className="text-right px-4 py-3 cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort("gain_dollar")}>
                  Gain / Loss<SortIcon field="gain_dollar" sortField={sortField} sortDir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((p, i) => (
                <tr key={p.id} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i === displayed.length - 1 ? "border-0" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-gray-900">{p.ticker}</div>
                    <div className="text-xs text-gray-400 mt-0.5 max-w-[180px] truncate">{p.name || ""}</div>
                    <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ASSET_COLORS[p.asset_type] ?? ASSET_COLORS.other}`}>
                      {p.asset_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.account_id}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-600">{fmtUSD(p.cost_basis)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-900">{fmtUSD(p.price)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-600 hidden sm:table-cell">{fmt(p.quantity, 4)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">{fmtUSD(p.value)}</td>
                  <td className="px-4 py-3 text-right">
                    {p.cost_basis && p.value ? (
                      <div>
                        <div className={`text-xs font-medium ${(p.value - p.cost_basis) >= 0 ? "text-green-600" : "text-red-500"}`}>
                          {(p.value - p.cost_basis) >= 0 ? "+" : ""}{fmtUSD(p.value - p.cost_basis)}
                        </div>
                        <GainBadge pct={p.gain_pct} />
                      </div>
                    ) : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
