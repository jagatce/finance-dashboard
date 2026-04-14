"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell
} from "recharts";

interface MonthlySummary {
  month: string;
  income: number;
  spending: number;
  saved: number;
  savings_rate: number;
}

interface Props { month: string; }

function shortMonth(m: string) {
  const [y, mon] = m.split("-");
  return new Date(parseInt(y), parseInt(mon) - 1).toLocaleString("default", { month: "short" });
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as MonthlySummary;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs space-y-1">
      <p className="font-medium text-gray-900">{label}</p>
      <p className="text-green-600">Income:   ${d.income.toLocaleString()}</p>
      <p className="text-red-500">Spending: ${d.spending.toLocaleString()}</p>
      <p className="text-indigo-600">Saved:    ${d.saved.toLocaleString()}</p>
      <p className="font-semibold text-gray-900">Rate: {d.savings_rate}%</p>
    </div>
  );
};

export default function SavingsRateTab({ month }: Props) {
  const [data, setData]     = useState<MonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]     = useState<"rate"|"amounts">("rate");

  const year = month.split("-")[0];

  useEffect(() => { fetchSummary(); }, [year]);

  async function fetchSummary() {
    setLoading(true);
    try {
      const d = await apiFetch(`/api/v1/cashflow/summary?year=${year}`);
      setData(Array.isArray(d) ? d : []);
    } finally { setLoading(false); }
  }

  // Only show months with data
  const activeData = data.filter(d => d.income > 0 || d.spending > 0);

  const avgRate = activeData.length
    ? Math.round(activeData.reduce((s, d) => s + d.savings_rate, 0) / activeData.length)
    : 0;

  const totalIncome   = activeData.reduce((s, d) => s + d.income, 0);
  const totalSpending = activeData.reduce((s, d) => s + d.spending, 0);
  const totalSaved    = activeData.reduce((s, d) => s + d.saved, 0);

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );

  if (activeData.length === 0) return (
    <div className="text-center py-24 text-gray-400 text-sm">
      No data for {year}. Add income and spending to see your savings rate.
    </div>
  );

  const chartData = data.map(d => ({ ...d, label: shortMonth(d.month) }));

  return (
    <div className="space-y-6">

      {/* Year summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Avg Savings Rate", value: `${avgRate}%`,
            color: avgRate >= 20 ? "text-green-600" : avgRate >= 10 ? "text-yellow-600" : "text-red-500" },
          { label: "Total Income",   value: `$${totalIncome.toLocaleString()}`,   color: "text-green-600" },
          { label: "Total Spending", value: `$${totalSpending.toLocaleString()}`, color: "text-red-500"   },
          { label: "Total Saved",    value: `$${totalSaved.toLocaleString()}`,    color: "text-indigo-600" },
        ].map(c => (
          <div key={c.label} className="bg-gray-50 rounded-lg px-4 py-3 space-y-1">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-xl font-semibold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{year} — Monthly View</p>
        <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs">
          {(["rate", "amounts"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                view === v ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}>
              {v === "rate" ? "Savings Rate" : "Income vs Spending"}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {view === "rate" ? (
            <BarChart data={chartData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis unit="%" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} domain={[-100, 100]} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0}  stroke="#e5e7eb" />
              <ReferenceLine y={20} stroke="#6ee7b7" strokeDasharray="4 4" label={{ value: "20% target", fontSize: 10, fill: "#6ee7b7" }} />
              <Bar dataKey="savings_rate" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.savings_rate >= 20 ? "#4f46e5" : entry.savings_rate >= 0 ? "#a5b4fc" : "#fca5a5"} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={chartData} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="income"   fill="#4f46e5" radius={[4, 4, 0, 0]} />
              <Bar dataKey="spending" fill="#fca5a5" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Monthly breakdown table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2">Month</th>
              <th className="px-4 py-2 text-right">Income</th>
              <th className="px-4 py-2 text-right">Spending</th>
              <th className="px-4 py-2 text-right">Saved</th>
              <th className="px-4 py-2 text-right">Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map(d => (
              <tr key={d.month} className={`hover:bg-gray-50 ${d.month === month ? "bg-indigo-50" : ""}`}>
                <td className="px-4 py-2.5 font-medium text-gray-700">{shortMonth(d.month)}</td>
                <td className="px-4 py-2.5 text-right text-green-600">
                  {d.income > 0 ? `$${d.income.toLocaleString()}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-right text-red-500">
                  {d.spending > 0 ? `$${d.spending.toLocaleString()}` : "—"}
                </td>
                <td className={`px-4 py-2.5 text-right font-medium ${d.saved >= 0 ? "text-indigo-600" : "text-red-500"}`}>
                  {d.income > 0 || d.spending > 0 ? `$${d.saved.toLocaleString()}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {d.income > 0 ? (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      d.savings_rate >= 20 ? "bg-green-50 text-green-700" :
                      d.savings_rate >= 0  ? "bg-yellow-50 text-yellow-700" :
                                             "bg-red-50 text-red-600"
                    }`}>
                      {d.savings_rate}%
                    </span>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
