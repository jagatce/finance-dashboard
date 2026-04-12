"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";
import { Clock, TrendingUp, TrendingDown, ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import Link from "next/link";

const API = "http://localhost:8000/api/v1";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(n);
}

function fmtShort(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const RANGES = ["3M", "6M", "1Y", "All"];

function filterByRange(data: any[], range: string) {
  if (range === "All" || data.length === 0) return data;
  const now    = new Date();
  const months: Record<string, number> = { "3M": 3, "6M": 6, "1Y": 12 };
  const cutoff = new Date(now.setMonth(now.getMonth() - (months[range] ?? 12)));
  return data.filter((d) => new Date(d.snapshot_date) >= cutoff);
}

export default function AccountDetailPage() {
  const { id }                    = useParams();
  const [account, setAccount]     = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [owners, setOwners]       = useState<any[]>([]);
  const [range, setRange]         = useState("All");
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    async function load() {
      const [acctRes, snapRes, ownerRes] = await Promise.all([
        fetch(`${API}/accounts/`),
        fetch(`${API}/accounts/${id}/snapshots/`),
        fetch(`${API}/owners/`),
      ]);
      const accts  = await acctRes.json();
      const snaps  = await snapRes.json();
      const owners = await ownerRes.json();
      setAccount(accts.find((a: any) => a.id === id));
      // Reverse so chart goes oldest → newest
      setSnapshots([...snaps].reverse());
      setOwners(owners);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
  );
  if (!account) return (
    <div className="text-gray-500 p-8">Account not found.</div>
  );

  const ownerMap  = Object.fromEntries(owners.map((o: any) => [o.id, o.name]));
  const filtered  = filterByRange(snapshots, range);
  const latest    = snapshots[snapshots.length - 1];
  const first     = filtered[0];
  const last      = filtered[filtered.length - 1];
  const change    = last && first ? last.balance - first.balance : 0;
  const positive  = change >= 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Back */}
      <Link
        href="/balances"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{account.name}</h1>
            <div className="flex gap-3 mt-1">
              {account.institution && (
                <span className="text-sm text-gray-500">{account.institution}</span>
              )}
              <span className="text-sm text-indigo-500 capitalize">{account.category}</span>
              {account.subtype && (
                <span className="text-sm text-gray-400">{account.subtype}</span>
              )}
              <span className="text-sm text-gray-400">
                · {ownerMap[account.owner_id] ?? "Unknown"}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">
              {fmt(latest?.balance ?? 0)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Current balance
            </p>
          </div>
        </div>

        {/* Change indicator */}
        {filtered.length > 1 && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
            {positive
              ? <TrendingUp className="w-4 h-4 text-green-500" />
              : <TrendingDown className="w-4 h-4 text-red-500" />}
            <span className={`text-sm font-medium ${positive ? "text-green-600" : "text-red-500"}`}>
              {positive ? "+" : ""}{fmt(change)}
            </span>
            <span className="text-sm text-gray-400">over selected period</span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-semibold text-gray-900">Balance History</h2>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  range === r
                    ? "bg-indigo-600 text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {filtered.length < 2 ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            Add balances on multiple dates to see trends here.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={filtered}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="snapshot_date"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={(d) => new Date(d).toLocaleDateString("en-US", {
                  month: "short", day: "numeric"
                })}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={fmtShort}
                width={60}
              />
              <Tooltip
                formatter={(v: number) => [fmt(v), "Balance"]}
                labelFormatter={(d) => new Date(d).toLocaleDateString("en-US", {
                  month: "long", day: "numeric", year: "numeric"
                })}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
              />
              <Line
                type="monotone"
                dataKey="balance"
                stroke="#4f46e5"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#4f46e5" }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Snapshot history table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">All Snapshots</h2>
        {snapshots.length === 0 ? (
          <p className="text-sm text-gray-400">No snapshots yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="text-left pb-2 font-medium">Date</th>
                <th className="text-right pb-2 font-medium">Balance</th>
                <th className="text-right pb-2 font-medium">Change</th>
                <th className="text-left pb-2 font-medium pl-4">Notes</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshots].reverse().map((s, i, arr) => {
                const prev   = arr[i + 1];
                const change = prev ? s.balance - prev.balance : null;
                const pos    = change !== null && change >= 0;
                return (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 text-gray-700">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-gray-300" />
                        {new Date(s.snapshot_date).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric"
                        })}
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-medium text-gray-900">
                      {fmt(s.balance)}
                    </td>
                    <td className="py-2.5 text-right">
                      {change !== null && (
                        <span className={`text-xs font-medium ${pos ? "text-green-600" : "text-red-500"}`}>
                          {pos ? "+" : ""}{fmt(change)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pl-4 text-gray-400 text-xs">{s.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
