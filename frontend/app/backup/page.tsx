"use client";
import { useState, useRef } from "react";
import { Download, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { getToken } from "@/lib/auth";

const API = "http://localhost:8000/api/v1";

export default function BackupPage() {
  const [restoreMsg, setRestoreMsg] = useState("");
  const [restoreErr, setRestoreErr] = useState("");
  const [uploading, setUploading]   = useState(false);
  const fileRef                     = useRef<HTMLInputElement>(null);

  async function handleDownload() {
    const token = getToken();
    const res   = await fetch(`${API}/backup/download`, {
      headers: { "x-auth-token": token },
    });
    if (!res.ok) {
      alert("Download failed — make sure backend is running");
      return;
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `finance-backup-${new Date().toISOString().split("T")[0]}.db`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".db")) {
      setRestoreErr("Please select a .db file");
      return;
    }
    const confirmed = window.confirm(
      "This will replace your current database with the backup. Are you sure?"
    );
    if (!confirmed) return;

    setUploading(true);
    setRestoreErr("");
    setRestoreMsg("");

    const form  = new FormData();
    form.append("file", file);
    const token = getToken();
    const res   = await fetch(`${API}/backup/restore`, {
      method: "POST",
      headers: { "x-auth-token": token },
      body: form,
    });

    setUploading(false);

    if (res.ok) {
      setRestoreMsg("Database restored. Restart the backend then refresh the page.");
    } else {
      const data = await res.json().catch(() => ({}));
      setRestoreErr(data.detail ?? "Restore failed");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Backup & Restore</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Keep your data safe and portable across machines.
        </p>
      </div>

      {/* Download */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
            <Download className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Download Backup</h2>
            <p className="text-sm text-gray-500 mt-1">
              Downloads your complete database file. Store it in iCloud,
              Dropbox, or a USB drive. Use this file to restore on any machine.
            </p>
            <button
              onClick={handleDownload}
              className="mt-4 flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download finance.db
            </button>
          </div>
        </div>
      </div>

      {/* Restore */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center shrink-0">
            <Upload className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Restore from Backup</h2>
            <p className="text-sm text-gray-500 mt-1">
              Upload a previously downloaded finance.db file to restore your data.
              Your current database will be replaced.
            </p>
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                This will overwrite your current data. A backup of the current
                database is saved as finance.db.bak on the server before restoring.
              </p>
            </div>
            <label className="mt-4 flex items-center gap-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer w-fit">
              <Upload className="w-4 h-4" />
              {uploading ? "Uploading..." : "Choose backup file"}
              <input
                ref={fileRef}
                type="file"
                accept=".db"
                onChange={handleRestore}
                className="hidden"
                disabled={uploading}
              />
            </label>
            {restoreMsg && (
              <div className="mt-3 flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                {restoreMsg}
              </div>
            )}
            {restoreErr && (
              <p className="mt-3 text-red-500 text-sm">{restoreErr}</p>
            )}
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-3">Moving to a New Machine</h2>
        <ol className="space-y-2 text-sm text-gray-600 list-decimal list-inside">
          <li>Download your backup using the button above</li>
          <li>On the new machine: clone the repo and run bash setup.sh</li>
          <li>Start the backend and frontend</li>
          <li>Go to Backup & Restore and upload your backup file</li>
          <li>Restart the backend then refresh</li>
          <li>All your data is back</li>
        </ol>
      </div>
    </div>
  );
}
