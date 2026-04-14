"use client";
import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/auth";
import { Upload, Plus, Trash2, Check, X, Loader2 } from "lucide-react";

interface Transaction {
  id?: string;
  _tmp_id?: string;
  account_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  category?: string;
  subcategory?: string;
  merchant?: string;
  notes?: string;
  source?: string;
  is_recurring?: boolean;
}

interface Props { month: string; }

const DEFAULT_ACCOUNT_ID = "manual";

export default function SpendingTab({ month }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories]     = useState<string[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showAddForm, setShowAddForm]   = useState(false);

  // CSV import state
  const [importStage, setImportStage]   = useState<"idle"|"preview"|"categorizing"|"confirming">("idle");
  const [importRows, setImportRows]     = useState<Transaction[]>([]);
  const [importBank, setImportBank]     = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Add form state
  const [form, setForm] = useState({
    description: "", amount: "", category: "", transaction_date: "", account_id: DEFAULT_ACCOUNT_ID,
  });

  useEffect(() => { fetchTransactions(); fetchCategories(); }, [month]);

  async function fetchTransactions() {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/v1/cashflow/transactions?month=${month}`);
      setTransactions(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCategories() {
    const data = await apiFetch("/api/v1/cashflow/categories");
    setCategories(Array.isArray(data) ? data.map((c: any) => c.name) : []);
  }

  async function handleAddManual() {
    if (!form.description || !form.amount || !form.transaction_date) return;
    await apiFetch("/api/v1/cashflow/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: form.account_id || DEFAULT_ACCOUNT_ID,
        transaction_date: form.transaction_date,
        description: form.description,
        amount: parseFloat(form.amount),
        category: form.category || null,
        source: "manual",
      }),
    });
    setForm({ description: "", amount: "", category: "", transaction_date: "", account_id: DEFAULT_ACCOUNT_ID });
    setShowAddForm(false);
    fetchTransactions();
  }

  async function handleDelete(id: string) {
    await apiFetch(`/api/v1/cashflow/transactions/${id}`, { method: "DELETE" });
    fetchTransactions();
  }

  async function handleCategoryChange(id: string, category: string) {
    await apiFetch(`/api/v1/cashflow/transactions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, category } : t));
  }

  // --- CSV Import ---
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("account_id", DEFAULT_ACCOUNT_ID);
    const data = await apiFetch("/api/v1/cashflow/transactions/import", {
      method: "POST", body: formData,
    });
    setImportBank(data.bank);
    setImportRows(data.transactions);
    setImportStage("preview");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleCategorize() {
    setImportStage("categorizing");
    const descriptions = importRows.map(t => t.description);
    const data = await apiFetch("/api/v1/cashflow/transactions/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descriptions, categories }),
    });
    const updated = importRows.map((t, i) => ({
      ...t,
      category:     data.suggestions[i]?.category     ?? t.category,
      subcategory:  data.suggestions[i]?.subcategory  ?? t.subcategory,
      is_recurring: data.suggestions[i]?.is_recurring ?? t.is_recurring,
    }));
    setImportRows(updated);
    setImportStage("confirming");
  }

  async function handleConfirmImport() {
    await apiFetch("/api/v1/cashflow/transactions/import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: importRows }),
    });
    setImportStage("idle");
    setImportRows([]);
    fetchTransactions();
  }

  function updateImportRow(idx: number, field: string, value: any) {
    setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  function removeImportRow(idx: number) {
    setImportRows(prev => prev.filter((_, i) => i !== idx));
  }

  const total = transactions.reduce((s, t) => s + t.amount, 0);

  // --- Render ---
  return (
    <div className="space-y-4">

      {/* Summary bar */}
      <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
        <span className="text-sm text-gray-500">{transactions.length} transactions</span>
        <span className="text-lg font-semibold text-gray-900">
          ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })} spent
        </span>
      </div>

      {/* Actions */}
      {importStage === "idle" && (
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Manual
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
        </div>
      )}

      {/* Add manual form */}
      {showAddForm && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
          <p className="text-sm font-medium text-gray-700">Add Transaction</p>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date" value={form.transaction_date}
              onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
            <input
              type="number" placeholder="Amount" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
            <input
              placeholder="Description" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2"
            />
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2"
            >
              <option value="">— Category —</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddManual}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
              Save
            </button>
            <button onClick={() => setShowAddForm(false)}
              className="px-4 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* CSV Import Preview */}
      {importStage !== "idle" && (
        <div className="border border-indigo-200 rounded-lg bg-indigo-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-indigo-800 capitalize">
              {importBank} CSV — {importRows.length} transactions
            </p>
            <button onClick={() => { setImportStage("idle"); setImportRows([]); }}
              className="text-indigo-400 hover:text-indigo-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          {importStage === "preview" && (
            <button onClick={handleCategorize}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
              <Loader2 className="w-4 h-4" /> Auto-Categorize with Claude
            </button>
          )}

          {importStage === "categorizing" && (
            <div className="flex items-center gap-2 text-sm text-indigo-700">
              <Loader2 className="w-4 h-4 animate-spin" /> Categorizing {importRows.length} transactions…
            </div>
          )}

          {(importStage === "preview" || importStage === "confirming") && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-indigo-600 border-b border-indigo-200">
                    <th className="pb-1 pr-3">Date</th>
                    <th className="pb-1 pr-3">Description</th>
                    <th className="pb-1 pr-3 text-right">Amount</th>
                    <th className="pb-1 pr-3">Category</th>
                    <th className="pb-1">Recurring</th>
                    <th className="pb-1"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-100">
                  {importRows.map((t, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-3 text-gray-600">{t.transaction_date}</td>
                      <td className="py-1 pr-3 text-gray-800 max-w-[200px] truncate">{t.description}</td>
                      <td className="py-1 pr-3 text-right font-medium">${t.amount.toFixed(2)}</td>
                      <td className="py-1 pr-3">
                        <select
                          value={t.category || ""}
                          onChange={e => updateImportRow(i, "category", e.target.value)}
                          className="border border-indigo-200 rounded px-1 py-0.5 text-xs bg-white"
                        >
                          <option value="">—</option>
                          {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-3">
                        <input type="checkbox" checked={!!t.is_recurring}
                          onChange={e => updateImportRow(i, "is_recurring", e.target.checked)} />
                      </td>
                      <td className="py-1">
                        <button onClick={() => removeImportRow(i)} className="text-gray-400 hover:text-red-500">
                          <X className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importStage === "confirming" && (
            <button onClick={handleConfirmImport}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
              <Check className="w-4 h-4" /> Import {importRows.length} Transactions
            </button>
          )}
        </div>
      )}

      {/* Transaction list */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No transactions for this month. Import a CSV or add manually.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{t.transaction_date}</td>
                  <td className="px-4 py-2.5 text-gray-800">
                    {t.description}
                    {t.is_recurring && (
                      <span className="ml-2 text-xs text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">recurring</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={t.category || ""}
                      onChange={e => handleCategoryChange(t.id!, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-600"
                    >
                      <option value="">—</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                    ${t.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => handleDelete(t.id!)}
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
