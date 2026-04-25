"use client";
import { useState } from "react";

import SpendingTab    from "./components/SpendingTab";
import IncomeTab      from "./components/IncomeTab";
import SavingsRateTab from "./components/SavingsRateTab";
import MonthlyReviewTab from "./components/MonthlyReviewTab";
import RecurringTab     from "./components/RecurringTab";

const TABS = ["Spending", "Income", "Savings Rate", "Recurring", "Monthly Review"] as const;
type Tab = typeof TABS[number];

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string) {
  const [y, m] = month.split("-");
  return new Date(parseInt(y), parseInt(m) - 1).toLocaleString("default", {
    month: "long", year: "numeric",
  });
}

function prevMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function CashFlowPage() {
  const [activeTab, setActiveTab]       = useState<Tab>("Spending");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const currentMonth = getCurrentMonth();

  return (
    
      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Cash Flow</h1>
            <p className="text-sm text-gray-500 mt-0.5">Income, spending, and savings</p>
          </div>

          {/* Month picker */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMonth(prevMonth(selectedMonth))}
              className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors"
            >
              ‹
            </button>
            <span className="text-sm font-medium text-gray-900 w-36 text-center">
              {formatMonthLabel(selectedMonth)}
            </span>
            <button
              onClick={() => setSelectedMonth(nextMonth(selectedMonth))}
              disabled={selectedMonth >= currentMonth}
              className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ›
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === "Spending"       && <SpendingTab    month={selectedMonth} />}
        {activeTab === "Income"         && <IncomeTab      month={selectedMonth} />}
        {activeTab === "Savings Rate"   && <SavingsRateTab month={selectedMonth} />}
        {activeTab === "Recurring"     && <RecurringTab />}
        {activeTab === "Monthly Review" && <MonthlyReviewTab month={selectedMonth} />}

      </div>
    
  );
}
