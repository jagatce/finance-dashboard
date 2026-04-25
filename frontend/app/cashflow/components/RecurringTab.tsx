"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { Check, X, Loader2, RefreshCw } from "lucide-react";

interface RecurringEntry {
  description: string;
  amount: number;
  category?: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  ytd_total: number;
  months: string;
}

interface Candidate {
  description: string;
  amount: number;
  category?: string;
  occurrences: number;
  distinct_months: number;
  first_seen: string;
  last_seen: string;
  months: string;
}

export default function RecurringTab() {
  const [confirmed, setConfirmed]   = useState<RecurringEntry[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [marking, setMarking]       = useState<string|null>(null);

  useEffect(() => { fetchRecurring(); }, []);

  async function fetchRecurring() {
    setLoading(true);
    try {
      const data = await (await apiFetch("/api/v1/cashflow/recurring")).json();
      setConfirmed(Array.isArray(data.confirmed) ? data.confirmed : []);
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
    } finally { setLoading(false); }
  }

  async function handleMark(description: string, amount: number, is_recurring: boolean) {
    const key = `${description}-${amount}`;
    setMarking(key);
    try {
      await apiFetch("/api/v1/cashflow/recurring/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, amount, is_recurring }),
      });
      await fetchRecurring();
    } finally { setMarking(null); }
  }

  const monthlyTotal = confirmed.reduce((s, e) => s + e.amount, 0);
  const yearlyTotal  = monthlyTotal * 12;

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500">Recurring items</p>
          <p className="text-xl font-semibold text-gray-900 mt-0.5">{confirmed.length}</p>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500">Est. monthly cost</p>
          <p className="text-xl font-semibold text-red-500 mt-0.5">
            ${monthlyTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500">Est. yearly cost</p>
          <p className="text-xl font-semibold text-gray-700 mt-0.5">
            ${yearlyTotal.toLocaleString("en-US", { minimumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* Confirmed recurring */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Confirmed Recurring ({confirmed.length})</p>
          <button onClick={fetchRecurring} className="text-gray-400 hover:text-gray-600">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {confirmed.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm border border-gray-200 rounded-lg">
            No recurring transactions yet. Mark some from the candidates below.
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-center">Seen</th>
                  <th className="px-4 py-2">Months</th>
                  <th className="px-4 py-2 text-right">YTD Total</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {confirmed.map((e, i) => {
                  const key = `${e.description}-${e.amount}`;
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-800 max-w-[200px] truncate" title={e.description}>
                        {e.description}
                      </td>
                      <td className="px-4 py-2.5">
                        {e.category && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            {e.category}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                        ${e.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-500 text-xs">{e.occurrences}x</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{e.months?.replace(/,/g, ", ")}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 text-xs">
                        ${e.ytd_total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => handleMark(e.description, e.amount, false)}
                          disabled={marking === key}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                          title="Remove recurring flag">
                          {marking === key
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <X className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Candidates */}
      {candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-700">
            Auto-Detected Candidates ({candidates.length})
            <span className="ml-2 text-xs font-normal text-gray-400">
              — appear in 2+ months, not yet marked recurring
            </span>
          </p>
          <div className="border border-amber-200 rounded-lg overflow-hidden bg-amber-50">
            <table className="w-full text-sm">
              <thead className="bg-amber-100 border-b border-amber-200">
                <tr className="text-left text-xs text-amber-700 uppercase tracking-wide">
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-center">Months</th>
                  <th className="px-4 py-2">Seen in</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {candidates.map((c, i) => {
                  const key = `${c.description}-${c.amount}`;
                  return (
                    <tr key={i} className="hover:bg-amber-100">
                      <td className="px-4 py-2.5 text-gray-800 max-w-[200px] truncate" title={c.description}>
                        {c.description}
                      </td>
                      <td className="px-4 py-2.5">
                        {c.category && (
                          <span className="text-xs bg-white text-gray-600 px-2 py-0.5 rounded border border-amber-200">
                            {c.category}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                        ${c.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-500 text-xs">{c.distinct_months}x</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{c.months?.replace(/,/g, ", ")}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => handleMark(c.description, c.amount, true)}
                          disabled={marking === key}
                          className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                          title="Mark as recurring">
                          {marking === key
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <><Check className="w-3 h-3" /> Mark</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
