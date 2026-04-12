"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, Lock, Eye, EyeOff } from "lucide-react";
import { setToken, getToken } from "@/lib/auth";

const API = "http://localhost:8000/api/v1";

export default function LoginPage() {
  const router                      = useRouter();
  const [passphrase, setPassphrase] = useState("");
  const [show, setShow]             = useState(false);
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [checking, setChecking]     = useState(true);

  useEffect(() => {
    async function check() {
      if (getToken()) { router.replace("/"); return; }
      try {
        const res  = await fetch(`${API}/auth/status`);
        const data = await res.json();
        if (!data.requires_auth) {
          const loginRes  = await fetch(`${API}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ passphrase: "" }),
          });
          const loginData = await loginRes.json();
          setToken(loginData.token);
          router.replace("/");
          return;
        }
      } catch {
        setError("Cannot connect to backend. Make sure it is running on port 8000.");
      }
      setChecking(false);
    }
    check();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        setError("Incorrect passphrase. Try again.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setToken(data.token);
      router.replace("/");
    } catch {
      setError("Cannot connect to backend. Make sure it is running.");
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#f9fafb" }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center mb-3">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">FinanceOS</h1>
          <p className="text-sm text-gray-500 mt-1">Your private finance dashboard</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <Lock className="w-4 h-4 text-indigo-500" />
            <h2 className="font-semibold text-gray-900">Enter passphrase</h2>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Your passphrase"
                autoFocus
                className="w-full px-4 py-3 pr-10 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading || !passphrase}
              className="w-full bg-indigo-600 text-white text-sm font-medium py-3 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-40"
            >
              {loading ? "Unlocking..." : "Unlock"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Local • Encrypted • Private
        </p>
      </div>
    </div>
  );
}
