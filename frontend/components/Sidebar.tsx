"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Wallet, CreditCard, Shield,
  TrendingUp, PiggyBank, BarChart3, Settings,
  DollarSign, Database, LogOut, BarChart2, Sparkles, Radio, Home
} from "lucide-react";
import { clearToken } from "@/lib/auth";

const nav = [
  {
    label: "Overview",
    items: [
      { href: "/",         label: "Dashboard",      icon: LayoutDashboard },
      { href: "/networth", label: "Net Worth",       icon: TrendingUp },
      { href: "/balances", label: "Update Balances", icon: DollarSign },
    ],
  },
  {
    label: "Assets",
    items: [
      { href: "/accounts/category/cash",        label: "Cash & Equivalents", icon: Wallet },
      { href: "/accounts/category/taxable",     label: "Investments",        icon: BarChart3 },
      { href: "/accounts/category/retirement",  label: "Retirement",         icon: PiggyBank },
      { href: "/accounts/category/hsa",         label: "HSA",                icon: Shield },
      { href: "/accounts/category/alternative", label: "Alternatives",       icon: TrendingUp },
      { href: "/accounts/category/manual",      label: "Manual Holdings",    icon: Wallet },
    ],
  },
  {
    label: "Liabilities",
    items: [
      { href: "/accounts/category/credit_card", label: "Credit Cards", icon: CreditCard },
      { href: "/accounts/category/loan",        label: "Loans",        icon: Wallet },
      { href: "/mortgage",                       label: "Mortgage",     icon: Home },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/insurance", label: "Insurance", icon: Shield },
      { href: "/cashflow", label: "Cash Flow", icon: TrendingUp },
      { href: "/forecast",     label: "Forecast",    icon: TrendingUp },
      { href: "/projections", label: "Projections", icon: TrendingUp },
      { href: "/reviews",   label: "Reviews",   icon: BarChart3 },
    ],
  },
  {
    label: "Holdings",
    items: [
      { href: "/holdings",          label: "Positions",  icon: BarChart2 },
      { href: "/holdings/analysis",    label: "AI Analysis",    icon: Sparkles },
      { href: "/holdings/tax-efficiency", label: "Tax Efficiency", icon: Shield },
    ],
  },
  {
    label: "Claude Sensor",
    items: [
      { href: "/sensor", label: "Sensor", icon: Radio },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/backup",   label: "Backup & Restore", icon: Database },
      { href: "/settings", label: "Settings",         icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col h-full shrink-0">
      <div className="px-4 py-5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-sm">FinanceOS</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {nav.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider px-2 mb-1">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
                        active
                          ? "bg-indigo-50 text-indigo-700 font-medium"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-gray-200 space-y-1">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Lock
        </button>
        <p className="text-xs text-gray-400 px-2">Local • Encrypted • Private</p>
      </div>
    </aside>
  );
}
