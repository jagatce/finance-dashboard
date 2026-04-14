"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/auth";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";

interface Props { month: string; }

function formatMonth(month: string) {
  const [y, m] = month.split("-");
  return new Date(parseInt(y), parseInt(m) - 1).toLocaleString("default", {
    month: "long", year: "numeric",
  });
}

function renderMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^### (.+)$/gm, "<h3 class='text-base font-semibold text-gray-900 mt-5 mb-1'>$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2 class='text-lg font-semibold text-gray-900 mt-6 mb-2'>$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1 class='text-xl font-bold text-gray-900 mt-6 mb-2'>$1</h1>")
    .replace(/^\d+\.\s(.+)$/gm, "<li class='ml-4 list-decimal text-gray-700'>$1</li>")
    .replace(/^[-•]\s(.+)$/gm,  "<li class='ml-4 list-disc text-gray-700'>$1</li>")
    .replace(/\n\n/g, "</p><p class='text-gray-700 leading-relaxed mt-3'>")
    .replace(/^(?!<)(.+)$/gm, "<p class='text-gray-700 leading-relaxed'>$1</p>");
}

export default function MonthlyReviewTab({ month }: Props) {
  const [review, setReview]     = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { fetchReview(); }, [month]);

  async function fetchReview() {
    setLoading(true);
    try {
      const data = await (await apiFetch(`/api/v1/cashflow/reviews?month=${month}`)).json();
      setReview(data && data.exists ? data.review : null);
    } finally { setLoading(false); }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const data = await (await apiFetch("/api/v1/cashflow/reviews/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      })).json();
      setReview({ notes: data.review, ...data.stats, generated_at: new Date().toISOString() });
    } finally { setGenerating(false); }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{formatMonth(month)} Review</h2>
          {review?.generated_at && (
            <p className="text-xs text-gray-400 mt-0.5">
              Generated {new Date(review.generated_at).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
            : review
            ? <><RefreshCw className="w-4 h-4" /> Regenerate</>
            : <><Sparkles className="w-4 h-4" /> Generate Review</>
          }
        </button>
      </div>

      {/* Stats row — shown if review exists */}
      {review && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Income",       value: review.total_income   != null ? `$${Number(review.total_income).toLocaleString()}`   : "—", color: "text-green-600"  },
            { label: "Spending",     value: review.total_expenses != null ? `$${Number(review.total_expenses).toLocaleString()}` : "—", color: "text-red-500"    },
            { label: "Saved",        value: review.savings_amount != null ? `$${Number(review.savings_amount).toLocaleString()}` : "—", color: "text-indigo-600" },
            { label: "Savings Rate", value: review.savings_rate   != null ? `${review.savings_rate}%`                           : "—",
              color: Number(review.savings_rate) >= 20 ? "text-green-600" : Number(review.savings_rate) >= 0 ? "text-yellow-600" : "text-red-500" },
          ].map(c => (
            <div key={c.label} className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className={`text-lg font-semibold mt-0.5 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Review content */}
      {!review && !generating && (
        <div className="text-center py-16 space-y-3">
          <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto">
            <Sparkles className="w-6 h-6 text-indigo-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No review yet for {formatMonth(month)}</p>
          <p className="text-xs text-gray-400 max-w-xs mx-auto">
            Claude will synthesize your cash flow, net worth, holdings, and sensor signals into a monthly summary.
          </p>
        </div>
      )}

      {generating && (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          <p className="text-sm text-gray-500">Synthesizing your financial data…</p>
        </div>
      )}

      {review?.notes && !generating && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(review.notes) }}
          />
        </div>
      )}
    </div>
  );
}
