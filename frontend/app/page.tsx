"use client";
import { apiFetch } from "@/lib/auth";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Wallet, CreditCard, PiggyBank, RefreshCw } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const API = "http://localhost:8000/api/v1";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

const categoryColors: Record<string, string> = {
  cash: "bg-teal-500",
  taxable: "bg-blue-500",
  retirement: "bg-purple-500",
  hsa: "bg-cyan-500",
  alternative: "bg-orange-500",
  manual: "bg-gray-400",
  credit_card: "bg-red-500",
  loan: "bg-rose-700",
};

const categoryLabels: Record<string, string> = {
  cash: "Cash",
  taxable: "Investments",
  retirement: "Retirement",
  hsa: "HSA",
  alternative: "Alternatives",
  manual: "Manual",
  credit_card: "Credit Cards",
  loan: "Loans",
};

export default function Dashboard() {
  const [summary, setSummary]       = useState<any>(null);
  const [projection, setProjection] = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch(`${API}/networth/summary`);
      const data = await res.json();
      setSummary(data);
      try {
        const proj = await (await apiFetch("/api/v1/cashflow/projection")).json();
        setProjection(proj);
      } catch { /* non-critical */ }
    } catch (e) {
      setError("Cannot connect to backend. Make sure it's running on port 8000.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
    </div>
  );

  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
  );

  const assets = summary?.total_assets ?? 0;
  const liabilities = summary?.total_liabilities ?? 0;
  const netWorth = summary?.net_worth ?? 0;
  const breakdown = summary?.category_breakdown ?? {};
  const owners = summary?.owner_breakdown ?? {};

  const assetCategories = Object.entries(breakdown).filter(([k]) =>
    ["cash","taxable","retirement","hsa","alternative","manual"].includes(k)
  );
  const liabilityCategories = Object.entries(breakdown).filter(([k]) =>
    ["credit_card","loan"].includes(k)
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">As of {summary?.as_of}</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Net Worth Hero */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm font-medium text-gray-500 mb-1">Total Net Worth</p>
        <p className="text-4xl font-bold text-gray-900">{fmt(netWorth)}</p>
        <div className="flex gap-6 mt-4">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Total Assets</p>
            <p className="text-lg font-semibold text-teal-600">{fmt(assets)}</p>
          </div>
          <div className="w-px bg-gray-200" />
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Total Liabilities</p>
            <p className="text-lg font-semibold text-red-500">{fmt(liabilities)}</p>
          </div>
          {Object.keys(owners).length > 0 && (
            <>
              <div className="w-px bg-gray-200" />
              {Object.entries(owners).map(([name, val]: any) => (
                <div key={name}>
                  <p className="text-xs text-gray-400 mb-0.5">{name}</p>
                  <p className="text-lg font-semibold text-indigo-600">{fmt(val)}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Breakdown Cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* Assets */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-teal-500" />
            <h2 className="font-semibold text-gray-900 text-sm">Assets</h2>
            <span className="ml-auto text-sm font-semibold text-teal-600">{fmt(assets)}</span>
          </div>
          {assetCategories.length === 0 ? (
            <p className="text-sm text-gray-400">No accounts yet. Add accounts in Settings.</p>
          ) : (
            <ul className="space-y-2">
              {assetCategories.map(([cat, val]: any) => (
                <li key={cat} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${categoryColors[cat] ?? "bg-gray-400"}`} />
                  <span className="text-sm text-gray-600 flex-1">{categoryLabels[cat] ?? cat}</span>
                  <span className="text-sm font-medium text-gray-900">{fmt(val)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Liabilities */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-4 h-4 text-red-500" />
            <h2 className="font-semibold text-gray-900 text-sm">Liabilities</h2>
            <span className="ml-auto text-sm font-semibold text-red-500">{fmt(liabilities)}</span>
          </div>
          {liabilityCategories.length === 0 ? (
            <p className="text-sm text-gray-400">No liabilities yet.</p>
          ) : (
            <ul className="space-y-2">
              {liabilityCategories.map(([cat, val]: any) => (
                <li key={cat} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${categoryColors[cat] ?? "bg-gray-400"}`} />
                  <span className="text-sm text-gray-600 flex-1">{categoryLabels[cat] ?? cat}</span>
                  <span className="text-sm font-medium text-gray-900">{fmt(val)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Net Worth Projection Widget */}
      {projection && projection.current_nw > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 text-sm">Net Worth Projection</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Based on avg monthly savings of {fmt(projection.avg_monthly_savings)}
              </p>
            </div>
            {projection.milestones?.length > 0 && (
              <div className="text-right">
                <p className="text-xs text-gray-400">Next milestone</p>
                <p className="text-sm font-semibold text-indigo-600">
                  {fmt(projection.milestones[0].target)} in {Math.ceil(projection.milestones[0].months_away)} months
                </p>
              </div>
            )}
          </div>

          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[
                  ...projection.history.map((h: any) => ({
                    label: h.date?.slice(0, 7),
                    net_worth: h.net_worth,
                    type: "actual",
                  })),
                  ...projection.projections.map((p: any) => ({
                    label: p.month,
                    projected: p.net_worth,
                    type: "projected",
                  })),
                ]}
              >
                <defs>
                  <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#4f46e5" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}    />
                  </linearGradient>
                  <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#a5b4fc" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#a5b4fc" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <ReferenceLine y={projection.current_nw} stroke="#e5e7eb" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="net_worth" stroke="#4f46e5" fill="url(#nwGrad)"
                  strokeWidth={2} connectNulls />
                <Area type="monotone" dataKey="projected" stroke="#a5b4fc" fill="url(#projGrad)"
                  strokeWidth={2} strokeDasharray="4 4" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Milestone targets */}
          {projection.milestones?.length > 0 && (
            <div className="flex gap-3">
              {projection.milestones.map((m: any, i: number) => (
                <div key={i} className="flex-1 bg-indigo-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-indigo-400">Reach {fmt(m.target)}</p>
                  <p className="text-sm font-semibold text-indigo-700">{m.reach_date}</p>
                  <p className="text-xs text-indigo-400">{Math.ceil(m.months_away)} months away</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state CTA */}
      {assetCategories.length === 0 && liabilityCategories.length === 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-6 text-center">
          <PiggyBank className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
          <h3 className="font-semibold text-indigo-900 mb-1">No accounts yet</h3>
          <p className="text-sm text-indigo-600 mb-4">Go to Settings to add your household members and accounts.</p>
          <a href="/settings" className="inline-flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
            Get Started →
          </a>
        </div>
      )}
    </div>
  );
}
