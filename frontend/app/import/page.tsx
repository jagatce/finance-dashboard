"use client";
import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/auth";
import { RefreshCw, CheckCircle, AlertCircle, ChevronDown, ChevronUp, FolderOpen } from "lucide-react";

type FileStatus = "new" | "imported" | "unknown_folder";

interface ScannedFile {
  path: string;
  filename: string;
  folder_name: string;
  account_id: number | null;
  account_name: string | null;
  file_hash: string;
  status: FileStatus;
  batch_id: string | null;
  import_type: "spending" | "holdings";
  size_bytes: number;
  modified_at: string;
}

interface ScanResult {
  data_root: string;
  folders_exist: boolean;
  spending: ScannedFile[];
  holdings: ScannedFile[];
  summary: Record<string, number>;
}

interface ImportResult {
  path: string;
  ok: boolean;
  batch_id?: string;
  rows_imported?: number;
  errors?: string[];
  error?: string;
}

const fmtBytes = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
const fmtDate  = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtNum   = (n: number) => new Intl.NumberFormat().format(n);

function StatusPill({ status }: { status: FileStatus }) {
  if (status === "new")
    return <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">New</span>;
  if (status === "imported")
    return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Imported</span>;
  return <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Unknown folder</span>;
}

function Section({
  title, files, selected, onToggle, onSelectAll, onReimport,
}: {
  title: string;
  files: ScannedFile[];
  selected: Set<string>;
  onToggle: (p: string) => void;
  onSelectAll: (paths: string[], checked: boolean) => void;
  onReimport: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const newFiles = files.filter(f => f.status === "new");
  const allNewSelected = newFiles.length > 0 && newFiles.every(f => selected.has(f.path));

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-left"
      >
        <div className="flex items-center gap-3">
          <FolderOpen size={15} className="text-gray-400" />
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-gray-400">{files.length} files</span>
          {newFiles.length > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {newFiles.length} new
            </span>
          )}
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div>
          {files.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No files found in any folder</p>
          ) : (
            <>
              {newFiles.length > 0 && (
                <label className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input
                    type="checkbox"
                    checked={allNewSelected}
                    onChange={e => onSelectAll(newFiles.map(f => f.path), e.target.checked)}
                    className="rounded"
                  />
                  Select all new
                </label>
              )}
              {files.map(f => (
                <div key={f.path} className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    onChange={() => onToggle(f.path)}
                    disabled={f.status === "unknown_folder"}
                    className="rounded shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono truncate">{f.filename}</span>
                      <StatusPill status={f.status} />
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                      <span className="font-mono">{f.folder_name}/</span>
                      {f.account_name
                        ? <span className="text-gray-500">→ {f.account_name}</span>
                        : <span className="text-amber-500">no matching account</span>}
                      <span>{fmtBytes(f.size_bytes)}</span>
                      <span>{fmtDate(f.modified_at)}</span>
                      {f.batch_id && <span className="text-gray-300 dark:text-gray-600">batch {f.batch_id.slice(0, 8)}</span>}
                    </div>
                  </div>
                  {f.status === "imported" && (
                    <button
                      onClick={() => onReimport(f.path)}
                      className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0 underline whitespace-nowrap"
                    >
                      Re-import
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ImportPage() {
  const [scan, setScan]           = useState<ScanResult | null>(null);
  const [scanning, setScanning]   = useState(false);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults]     = useState<ImportResult[]>([]);

  const doScan = useCallback(async () => {
    setScanning(true);
    setResults([]);
    try {
      const res  = await apiFetch("/api/v1/import/scan");
      const data: ScanResult = await res.json();
      setScan(data);
      const newPaths = [...data.spending, ...data.holdings]
        .filter(f => f.status === "new")
        .map(f => f.path);
      setSelected(new Set(newPaths));
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { doScan(); }, [doScan]);

  const toggle = (path: string) =>
    setSelected(prev => {
      const n = new Set(prev);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });

  const selectAll = (paths: string[], checked: boolean) =>
    setSelected(prev => {
      const n = new Set(prev);
      paths.forEach(p => checked ? n.add(p) : n.delete(p));
      return n;
    });

  const runImport = async (paths: string[], force = false) => {
    if (paths.length === 0) return;
    setImporting(true);
    const allResults: ImportResult[] = [];
    try {
      // Process in batches of 3 to avoid proxy timeout (Claude API calls per file)
      const BATCH = 3;
      for (let i = 0; i < paths.length; i += BATCH) {
        const batch = paths.slice(i, i + BATCH);
        const res = await apiFetch("/api/v1/import/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: batch, force_reimport: force }),
        });
        const data = await res.json();
        allResults.push(...(data.results ?? []));
        setResults([...allResults]);
      }
      await doScan();
    } finally {
      setImporting(false);
    }
  };

  const totalNew     = (scan?.summary.spending_new     ?? 0) + (scan?.summary.holdings_new     ?? 0);
  const totalDone    = (scan?.summary.spending_imported ?? 0) + (scan?.summary.holdings_imported ?? 0);
  const totalUnknown = (scan?.summary.spending_unknown  ?? 0) + (scan?.summary.holdings_unknown  ?? 0);

  return (
    <div className="p-6 max-w-3xl mx-auto">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Import</h1>
          {scan && (
            <p className="text-xs text-gray-400 mt-1 font-mono">{scan.data_root}</p>
          )}
        </div>
        <button
          onClick={doScan}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
          Scan
        </button>
      </div>

      {scan && !scan.folders_exist && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-4 mb-6">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">Data folders not found</p>
          <p className="text-xs text-amber-700 dark:text-amber-300">Run <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">python3 migrate_folder_import.py</code> in the backend directory first.</p>
        </div>
      )}

      {scan && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-2xl font-semibold text-blue-600 dark:text-blue-400">{totalNew}</div>
            <div className="text-xs text-gray-400 mt-1">New files</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-2xl font-semibold text-green-600 dark:text-green-400">{totalDone}</div>
            <div className="text-xs text-gray-400 mt-1">Already imported</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className={`text-2xl font-semibold ${totalUnknown > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}`}>
              {totalUnknown}
            </div>
            <div className="text-xs text-gray-400 mt-1">Unknown folders</div>
          </div>
        </div>
      )}

      {scan && (
        <>
          <Section
            title="Spending & checking"
            files={scan.spending}
            selected={selected}
            onToggle={toggle}
            onSelectAll={selectAll}
            onReimport={path => runImport([path], true)}
          />
          <Section
            title="Holdings"
            files={scan.holdings}
            selected={selected}
            onToggle={toggle}
            onSelectAll={selectAll}
            onReimport={path => runImport([path], true)}
          />
        </>
      )}

      {results.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          {results.map(r => (
            <div key={r.path} className="flex items-start gap-3 px-4 py-3">
              {r.ok
                ? <CheckCircle size={15} className="text-green-500 mt-0.5 shrink-0" />
                : <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className="text-sm font-mono truncate">{r.path.split("/").pop()}</p>
                {r.ok && (
                  <p className="text-xs text-gray-400">
                    {fmtNum(r.rows_imported ?? 0)} rows imported · batch {r.batch_id?.slice(0, 8)}
                  </p>
                )}
                {!r.ok && <p className="text-xs text-red-500">{r.error}</p>}
                {r.errors && r.errors.length > 0 && (
                  <p className="text-xs text-amber-500">{r.errors.slice(0, 2).join(" · ")}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => runImport(Array.from(selected))}
          disabled={selected.size === 0 || importing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          {importing && <RefreshCw size={13} className="animate-spin" />}
          {importing
            ? "Importing…"
            : selected.size > 0
              ? `Import ${selected.size} file${selected.size > 1 ? "s" : ""}`
              : "Import selected"}
        </button>
        {totalNew === 0 && scan && !scanning && (
          <span className="text-sm text-gray-400">
            No new files — drop CSVs into the data folders and scan again
          </span>
        )}
      </div>

    </div>
  );
}
