"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type Health = { service: string; version: string; environment: string; contact: string; status: string };
type VendorTemplate = { vendor_key: string; display_name: string; version: string; format: string; required_fields: string[]; mapping_notes: string[] };
type ValidationIssue = { code: string; message: string; severity: string; transaction_id?: string };
type ValidationReport = { errors: ValidationIssue[]; warnings: ValidationIssue[]; suggested_fixes: string[] };
type IngestionResponse = {
  job_id: string;
  ingestion_summary: { total_rows: number; missing_fields: string[]; unexpected_fields: string[] };
  summary: { total_transactions: number };
  validation: ValidationReport;
  normalized: unknown[];
};
type JobRecord = {
  job_id: string;
  tax_year: number;
  vendor_source: string;
  vendor_target: string;
  status: string;
  warnings: ValidationIssue[];
  validation_report?: ValidationReport;
  reconciliation?: { mismatched_accounts: string[]; gain_loss_alignment: boolean };
  export_report?: { download_url: string; webhook_event: string };
};
type TranslationResponse = { payload: { vendor_key: string; records: unknown[]; human_readable?: string }; status: string };
type ExportResponse = { download_url: string; webhook_event: string };
type SamplePayload = { tax_year: number; vendor_source: string; vendor_target: string; cost_basis: unknown[]; personal_info: unknown[] };

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000/api").replace(/\/$/, "");
const buildUrl = (path: string) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
const DEFAULT_ROLE = "broker_admin";

export default function ManualPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [templates, setTemplates] = useState<VendorTemplate[]>([]);
  const [costBasisEditor, setCostBasisEditor] = useState("");
  const [personalInfoEditor, setPersonalInfoEditor] = useState("");
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [currentJobId, setCurrentJobId] = useState("");
  const [currentJob, setCurrentJob] = useState<JobRecord | null>(null);
  const [ingestionResult, setIngestionResult] = useState<IngestionResponse | null>(null);
  const [translation, setTranslation] = useState<TranslationResponse | null>(null);
  const [exportReport, setExportReport] = useState<ExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taxYear, setTaxYear] = useState(2024);
  const [vendorSource, setVendorSource] = useState("demo_cost_basis_vendor");
  const [vendorTarget, setVendorTarget] = useState("fis");

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
    fetchJson<Health>("/health", DEFAULT_ROLE).then(setHealth).catch(() => setHealth(null));
    fetchJson<VendorTemplate[]>("/templates", DEFAULT_ROLE)
      .then((data) => {
        setTemplates(data);
        setVendorTarget(data[0]?.vendor_key ?? "fis");
      })
      .catch(() => setTemplates([]));
    fetchJson<{ payload: SamplePayload }>("/playbooks/sample-ingestion", DEFAULT_ROLE)
      .then((payload) => {
        setTaxYear(payload.payload.tax_year);
        setVendorSource(payload.payload.vendor_source);
        setVendorTarget(payload.payload.vendor_target);
        setCostBasisEditor(JSON.stringify(payload.payload.cost_basis, null, 2));
        setPersonalInfoEditor(JSON.stringify(payload.payload.personal_info, null, 2));
      })
      .catch(() => undefined);
  }, []);

  const refreshJobs = React.useCallback(() => {
    fetchJson<JobRecord[]>("/jobs", DEFAULT_ROLE)
      .then((records) => {
        setJobs(records);
        if (currentJobId) {
          const match = records.find((job) => job.job_id === currentJobId);
          if (match) setCurrentJob(match);
        }
      })
      .catch(() => setJobs([]));
  }, [currentJobId]);

  const startJob = async () => {
    setError(null);
    setTranslation(null);
    setExportReport(null);
    setIngestionResult(null);
    try {
      const result = await fetchJson<{ job_id: string }>("/jobs/start", DEFAULT_ROLE, {
        method: "POST",
        body: JSON.stringify({
          tax_year: taxYear,
          vendor_source: vendorSource,
          vendor_target: vendorTarget,
          started_by: DEFAULT_ROLE,
        }),
      });
      setCurrentJobId(result.job_id);
      setCurrentJob(null);
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const uploadPersonalInfo = async () => {
    if (!currentJobId) return;
    setError(null);
    try {
      const records = JSON.parse(personalInfoEditor || "[]");
      await fetchJson(`/ingest/personal-info`, DEFAULT_ROLE, { method: "POST", body: JSON.stringify({ job_id: currentJobId, records }) });
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const uploadCostBasis = async () => {
    if (!currentJobId) return;
    setError(null);
    try {
      const records = JSON.parse(costBasisEditor || "[]");
      const result = await fetchJson<IngestionResponse>("/ingest/costbasis", DEFAULT_ROLE, {
        method: "POST",
        body: JSON.stringify({ job_id: currentJobId, records }),
      });
      setIngestionResult(result);
      await fetchJob(currentJobId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const fetchJob = React.useCallback(async (jobId: string) => {
    try {
      const record = await fetchJson<JobRecord>(`/jobs/${jobId}`, DEFAULT_ROLE);
      setCurrentJob(record);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const handleTransform = async () => {
    if (!currentJobId) return;
    setError(null);
    try {
      const result = await fetchJson<TranslationResponse>(`/jobs/${currentJobId}/transform`, DEFAULT_ROLE, {
        method: "POST",
        body: JSON.stringify({ vendor_key: vendorTarget, include_normalized: true }),
      });
      setTranslation(result);
      await fetchJob(currentJobId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleReconcile = async () => {
    if (!currentJobId) return;
    setError(null);
    try {
      await fetchJson(`/jobs/${currentJobId}/reconcile`, DEFAULT_ROLE, { method: "POST" });
      await fetchJob(currentJobId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleExport = async () => {
    if (!currentJobId) return;
    setError(null);
    try {
      const result = await fetchJson<ExportResponse>(`/jobs/${currentJobId}/export`, DEFAULT_ROLE, { method: "POST" });
      setExportReport(result);
      await fetchJob(currentJobId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.vendor_key === vendorTarget) ?? templates[0],
    [templates, vendorTarget]
  );
  const totalWarnings = jobs.reduce((acc, job) => acc + job.warnings.length, 0);

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
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Manual</p>
              <p className="text-sm text-slate-600">Hands-on pipeline</p>
            </div>
          </div>
          <Link
            href="/tammy"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Use Tammy
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <section className="rounded-3xl bg-white p-6 shadow-md border border-emerald-100">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-emerald-700">Manual flow</p>
              <h1 className="text-3xl font-bold text-slate-900">Control the pipeline</h1>
              <p className="text-sm text-slate-700">
                Create jobs, upload PII and cost basis, transform, reconcile, and export vendor-ready payloads.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                className="bg-white text-slate-800 hover:bg-emerald-50"
                onClick={refreshJobs}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button onClick={startJob}>Start new job</Button>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Service</p>
              <p className="text-xl font-semibold">{health ? "Healthy" : "Offline"}</p>
              <p className="text-sm text-slate-700">{health?.service ?? "Awaiting backend"}</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Templates</p>
              <p className="text-xl font-semibold">{templates.length || "–"}</p>
              <p className="text-sm text-slate-700">Vendor payload definitions ready.</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Jobs</p>
              <p className="text-xl font-semibold">{jobs.length}</p>
              <p className="text-sm text-slate-700">Warnings: {totalWarnings}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-800">Tax year</span>
              <Input
                type="number"
                value={taxYear}
                onChange={(e) => setTaxYear(parseInt(e.target.value, 10))}
                className="bg-white text-slate-900 border-emerald-200"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-800">Vendor source</span>
              <Input
                value={vendorSource}
                onChange={(e) => setVendorSource(e.target.value)}
                className="bg-white text-slate-900 border-emerald-200"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-800">Vendor target</span>
              <select
                value={vendorTarget}
                onChange={(e) => setVendorTarget(e.target.value)}
                className="h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900"
              >
                {templates.map((template) => (
                  <option key={template.vendor_key} value={template.vendor_key}>
                    {template.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {currentJobId && <p className="mt-2 text-sm text-emerald-700">Current job: {currentJobId}</p>}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Upload datasets</h2>
                <p className="text-sm text-slate-700">Cost basis, personal info, and optional trades.</p>
              </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="bg-white text-slate-800 hover:bg-emerald-50 disabled:bg-emerald-100 disabled:text-emerald-400 disabled:border-emerald-200"
                    onClick={uploadPersonalInfo}
                    disabled={!currentJobId}
                  >
                    Upload PII
                  </Button>
                  <Button
                    className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-200 disabled:text-emerald-600"
                    onClick={uploadCostBasis}
                    disabled={!currentJobId}
                  >
                    Ingest cost basis
                  </Button>
                </div>
              </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Personal info (PII)</p>
                  <Textarea
                    rows={8}
                    value={personalInfoEditor}
                    onChange={(e) => setPersonalInfoEditor(e.target.value)}
                    className="rounded-2xl bg-white text-slate-900"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Cost basis / trades</p>
                  <Textarea
                    rows={8}
                    value={costBasisEditor}
                    onChange={(e) => setCostBasisEditor(e.target.value)}
                    className="rounded-2xl bg-white text-slate-900"
                  />
                </div>
              </div>
            {ingestionResult && (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800">
                Job {ingestionResult.job_id} ingested {ingestionResult.ingestion_summary.total_rows} row(s). Missing:{" "}
                {ingestionResult.ingestion_summary.missing_fields.join(", ") || "none"}.
              </div>
            )}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>

          <div className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-md">
            <h2 className="text-xl font-semibold text-slate-900">Templates & required fields</h2>
            {selectedTemplate ? (
              <div className="mt-3 space-y-2 text-sm text-slate-800">
                <p className="font-semibold">
                  {selectedTemplate.display_name} · {selectedTemplate.format.toUpperCase()}
                </p>
                <p>Required: {selectedTemplate.required_fields.join(", ")}</p>
                <ul className="list-disc pl-5 text-slate-700">
                  {selectedTemplate.mapping_notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-slate-700">No templates returned; check backend.</p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-md">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Transform, reconcile, export</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="bg-white text-slate-800 hover:bg-emerald-50 disabled:bg-emerald-100 disabled:text-emerald-400 disabled:border-emerald-200"
                onClick={handleTransform}
                disabled={!currentJobId}
              >
                Transform
              </Button>
              <Button
                variant="outline"
                className="bg-white text-slate-800 hover:bg-emerald-50 disabled:bg-emerald-100 disabled:text-emerald-400 disabled:border-emerald-200"
                onClick={handleReconcile}
                disabled={!currentJobId}
              >
                Reconcile
              </Button>
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-200 disabled:text-emerald-600"
                onClick={handleExport}
                disabled={!currentJobId}
              >
                Export
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {currentJob?.validation_report && (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <h3 className="text-sm font-semibold text-emerald-800">Validation</h3>
                {currentJob.validation_report.errors.length === 0 ? (
                  <p className="text-sm text-slate-700">No blocking errors.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-red-700">
                    {currentJob.validation_report.errors.map((issue) => (
                      <li key={`${issue.code}-${issue.transaction_id ?? "all"}`}>
                        <strong>{issue.code}</strong>: {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                {currentJob.validation_report.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-amber-800">
                    {currentJob.validation_report.warnings.map((issue) => (
                      <li key={`${issue.code}-${issue.transaction_id ?? "warn"}`}>
                        <strong>{issue.code}</strong>: {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {translation && (
              <div className="rounded-2xl border border-emerald-100 bg-slate-900 text-emerald-50 p-4">
                <h3 className="text-sm font-semibold text-emerald-200">Transformation output</h3>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(translation.payload, null, 2)}
                </pre>
              </div>
            )}

            {currentJob?.reconciliation && (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <h3 className="text-sm font-semibold text-emerald-800">Reconciliation</h3>
                <p className="text-sm text-slate-700">
                  Mismatches: {currentJob.reconciliation.mismatched_accounts.join(", ") || "none"}
                </p>
                <p className="text-sm text-slate-700">
                  Gain/loss alignment: {currentJob.reconciliation.gain_loss_alignment ? "yes" : "no"}
                </p>
              </div>
            )}

            {exportReport && (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <h3 className="text-sm font-semibold text-emerald-800">Export</h3>
                <p className="text-sm text-slate-700">Download: {exportReport.download_url}</p>
                <p className="text-sm text-slate-700">Webhook: {exportReport.webhook_event}</p>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Jobs & statuses</h2>
                <p className="text-sm text-slate-700">Click a job to load details.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white text-slate-800 hover:bg-emerald-50"
                onClick={refreshJobs}
              >
                Refresh
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {jobs.length === 0 ? (
                <p className="text-sm text-slate-700">No ingestions yet.</p>
              ) : (
                jobs.map((job) => (
                  <button
                    key={job.job_id}
                    className={`w-full text-left rounded-2xl border p-3 transition ${
                      currentJobId === job.job_id ? "border-emerald-400 bg-emerald-50" : "border-emerald-100 bg-white"
                    }`}
                    onClick={() => {
                      setCurrentJobId(job.job_id);
                      fetchJob(job.job_id);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">
                          {job.vendor_source} → {job.vendor_target}
                        </p>
                        <p className="text-sm font-semibold">{job.job_id}</p>
                        <p className="text-xs text-slate-600">Tax year {job.tax_year}</p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                        {job.status}
                      </span>
                    </div>
                    {job.warnings.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-amber-800">
                        {job.warnings.map((warning) => (
                          <li key={`${job.job_id}-${warning.code}`}>
                            <strong>{warning.code}</strong>: {warning.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-md">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Health & metadata</h2>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {health ? "Online" : "Idle"}
              </span>
            </div>
            {health ? (
              <ul className="mt-3 space-y-1 text-sm text-slate-700">
                <li>
                  <strong>Service:</strong> {health.service} ({health.version})
                </li>
                <li>
                  <strong>Environment:</strong> {health.environment}
                </li>
                <li>
                  <strong>Contact:</strong> {health.contact}
                </li>
              </ul>
            ) : (
              <p className="text-sm text-slate-700">Unable to reach backend. Ensure `uvicorn` is running.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
