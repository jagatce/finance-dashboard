"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { Loader2, AlertTriangle, Info } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from "recharts";

interface Projection {
  month: string;
  income: number;
  spending: number;
  savings: number;
  savings_rate: number;
  liquid_balance: number;
  is_actual: boolean;
  is_complete: boolean;
}

interface Assumptions {
  avg_income: number;
  avg_spending: number;
  avg_savings: number;
  savings_rate: number;
  monthly_recurring: number;
  current_liquid: number;
  income_months: number;
  spending_months: number;
  complete_months: string[];
}

function shortMonth(m: string) {
  const [y, mon] = m.split("-");
  return new Date(parseInt(y), parseInt(mon) - 1).toLocaleString("default", { month: "short", year: "2-digit" });
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as Projection;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs space-y-1 min-w-[160px]">
      <p className="font-medium text-gray-900">{label} {d?.is_actual ? "✓ actual" : "~ projected"}</p>
      <p className="text-green-600">Income:   ${d?.income.toLocaleString()}</p>
      <p className="text-red-500"> Spending: ${d?.spending.toLocaleString()}</p>
      <p className="text-indigo-600">Saved:   ${d?.savings.toLocaleString()}</p>
      <p className="text-gray-700 font-medium">Balance: ${d?.liquid_balance.toLocaleString()}</p>
    </div>
  );
};

export default function ForecastPage() {
  const [assumptions, setAssumptions] = useState<Assumptions|null>(null);
  const [projections, setProjections] = useState<Projection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showAssumptions, setShowAssumptions] = useState(false);

  // Overrides
  const [incomeOverride, setIncomeOverride]   = useState<string>("");
  const [spendOverride, setSpendOverride]     = useState<string>("");

  useEffect(() => { fetchForecast(); }, []);

  async function fetchForecast() {
    setLoading(true);
    try {
      const data = await (await apiFetch("/api/v1/cashflow/forecast")).json();
      setAssumptions(data.assumptions);
      setProjections(data.projections);
    } finally { setLoading(false); }
  }

  // Apply overrides client-side
  const effectiveIncome  = incomeOverride  ? parseFloat(incomeOverride)  : assumptions?.avg_income  ?? 0;
  const effectiveSpending = spendOverride  ? parseFloat(spendOverride)   : assumptions?.avg_spending ?? 0;

  const adjustedProjections = projections.map((p, i) => {
    if (p.is_actual) return p;
    const income   = effectiveIncome;
    const spending = effectiveSpending;
    const savings  = income - spending;
    // Recalculate running balance from last actual
    return { ...p, income, spending, savings, savings_rate: income > 0 ? parseFloat((savings/income*100).toFixed(1)) : 0 };
  });

  // Recalculate running balance for adjusted projections
  let runningBalance = assumptions?.current_liquid ?? 0;
  const finalProjections = adjustedProjections.map(p => {
    if (p.is_actual) {
      runningBalance = p.liquid_balance;
      return p;
    }
    runningBalance = parseFloat((runningBalance + p.savings).toFixed(2));
    return { ...p, liquid_balance: runningBalance };
  });

  const hasDataWarning = assumptions && assumptions.complete_months.length < 3;
  const incompleteMonths = assumptions ? assumptions.spending_months - assumptions.complete_months.length : 0;

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-gray-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading forecast…
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Cash Flow Forecast</h1>
        <p className="text-sm text-gray-500 mt-0.5">12-month projection based on your historical data</p>
      </div>

      {/* Data quality warning */}
      {hasDataWarning && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Limited data — projections may be inaccurate</p>
            <p className="text-xs mt-0.5 text-amber-600">
              Only {assumptions?.complete_months.length} complete month(s) with both income and spending.
              Import more historical statements for better accuracy.
            </p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {assumptions && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Avg Monthly Income",   value: `$${assumptions.avg_income.toLocaleString()}`,   color: "text-green-600"  },
            { label: "Avg Monthly Spending",  value: `$${assumptions.avg_spending.toLocaleString()}`, color: "text-red-500"    },
            { label: "Avg Monthly Savings",   value: `$${assumptions.avg_savings.toLocaleString()}`,  color: "text-indigo-600" },
            { label: "Current Liquid",        value: `$${assumptions.current_liquid.toLocaleString()}`, color: "text-gray-900" },
          ].map(c => (
            <div key={c.label} className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className={`text-lg font-semibold mt-0.5 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Override controls */}
      <div className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-lg">
        <p className="text-sm font-medium text-gray-700 shrink-0">Override assumptions:</p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Monthly income</label>
          <input type="number" placeholder={assumptions?.avg_income.toString()}
            value={incomeOverride}
            onChange={e => setIncomeOverride(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-28" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Monthly spending</label>
          <input type="number" placeholder={assumptions?.avg_spending.toString()}
            value={spendOverride}
            onChange={e => setSpendOverride(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-28" />
        </div>
        {(incomeOverride || spendOverride) && (
          <button onClick={() => { setIncomeOverride(""); setSpendOverride(""); }}
            className="text-xs text-gray-400 hover:text-gray-600">Reset</button>
        )}
        <div className="ml-auto flex items-center gap-1 text-xs text-gray-400">
          <Info className="w-3.5 h-3.5" />
          Based on {assumptions?.income_months} income months, {assumptions?.spending_months} spending months
        </div>
      </div>

      {/* Liquid balance area chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Projected Liquid Balance</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={finalProjections.map(p => ({ ...p, label: shortMonth(p.month) }))}>
              <defs>
                <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4f46e5" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={assumptions?.current_liquid} stroke="#e5e7eb" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="liquid_balance" stroke="#4f46e5" fill="url(#balGrad)"
                strokeWidth={2} dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  return payload.is_actual
                    ? <circle key={cx} cx={cx} cy={cy} r={3} fill="#4f46e5" />
                    : <circle key={cx} cx={cx} cy={cy} r={2} fill="#a5b4fc" strokeDasharray="2 2" />;
                }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-gray-400">Solid dots = actual data · Hollow dots = projected</p>
      </div>

      {/* 12-month table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2">Month</th>
              <th className="px-4 py-2 text-right">Income</th>
              <th className="px-4 py-2 text-right">Spending</th>
              <th className="px-4 py-2 text-right">Saved</th>
              <th className="px-4 py-2 text-right">Rate</th>
              <th className="px-4 py-2 text-right">Liquid Balance</th>
              <th className="px-4 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {finalProjections.map((p, i) => (
              <tr key={i} className={`hover:bg-gray-50 ${p.is_actual ? "" : "text-gray-400"}`}>
                <td className="px-4 py-2.5 font-medium text-gray-700">{shortMonth(p.month)}</td>
                <td className="px-4 py-2.5 text-right text-green-600">
                  ${p.income.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-2.5 text-right text-red-500">
                  ${p.spending.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                </td>
                <td className={`px-4 py-2.5 text-right font-medium ${p.savings >= 0 ? "text-indigo-600" : "text-red-600"}`}>
                  ${p.savings.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                    p.savings_rate >= 20 ? "bg-green-50 text-green-700" :
                    p.savings_rate >= 0  ? "bg-yellow-50 text-yellow-700" :
                                           "bg-red-50 text-red-600"
                  }`}>
                    {p.savings_rate}%
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-gray-700">
                  ${p.liquid_balance.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {p.is_complete
                    ? <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">actual</span>
                    : p.is_actual
                    ? <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded">partial</span>
                    : <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded">projected</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
