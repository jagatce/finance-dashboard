"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/auth";
import { Loader2, Plus, Trash2, ChevronLeft } from "lucide-react";
import Link from "next/link";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtRate(r: number) { return `${r}%`; }

const TABS = ["Overview", "Loans", "Amortization", "Payoff Calculator", "Payments"] as const;
type Tab = typeof TABS[number];

const LOAN_TYPES = ["fixed", "arm"];
const EVENT_TYPES = ["purchase", "refinance"];

export default function MortgageDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [data, setData]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [activeLoanId, setActiveLoanId] = useState<string|null>(null);
  const [amortData, setAmortData] = useState<any>(null);
  const [amortLoading, setAmortLoading] = useState(false);
  const [extraMonthly, setExtraMonthly] = useState("0");
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [editingLoanId, setEditingLoanId]     = useState<string|null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const [loanForm, setLoanForm] = useState({
    event_type: "purchase", loan_type: "fixed",
    original_balance: "", rate: "", term_months: "",
    start_date: "", monthly_escrow: "", monthly_extra_principal: "",
    closing_costs: "", down_payment: "", notes: "",
    arm_initial_period: "", arm_cap: "", arm_lifetime_cap: "",
  });

  const [paymentForm, setPaymentForm] = useState({
    loan_id: "", payment_date: "", principal: "", interest: "",
    escrow: "", extra_principal: "", balance_after: "", notes: "",
  });

  useEffect(() => { if (id) fetchData(); }, [id]);

  async function fetchData() {
    setLoading(true);
    try {
      const d = await (await apiFetch(`/api/v1/mortgage/${id}`)).json();
      setData(d);
      const active = d.loans?.find((l: any) => l.is_active);
      if (active) setActiveLoanId(active.id);
    } finally { setLoading(false); }
  }

  async function fetchAmortization(loanId: string, extra: number = 0) {
    setAmortLoading(true);
    try {
      const d = await (await apiFetch(`/api/v1/mortgage/loan/${loanId}/amortization?extra_monthly=${extra}`)).json();
      setAmortData(d);
    } finally { setAmortLoading(false); }
  }

  useEffect(() => {
    if (activeLoanId && (activeTab === "Amortization" || activeTab === "Payoff Calculator")) {
      fetchAmortization(activeLoanId, parseFloat(extraMonthly) || 0);
    }
  }, [activeTab, activeLoanId]);

  async function handleAddLoan() {
    await apiFetch("/api/v1/mortgage/loan/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mortgage_id: id,
        event_type: loanForm.event_type,
        loan_type: loanForm.loan_type,
        original_balance: parseFloat(loanForm.original_balance),
        rate: parseFloat(loanForm.rate),
        term_months: parseInt(loanForm.term_months),
        start_date: loanForm.start_date,
        monthly_escrow: parseFloat(loanForm.monthly_escrow) || 0,
        monthly_extra_principal: parseFloat(loanForm.monthly_extra_principal) || 0,
        closing_costs: parseFloat(loanForm.closing_costs) || 0,
        down_payment: parseFloat(loanForm.down_payment) || 0,
        notes: loanForm.notes || null,
        arm_initial_period: loanForm.arm_initial_period ? parseInt(loanForm.arm_initial_period) : null,
        arm_cap: loanForm.arm_cap ? parseFloat(loanForm.arm_cap) : null,
        arm_lifetime_cap: loanForm.arm_lifetime_cap ? parseFloat(loanForm.arm_lifetime_cap) : null,
        is_active: true,
      }),
    });
    setShowLoanForm(false);
    fetchData();
  }

  async function handleDeleteLoan(loanId: string) {
    if (!confirm("Delete this loan and all its payments?")) return;
    await apiFetch(`/api/v1/mortgage/loan/${loanId}`, { method: "DELETE" });
    fetchData();
  }

  async function handleUpdateLoan(loanId: string) {
    await apiFetch(`/api/v1/mortgage/loan/${loanId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    setEditingLoanId(null);
    setEditForm({});
    fetchData();
    if (activeLoanId && (activeTab === "Amortization" || activeTab === "Payoff Calculator")) {
      fetchAmortization(activeLoanId, parseFloat(extraMonthly) || 0);
    }
  }

  async function handleCloseLoan(loanId: string, endDate: string) {
    await apiFetch(`/api/v1/mortgage/loan/${loanId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false, end_date: endDate }),
    });
    fetchData();
  }

  async function handleAddPayment() {
    await apiFetch("/api/v1/mortgage/payment/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loan_id: paymentForm.loan_id || activeLoanId,
        payment_date: paymentForm.payment_date,
        principal: parseFloat(paymentForm.principal) || 0,
        interest: parseFloat(paymentForm.interest) || 0,
        escrow: parseFloat(paymentForm.escrow) || 0,
        extra_principal: parseFloat(paymentForm.extra_principal) || 0,
        balance_after: paymentForm.balance_after ? parseFloat(paymentForm.balance_after) : null,
        notes: paymentForm.notes || null,
      }),
    });
    setShowPaymentForm(false);
    setPaymentForm({ loan_id: "", payment_date: "", principal: "", interest: "", escrow: "", extra_principal: "", balance_after: "", notes: "" });
    if (activeLoanId && (activeTab === "Amortization" || activeTab === "Payoff Calculator")) {
      fetchAmortization(activeLoanId, parseFloat(extraMonthly) || 0);
    }
  }

  async function handleDeletePayment(paymentId: string) {
    await apiFetch(`/api/v1/mortgage/payment/${paymentId}`, { method: "DELETE" });
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-64 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );

  if (!data) return <div className="p-6 text-gray-500">Mortgage not found.</div>;

  const { mortgage, loans } = data;
  const activeLoan = loans?.find((l: any) => l.is_active);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/mortgage" className="text-gray-400 hover:text-gray-600">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{mortgage.property_name}</h1>
          {mortgage.address && <p className="text-sm text-gray-500">{mortgage.address}</p>}
        </div>
        <div className="ml-auto flex gap-4 text-sm">
          {mortgage.purchase_price && (
            <div className="text-right">
              <p className="text-xs text-gray-400">Purchase Price</p>
              <p className="font-semibold text-gray-700">{fmt(mortgage.purchase_price)}</p>
            </div>
          )}
          {mortgage.purchase_date && (
            <div className="text-right">
              <p className="text-xs text-gray-400">Purchase Date</p>
              <p className="font-semibold text-gray-700">{mortgage.purchase_date}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "Overview" && activeLoan && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Original Balance", value: fmt(activeLoan.original_balance) },
              { label: "Interest Rate",    value: fmtRate(activeLoan.rate) },
              { label: "Term",             value: `${activeLoan.term_months} months (${activeLoan.term_months/12} yrs)` },
              { label: "Started",          value: activeLoan.start_date },
            ].map(c => (
              <div key={c.label} className="bg-gray-50 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-base font-semibold text-gray-900 mt-0.5">{c.value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Monthly Escrow",    value: fmt(activeLoan.monthly_escrow) },
              { label: "Extra Principal",   value: fmt(activeLoan.monthly_extra_principal) },
              { label: "Down Payment",      value: fmt(activeLoan.down_payment) },
              { label: "Closing Costs",     value: fmt(activeLoan.closing_costs) },
            ].map(c => (
              <div key={c.label} className="bg-gray-50 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-base font-semibold text-gray-900 mt-0.5">{c.value}</p>
              </div>
            ))}
          </div>
          {activeLoan.loan_type === "arm" && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm text-amber-800 space-y-1">
              <p className="font-medium">ARM Details</p>
              <p>Initial fixed period: {activeLoan.arm_initial_period} months</p>
              <p>Periodic cap: {activeLoan.arm_cap}% · Lifetime cap: {activeLoan.arm_lifetime_cap}%</p>
            </div>
          )}
          {activeLoan.notes && (
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">{activeLoan.notes}</div>
          )}
        </div>
      )}

      {/* ── LOANS TAB ── */}
      {activeTab === "Loans" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Loan History ({loans?.length || 0} loans)</p>
            <button onClick={() => setShowLoanForm(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
              <Plus className="w-3.5 h-3.5" /> Add Loan / Refinance
            </button>
          </div>

          {/* Add loan form */}
          {showLoanForm && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
              <p className="text-sm font-medium text-gray-700">Add Loan</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Event Type</label>
                  <select value={loanForm.event_type}
                    onChange={e => setLoanForm(f => ({ ...f, event_type: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full">
                    {EVENT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Loan Type</label>
                  <select value={loanForm.loan_type}
                    onChange={e => setLoanForm(f => ({ ...f, loan_type: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full">
                    {LOAN_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Start Date</label>
                  <input type="date" value={loanForm.start_date}
                    onChange={e => setLoanForm(f => ({ ...f, start_date: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Original Balance ($)</label>
                  <input type="number" placeholder="450000" value={loanForm.original_balance}
                    onChange={e => setLoanForm(f => ({ ...f, original_balance: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Interest Rate (%)</label>
                  <input type="number" step="0.01" placeholder="6.5" value={loanForm.rate}
                    onChange={e => setLoanForm(f => ({ ...f, rate: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Term (months)</label>
                  <input type="number" placeholder="360" value={loanForm.term_months}
                    onChange={e => setLoanForm(f => ({ ...f, term_months: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Monthly Escrow ($)</label>
                  <input type="number" placeholder="400" value={loanForm.monthly_escrow}
                    onChange={e => setLoanForm(f => ({ ...f, monthly_escrow: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Extra Principal/mo ($)</label>
                  <input type="number" placeholder="0" value={loanForm.monthly_extra_principal}
                    onChange={e => setLoanForm(f => ({ ...f, monthly_extra_principal: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Down Payment ($)</label>
                  <input type="number" placeholder="90000" value={loanForm.down_payment}
                    onChange={e => setLoanForm(f => ({ ...f, down_payment: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Closing Costs ($)</label>
                  <input type="number" placeholder="5000" value={loanForm.closing_costs}
                    onChange={e => setLoanForm(f => ({ ...f, closing_costs: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                {loanForm.loan_type === "arm" && <>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">ARM Initial Period (mo)</label>
                    <input type="number" placeholder="84" value={loanForm.arm_initial_period}
                      onChange={e => setLoanForm(f => ({ ...f, arm_initial_period: e.target.value }))}
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Periodic Cap (%)</label>
                    <input type="number" step="0.1" placeholder="2" value={loanForm.arm_cap}
                      onChange={e => setLoanForm(f => ({ ...f, arm_cap: e.target.value }))}
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Lifetime Cap (%)</label>
                    <input type="number" step="0.1" placeholder="5" value={loanForm.arm_lifetime_cap}
                      onChange={e => setLoanForm(f => ({ ...f, arm_lifetime_cap: e.target.value }))}
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                  </div>
                </>}
                <textarea placeholder="Notes" value={loanForm.notes}
                  onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))}
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm col-span-3 h-16 resize-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddLoan}
                  className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Save</button>
                <button onClick={() => setShowLoanForm(false)}
                  className="px-4 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          )}

          {/* Loan history timeline */}
          <div className="space-y-3">
            {loans?.map((loan: any, i: number) => (
              <div key={loan.id}
                className={`border rounded-lg p-4 ${loan.is_active ? "border-indigo-200 bg-indigo-50" : "border-gray-200 bg-white"}`}>
                {editingLoanId === loan.id ? (
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-600">Editing loan</p>
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: "Rate (%)",          field: "rate",                     type: "number", step: "0.01" },
                        { label: "Escrow/mo ($)",     field: "monthly_escrow",           type: "number" },
                        { label: "Extra Principal/mo ($)", field: "monthly_extra_principal", type: "number" },
                        { label: "Notes",             field: "notes",                    type: "text"   },
                      ].map(f => (
                        <div key={f.field} className="space-y-1">
                          <label className="text-xs text-gray-500">{f.label}</label>
                          <input type={f.type} step={(f as any).step}
                            value={editForm[f.field] ?? loan[f.field] ?? ""}
                            onChange={e => setEditForm((prev: any) => ({ ...prev, [f.field]: f.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value }))}
                            className="border border-gray-300 rounded px-2 py-1 text-xs w-full" />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleUpdateLoan(loan.id)}
                        className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700">Save</button>
                      <button onClick={() => { setEditingLoanId(null); setEditForm({}); }}
                        className="px-3 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded capitalize ${
                          loan.event_type === "purchase" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                        }`}>{loan.event_type}</span>
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded uppercase">{loan.loan_type}</span>
                        {loan.is_active && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">Active</span>}
                      </div>
                      <p className="text-sm font-medium text-gray-900">
                        {fmt(loan.original_balance)} @ {fmtRate(loan.rate)} · {loan.term_months} months
                      </p>
                      <p className="text-xs text-gray-500">
                        Started {loan.start_date}{loan.end_date ? ` → ${loan.end_date}` : ""}
                      </p>
                      {loan.notes && <p className="text-xs text-gray-400 italic">{loan.notes}</p>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <div className="text-right">
                        <p>Escrow: {fmt(loan.monthly_escrow)}/mo</p>
                        {loan.monthly_extra_principal > 0 && <p>Extra: {fmt(loan.monthly_extra_principal)}/mo</p>}
                        {loan.down_payment > 0 && <p>Down: {fmt(loan.down_payment)}</p>}
                      </div>
                      <button onClick={() => { setEditingLoanId(loan.id); setEditForm({}); }}
                        className="text-gray-400 hover:text-indigo-600 transition-colors text-xs px-2 py-1 border border-gray-200 rounded hover:border-indigo-300">
                        Edit
                      </button>
                      {loan.is_active && (
                        <button onClick={() => {
                          const endDate = prompt("Enter end date (YYYY-MM-DD):", new Date().toISOString().slice(0,10));
                          if (endDate) handleCloseLoan(loan.id, endDate);
                        }}
                          className="text-gray-400 hover:text-amber-600 transition-colors text-xs px-2 py-1 border border-gray-200 rounded hover:border-amber-300">
                          Close
                        </button>
                      )}
                      <button onClick={() => handleDeleteLoan(loan.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AMORTIZATION TAB ── */}
      {activeTab === "Amortization" && (
        <div className="space-y-4">
          {amortLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Computing…
            </div>
          ) : amortData ? (
            <>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: "Monthly P+I",      value: fmt(amortData.monthly_pi) },
                  { label: "Payoff Date",       value: amortData.payoff_date?.slice(0,7) },
                  { label: "Total Interest",    value: fmt(amortData.total_interest) },
                  { label: "Months to Payoff",  value: `${amortData.payoff_months} mo` },
                ].map(c => (
                  <div key={c.label} className="bg-gray-50 rounded-lg px-4 py-3">
                    <p className="text-xs text-gray-500">{c.label}</p>
                    <p className="text-base font-semibold text-gray-900 mt-0.5">{c.value}</p>
                  </div>
                ))}
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    <tr className="text-left text-gray-500 uppercase tracking-wide">
                      <th className="px-3 py-2">Month</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2 text-right">Principal</th>
                      <th className="px-3 py-2 text-right">Interest</th>
                      <th className="px-3 py-2 text-right">Extra</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2 text-right">Cum. Interest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {amortData.schedule?.map((row: any) => (
                      <tr key={row.month} className={`hover:bg-gray-50 ${row.extra > 0 ? "bg-green-50" : ""}`}>
                        <td className="px-3 py-1.5 text-gray-500">{row.month}</td>
                        <td className="px-3 py-1.5 text-gray-500">{row.payment_date?.slice(0,7)}</td>
                        <td className="px-3 py-1.5 text-right text-indigo-600">{fmt(row.principal)}</td>
                        <td className="px-3 py-1.5 text-right text-red-500">{fmt(row.interest)}</td>
                        <td className="px-3 py-1.5 text-right text-green-600">{row.extra > 0 ? fmt(row.extra) : "—"}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmt(row.balance)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">{fmt(row.cumulative_interest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">No active loan found.</div>
          )}
        </div>
      )}

      {/* ── PAYOFF CALCULATOR TAB ── */}
      {activeTab === "Payoff Calculator" && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-lg">
            <label className="text-sm font-medium text-gray-700 shrink-0">Extra monthly principal ($)</label>
            <input type="number" value={extraMonthly}
              onChange={e => setExtraMonthly(e.target.value)}
              placeholder="0"
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32" />
            <button
              onClick={() => activeLoanId && fetchAmortization(activeLoanId, parseFloat(extraMonthly) || 0)}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
              Calculate
            </button>
          </div>

          {amortLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Computing…
            </div>
          ) : amortData ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-700">Without Extra Payments</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Payoff months</span>
                    <span className="font-medium">{amortData.base_payoff_months}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Total interest</span>
                    <span className="font-medium text-red-500">{fmt(amortData.base_total_interest)}</span>
                  </div>
                </div>
              </div>
              <div className={`border rounded-lg p-4 space-y-3 ${amortData.months_saved > 0 ? "border-green-200 bg-green-50" : "border-gray-200"}`}>
                <p className="text-sm font-semibold text-gray-700">
                  With {parseFloat(extraMonthly) > 0 ? fmt(parseFloat(extraMonthly)) : "No"} Extra/Month
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Payoff months</span>
                    <span className="font-medium">{amortData.payoff_months}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Total interest</span>
                    <span className="font-medium text-red-500">{fmt(amortData.total_interest)}</span>
                  </div>
                  {amortData.months_saved > 0 && (
                    <>
                      <div className="border-t border-green-200 pt-2 flex justify-between text-sm">
                        <span className="text-green-700 font-medium">Months saved</span>
                        <span className="font-bold text-green-700">{amortData.months_saved}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-green-700 font-medium">Interest saved</span>
                        <span className="font-bold text-green-700">{fmt(amortData.interest_saved)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-green-700 font-medium">New payoff date</span>
                        <span className="font-bold text-green-700">{amortData.payoff_date?.slice(0,7)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">No active loan found.</div>
          )}
        </div>
      )}

      {/* ── PAYMENTS TAB ── */}
      {activeTab === "Payments" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Payment Log</p>
            <button onClick={() => setShowPaymentForm(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
              <Plus className="w-3.5 h-3.5" /> Log Payment
            </button>
          </div>

          {showPaymentForm && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
              <p className="text-sm font-medium text-gray-700">Log Payment</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Loan</label>
                  <select value={paymentForm.loan_id || activeLoanId || ""}
                    onChange={e => setPaymentForm(f => ({ ...f, loan_id: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full">
                    {loans?.map((l: any) => (
                      <option key={l.id} value={l.id}>
                        {l.event_type} — {l.start_date} @ {l.rate}%
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Payment Date</label>
                  <input type="date" value={paymentForm.payment_date}
                    onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Balance After ($)</label>
                  <input type="number" placeholder="optional" value={paymentForm.balance_after}
                    onChange={e => setPaymentForm(f => ({ ...f, balance_after: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Principal ($)</label>
                  <input type="number" value={paymentForm.principal}
                    onChange={e => setPaymentForm(f => ({ ...f, principal: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Interest ($)</label>
                  <input type="number" value={paymentForm.interest}
                    onChange={e => setPaymentForm(f => ({ ...f, interest: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Escrow ($)</label>
                  <input type="number" value={paymentForm.escrow}
                    onChange={e => setPaymentForm(f => ({ ...f, escrow: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Extra Principal ($)</label>
                  <input type="number" value={paymentForm.extra_principal}
                    onChange={e => setPaymentForm(f => ({ ...f, extra_principal: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-gray-500">Notes</label>
                  <input placeholder="optional" value={paymentForm.notes}
                    onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddPayment}
                  className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Save</button>
                <button onClick={() => setShowPaymentForm(false)}
                  className="px-4 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          )}

          <PaymentsList loanId={activeLoanId} onDelete={handleDeletePayment} />
        </div>
      )}
    </div>
  );
}

function PaymentsList({ loanId, onDelete }: { loanId: string|null; onDelete: (id: string) => void }) {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!loanId) { setLoading(false); return; }
    apiFetch(`/api/v1/mortgage/loan/${loanId}/payments`)
      .then(r => r.json())
      .then(d => { setPayments(Array.isArray(d) ? d : []); setLoading(false); });
  }, [loanId]);

  function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
  }

  if (loading) return <div className="text-center py-8 text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading…</div>;
  if (payments.length === 0) return <div className="text-center py-12 text-gray-400 text-sm">No payments logged yet.</div>;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2 text-right">Principal</th>
            <th className="px-4 py-2 text-right">Interest</th>
            <th className="px-4 py-2 text-right">Escrow</th>
            <th className="px-4 py-2 text-right">Extra</th>
            <th className="px-4 py-2 text-right">Balance After</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {payments.map(p => (
            <tr key={p.id} className={`hover:bg-gray-50 ${p.extra_principal > 0 ? "bg-green-50" : ""}`}>
              <td className="px-4 py-2.5 text-gray-600 text-xs">{p.payment_date}</td>
              <td className="px-4 py-2.5 text-right text-indigo-600">{fmt(p.principal)}</td>
              <td className="px-4 py-2.5 text-right text-red-500">{fmt(p.interest)}</td>
              <td className="px-4 py-2.5 text-right text-gray-500">{fmt(p.escrow)}</td>
              <td className="px-4 py-2.5 text-right text-green-600">{p.extra_principal > 0 ? fmt(p.extra_principal) : "—"}</td>
              <td className="px-4 py-2.5 text-right font-medium text-gray-700">{p.balance_after ? fmt(p.balance_after) : "—"}</td>
              <td className="px-4 py-2.5 text-right">
                <button onClick={() => onDelete(p.id)} className="text-gray-300 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
