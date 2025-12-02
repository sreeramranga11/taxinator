"use client";

import React, { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Download, Upload, Wand2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type VendorTemplate = { vendor_key: string; display_name: string; version: string; format: string };
type AIResponse = { status: string; vendor_target?: string | null; translation: string; notes?: string[] };
type SamplePayload = { tax_year: number; vendor_source: string; vendor_target: string; cost_basis: unknown[]; personal_info: unknown[] };

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000/api").replace(/\/$/, "");
const buildUrl = (path: string) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
const DEFAULT_ROLE = "broker_admin";

export default function TammyPage() {
  const [templates, setTemplates] = useState<VendorTemplate[]>([]);
  const [vendorTarget, setVendorTarget] = useState("fis");
  const [aiInput, setAiInput] = useState("");
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiFileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchJson = async <T,>(path: string, role: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(buildUrl(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-User-Role": role,
        ...(options?.headers || {}),
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as T;
  };

  useEffect(() => {
    fetchJson<VendorTemplate[]>("/templates", DEFAULT_ROLE)
      .then((data) => {
        setTemplates(data);
        setVendorTarget(data[0]?.vendor_key ?? "fis");
      })
      .catch(() => setTemplates([]));

    fetchJson<{ payload: SamplePayload }>("/playbooks/sample-ingestion", DEFAULT_ROLE)
      .then((payload) => {
        setAiInput(
          [
            `Vendor target: ${payload.payload.vendor_target}`,
            "Cost basis sample:",
            JSON.stringify(payload.payload.cost_basis, null, 2),
            "Personal info sample:",
            JSON.stringify(payload.payload.personal_info, null, 2),
          ].join("\n")
        );
      })
      .catch(() => setAiInput(""));
  }, []);

  const handleAiTranslate = async () => {
    setError(null);
    setAiResult(null);
    setAiLoading(true);
    try {
      const result = await fetchJson<AIResponse>("/ai/translate", DEFAULT_ROLE, {
        method: "POST",
        body: JSON.stringify({
          input_text: aiInput || "Translate this payload",
          vendor_target: vendorTarget,
          include_checks: false,
        }),
      });
      setAiResult(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      setAiInput(text);
    } catch {
      setError("Unable to read file.");
    } finally {
      event.target.value = "";
    }
  };

  const handleDownloadAi = () => {
    if (!aiResult?.translation) return;
    const blob = new Blob([aiResult.translation], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tammy-translation.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.vendor_key === vendorTarget) ?? templates[0],
    [templates, vendorTarget]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 text-slate-900">
      <header className="border-b border-emerald-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Tammy</p>
              <p className="text-sm text-slate-600">AI translator</p>
            </div>
          </div>
          <Link
            href="/manual"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Manual flow
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <div className="rounded-3xl bg-white p-6 shadow-md border border-emerald-100">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-emerald-700">Tammy</p>
              <h1 className="text-3xl font-bold text-slate-900">AI-powered translation</h1>
              <p className="text-sm text-slate-700">
                Paste or upload any payload—Tammy drafts a vendor-ready translation for your selected target.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="bg-white text-slate-800 hover:bg-emerald-50" onClick={() => setAiInput("")}>
                Clear
              </Button>
              <Button onClick={handleAiTranslate} disabled={aiLoading}>
                <Wand2 className="mr-2 h-4 w-4" />
                {aiLoading ? "Thinking..." : "Use Tammy"}
              </Button>
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    ref={aiFileInputRef}
                    type="file"
                    accept=".json,text/plain,application/json"
                    className="hidden"
                    onChange={handleAiFileUpload}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white text-slate-800 hover:bg-emerald-50"
                    onClick={() => aiFileInputRef.current?.click()}
                    disabled={aiLoading}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload file
                  </Button>
                  <span className="text-sm text-slate-700">Vendor</span>
                  <select
                    value={vendorTarget}
                    onChange={(e) => setVendorTarget(e.target.value)}
                    className="h-10 rounded-md border border-emerald-200 bg-white px-3 text-sm"
                  >
                    {templates.map((template) => (
                      <option key={template.vendor_key} value={template.vendor_key}>
                        {template.display_name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-sm font-semibold text-emerald-800">Input</p>
              </div>
              <Textarea
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                rows={12}
                className="rounded-2xl border-emerald-200 bg-emerald-50/60"
                placeholder="Paste payload, mapping notes, or freeform instructions..."
              />
              {selectedTemplate && (
                <p className="text-xs text-emerald-700">
                  Target: {selectedTemplate.display_name} ({selectedTemplate.format.toUpperCase()}) · Required:{" "}
                  {selectedTemplate.required_fields.join(", ")}
                </p>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-emerald-800">Tammy output</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white text-slate-800 hover:bg-emerald-50"
                  onClick={handleDownloadAi}
                  disabled={!aiResult?.translation}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-slate-900 text-emerald-50 p-4 min-h-[260px]">
                {aiResult?.translation ? (
                  <pre className="whitespace-pre-wrap break-words text-sm">{aiResult.translation}</pre>
                ) : (
                  <p className="text-sm text-emerald-100">AI results will appear here.</p>
                )}
              </div>
              {aiResult?.notes?.length ? (
                <ul className="text-xs text-slate-700">
                  {aiResult.notes.map((note) => (
                    <li key={note}>• {note}</li>
                  ))}
                </ul>
              ) : null}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
