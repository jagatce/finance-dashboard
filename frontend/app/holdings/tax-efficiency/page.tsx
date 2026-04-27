"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { RefreshCw, AlertTriangle, Shield } from "lucide-react";

function fmtUSD(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

const ACCOUNT_TYPES = [
  { value: "traditional_401k", label: "Traditional 401k/403b" },
  { value: "roth",             label: "Roth IRA/401k" },
  { value: "taxable",          label: "Taxable Brokerage" },
  { value: "hsa",              label: "HSA" },
  { value: "unknown",          label: "Unknown" },
];

export default function TaxEfficiencyPage() {
  const [taxData, setTaxData]       = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [mapping, setMapping]       = useState<Record<string,string>>({});
  const [savingMap, setSavingMap]   = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [savedMsg, setSavedMsg]     = useState(false);

  useEffect(() => { fetchTax(); }, []);

  async function fetchTax() {
    setLoading(true);
    try {
      const data = await apiFetch("/api/v1/holdings/tax-efficiency").then(r => r.json());
      setTaxData(data);
      setMapping(data.account_types || {});
    } finally { setLoading(false); }
  }

  async function saveMapping() {
    setSavingMap(true);
    try {
      await apiFetch("/api/v1/holdings/tax-efficiency/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
      await fetchTax();
    } finally { setSavingMap(false); }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-64 text-gray-400">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Computing…
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Tax Efficiency</h1>
            <p className="text-sm text-gray-500 mt-0.5">Asset location analysis across your accounts</p>
          </div>
        </div>
        <button onClick={fetchTax}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-gray-100">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {taxData?.error ? (
        <div className="text-center py-16 text-gray-400 text-sm">{taxData.error}</div>
      ) : taxData && (
        <>
          {/* Score cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
              <p className="text-xs text-gray-500">Overall Score</p>
              <p className={`text-4xl font-bold mt-1 ${
                taxData.score >= 90 ? "text-green-600" :
                taxData.score >= 75 ? "text-blue-600" :
                taxData.score >= 60 ? "text-yellow-600" : "text-red-500"
              }`}>{taxData.score}
                <span className="text-lg text-gray-400">/100</span>
              </p>
              <span className={`text-sm font-semibold px-2 py-0.5 rounded mt-2 inline-block ${
                taxData.grade === "A" ? "bg-green-100 text-green-700" :
                taxData.grade === "B" ? "bg-blue-100 text-blue-700" :
                taxData.grade === "C" ? "bg-yellow-100 text-yellow-700" :
                "bg-red-100 text-red-700"
              }`}>Grade {taxData.grade}</span>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
              <p className="text-xs text-gray-500">Analyzed Value</p>
              <p className="text-2xl font-semibold text-gray-900 mt-1">{fmtUSD(taxData.total_value)}</p>
              <p className="text-xs text-gray-400 mt-1">{taxData.positions?.length} positions</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
              <p className="text-xs text-gray-500">Recommendations</p>
              <p className="text-2xl font-semibold text-gray-900 mt-1">{taxData.recommendations?.length || 0}</p>
              <p className="text-xs text-gray-400 mt-1">
                {taxData.recommendations?.length === 0 ? "Well positioned ✓" : "Action items"}
              </p>
            </div>
          </div>

          {/* Account mapping */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">Account Type Mapping</p>
              <button onClick={() => setShowMapping(v => !v)}
                className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded px-2 py-1">
                {showMapping ? "Hide" : "Edit"}
              </button>
            </div>
            {!showMapping && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(mapping).map(([acct, type]) => (
                  <span key={acct} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                    {acct} → {ACCOUNT_TYPES.find(t => t.value === type)?.label || type}
                  </span>
                ))}
              </div>
            )}
            {showMapping && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">Set the tax treatment for each holding account.</p>
                {taxData.matrix?.map((acct: any) => (
                  <div key={acct.account_id} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-48 truncate">{acct.account_name || acct.account_id}</span>
                    <select
                      value={mapping[acct.account_id] || "unknown"}
                      onChange={e => setMapping(prev => ({ ...prev, [acct.account_id]: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-1 text-sm flex-1">
                      {ACCOUNT_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-400 w-24 text-right">{fmtUSD(acct.total_value)}</span>
                  </div>
                ))}
                <button onClick={saveMapping} disabled={savingMap}
                  className="mt-2 px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50">
                  {savingMap ? "Saving…" : savedMsg ? "Saved ✓" : "Save & Recalculate"}
                </button>
              </div>
            )}
          </div>

          {/* Matrix */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Account Matrix</p>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2">Account</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right text-red-500">High Tax</th>
                    <th className="px-4 py-2 text-right text-yellow-600">Medium</th>
                    <th className="px-4 py-2 text-right text-green-600">Low Tax</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {taxData.matrix?.map((acct: any) => (
                    <tr key={acct.account_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-700">{acct.account_name || acct.account_id}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs capitalize">{(acct.account_type || "unknown").replace(/_/g, " ")}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{fmtUSD(acct.total_value)}</td>
                      <td className="px-4 py-2.5 text-right text-red-500 text-xs">{acct.breakdown.high > 0 ? fmtUSD(acct.breakdown.high) : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-yellow-600 text-xs">{acct.breakdown.medium > 0 ? fmtUSD(acct.breakdown.medium) : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-green-600 text-xs">{acct.breakdown.low > 0 ? fmtUSD(acct.breakdown.low) : "—"}</td>
                      <td className="px-4 py-2.5 text-center">
                        {acct.has_misplaced
                          ? <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded">⚠ Review</span>
                          : <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded">✓ OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recommendations */}
          {taxData.recommendations?.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Recommendations</p>
              <div className="space-y-2">
                {taxData.recommendations.map((r: any, i: number) => (
                  <div key={i} className={`border rounded-lg px-4 py-3 flex items-start gap-3 ${
                    r.severity >= 3 ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50"
                  }`}>
                    <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${r.severity >= 3 ? "text-red-500" : "text-yellow-500"}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{r.name || r.ticker} — {fmtUSD(r.value)}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{r.action} · {r.reason}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Currently in: {(r.account_type || "unknown").replace(/_/g," ")} ({r.account_name || r.account_id})</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center gap-3">
              <Shield className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">Well positioned</p>
                <p className="text-xs text-green-600 mt-0.5">No significant tax efficiency improvements identified.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
