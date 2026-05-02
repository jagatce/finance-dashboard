"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/auth";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";

// ─── Contract metadata ────────────────────────────────────────────────────────
const CONTRACT_META: Record<string, { name: string; color: string; bg: string; text: string }> = {
  MNQ: { name: "Micro Nasdaq-100", color: "#3B82F6", bg: "bg-blue-50",   text: "text-blue-700" },
  SIL: { name: "Micro Silver",     color: "#6B7280", bg: "bg-gray-100",  text: "text-gray-700" },
  MCL: { name: "Micro Crude Oil",  color: "#D97706", bg: "bg-amber-50",  text: "text-amber-700" },
  MGC: { name: "Micro Gold",       color: "#16A34A", bg: "bg-green-50",  text: "text-green-700" },
  MBT: { name: "Micro Bitcoin",    color: "#7C3AED", bg: "bg-violet-50", text: "text-violet-700" },
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Summary {
  totals: { gross_pnl: number; total_fees: number; net_pnl: number; round_trips: number; trading_days: number };
  by_symbol: SymbolRow[];
  available_months: string[];
}
interface SymbolRow {
  symbol: string; gross_pnl: number; total_fees: number; net_pnl: number;
  round_trips: number; active_days: number; fee_drag_pct: number | null;
}
interface DayRow {
  trade_date: string; symbols: string; gross_pnl: number;
  total_fees: number; net_pnl: number; contracts: number;
}
interface TradeRow {
  trade_date: string; symbol: string; gross_pnl: number; net_pnl: number;
  total_fees: number; total_long: number; total_short: number;
  avg_long: number | null; avg_short: number | null;
  price_move?: number; move_direction?: string;
  contract_name: string; analysis: string;
}
interface TopTrades { winners: TradeRow[]; losers: TradeRow[]; }
interface Psychology {
  win_days: number; loss_days: number; flat_days: number;
  avg_win: number; avg_loss: number; best_day: number; worst_day: number;
  total_net: number; win_loss_ratio: number | null;
  max_consecutive_losses: number; mnq_daily_limit_breaches: number;
  adverse_direction_days: number;
  estimated_savings: { mnq_daily_cap: number; sil_roll_rule: number; total_est: number };
}
interface ImportBatch {
  id: number; filename: string; account_num: string;
  period_start: string; period_end: string; leg_count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtPnl = (n: number | null | undefined, showPlus = true) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const s = abs >= 1000 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs.toFixed(0);
  return (n < 0 ? "−$" : showPlus ? "+$" : "$") + s;
};

const TABS = ["Summary", "Daily", "Top Trades", "Psychology", "Import"] as const;
type Tab = typeof TABS[number];

// ─── Shared UI ────────────────────────────────────────────────────────────────
const SymBadge = ({ sym }: { sym: string }) => {
  const m = CONTRACT_META[sym] || { bg: "bg-gray-100", text: "text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${m.bg} ${m.text}`}>
      {sym}
    </span>
  );
};

const PnlBadge = ({ val }: { val: number }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
    val >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
  }`}>
    {fmtPnl(val)}
  </span>
);

const StatCard = ({ label, value, sub, green, red }: { label: string; value: string; sub?: string; green?: boolean; red?: boolean }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-4">
    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
    <p className={`text-2xl font-semibold ${green ? "text-green-600" : red ? "text-red-600" : "text-gray-900"}`}>
      {value}
    </p>
    {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">{children}</h3>
);

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white rounded-xl border border-gray-200 p-5 ${className || ""}`}>
    {children}
  </div>
);

const Callout = ({ type, children }: { type: "green" | "red" | "amber" | "gray"; children: React.ReactNode }) => {
  const styles = {
    green: "border-l-4 border-green-500 bg-green-50 text-green-800",
    red:   "border-l-4 border-red-400  bg-red-50   text-red-800",
    amber: "border-l-4 border-amber-400 bg-amber-50 text-amber-800",
    gray:  "border-l-4 border-gray-300  bg-gray-50  text-gray-700",
  }[type];
  return <div className={`${styles} px-4 py-3 rounded-r-lg text-sm leading-relaxed mb-3`}>{children}</div>;
};

const RuleBox = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border border-gray-200 rounded-lg p-4 mb-3">
    <p className="text-sm font-semibold text-gray-800 mb-1">{title}</p>
    <p className="text-sm text-gray-600 leading-relaxed">{children}</p>
  </div>
);

const tooltipStyle = {
  contentStyle: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#6b7280" },
};

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FuturesPage() {
  const [tab, setTab]       = useState<Tab>("Summary");
  const [month, setMonth]   = useState("");
  const [sym, setSym]       = useState("");
  const [months, setMonths] = useState<string[]>([]);

  const [summary,   setSummary]   = useState<Summary | null>(null);
  const [daily,     setDaily]     = useState<DayRow[]>([]);
  const [topTrades, setTopTrades] = useState<TopTrades | null>(null);
  const [psych,     setPsych]     = useState<Psychology | null>(null);
  const [batches,   setBatches]   = useState<ImportBatch[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (month) p.set("month", month);
    if (sym)   p.set("symbol", sym);
    return p.toString() ? "?" + p.toString() : "";
  }, [month, sym]);

  const load = useCallback(async () => {
    const q = qs();
    try {
      const [s, d, tt, ps] = await Promise.all([
        apiFetch(`/api/v1/futures/summary${q}`).then(r => r.json()),
        apiFetch(`/api/v1/futures/daily${q}`).then(r => r.json()),
        apiFetch(`/api/v1/futures/top-trades${q}`).then(r => r.json()),
        apiFetch(`/api/v1/futures/psychology${q}`).then(r => r.json()),
      ]);
      setSummary(s);
      setMonths(s.available_months || []);
      setDaily(Array.isArray(d) ? d : []);
      setTopTrades(tt);
      setPsych(ps);
    } catch (e) { console.error(e); }
  }, [qs]);

  const loadBatches = useCallback(async () => {
    const r = await apiFetch("/api/v1/futures/imports").then(r => r.json());
    setBatches(Array.isArray(r) ? r : []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "Import") loadBatches(); }, [tab, loadBatches]);

  // ── Filter bar ───────────────────────────────────────────────────────────────
  const FilterBar = () => (
    <div className="flex items-center gap-3 mb-6 flex-wrap">
      <select
        value={month} onChange={e => setMonth(e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">All months</option>
        {months.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
        value={sym} onChange={e => setSym(e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">All instruments</option>
        {Object.entries(CONTRACT_META).map(([s, m]) => (
          <option key={s} value={s}>{s} — {m.name}</option>
        ))}
      </select>
      {(month || sym) && (
        <button onClick={() => { setMonth(""); setSym(""); }} className="text-sm text-red-500 hover:text-red-700">
          Clear filters ×
        </button>
      )}
    </div>
  );

  // ── Summary ──────────────────────────────────────────────────────────────────
  const SummaryTab = () => {
    if (!summary) return (
      <p className="text-gray-500 text-sm py-8">No data yet — go to Import tab to upload a statement.</p>
    );
    const t = summary.totals;
    const totalRt = (summary.by_symbol || []).reduce((a, r) => a + r.round_trips, 0);
    const drag = t.gross_pnl ? (Math.abs(t.total_fees) / t.gross_pnl * 100).toFixed(1) : null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Gross P&L"    value={fmtPnl(t.gross_pnl)} green={t.gross_pnl >= 0} red={t.gross_pnl < 0} />
          <StatCard label="Net P&L"      value={fmtPnl(t.net_pnl)}   green={t.net_pnl   >= 0} red={t.net_pnl   < 0} />
          <StatCard label="Fees Paid"    value={fmtPnl(t.total_fees, false)} red sub={drag ? `${drag}% drag` : undefined} />
          <StatCard label="Round-Trips"  value={String(t.round_trips ?? "—")} />
          <StatCard label="Trading Days" value={String(t.trading_days ?? "—")} />
        </div>

        <Card>
          <SectionTitle>P&L by instrument</SectionTitle>
          <div className="divide-y divide-gray-100">
            {(summary.by_symbol || []).map(row => {
              const meta = CONTRACT_META[row.symbol];
              const pct = totalRt > 0 ? Math.round(row.round_trips / totalRt * 100) : 0;
              return (
                <div key={row.symbol} className="flex items-center gap-4 py-3">
                  <div className="w-12 flex-shrink-0"><SymBadge sym={row.symbol} /></div>
                  <div className="w-36 text-sm text-gray-500 flex-shrink-0">{meta?.name}</div>
                  <div className="flex-1 min-w-0">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: meta?.color || "#888" }} />
                    </div>
                    <p className="text-xs text-gray-400">{pct}% of volume · {row.round_trips} rt · {row.active_days}d</p>
                  </div>
                  <div className="text-xs text-red-500 w-14 text-right flex-shrink-0">{fmtPnl(row.total_fees, false)}</div>
                  <div className="w-20 flex justify-end flex-shrink-0"><PnlBadge val={row.gross_pnl} /></div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionTitle>Gross P&L by instrument</SectionTitle>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={summary.by_symbol || []} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="symbol" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => "$" + (v / 1000).toFixed(1) + "k"} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [fmtPnl(v), "gross p&l"]} />
              <ReferenceLine y={0} stroke="#e5e7eb" />
              <Bar dataKey="gross_pnl" radius={[4, 4, 0, 0]}>
                {(summary.by_symbol || []).map(r => <Cell key={r.symbol} fill={r.gross_pnl >= 0 ? "#16a34a" : "#dc2626"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    );
  };

  // ── Daily ─────────────────────────────────────────────────────────────────────
  const DailyTab = () => {
    const winDays  = daily.filter(d => d.gross_pnl > 0).length;
    const lossDays = daily.filter(d => d.gross_pnl < 0).length;
    const cumData  = daily.reduce<{ date: string; cum: number }[]>((acc, d) => {
      acc.push({ date: d.trade_date, cum: (acc[acc.length - 1]?.cum || 0) + (d.gross_pnl || 0) });
      return acc;
    }, []);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Win Days"  value={String(winDays)}  green />
          <StatCard label="Loss Days" value={String(lossDays)} red />
          <StatCard label="Total Days" value={String(daily.length)} />
        </div>

        <Card>
          <SectionTitle>Daily P&L + contracts traded</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily} margin={{ bottom: 28, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="trade_date" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" interval={0} height={56} axisLine={false} tickLine={false} />
              <YAxis yAxisId="pnl" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => (v >= 0 ? "$" : "-$") + Math.abs(Math.round(v)).toLocaleString()} />
              <YAxis yAxisId="ct" orientation="right" tick={{ fontSize: 10, fill: "#3b82f6" }} axisLine={false} tickLine={false} />
              <ReferenceLine yAxisId="pnl" y={0} stroke="#e5e7eb" />
              <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => n === "gross_pnl" ? [fmtPnl(v), "p&l"] : [v, "contracts"]} />
              <Bar yAxisId="pnl" dataKey="gross_pnl" radius={[3, 3, 0, 0]}>
                {daily.map((d, i) => <Cell key={i} fill={d.gross_pnl >= 0 ? "#16a34a" : "#dc2626"} />)}
              </Bar>
              <Line yAxisId="ct" type="monotone" dataKey="contracts" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 2, fill: "#3b82f6" }} strokeDasharray="4 3" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionTitle>Cumulative P&L</SectionTitle>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={cumData} margin={{ left: 0, right: 4, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={3} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => "$" + Math.round(v).toLocaleString()} />
              <ReferenceLine y={0} stroke="#e5e7eb" />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [fmtPnl(v), "cumulative"]} />
              <Line type="monotone" dataKey="cum" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionTitle>Daily log</SectionTitle>
          <div className="grid grid-cols-[100px_90px_1fr_60px_70px_52px] gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2 border-b border-gray-100 mb-1">
            <span>Date</span><span>P&L</span><span>Instruments</span>
            <span className="text-right">Contracts</span>
            <span className="text-right">Fees</span>
            <span className="text-right">Result</span>
          </div>
          {daily.map((d, i) => (
            <div key={i} className="grid grid-cols-[100px_90px_1fr_60px_70px_52px] gap-2 items-center py-2 border-b border-gray-50 text-sm">
              <span className="text-gray-500 tabular-nums">{d.trade_date}</span>
              <PnlBadge val={d.gross_pnl} />
              <div className="flex gap-1 flex-wrap">
                {(d.symbols || "").split(",").map(s => <SymBadge key={s} sym={s.trim()} />)}
              </div>
              <span className="text-right text-gray-500">{d.contracts}</span>
              <span className="text-right text-red-500 text-xs">{fmtPnl(d.total_fees, false)}</span>
              <span className={`text-right text-xs font-semibold ${d.gross_pnl > 0 ? "text-green-600" : d.gross_pnl < 0 ? "text-red-600" : "text-gray-400"}`}>
                {d.gross_pnl > 0 ? "win" : d.gross_pnl < 0 ? "loss" : "flat"}
              </span>
            </div>
          ))}
        </Card>
      </div>
    );
  };

  // ── Top Trades ────────────────────────────────────────────────────────────────
  const TopTradesTab = () => {
    if (!topTrades) return null;
    const List = ({ trades, isWin }: { trades: TradeRow[]; isWin: boolean }) => (
      <Card>
        <SectionTitle>{isWin ? "▲ Top 10 winners" : "▼ Top 10 losers"}</SectionTitle>
        {trades.length === 0 && <p className="text-gray-400 text-sm">No data yet.</p>}
        {trades.map((t, i) => (
          <div key={i} className={`py-3 ${i < trades.length - 1 ? "border-b border-gray-100" : ""}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <SymBadge sym={t.symbol} />
                <span className="text-xs text-gray-400 tabular-nums">{t.trade_date}</span>
                <span className="text-xs text-gray-400">{t.total_long}L · {t.total_short}S</span>
              </div>
              <PnlBadge val={t.gross_pnl} />
            </div>
            {t.avg_long != null && t.avg_short != null && (
              <p className="text-xs text-gray-400 mb-1 tabular-nums">
                entry {t.avg_long.toFixed(t.symbol === "MNQ" ? 0 : 3)} → exit {t.avg_short.toFixed(t.symbol === "MNQ" ? 0 : 3)}
                {t.price_move != null && (
                  <span className={`ml-1.5 ${t.move_direction === "favorable" ? "text-green-500" : "text-red-500"}`}>
                    ({t.price_move > 0 ? "+" : ""}{t.price_move.toFixed(t.symbol === "MNQ" ? 0 : 3)})
                  </span>
                )}
              </p>
            )}
            <p className="text-xs text-gray-500 leading-relaxed">{t.analysis}</p>
          </div>
        ))}
      </Card>
    );
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <List trades={topTrades.winners} isWin={true} />
        <List trades={topTrades.losers}  isWin={false} />
      </div>
    );
  };

  // ── Psychology ────────────────────────────────────────────────────────────────
  const PsychologyTab = () => {
    if (!psych) return null;
    const total  = (psych.win_days || 0) + (psych.loss_days || 0) + (psych.flat_days || 0);
    const winPct = total ? Math.round(psych.win_days / total * 100) : 0;
    return (
      <div className="space-y-6">
        <div className="border-2 border-amber-300 bg-amber-50 rounded-xl p-5">
          <p className="text-sm font-semibold text-amber-900 mb-1">Your pattern — asymmetric exits</p>
          <p className="text-sm text-amber-800 leading-relaxed">
            Winners cut early — no regret, no FOMO. Losses held, re-entered, and compounded. The fix is mechanical: rules that fire before your brain rationalizes holding.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard label="Win days"     value={`${psych.win_days}/${total}`} green />
          <StatCard label="Win rate"     value={`${winPct}%`} green={winPct >= 50} red={winPct < 50} />
          <StatCard label="Avg win day"  value={fmtPnl(psych.avg_win)}  green />
          <StatCard label="Avg loss day" value={fmtPnl(psych.avg_loss)} red />
          <StatCard label="Best day"     value={fmtPnl(psych.best_day)}  green />
          <StatCard label="Worst day"    value={fmtPnl(psych.worst_day)} red />
          <StatCard label="W/L ratio"    value={psych.win_loss_ratio ? psych.win_loss_ratio.toFixed(2) + "x" : "—"} green={!!psych.win_loss_ratio && psych.win_loss_ratio >= 1} red={!!psych.win_loss_ratio && psych.win_loss_ratio < 1} />
          <StatCard label="Max consec. L" value={String(psych.max_consecutive_losses)} red={psych.max_consecutive_losses >= 3} />
        </div>

        <Card>
          <SectionTitle>Stop-loss rule compliance</SectionTitle>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className={`rounded-lg p-4 ${psych.mnq_daily_limit_breaches > 0 ? "bg-red-50" : "bg-green-50"}`}>
              <p className="text-xs text-gray-500 mb-1">MNQ daily limit breaches (&gt;−$150)</p>
              <p className={`text-3xl font-bold ${psych.mnq_daily_limit_breaches > 0 ? "text-red-600" : "text-green-600"}`}>
                {psych.mnq_daily_limit_breaches}
              </p>
            </div>
            <div className={`rounded-lg p-4 ${psych.adverse_direction_days > 0 ? "bg-red-50" : "bg-green-50"}`}>
              <p className="text-xs text-gray-500 mb-1">Adverse direction days</p>
              <p className={`text-3xl font-bold ${psych.adverse_direction_days > 0 ? "text-red-600" : "text-green-600"}`}>
                {psych.adverse_direction_days}
              </p>
            </div>
          </div>
          <Callout type="gray">
            Estimated savings if all stop rules followed: <span className="font-semibold">{fmtPnl(psych.estimated_savings.total_est)}</span>
            {" "}· MNQ cap {fmtPnl(psych.estimated_savings.mnq_daily_cap)} + SIL roll rule {fmtPnl(psych.estimated_savings.sil_roll_rule)}
          </Callout>
        </Card>

        <Card>
          <SectionTitle>The 3 rules</SectionTitle>
          <RuleBox title="Rule 1 — first loss is the best loss">
            In every large loss in this data, the earliest exit was always the best exit. The impulse to hold is the signal to exit.
          </RuleBox>
          <RuleBox title="Rule 2 — after 2 consecutive losses, 1 contract only">
            After 2 sequential losses on any instrument, reduce to 1 contract for the rest of that session. Full size resumes next session.
          </RuleBox>
          <RuleBox title="Rule 3 — no re-entry after 2 losing scalps on a new contract month">
            When rolling to a new expiry, stop re-entering after 2 consecutive losses. Unfamiliar price levels amplify the re-entry loop.
          </RuleBox>
        </Card>

        <Card>
          <SectionTitle>Monthly self-review checklist</SectionTitle>
          <div className="space-y-0">
            {[
              "How many trades exceeded the hard stop? (target: 0)",
              "How many days did I breach the daily loss limit and keep trading?",
              "Did I add to any losing position? (target: 0)",
              "On my 3 worst trades — at what point could I have exited earliest?",
              "How many re-entry-after-loss sequences ended in a bigger loss?",
              "Did I follow the 1-contract rule on new contract months?",
            ].map((item, i, arr) => (
              <div key={i} className={`flex gap-3 py-2.5 text-sm text-gray-600 ${i < arr.length - 1 ? "border-b border-gray-100" : ""}`}>
                <span className="text-gray-300 mt-0.5">☐</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  };

  // ── Import ────────────────────────────────────────────────────────────────────
  const ImportTab = () => {
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      setImporting(true); setImportMsg(null);
      const form = new FormData();
      form.append("file", f);
      try {
        const r    = await apiFetch("/api/v1/futures/import", { method: "POST", body: form });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || JSON.stringify(data));
        setImportMsg({ ok: true, text: `Imported ${data.leg_count} legs · ${data.period_start} → ${data.period_end}` });
        load(); loadBatches();
      } catch (err: unknown) {
        setImportMsg({ ok: false, text: "Error: " + (err instanceof Error ? err.message : String(err)) });
      } finally { setImporting(false); e.target.value = ""; }
    };

    const handleDelete = async (id: number, fn: string) => {
      if (!confirm(`Remove "${fn}"? All trade data for this statement will be deleted.`)) return;
      await apiFetch(`/api/v1/futures/imports/${id}`, { method: "DELETE" });
      loadBatches(); load();
    };

    return (
      <div className="space-y-6">
        <Card>
          <SectionTitle>Upload statement</SectionTitle>
          <p className="text-sm text-gray-500 mb-4">Robinhood Derivatives monthly PDF. Each file imports once (duplicate detection by filename).</p>
          <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white hover:bg-gray-50 cursor-pointer transition-colors ${importing ? "opacity-50 cursor-not-allowed" : ""}`}>
            {importing ? "Parsing…" : "+ Choose PDF"}
            <input type="file" accept=".pdf" onChange={handleUpload} disabled={importing} className="hidden" />
          </label>
          {importMsg && (
            <div className={`mt-3 px-4 py-2.5 rounded-lg text-sm ${importMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              {importMsg.text}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Imported statements ({batches.length})</SectionTitle>
          {batches.length === 0 && <p className="text-gray-400 text-sm">No statements imported yet.</p>}
          <div className="divide-y divide-gray-100">
            {batches.map(b => (
              <div key={b.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{b.filename}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{b.period_start} → {b.period_end} · {b.leg_count} legs · {b.account_num}</p>
                </div>
                <button
                  onClick={() => handleDelete(b.id, b.filename)}
                  className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg px-3 py-1.5 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  };

  // ── Shell ─────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-baseline gap-3 mb-2">
          <h1 className="text-2xl font-semibold text-gray-900">Futures Trading</h1>
          <span className="text-sm text-gray-400">Robinhood Derivatives</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {Object.keys(CONTRACT_META).map(s => <SymBadge key={s} sym={s} />)}
        </div>
      </div>

      {/* Tabs — matching Cash Flow exactly */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >{t}</button>
          ))}
        </nav>
      </div>

      {/* Filters */}
      {tab !== "Import" && <FilterBar />}

      {tab === "Summary"    && <SummaryTab />}
      {tab === "Daily"      && <DailyTab />}
      {tab === "Top Trades" && <TopTradesTab />}
      {tab === "Psychology" && <PsychologyTab />}
      {tab === "Import"     && <ImportTab />}
    </div>
  );
}
