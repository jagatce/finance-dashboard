"use client";
import { useState, useEffect, useRef } from "react";
import { apiFetch, getToken } from "@/lib/auth";
import { Upload, Plus, Trash2, Check, X, Loader2, BarChart2, TrendingUp } from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from "recharts";

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
  batch_id?: string;
}

interface Props { month: string; }

const DEFAULT_ACCOUNT_ID = "manual";

const COLORS = [
  "#4f46e5","#7c3aed","#db2777","#ea580c","#d97706",
  "#65a30d","#0891b2","#0284c7","#6366f1","#8b5cf6",
  "#ec4899","#f97316","#84cc16","#06b6d4","#94a3b8",
];

function shortMonth(m: string) {
  const [y, mon] = m.split("-");
  return new Date(parseInt(y), parseInt(mon) - 1).toLocaleString("default", { month: "short" });
}

export default function SpendingTab({ month }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories]     = useState<string[]>([]);
  const [accounts, setAccounts]         = useState<any[]>([]);
  const [owners, setOwners]             = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [loading, setLoading]           = useState(true);
  const [showAddForm, setShowAddForm]   = useState(false);
  const [activeFilter, setActiveFilter] = useState<string|null>(null);
  const [batchFilter, setBatchFilter]   = useState<string|null>(null);
  const [batchFilterName, setBatchFilterName] = useState<string>("");
  const [activePanel, setActivePanel]   = useState<null|"breakdown"|"trends"|"imports">(null);
  const [trendsData, setTrendsData]     = useState<any[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [importsData, setImportsData]     = useState<any[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const [deletingKey, setDeletingKey]     = useState<string|null>(null);

  // CSV import state
  const [importRows, setImportRows]       = useState<Transaction[]>([]);
  const [importIncome, setImportIncome]   = useState<any[]>([]);
  const [importSection, setImportSection] = useState<"spending"|"income">("spending");
  const [importStage, setImportStage]     = useState<"idle"|"preview"|"categorizing">("idle");
  const [importBank, setImportBank]       = useState("");
  const [importBatchId, setImportBatchId] = useState<string|null>(null);
  const [importFilename, setImportFilename] = useState<string>("");
  const [saveMsg, setSaveMsg]             = useState<string|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    description: "", amount: "", category: "", transaction_date: "", account_id: DEFAULT_ACCOUNT_ID,
  });

  useEffect(() => { fetchTransactions(); fetchCategories(); fetchAccounts(); fetchOwners(); }, [month]);

  async function fetchTransactions() {
    setLoading(true);
    try {
      const data = await (await apiFetch(`/api/v1/cashflow/transactions?month=${month}`)).json();
      setTransactions(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }

  async function fetchCategories() {
    const data = await (await apiFetch("/api/v1/cashflow/categories")).json();
    setCategories(Array.isArray(data) ? data.map((c: any) => c.name) : []);
  }

  async function fetchAccounts() {
    const data = await (await apiFetch("/api/v1/accounts/")).json();
    const filtered = Array.isArray(data)
      ? data.filter((a: any) => a.is_active && (
          a.category === "credit_card" ||
          (a.category === "cash" && a.name.toLowerCase().includes("checking"))
        ))
      : [];
    setAccounts(filtered);
  }

  async function fetchTrends() {
    setTrendsLoading(true);
    try {
      const year = month.split("-")[0];
      const data = await (await apiFetch(`/api/v1/cashflow/trends?year=${year}`)).json();
      setTrendsData(Array.isArray(data) ? data : []);
    } finally { setTrendsLoading(false); }
  }

  async function fetchImports() {
    setImportsLoading(true);
    try {
      const data = await (await apiFetch("/api/v1/cashflow/imports")).json();
      setImportsData(Array.isArray(data) ? data : []);
    } finally { setImportsLoading(false); }
  }

  async function handleDeleteImport(batch_id: string, filename: string, row_count: number) {
    if (!confirm(`Delete "${filename}" (${row_count} transactions)? This cannot be undone.`)) return;
    setDeletingKey(batch_id);
    try {
      await apiFetch(`/api/v1/cashflow/imports/${batch_id}`, { method: "DELETE" });
      await fetchImports();
      await fetchTransactions();
      if (activePanel === "trends") fetchTrends();
    } finally { setDeletingKey(null); }
  }

  function togglePanel(panel: "breakdown"|"trends"|"imports") {
    if (activePanel === panel) { setActivePanel(null); return; }
    setActivePanel(panel);
    if (panel === "trends" && trendsData.length === 0) fetchTrends();
    if (panel === "imports") fetchImports();
  }

  async function fetchOwners() {
    const data = await (await apiFetch("/api/v1/owners/")).json();
    setOwners(Array.isArray(data) ? data : []);
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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("account_id", selectedAccountId || DEFAULT_ACCOUNT_ID);
    const token = getToken();
    const res = await fetch("/api/v1/cashflow/transactions/import", {
      method: "POST",
      headers: { "x-auth-token": token },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || data.detail || "Import failed"); return; }
    setImportBank(data.bank || "unknown");
    setImportBatchId(data.batch_id || null);
    setImportFilename(prev => prev || data.filename || "");
    setImportRows(prev => [...prev, ...(Array.isArray(data.transactions) ? data.transactions : [])]);
    setImportIncome(prev => [...prev, ...(Array.isArray(data.income) ? data.income : [])]);
    setImportSection("spending");
    setImportStage("preview");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleCategorize() {
    setImportStage("categorizing");
    const descriptions = importRows.map(t => t.description);
    const data = await (await apiFetch("/api/v1/cashflow/transactions/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descriptions, categories }),
    })).json();
    const updated = importRows.map((t, i) => ({
      ...t,
      category:     data.suggestions[i]?.category     ?? t.category,
      subcategory:  data.suggestions[i]?.subcategory  ?? t.subcategory,
      is_recurring: data.suggestions[i]?.is_recurring ?? t.is_recurring,
    }));
    setImportRows(updated);
    setImportStage("preview");
  }

  async function handleSave() {
    await apiFetch("/api/v1/cashflow/transactions/import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions: importRows,
        income: importIncome,
        batch_id: importBatchId,
        filename: importFilename,
      }),
    });
    const msg = `Saved ${importRows.length} transactions${importIncome.length ? ` + ${importIncome.length} income entries` : ""}`;
    setSaveMsg(msg);
    setImportStage("idle");
    setImportRows([]);
    setImportIncome([]);
    setImportBatchId(null);
    setImportFilename("");
    setTimeout(() => setSaveMsg(null), 4000);
    fetchTransactions();
  }

  function updateImportRow(idx: number, field: string, value: any) {
    setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  // --- Breakdown data (client-side) ---
  const categoryTotals = transactions.reduce((acc, t) => {
    const cat = t.category || "Uncategorized";
    acc[cat] = (acc[cat] || 0) + t.amount;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));

  // --- Trends data (cross-month, from API) ---
  const allMonths = Array.from(new Set(trendsData.map((r: any) => r.month))).sort();
  const allAccountIds = Array.from(new Set(trendsData.map((r: any) => r.account_id)));
  const accountNames: Record<string, string> = {};
  trendsData.forEach((r: any) => { accountNames[r.account_id] = r.account_name || r.account_id; });

  const trendsChartData = allMonths.map(m => {
    const entry: any = { month: shortMonth(m) };
    allAccountIds.forEach(aid => {
      const row = trendsData.find((r: any) => r.month === m && r.account_id === aid);
      entry[aid] = row ? parseFloat(row.total.toFixed(2)) : 0;
    });
    return entry;
  });

  const filteredTransactions = transactions
    .filter(t => !activeFilter || (t.category || "Uncategorized") === activeFilter)
    .filter(t => !batchFilter || (t as any).batch_id === batchFilter);

  const total = transactions.reduce((s, t) => s + t.amount, 0);
  const filteredTotal = filteredTransactions.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-4">

      {/* Summary bar */}
      <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{transactions.length} transactions</span>
          {activeFilter && (
            <span className="flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">
              {activeFilter}
              <button onClick={() => setActiveFilter(null)}><X className="w-3 h-3" /></button>
            </span>
          )}
          {batchFilter && (
            <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
              {batchFilterName}
              <button onClick={() => { setBatchFilter(null); setBatchFilterName(""); }}><X className="w-3 h-3" /></button>
            </span>
          )}
        </div>
        <span className="text-lg font-semibold text-gray-900">
          {activeFilter
            ? <>${filteredTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} <span className="text-sm text-gray-400">of ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></>
            : `$${total.toLocaleString("en-US", { minimumFractionDigits: 2 })} spent`
          }
        </span>
      </div>

      {/* Save success message */}
      {saveMsg && (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <Check className="w-4 h-4" /> {saveMsg}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap items-center">
        <select value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-700 bg-white">
          <option value="">— Select account —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button onClick={() => selectedAccountId && fileRef.current?.click()}
          disabled={!selectedAccountId}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
          <Upload className="w-4 h-4" />
          {importRows.length > 0 ? "Add Another CSV" : "Import CSV"}
        </button>
        <button onClick={() => setShowAddForm(v => !v)}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50">
          <Plus className="w-4 h-4" /> Add Manual
        </button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />

        {/* Panel toggles — only show when there are transactions */}
        {transactions.length > 0 && (
          <div className="ml-auto flex gap-1">
            {(["breakdown", "trends", "imports"] as const).map(panel => (
              <button key={panel} onClick={() => togglePanel(panel)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  activePanel === panel
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}>
                {panel === "breakdown" ? <BarChart2 className="w-3.5 h-3.5" /> :
                 panel === "trends" ? <TrendingUp className="w-3.5 h-3.5" /> :
                 <Trash2 className="w-3.5 h-3.5" />}
                {panel === "breakdown" ? "Breakdown" : panel === "trends" ? "Trends" : "Imports"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add manual form */}
      {showAddForm && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
          <p className="text-sm font-medium text-gray-700">Add Transaction</p>
          <div className="grid grid-cols-2 gap-3">
            <input type="date" value={form.transaction_date}
              onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
            <input type="number" placeholder="Amount" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
            <input placeholder="Description" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2" />
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-2">
              <option value="">— Category —</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddManual}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Save</button>
            <button onClick={() => setShowAddForm(false)}
              className="px-4 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {/* CSV Import Preview */}
      {importStage !== "idle" && importRows.length > 0 && (
        <div className="border border-indigo-200 rounded-lg bg-indigo-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-indigo-800 capitalize">
                {importBank} — {importRows.length} spending{importIncome.length > 0 ? ` · ${importIncome.length} income` : ""}
              </p>
              {importIncome.length > 0 && (
                <div className="flex rounded border border-indigo-200 overflow-hidden text-xs">
                  {(["spending", "income"] as const).map(s => (
                    <button key={s} onClick={() => setImportSection(s)}
                      className={`px-2.5 py-1 capitalize transition-colors ${
                        importSection === s ? "bg-indigo-600 text-white" : "bg-white text-indigo-600"
                      }`}>
                      {s === "spending" ? `${importRows.length} spending` : `${importIncome.length} income`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => { setImportStage("idle"); setImportRows([]); setImportIncome([]); }}
              className="text-indigo-400 hover:text-indigo-700"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex gap-2">
            {importStage === "preview" && (
              <button onClick={handleCategorize}
                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-indigo-300 text-indigo-700 text-sm rounded-md hover:bg-indigo-50">
                <Loader2 className="w-3.5 h-3.5" /> Categorize with Claude
              </button>
            )}
            {importStage === "categorizing" && (
              <div className="flex items-center gap-2 text-sm text-indigo-700 px-3 py-1.5">
                <Loader2 className="w-4 h-4 animate-spin" /> Categorizing {importRows.length} transactions…
              </div>
            )}
            <button onClick={handleSave} disabled={importStage === "categorizing"}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> Save {importRows.length} transactions
            </button>
          </div>

          {/* Spending preview table */}
          {importSection === "spending" && (
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
                      <td className="py-1 pr-3 text-right font-medium">${Number(t.amount).toFixed(2)}</td>
                      <td className="py-1 pr-3">
                        <select value={t.category || ""} onChange={e => updateImportRow(i, "category", e.target.value)}
                          className="border border-indigo-200 rounded px-1 py-0.5 text-xs bg-white">
                          <option value="">—</option>
                          {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-3">
                        <input type="checkbox" checked={!!t.is_recurring}
                          onChange={e => updateImportRow(i, "is_recurring", e.target.checked)} />
                      </td>
                      <td className="py-1">
                        <button onClick={() => setImportRows(prev => prev.filter((_, j) => j !== i))}
                          className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Income preview table */}
          {importSection === "income" && importIncome.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-indigo-600 border-b border-indigo-200">
                    <th className="pb-1 pr-3">Date</th>
                    <th className="pb-1 pr-3">Description</th>
                    <th className="pb-1 pr-3 text-right">Amount</th>
                    <th className="pb-1 pr-3">Type</th>
                    <th className="pb-1 pr-3">Owner</th>
                    <th className="pb-1"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-100">
                  {importIncome.map((t, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-3 text-gray-600">{t.transaction_date}</td>
                      <td className="py-1 pr-3 text-gray-800 max-w-[200px] truncate">{t.description}</td>
                      <td className="py-1 pr-3 text-right font-medium text-green-700">${Number(t.amount).toFixed(2)}</td>
                      <td className="py-1 pr-3">
                        <select value={t.income_type || "other"}
                          onChange={e => setImportIncome(prev => prev.map((r, j) => j === i ? { ...r, income_type: e.target.value } : r))}
                          className="border border-indigo-200 rounded px-1 py-0.5 text-xs bg-white">
                          {["salary","bonus","freelance","dividend","other"].map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-3">
                        <input value={t.owner_hint || ""}
                          onChange={e => setImportIncome(prev => prev.map((r, j) => j === i ? { ...r, owner_hint: e.target.value } : r))}
                          placeholder="owner"
                          className="border border-indigo-200 rounded px-1 py-0.5 text-xs bg-white w-16" />
                      </td>
                      <td className="py-1">
                        <button onClick={() => setImportIncome(prev => prev.filter((_, j) => j !== i))}
                          className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── BREAKDOWN PANEL ── */}
      {activePanel === "breakdown" && transactions.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-6 bg-white">
          <p className="text-sm font-semibold text-gray-700">Spend by Category</p>

          {/* Pie chart */}
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value"
                  onClick={(d) => setActiveFilter(activeFilter === d.name ? null : d.name)}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]}
                      opacity={activeFilter && activeFilter !== pieData[i].name ? 0.3 : 1}
                      style={{ cursor: "pointer" }} />
                  ))}
                </Pie>
                <ReTooltip formatter={(v: any) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Horizontal bar chart */}
          <div style={{ height: `${Math.max(pieData.length * 32, 120)}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pieData} layout="vertical" barSize={18}
                margin={{ left: 80, right: 40, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                <ReTooltip formatter={(v: any) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={(d) => setActiveFilter(activeFilter === d.name ? null : d.name)}
                  style={{ cursor: "pointer" }}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]}
                      opacity={activeFilter && activeFilter !== entry.name ? 0.3 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── TRENDS PANEL ── */}
      {activePanel === "trends" && (
        <div className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
          <p className="text-sm font-semibold text-gray-700">Monthly Spend by Account — {month.split("-")[0]}</p>
          {trendsLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : trendsChartData.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No data for this year yet.</div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendsChartData} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                  <ReTooltip formatter={(v: any, name: any) => [`$${Number(v).toLocaleString()}`, accountNames[name] || name]} />
                  <Legend formatter={(value) => accountNames[value] || value} wrapperStyle={{ fontSize: 11 }} />
                  {allAccountIds.map((aid, i) => (
                    <Bar key={aid as string} dataKey={aid as string} fill={COLORS[i % COLORS.length]} radius={[2,2,0,0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── IMPORTS PANEL ── */}
      {activePanel === "imports" && (
        <div className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
          <p className="text-sm font-semibold text-gray-700">Import History</p>
          {importsLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : importsData.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No imports yet.</div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2">File</th>
                    <th className="px-4 py-2">Account</th>
                    <th className="px-4 py-2">Bank</th>
                    <th className="px-4 py-2 text-right">Transactions</th>
                    <th className="px-4 py-2 text-right">Imported</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {importsData.map((row, i) => (
                    <tr key={i} className={`hover:bg-gray-50 ${batchFilter === row.batch_id ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-2.5 text-gray-800 text-xs max-w-[160px] truncate" title={row.filename}>
                        {row.filename || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs">{row.account_name || row.account_id}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded capitalize">{row.bank}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 text-xs">{row.row_count}</td>
                      <td className="px-4 py-2.5 text-right text-gray-400 text-xs">
                        {row.imported_at ? new Date(row.imported_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              if (batchFilter === row.batch_id) { setBatchFilter(null); setBatchFilterName(""); }
                              else { setBatchFilter(row.batch_id); setBatchFilterName(row.filename || row.account_name); }
                            }}
                            className={`transition-colors ${batchFilter === row.batch_id ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}`}
                            title="Filter transactions to this import"
                          >
                            <BarChart2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteImport(row.batch_id, row.filename || row.batch_id, row.row_count)}
                            disabled={deletingKey === row.batch_id}
                            className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
                            title="Delete this import batch"
                          >
                            {deletingKey === row.batch_id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              {filteredTransactions.map(t => (
                <tr key={t.id}
                  className={`hover:bg-gray-50 ${activeFilter && (t.category || "Uncategorized") === activeFilter ? "bg-indigo-50" : ""}`}>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{t.transaction_date}</td>
                  <td className="px-4 py-2.5 text-gray-800">
                    {t.description}
                    {t.is_recurring && (
                      <span className="ml-2 text-xs text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">recurring</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <select value={t.category || ""}
                      onChange={e => handleCategoryChange(t.id!, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-600">
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
