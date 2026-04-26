"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { Plus, Home, Loader2, ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";

interface Mortgage {
  id: string;
  property_name: string;
  address?: string;
  purchase_price?: number;
  purchase_date?: string;
  notes?: string;
  loan_count: number;
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default function MortgagePage() {
  const [mortgages, setMortgages]   = useState<Mortgage[]>([]);
  const [equity, setEquity]         = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editingMvId, setEditingMvId] = useState<string|null>(null);
  const [mvForm, setMvForm]         = useState({ estimated_market_value: "", market_value_date: "" });
  const [form, setForm] = useState({
    property_name: "", address: "", purchase_price: "", purchase_date: "", notes: ""
  });

  useEffect(() => { fetchMortgages(); fetchEquity(); }, []);

  async function fetchMortgages() {
    setLoading(true);
    try {
      const data = await (await apiFetch("/api/v1/mortgage/")).json();
      setMortgages(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }

  async function fetchEquity() {
    try {
      const data = await (await apiFetch("/api/v1/mortgage/equity")).json();
      setEquity(Array.isArray(data) ? data : []);
    } catch {}
  }

  async function handleAdd() {
    if (!form.property_name) return;
    await apiFetch("/api/v1/mortgage/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: form.property_name,
        address: form.address || null,
        purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
        purchase_date: form.purchase_date || null,
        notes: form.notes || null,
      }),
    });
    setForm({ property_name: "", address: "", purchase_price: "", purchase_date: "", notes: "" });
    setShowForm(false);
    fetchMortgages();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its loan history?`)) return;
    await apiFetch(`/api/v1/mortgage/${id}`, { method: "DELETE" });
    fetchMortgages();
    fetchEquity();
  }

  async function handleUpdateMarketValue(id: string) {
    await apiFetch(`/api/v1/mortgage/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estimated_market_value: parseFloat(mvForm.estimated_market_value),
        market_value_date: mvForm.market_value_date || new Date().toISOString().slice(0, 10),
      }),
    });
    setEditingMvId(null);
    setMvForm({ estimated_market_value: "", market_value_date: "" });
    fetchEquity();
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-64 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mortgage Tracker</h1>
          <p className="text-sm text-gray-500 mt-0.5">Full audit trail — purchase history, refinances, payments</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> Add Property
        </button>
      </div>

      {/* Add property form */}
      {showForm && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
          <p className="text-sm font-medium text-gray-700">Add Property</p>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Property name (e.g. Primary Home)" value={form.property_name}
              onChange={e => setForm(f => ({ ...f, property_name: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2" />
            <input placeholder="Address" value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2" />
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Purchase Price</label>
              <input type="number" placeholder="450000" value={form.purchase_price}
                onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Purchase Date</label>
              <input type="date" value={form.purchase_date}
                onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
            </div>
            <textarea placeholder="Notes (optional)" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2 h-16 resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Save</button>
            <button onClick={() => setShowForm(false)}
              className="px-4 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {/* Equity summary cards */}
      {equity.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {equity.map(e => (
            <div key={e.id} className="bg-white border border-indigo-200 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-400">Home Equity</p>
                  <p className="text-2xl font-bold text-indigo-600">{fmt(e.equity)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{e.property_name}</p>
                </div>
                <button
                  onClick={() => {
                    setEditingMvId(e.id);
                    setMvForm({ estimated_market_value: e.market_value.toString(), market_value_date: e.market_value_date || "" });
                  }}
                  className="text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 rounded px-2 py-1">
                  Update Value
                </button>
              </div>
              <div className="space-y-1 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Market value</span>
                  <span className="font-medium text-gray-700">{fmt(e.market_value)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Mortgage balance</span>
                  <span className="font-medium text-red-500">− {fmt(e.mortgage_balance)}</span>
                </div>
                {e.appreciation != null && (
                  <div className="flex justify-between border-t border-gray-100 pt-1">
                    <span>Appreciation vs purchase</span>
                    <span className={`font-medium ${e.appreciation >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {e.appreciation >= 0 ? "+" : ""}{fmt(e.appreciation)}
                    </span>
                  </div>
                )}
                {e.market_value_date && <p className="text-gray-400">As of {e.market_value_date}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Market value edit form */}
      {editingMvId && (
        <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50 space-y-3">
          <p className="text-sm font-medium text-indigo-800">
            {equity.find(e => e.id === editingMvId) ? "Update Market Value" : "Set Market Value"}
          </p>
          <div className="flex gap-3">
            <input type="number" placeholder="Current market value ($)"
              value={mvForm.estimated_market_value}
              onChange={ev => setMvForm(f => ({ ...f, estimated_market_value: ev.target.value }))}
              className="border border-indigo-200 rounded px-3 py-1.5 text-sm flex-1" />
            <input type="date" value={mvForm.market_value_date}
              onChange={ev => setMvForm(f => ({ ...f, market_value_date: ev.target.value }))}
              className="border border-indigo-200 rounded px-3 py-1.5 text-sm w-40" />
            <button onClick={() => handleUpdateMarketValue(editingMvId)}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700">Save</button>
            <button onClick={() => setEditingMvId(null)}
              className="px-4 py-1.5 text-sm border border-indigo-200 rounded hover:bg-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Property list */}
      {mortgages.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Home className="w-12 h-12 text-gray-200 mx-auto" />
          <p className="text-sm font-medium text-gray-500">No properties yet</p>
          <p className="text-xs text-gray-400">Add a property to start tracking your mortgage history</p>
        </div>
      ) : (
        <div className="space-y-3">
          {mortgages.map(m => (
            <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-4 hover:border-indigo-200 transition-colors">
              <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                <Home className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{m.property_name}</p>
                {m.address && <p className="text-sm text-gray-500 truncate">{m.address}</p>}
                <div className="flex items-center gap-4 mt-1">
                  {m.purchase_price && <span className="text-xs text-gray-400">Purchased {fmt(m.purchase_price)}</span>}
                  {m.purchase_date  && <span className="text-xs text-gray-400">{m.purchase_date}</span>}
                  <span className="text-xs text-indigo-500">{m.loan_count} loan{m.loan_count !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const eq = equity.find(e => e.id === m.id);
                    setEditingMvId(m.id);
                    setMvForm({
                      estimated_market_value: eq ? eq.market_value.toString() : "",
                      market_value_date: eq?.market_value_date || new Date().toISOString().slice(0, 10),
                    });
                  }}
                  className="text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 rounded px-2 py-1 transition-colors">
                  {equity.find(e => e.id === m.id) ? "Update Value" : "Set Value"}
                </button>
                <button onClick={() => handleDelete(m.id, m.property_name)}
                  className="text-gray-300 hover:text-red-500 transition-colors p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
                <Link href={`/mortgage/${m.id}`}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors">
                  View <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
