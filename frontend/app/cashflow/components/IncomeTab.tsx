"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { Plus, Trash2, Loader2 } from "lucide-react";

interface IncomeEntry {
  id: string;
  owner_id: string;
  date: string;
  source_name: string;
  income_type: string;
  amount: number;
  notes?: string;
}

interface Owner { id: string; name: string; }
interface Props  { month: string; }

const INCOME_TYPES = ["salary", "bonus", "freelance", "dividend", "rental", "other"];

export default function IncomeTab({ month }: Props) {
  const [entries, setEntries]       = useState<IncomeEntry[]>([]);
  const [owners, setOwners]         = useState<Owner[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm] = useState({
    owner_id: "", date: "", source_name: "", income_type: "salary", amount: "", notes: "",
  });

  useEffect(() => { fetchIncome(); fetchOwners(); }, [month]);

  async function fetchIncome() {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/v1/cashflow/income?month=${month}`);
      setEntries(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }

  async function fetchOwners() {
    const data = await apiFetch("/api/v1/owners/");
    setOwners(Array.isArray(data) ? data : []);
  }

  async function handleAdd() {
    if (!form.owner_id || !form.date || !form.source_name || !form.amount) return;
    await apiFetch("/api/v1/cashflow/income", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_id:    form.owner_id,
        date:        form.date,
        source_name: form.source_name,
        income_type: form.income_type,
        amount:      parseFloat(form.amount),
        notes:       form.notes || null,
      }),
    });
    setForm({ owner_id: "", date: "", source_name: "", income_type: "salary", amount: "", notes: "" });
    setShowForm(false);
    fetchIncome();
  }

  async function handleDelete(id: string) {
    await apiFetch(`/api/v1/cashflow/income/${id}`, { method: "DELETE" });
    fetchIncome();
  }

  const total = entries.reduce((s, e) => s + e.amount, 0);
  const byType = entries.reduce((acc, e) => {
    acc[e.income_type] = (acc[e.income_type] || 0) + e.amount;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-4">

      {/* Summary */}
      <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
        <div className="flex gap-4">
          {Object.entries(byType).map(([type, amt]) => (
            <span key={type} className="text-sm text-gray-500 capitalize">
              {type}: <span className="font-medium text-gray-700">${amt.toLocaleString()}</span>
            </span>
          ))}
        </div>
        <span className="text-lg font-semibold text-gray-900">
          ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })} total
        </span>
      </div>

      {/* Add button */}
      <button
        onClick={() => setShowForm(v => !v)}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50 transition-colors"
      >
        <Plus className="w-4 h-4" /> Add Income
      </button>

      {/* Add form */}
      {showForm && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
          <p className="text-sm font-medium text-gray-700">Add Income Entry</p>
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.owner_id}
              onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            >
              <option value="">— Person —</option>
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input
              type="date" value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
            <input
              placeholder="Source (e.g. Employer, Fidelity)" value={form.source_name}
              onChange={e => setForm(f => ({ ...f, source_name: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2"
            />
            <select
              value={form.income_type}
              onChange={e => setForm(f => ({ ...f, income_type: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            >
              {INCOME_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
            <input
              type="number" placeholder="Amount" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
            <input
              placeholder="Notes (optional)" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
              Save
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-4 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No income entries for this month.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Person</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{e.date}</td>
                  <td className="px-4 py-2.5 text-gray-800">{e.source_name}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded capitalize">
                      {e.income_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">
                    {owners.find(o => o.id === e.owner_id)?.name ?? e.owner_id}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-green-700">
                    ${e.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => handleDelete(e.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
