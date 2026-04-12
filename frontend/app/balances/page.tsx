"use client";
import { apiFetch } from "@/lib/auth";
import { useEffect, useState } from "react";
import { Save, RefreshCw, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";

const API = "http://localhost:8000/api/v1";

const CATEGORY_COLORS: Record<string, string> = {
  cash:        "border-l-teal-400",
  taxable:     "border-l-blue-400",
  retirement:  "border-l-purple-400",
  hsa:         "border-l-cyan-400",
  alternative: "border-l-orange-400",
  manual:      "border-l-gray-400",
  credit_card: "border-l-red-400",
  loan:        "border-l-rose-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  cash:        "Cash & Equivalents",
  taxable:     "Taxable Investment",
  retirement:  "Retirement",
  hsa:         "HSA",
  alternative: "Alternative",
  manual:      "Manual",
  credit_card: "Credit Card",
  loan:        "Loan",
};

const CATEGORY_ORDER = [
  "cash","taxable","retirement","hsa","alternative","manual","credit_card","loan"
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(n);
}

function today() {
  return new Date().toISOString().split("T")[0];
}

export default function BalancesPage() {
  const [accounts, setAccounts]   = useState<any[]>([]);
  const [owners, setOwners]       = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, any[]>>({});
  const [balances, setBalances]   = useState<Record<string, string>>({});
  const [dates, setDates]         = useState<Record<string, string>>({});
  const [saved, setSaved]         = useState<Record<string, boolean>>({});
  const [saving, setSaving]       = useState<Record<string, boolean>>({});
  const [loading, setLoading]     = useState(true);
  const [filterOwner, setFilterOwner] = useState("all");
  const [asOfDate, setAsOfDate]   = useState(today());

  async function load() {
    setLoading(true);
    const [acctRes, ownerRes] = await Promise.all([
      fetch(`${API}/accounts/`),
      fetch(`${API}/owners/`),
    ]);
    const accts  = await acctRes.json();
    const owners = await ownerRes.json();
    setAccounts(accts);
    setOwners(owners);

    const snapMap: Record<string, any[]> = {};
    await Promise.all(accts.map(async (a: any) => {
      const res  = await apiFetch(`${API}/accounts/${a.id}/snapshots/`);
      const data = await res.json();
      snapMap[a.id] = data;
    }));
    setSnapshots(snapMap);

    const initBalances: Record<string, string> = {};
    const initDates: Record<string, string>    = {};
    accts.forEach((a: any) => {
      const latest = snapMap[a.id]?.[0];
      initBalances[a.id] = latest ? String(latest.balance) : "";
      initDates[a.id]    = today();
    });
    setBalances(initBalances);
    setDates(initDates);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveOne(accountId: string) {
    const bal = parseFloat(balances[accountId]);
    if (isNaN(bal)) return;
    setSaving((s) => ({ ...s, [accountId]: true }));
    await apiFetch(`${API}/accounts/snapshots/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id:    accountId,
        balance:       bal,
        snapshot_date: dates[accountId] || today(),
        as_of_date:    dates[accountId] || today(),
      }),
    });
    setSaving((s) => ({ ...s, [accountId]: false }));
    setSaved((s)  => ({ ...s, [accountId]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [accountId]: false })), 3000);
    const res  = await apiFetch(`${API}/accounts/${accountId}/snapshots/`);
    const data = await res.json();
    setSnapshots((prev) => ({ ...prev, [accountId]: data }));
  }

  async function saveAll() {
    const toSave = filtered.filter(
      (a) => balances[a.id] !== "" && !isNaN(parseFloat(balances[a.id]))
    );
    await Promise.all(toSave.map((a) => saveOne(a.id)));
  }

  function applyDateToAll() {
    const updated: Record<string, string> = {};
    filtered.forEach((a) => { updated[a.id] = asOfDate; });
    setDates((prev) => ({ ...prev, ...updated }));
  }

  const ownerMap = Object.fromEntries(owners.map((o) => [o.id, o]));

  const filtered = filterOwner === "all"
    ? accounts
    : accounts.filter((a) => a.owner_id === filterOwner);

  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = filtered.filter((a) => a.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {} as Record<string, any[]>);

  const filledCount = filtered.filter(
    (a) => balances[a.id] !== "" && !isNaN(parseFloat(balances[a.id]))
  ).length;

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading accounts...
    </div>
  );

  if (accounts.length === 0) return (
    <div className="max-w-2xl mx-auto text-center py-20">
      <p className="text-gray-500 mb-3">No accounts found.</p>
      <a href="/settings" className="text-indigo-600 text-sm font-medium hover:underline">
        Go to Settings to add accounts →
      </a>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Update Balances</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {filledCount} of {filtered.length} accounts filled
          </p>
        </div>
        <button
          onClick={saveAll}
          className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Save className="w-4 h-4" /> Save All
        </button>
      </div>

      {/* Filters + bulk date */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Filter by member</label>
          <select
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Members</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Apply date to all</label>
          <div className="flex gap-2">
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={applyDateToAll}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* Account groups */}
      {Object.entries(grouped).map(([cat, accts]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {CATEGORY_LABELS[cat] ?? cat}
            </h2>
            <span className="text-xs text-gray-400">({accts.length})</span>
          </div>

          <div className="space-y-2">
            {accts.map((a) => {
              const latest   = snapshots[a.id]?.[0];
              const owner    = ownerMap[a.owner_id];
              const isSaved  = saved[a.id];
              const isSaving = saving[a.id];
              const hasChange = latest && parseFloat(balances[a.id]) !== latest.balance;

              return (
                <div
                  key={a.id}
                  className={`bg-white rounded-xl border border-gray-200 border-l-4 ${CATEGORY_COLORS[cat]} p-4`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {/* ── Clickable account name ── */}
                        <Link
                          href={`/accounts/${a.id}`}
                          className="text-sm font-semibold text-gray-900 truncate hover:text-indigo-600 transition-colors"
                        >
                          {a.name}
                        </Link>
                        {a.institution && (
                          <span className="text-xs text-gray-400">{a.institution}</span>
                        )}
                        {owner && (
                          <span className="text-xs text-gray-400 ml-auto shrink-0">
                            {owner.name}
                          </span>
                        )}
                      </div>
                      {latest && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-300" />
                          <span className="text-xs text-gray-400">
                            Last: {fmt(latest.balance)} on {latest.snapshot_date}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Input row */}
                  <div className="flex items-center gap-2 mt-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        type="number"
                        value={balances[a.id] ?? ""}
                        onChange={(e) => setBalances((b) => ({ ...b, [a.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && saveOne(a.id)}
                        placeholder="0"
                        className={`w-full pl-7 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                          hasChange ? "border-indigo-300 bg-indigo-50" : "border-gray-200"
                        }`}
                      />
                    </div>
                    <input
                      type="date"
                      value={dates[a.id] ?? today()}
                      onChange={(e) => setDates((d) => ({ ...d, [a.id]: e.target.value }))}
                      className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      onClick={() => saveOne(a.id)}
                      disabled={isSaving || !balances[a.id]}
                      className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                        isSaved
                          ? "bg-green-50 text-green-600 border border-green-200"
                          : "bg-indigo-600 text-white hover:bg-indigo-700"
                      } disabled:opacity-40`}
                    >
                      {isSaved ? (
                        <><CheckCircle2 className="w-4 h-4" /> Saved</>
                      ) : isSaving ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> Saving</>
                      ) : (
                        <><Save className="w-4 h-4" /> Save</>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Sticky save all footer */}
      {filtered.length > 3 && (
        <div className="sticky bottom-4">
          <button
            onClick={saveAll}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white text-sm font-medium px-5 py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg"
          >
            <Save className="w-4 h-4" /> Save All ({filledCount} accounts)
          </button>
        </div>
      )}
    </div>
  );
}
