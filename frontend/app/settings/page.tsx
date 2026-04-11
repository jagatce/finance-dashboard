"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, User, Building2, Pencil, Check, X } from "lucide-react";

const API = "http://localhost:8000/api/v1";

const CATEGORIES = [
  { value: "cash", label: "Cash & Equivalents" },
  { value: "taxable", label: "Taxable Investment" },
  { value: "retirement", label: "Retirement (401k/IRA)" },
  { value: "hsa", label: "HSA" },
  { value: "alternative", label: "Alternative Investment" },
  { value: "manual", label: "Manual Holdings" },
  { value: "credit_card", label: "Credit Card" },
  { value: "loan", label: "Loan" },
];

const SUBTYPES: Record<string, string[]> = {
  cash: ["Checking", "Savings", "Money Market", "HYSA", "CD", "529 Plan", "Custodial", "Other"],
  taxable: ["Brokerage", "ETF", "Stocks", "Custodial (UGMA/UTMA)", "Other"],
  retirement: ["401k", "Roth IRA", "Traditional IRA", "403b", "SEP-IRA", "Pension", "Other"],
  hsa: ["HSA"],
  alternative: ["Real Estate", "Crypto", "Private Equity", "Angel", "Other"],
  manual: ["Custom"],
  credit_card: ["Visa", "Mastercard", "Amex", "Discover", "Other"],
  loan: ["Mortgage", "Auto", "Student", "Personal", "Other"],
};

const MEMBER_TYPES = [
  { value: "self", label: "Self" },
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Child" },
  { value: "joint", label: "Joint" },
];

const MEMBER_COLORS: Record<string, string> = {
  self: "bg-indigo-100 text-indigo-700",
  spouse: "bg-purple-100 text-purple-700",
  child: "bg-green-100 text-green-700",
  joint: "bg-gray-100 text-gray-700",
};

export default function Settings() {
  const [owners, setOwners] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [msg, setMsg] = useState("");

  // Owner form
  const [ownerName, setOwnerName] = useState("");
  const [ownerType, setOwnerType] = useState("self");

  // Account add form
  const [acctOwner, setAcctOwner] = useState("");
  const [acctName, setAcctName] = useState("");
  const [acctInstitution, setAcctInstitution] = useState("");
  const [acctCategory, setAcctCategory] = useState("cash");
  const [acctSubtype, setAcctSubtype] = useState("");
  const [acctNotes, setAcctNotes] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  async function loadOwners() {
    const res = await fetch(`${API}/owners/`);
    const data = await res.json();
    setOwners(data);
    if (data.length > 0 && !acctOwner) setAcctOwner(data[0].id);
  }

  async function loadAccounts() {
    const res = await fetch(`${API}/accounts/`);
    setAccounts(await res.json());
  }

  useEffect(() => { loadOwners(); loadAccounts(); }, []);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2500); }

  async function addOwner() {
    if (!ownerName.trim()) return;
    await fetch(`${API}/owners/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: ownerName, member_type: ownerType }),
    });
    setOwnerName("");
    flash("Member added ✓");
    loadOwners();
  }

  async function deleteOwner(id: string) {
    await fetch(`${API}/owners/${id}`, { method: "DELETE" });
    loadOwners();
  }

  async function addAccount() {
    if (!acctName.trim() || !acctOwner) return;
    await fetch(`${API}/accounts/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_id: acctOwner,
        name: acctName,
        institution: acctInstitution,
        category: acctCategory,
        subtype: acctSubtype,
        notes: acctNotes,
      }),
    });
    setAcctName(""); setAcctInstitution(""); setAcctNotes(""); setAcctSubtype("");
    flash("Account added ✓");
    loadAccounts();
  }

  async function deleteAccount(id: string) {
    await fetch(`${API}/accounts/${id}`, { method: "DELETE" });
    loadAccounts();
  }

  function startEdit(a: any) {
    setEditingId(a.id);
    setEditForm({
      owner_id: a.owner_id,
      name: a.name,
      institution: a.institution ?? "",
      category: a.category,
      subtype: a.subtype ?? "",
      notes: a.notes ?? "",
    });
  }

  async function saveEdit(id: string) {
    await fetch(`${API}/accounts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    setEditingId(null);
    flash("Account updated ✓");
    loadAccounts();
  }

  const ownerMap = Object.fromEntries(owners.map((o) => [o.id, o.name]));

  // Group owners by type for display
  const groupedOwners = MEMBER_TYPES.map(({ value, label }) => ({
    type: value,
    label,
    members: owners.filter((o) => o.member_type === value),
  })).filter((g) => g.members.length > 0);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        {msg && <span className="text-sm text-green-600 font-medium">{msg}</span>}
      </div>

      {/* ── Household Members ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-5">
          <User className="w-4 h-4 text-indigo-500" />
          <h2 className="font-semibold text-gray-900">Household Members</h2>
          <span className="ml-auto text-xs text-gray-400">{owners.length} member{owners.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Grouped by type */}
        {groupedOwners.length > 0 && (
          <div className="mb-5 space-y-3">
            {groupedOwners.map(({ type, label, members }) => (
              <div key={type}>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">{label}{members.length > 1 ? "ren" : ""}</p>
                <ul className="space-y-1.5">
                  {members.map((o) => (
                    <li key={o.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{o.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MEMBER_COLORS[o.member_type] ?? "bg-gray-100 text-gray-600"}`}>
                          {o.member_type}
                        </span>
                      </div>
                      <button onClick={() => deleteOwner(o.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Add member form */}
        <div className="flex gap-2">
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addOwner()}
            placeholder="Name (e.g. Aria)"
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={ownerType}
            onChange={(e) => setOwnerType(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {MEMBER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button onClick={addOwner} className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </section>

      {/* ── Accounts ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-5">
          <Building2 className="w-4 h-4 text-indigo-500" />
          <h2 className="font-semibold text-gray-900">Accounts</h2>
          <span className="ml-auto text-xs text-gray-400">{accounts.length} account{accounts.length !== 1 ? "s" : ""}</span>
        </div>

        {owners.length === 0 && (
          <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-4">
            Add a household member first before adding accounts.
          </p>
        )}

        {/* Account list */}
        {accounts.length > 0 && (
          <ul className="mb-6 space-y-2">
            {accounts.map((a) =>
              editingId === a.id ? (
                <li key={a.id} className="border border-indigo-200 bg-indigo-50 rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Owner</label>
                      <select value={editForm.owner_id} onChange={(e) => setEditForm({ ...editForm, owner_id: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Account Name</label>
                      <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Institution</label>
                      <input value={editForm.institution} onChange={(e) => setEditForm({ ...editForm, institution: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Category</label>
                      <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value, subtype: "" })} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Subtype</label>
                      <select value={editForm.subtype} onChange={(e) => setEditForm({ ...editForm, subtype: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">Select...</option>
                        {(SUBTYPES[editForm.category] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
                      <input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => saveEdit(a.id)} className="flex items-center gap-1 bg-indigo-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-gray-500 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                </li>
              ) : (
                <li key={a.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-900">{a.name}</span>
                    {a.institution && <span className="text-xs text-gray-400 ml-2">{a.institution}</span>}
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-xs text-indigo-500 capitalize">{a.category}</span>
                      {a.subtype && <span className="text-xs text-gray-400">{a.subtype}</span>}
                      <span className="text-xs text-gray-400">· {ownerMap[a.owner_id] ?? "Unknown"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button onClick={() => startEdit(a)} className="text-gray-300 hover:text-indigo-500 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteAccount(a.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              )
            )}
          </ul>
        )}

        {/* Add account form */}
        <div className="border-t border-gray-100 pt-5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Add New Account</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Owner *</label>
              <select value={acctOwner} onChange={(e) => setAcctOwner(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.member_type})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Account Name *</label>
              <input value={acctName} onChange={(e) => setAcctName(e.target.value)} placeholder="e.g. Fidelity 401k" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Institution</label>
              <input value={acctInstitution} onChange={(e) => setAcctInstitution(e.target.value)} placeholder="e.g. Fidelity" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Category *</label>
              <select value={acctCategory} onChange={(e) => { setAcctCategory(e.target.value); setAcctSubtype(""); }} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Subtype</label>
              <select value={acctSubtype} onChange={(e) => setAcctSubtype(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select...</option>
                {(SUBTYPES[acctCategory] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
              <input value={acctNotes} onChange={(e) => setAcctNotes(e.target.value)} placeholder="Optional" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <button onClick={addAccount} disabled={owners.length === 0} className="mt-4 flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus className="w-4 h-4" /> Add Account
          </button>
        </div>
      </section>
    </div>
  );
}
