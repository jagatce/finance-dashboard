"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { Loader2, Target } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from "recharts";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtM(n: number) {
  if (n >= 1000000) return `$${(n/1000000).toFixed(1)}M`;
  if (n >= 1000)    return `$${(n/1000).toFixed(0)}k`;
  return fmt(n);
}

interface Inputs {
  current_nw:   number;
  cash:         number;
  investments:  number;
  retirement:   number;
  liabilities:  number;
  avg_savings:  number;
  avg_spending: number;
  annual_spend: number;
  fire_number:  number;
}

interface ScenarioConfig {
  label:       string;
  color:       string;
  cashReturn:  number;
  invReturn:   number;
  retReturn:   number;
}

const DEFAULT_SCENARIOS: ScenarioConfig[] = [
  { label: "Conservative", color: "#94a3b8", cashReturn: 3,  invReturn: 5,  retReturn: 5  },
  { label: "Base",         color: "#4f46e5", cashReturn: 4,  invReturn: 7,  retReturn: 7  },
  { label: "Optimistic",   color: "#16a34a", cashReturn: 5,  invReturn: 10, retReturn: 10 },
];

const MILESTONES = [500000, 750000, 1000000, 1500000, 2000000, 3000000];

function projectScenario(
  cash: number, investments: number, retirement: number, realEstate: number,
  monthlySavings: number,
  cashReturn: number, invReturn: number, retReturn: number,
  years: number
) {
  const points = [];
  let c = cash, inv = investments, ret = retirement, re = realEstate;
  const cashMonthly = Math.pow(1 + cashReturn/100, 1/12) - 1;
  const invMonthly  = Math.pow(1 + invReturn/100,  1/12) - 1;
  const retMonthly  = Math.pow(1 + retReturn/100,  1/12) - 1;
  const reMonthly   = Math.pow(1 + 3/100, 1/12) - 1; // Real estate appreciates at 3% annually

  // Allocate monthly savings: 20% cash, 40% investments, 40% retirement
  const savCash = monthlySavings * 0.20;
  const savInv  = monthlySavings * 0.40;
  const savRet  = monthlySavings * 0.40;

  for (let m = 0; m <= years * 12; m++) {
    const nw = Math.round(c + inv + ret + re);
    if (m % 12 === 0) {
      points.push({ year: m/12, nw, cash: Math.round(c), investments: Math.round(inv), retirement: Math.round(ret), real_estate: Math.round(re) });
    }
    c   = c   * (1 + cashMonthly) + savCash;
    inv = inv * (1 + invMonthly)  + savInv;
    ret = ret * (1 + retMonthly)  + savRet;
    re  = re  * (1 + reMonthly);
  }
  return points;
}

function getMilestones(points: any[], fireNumber: number) {
  const targets = [...MILESTONES.filter(m => m > points[0]?.nw), fireNumber];
  return targets.map(target => {
    const hit = points.find(p => p.nw >= target);
    return { target, year: hit?.year ?? null };
  }).filter(m => m.year !== null);
}

export default function ProjectionsPage() {
  const [inputs, setInputs]       = useState<Inputs|null>(null);
  const [loading, setLoading]     = useState(true);
  const [scenarios, setScenarios] = useState<ScenarioConfig[]>(DEFAULT_SCENARIOS);
  const [years] = useState(10);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  // Overrides
  const [savingsOverride, setSavingsOverride]   = useState("");
  const [fireOverride, setFireOverride]         = useState("");

  useEffect(() => { fetchInputs(); fetchScenarios(); }, []);

  async function fetchScenarios() {
    try {
      const data = await (await apiFetch("/api/v1/cashflow/settings/projection_scenarios")).json();
      if (data.value) {
        const v = data.value;
        setScenarios([
          { label: "Conservative", color: "#94a3b8", ...v.conservative },
          { label: "Base",         color: "#4f46e5", ...v.base         },
          { label: "Optimistic",   color: "#16a34a", ...v.optimistic   },
        ]);
      }
    } catch { /* use defaults */ }
  }

  async function saveScenarios() {
    setSaving(true);
    try {
      await apiFetch("/api/v1/cashflow/settings/projection_scenarios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: {
            conservative: { cashReturn: scenarios[0].cashReturn, invReturn: scenarios[0].invReturn, retReturn: scenarios[0].retReturn },
            base:         { cashReturn: scenarios[1].cashReturn, invReturn: scenarios[1].invReturn, retReturn: scenarios[1].retReturn },
            optimistic:   { cashReturn: scenarios[2].cashReturn, invReturn: scenarios[2].invReturn, retReturn: scenarios[2].retReturn },
          }
        }),
      });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } finally { setSaving(false); }
  }

  async function fetchInputs() {
    setLoading(true);
    try {
      const data = await (await apiFetch("/api/v1/cashflow/projections/inputs")).json();
      setInputs(data);
    } finally { setLoading(false); }
  }

  if (loading || !inputs) return (
    <div className="flex items-center justify-center min-h-screen text-gray-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
    </div>
  );

  const monthlySavings = savingsOverride ? parseFloat(savingsOverride) : inputs.avg_savings;
  const fireNumber     = fireOverride    ? parseFloat(fireOverride)    : inputs.fire_number;

  // Run all 3 scenarios
  const projData = scenarios.map(s =>
    projectScenario(inputs.cash, inputs.investments, inputs.retirement, inputs.real_estate || 0,
      monthlySavings, s.cashReturn, s.invReturn, s.retReturn, years)
  );

  // Build chart data — one point per year
  const chartData = Array.from({ length: years + 1 }, (_, i) => {
    const point: any = { year: `Year ${i}` };
    scenarios.forEach((s, si) => {
      point[s.label] = projData[si][i]?.nw ?? null;
    });
    return point;
  });

  // Milestones per scenario
  const milestonesPerScenario = projData.map((pts, i) => getMilestones(pts, fireNumber));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Projections</h1>
        <p className="text-sm text-gray-500 mt-0.5">10-year net worth scenarios with configurable returns</p>
      </div>

      {/* Current state cards */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: "Current NW",   value: fmtM(inputs.current_nw),  color: "text-gray-900"   },
          { label: "Cash",         value: fmtM(inputs.cash),         color: "text-teal-600"   },
          { label: "Investments",  value: fmtM(inputs.investments),  color: "text-blue-600"   },
          { label: "Retirement",   value: fmtM(inputs.retirement),   color: "text-purple-600" },
          { label: "Real Estate",  value: fmtM(inputs.real_estate || 0), color: "text-amber-600" },
          { label: "FIRE Target",  value: fmtM(fireNumber),          color: "text-indigo-600" },
        ].map(c => (
          <div key={c.label} className="bg-gray-50 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-lg font-semibold mt-0.5 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Assumptions + overrides */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Assumptions</p>
          <button onClick={saveScenarios} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {savedMsg ? "Saved ✓" : "Save Assumptions"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-6">
          {/* Left — overrides */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 w-36">Monthly savings ($)</label>
              <input type="number"
                placeholder={inputs.avg_savings.toFixed(0)}
                value={savingsOverride}
                onChange={e => setSavingsOverride(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-32" />
              <span className="text-xs text-gray-400">avg: {fmt(inputs.avg_savings)}</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 w-36">FIRE target ($)</label>
              <input type="number"
                placeholder={inputs.fire_number.toFixed(0)}
                value={fireOverride}
                onChange={e => setFireOverride(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-32" />
              <span className="text-xs text-gray-400">25× annual spend = {fmtM(inputs.fire_number)}</span>
            </div>
          </div>
          {/* Right — return rates per scenario */}
          <div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th className="text-left pb-1">Scenario</th>
                  <th className="text-center pb-1">Cash %</th>
                  <th className="text-center pb-1">Investment %</th>
                  <th className="text-center pb-1">Retirement %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scenarios.map((s, i) => (
                  <tr key={s.label}>
                    <td className="py-1 font-medium" style={{ color: s.color }}>{s.label}</td>
                    {(["cashReturn", "invReturn", "retReturn"] as const).map(field => (
                      <td key={field} className="py-1 text-center">
                        <input type="number"
                          value={s[field]}
                          onChange={e => setScenarios(prev => prev.map((sc, si) =>
                            si === i ? { ...sc, [field]: parseFloat(e.target.value) || 0 } : sc
                          ))}
                          className="border border-gray-200 rounded px-1 py-0.5 text-xs w-14 text-center" />
                        <span className="ml-0.5 text-gray-400">%</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">10-Year Net Worth Projection</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => fmtM(v)} />
              <Tooltip formatter={(v: any, name: any) => [fmtM(Number(v)), name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {fireNumber > 0 && (
                <ReferenceLine y={fireNumber} stroke="#f59e0b" strokeDasharray="6 3"
                  label={{ value: "FIRE", position: "right", fontSize: 10, fill: "#f59e0b" }} />
              )}
              {scenarios.map(s => (
                <Line key={s.label} type="monotone" dataKey={s.label}
                  stroke={s.color} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Milestones + breakdown per scenario */}
      <div className="grid grid-cols-3 gap-4">
        {scenarios.map((s, si) => {
          const finalPoint = projData[si][years];
          const miles = milestonesPerScenario[si];
          const fireHit = miles.find(m => m.target === fireNumber);
          return (
            <div key={s.label} className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm" style={{ color: s.color }}>{s.label}</p>
                <p className="text-lg font-bold text-gray-900">{fmtM(finalPoint?.nw ?? 0)}</p>
              </div>
              <p className="text-xs text-gray-400">in 10 years</p>

              {/* Asset breakdown at year 10 */}
              <div className="space-y-1.5">
                {[
                  { label: "Cash",        value: finalPoint?.cash,        color: "bg-teal-400"   },
                  { label: "Investments", value: finalPoint?.investments,  color: "bg-blue-400"   },
                  { label: "Retirement",  value: finalPoint?.retirement,   color: "bg-purple-400" },
                  { label: "Real Estate", value: finalPoint?.real_estate,  color: "bg-amber-400"  },
                ].map(b => (
                  <div key={b.label} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${b.color}`} />
                    <span className="text-gray-500 flex-1">{b.label}</span>
                    <span className="font-medium text-gray-700">{fmtM(b.value ?? 0)}</span>
                  </div>
                ))}
              </div>

              {/* FIRE date */}
              {fireHit ? (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <Target className="w-4 h-4 text-green-600 shrink-0" />
                  <div>
                    <p className="text-xs text-green-700 font-medium">FIRE in Year {fireHit.year}</p>
                    <p className="text-xs text-green-500">{fmtM(fireNumber)} target reached</p>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-500">FIRE target not reached in 10 years</p>
                  <p className="text-xs text-gray-400">Need {fmtM(fireNumber - (finalPoint?.nw ?? 0))} more</p>
                </div>
              )}

              {/* Milestones */}
              <div className="space-y-1">
                {miles.filter(m => m.target !== fireNumber && m.year !== null).slice(0, 4).map(m => (
                  <div key={m.target} className="flex justify-between text-xs">
                    <span className="text-gray-400">{fmtM(m.target)}</span>
                    <span className="font-medium text-gray-600">Year {m.year}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
