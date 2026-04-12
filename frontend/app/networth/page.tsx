"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { apiFetch } from "@/lib/auth";

const API = "http://localhost:8000/api/v1";

const CATEGORY_COLORS: Record<string, string> = {
  cash:        "#14b8a6",
  taxable:     "#3b82f6",
  retirement:  "#a855f7",
  hsa:         "#06b6d4",
  alternative: "#f97316",
  manual:      "#9ca3af",
  credit_card: "#ef4444",
  loan:        "#be123c",
};

const CATEGORY_LABELS: Record<string, string> = {
  cash:        "Cash",
  taxable:     "Investments",
  retirement:  "Retirement",
  hsa:         "HSA",
  alternative: "Alternatives",
  manual:      "Manual",
  credit_card: "Credit Cards",
  loan:        "Loans",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(n);
}

function fmtShort(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const RANGES = ["1M", "3M", "6M", "1Y", "All"];

function filterByRange(data: any[], range: string) {
  if (range === "All" || data.length === 0) return data;
  const now   = new Date();
  const months: Record<string, number> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 };
  const cutoff = new Date(now.setMonth(now.getMonth() - (months[range] ?? 12)));
  return data.filter((d) => new Date(d.date) >= cutoff);
}

export default function NetWorthPage() {
  const [history, setHistory]   = useState<any[]>([]);
  const [summary, setSummary]   = useState<any>(null);
  const [range, setRange]       = useState("1Y");
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      const [histRes, sumRes] = await Promise.all([
        apiFetch(`${API}/networth/history`),
        apiFetch(`${API}/networth/summary`),
      ]);
      setHistory(await histRes.json());
      setSummary(await sumRes.json());
      setLoading(false);
    }
    load();
  }, []);

  const filtered = filterByRange(history, range);

  // Net worth change
  const first    = filtered[0]?.net_worth ?? 0;
  const last     = filtered[filtered.length - 1]?.net_worth ?? 0;
  const change   = last - first;
  const changePct = first !== 0 ? ((change / Math.abs(first)) * 100).toFixed(1) : "0";
  const positive = change >= 0;

  // Allocation pie data (assets only)
  const breakdown   = summary?.category_breakdown ?? {};
  const assetCats   = ["cash","taxable","retirement","hsa","alternative","manual"];
  const pieData     = assetCats
    .filter((k) => breakdown[k] > 0)
    .map((k) => ({ name: CATEGORY_LABELS[k], value: breakdown[k], key: k }));

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      Loading...
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Net Worth</h1>
        <p className="text-sm text-gray-500 mt-0.5">As of {summary?.as_of}</p>
      </div>

      {/* Hero */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm text-gray-500 mb-1">Total Net Worth</p>
        <p className="text-4xl font-bold text-gray-900">{fmt(summary?.net_worth ?? 0)}</p>
        <div className="flex items-center gap-2 mt-2">
          {positive
            ? <TrendingUp className="w-4 h-4 text-green-500" />
            : <TrendingDown className="w-4 h-4 text-red-500" />}
          <span className={`text-sm font-medium ${positive ? "text-green-600" : "text-red-500"}`}>
            {positive ? "+" : ""}{fmt(change)} ({positive ? "+" : ""}{changePct}%)
          </span>
          <span className="text-sm text-gray-400">over selected period</span>
        </div>

        {/* Asset / Liability split */}
        <div className="flex gap-8 mt-4 pt-4 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Total Assets</p>
            <p className="text-lg font-semibold text-teal-600">{fmt(summary?.total_assets ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Total Liabilities</p>
            <p className="text-lg font-semibold text-red-500">{fmt(summary?.total_liabilities ?? 0)}</p>
          </div>
          {Object.entries(summary?.owner_breakdown ?? {}).map(([name, val]: any) => (
            <div key={name}>
              <p className="text-xs text-gray-400 mb-0.5">{name}</p>
              <p className="text-lg font-semibold text-indigo-600">{fmt(val)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Net Worth Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-semibold text-gray-900">Net Worth Over Time</h2>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  range === r
                    ? "bg-indigo-600 text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {filtered.length < 2 ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            Add balances on multiple dates to see trends here.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={filtered}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={(d) => {
                  const dt = new Date(d);
                  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={fmtShort}
                width={60}
              />
              <Tooltip
                formatter={(v: number) => [fmt(v), "Net Worth"]}
                labelFormatter={(d) => new Date(d).toLocaleDateString("en-US", {
                  month: "long", day: "numeric", year: "numeric"
                })}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
              />
              <Line
                type="monotone"
                dataKey="net_worth"
                stroke="#4f46e5"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#4f46e5" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Allocation + Owner breakdown */}
      <div className="grid grid-cols-2 gap-4">

        {/* Pie chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Asset Allocation</h2>
          {pieData.length === 0 ? (
            <p className="text-sm text-gray-400">No asset data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.key} fill={CATEGORY_COLORS[entry.key]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => [fmt(v)]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend
                  formatter={(v) => <span style={{ fontSize: 11, color: "#6b7280" }}>{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Category breakdown list */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Breakdown</h2>
          <ul className="space-y-3">
            {Object.entries(breakdown).map(([cat, val]: any) => {
              const total = summary?.total_assets + summary?.total_liabilities;
              const pct   = total > 0 ? ((Math.abs(val) / total) * 100).toFixed(1) : "0";
              const isLiability = ["credit_card","loan"].includes(cat);
              return (
                <li key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: CATEGORY_COLORS[cat] ?? "#9ca3af" }}
                      />
                      <span className="text-sm text-gray-600">{CATEGORY_LABELS[cat] ?? cat}</span>
                    </div>
                    <span className={`text-sm font-medium ${isLiability ? "text-red-500" : "text-gray-900"}`}>
                      {isLiability ? "-" : ""}{fmt(Math.abs(val))}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: CATEGORY_COLORS[cat] ?? "#9ca3af"
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
