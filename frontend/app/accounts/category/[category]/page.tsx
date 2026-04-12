"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TrendingUp, TrendingDown, Clock, Plus } from "lucide-react";
import { apiFetch } from "@/lib/auth";

const API = "http://localhost:8000/api/v1";

const CATEGORY_LABELS: Record<string, string> = {
  cash:        "Cash & Equivalents",
  taxable:     "Taxable Investments",
  retirement:  "Retirement Accounts",
  hsa:         "HSA",
  alternative: "Alternative Investments",
  manual:      "Manual Holdings",
  credit_card: "Credit Cards",
  loan:        "Loans",
};

const CATEGORY_COLORS: Record<string, string> = {
  cash:        "text-teal-600",
  taxable:     "text-blue-600",
  retirement:  "text-purple-600",
  hsa:         "text-cyan-600",
  alternative: "text-orange-600",
  manual:      "text-gray-600",
  credit_card: "text-red-600",
  loan:        "text-rose-700",
};

const CATEGORY_BG: Record<string, string> = {
  cash:        "bg-teal-50 border-teal-200",
  taxable:     "bg-blue-50 border-blue-200",
  retirement:  "bg-purple-50 border-purple-200",
  hsa:         "bg-cyan-50 border-cyan-200",
  alternative: "bg-orange-50 border-orange-200",
  manual:      "bg-gray-50 border-gray-200",
  credit_card: "bg-red-50 border-red-200",
  loan:        "bg-rose-50 border-rose-200",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(n);
}

export default function CategoryPage() {
  const { category }              = useParams();
  const cat                       = category as string;
  const [accounts, setAccounts]   = useState<any[]>([]);
  const [owners, setOwners]       = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, any[]>>({});
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    async function load() {
      const [acctRes, ownerRes] = await Promise.all([
        apiFetch(`${API}/accounts/?category=${cat}`),
        apiFetch(`${API}/owners/`),
      ]);
      const accts  = await acctRes.json();
      const owners = await ownerRes.json();
      setAccounts(Array.isArray(accts)  ? accts  : []);
      setOwners(Array.isArray(owners) ? owners : []);

      const snapMap: Record<string, any[]> = {};
      await Promise.all((Array.isArray(accts) ? accts : []).map(async (a: any) => {
        const res  = await apiFetch(`${API}/accounts/${a.id}/snapshots/`);
        const data = await res.json();
        snapMap[a.id] = Array.isArray(data) ? data : [];
      }));
      setSnapshots(snapMap);
      setLoading(false);
    }
    load();
  }, [cat]);

  const ownerMap    = Object.fromEntries(owners.map((o) => [o.id, o.name]));
  const isLiability = ["credit_card", "loan"].includes(cat);

  const total = accounts.reduce((sum, a) => {
    const latest = snapshots[a.id]?.[0];
    return sum + (latest?.balance ?? 0);
  }, 0);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      Loading...
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {CATEGORY_LABELS[cat] ?? cat}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">{fmt(total)}</p>
          <p className="text-xs text-gray-400">Total balance</p>
        </div>
      </div>

      {accounts.length === 0 && (
        <div className={`rounded-xl border p-8 text-center ${CATEGORY_BG[cat] ?? "bg-gray-50 border-gray-200"}`}>
          <p className={`font-medium mb-1 ${CATEGORY_COLORS[cat] ?? "text-gray-600"}`}>
            No {CATEGORY_LABELS[cat] ?? cat} accounts yet
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Add accounts in Settings, then update their balances.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Account
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {accounts.map((a) => {
          const snaps   = snapshots[a.id] ?? [];
          const latest  = snaps[0];
          const prev    = snaps[1];
          const balance = latest?.balance ?? 0;
          const change  = latest && prev ? latest.balance - prev.balance : null;
          const pos     = change !== null && change >= 0;

          return (
            <Link
              key={a.id}
              href={`/accounts/${a.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{a.name}</p>
                  <div className="flex gap-2 mt-0.5">
                    {a.institution && <span className="text-xs text-gray-400">{a.institution}</span>}
                    {a.subtype && <span className="text-xs text-gray-400">· {a.subtype}</span>}
                    <span className="text-xs text-gray-400">· {ownerMap[a.owner_id] ?? "Unknown"}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-lg font-bold ${isLiability ? "text-red-500" : "text-gray-900"}`}>
                    {fmt(balance)}
                  </p>
                  {change !== null && (
                    <div className={`flex items-center justify-end gap-1 mt-0.5 ${pos ? "text-green-600" : "text-red-500"}`}>
                      {pos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      <span className="text-xs font-medium">{pos ? "+" : ""}{fmt(change)}</span>
                    </div>
                  )}
                </div>
              </div>
              {latest && (
                <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-50">
                  <Clock className="w-3 h-3 text-gray-300" />
                  <span className="text-xs text-gray-400">
                    Updated {new Date(latest.snapshot_date).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric"
                    })}
                  </span>
                  {snaps.length > 1 && (
                    <span className="text-xs text-gray-300 ml-auto">{snaps.length} snapshots</span>
                  )}
                </div>
              )}
              {!latest && (
                <div className="mt-3 pt-3 border-t border-gray-50">
                  <span className="text-xs text-amber-500">No balance entered yet</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {accounts.length > 0 && (
        <div className="flex gap-3">
          <Link href="/balances" className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
            Update Balances
          </Link>
          <Link href="/settings" className="flex items-center gap-1.5 border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <Plus className="w-4 h-4" /> Add Account
          </Link>
        </div>
      )}
    </div>
  );
}
