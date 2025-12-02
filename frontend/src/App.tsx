import React, { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import "./styles/global.css";

type Health = {
  service: string;
  version: string;
  environment: string;
  contact: string;
  status: string;
};

type VendorTemplate = {
  vendor_key: string;
  display_name: string;
  version: string;
  format: string;
  required_fields: string[];
  mapping_notes: string[];
};

type ValidationIssue = { code: string; message: string; severity: string; transaction_id?: string };

type ValidationReport = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  suggested_fixes: string[];
};

type IngestionResponse = {
  job_id: string;
  summary: {
    total_transactions: number;
    total_gain_loss: string;
    total_proceeds: string;
    total_cost_basis: string;
    long_term_count: number;
    short_term_count: number;
  };
  ingestion_summary: {
    total_rows: number;
    malformed_rows: number;
    missing_fields: string[];
    unexpected_fields: string[];
    potential_schema_drift: boolean;
  };
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
  ingestion_summary?: IngestionResponse["ingestion_summary"];
  validation_report?: ValidationReport;
  reconciliation?: { mismatched_accounts: string[]; gain_loss_alignment: boolean };
  export_report?: { download_url: string; webhook_event: string };
};

type TranslationResponse = {
  payload: { vendor_key: string; records: unknown[]; human_readable?: string };
  status: string;
};

type ExportResponse = { download_url: string; webhook_event: string };

type SamplePayload = {
  tax_year: number;
  vendor_source: string;
  vendor_target: string;
  cost_basis: unknown[];
  personal_info: unknown[];
};

type AIResponse = {
  status: string;
  vendor_target?: string | null;
  plan: string;
  translation: string;
  checks: string[];
  notes?: string[];
};

const API_BASE = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/$/, "");
const buildUrl = (path: string) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
const DEFAULT_ROLE = "broker_admin";

export function App() {
  const [view, setView] = useState<"home" | "tammy" | "manual">("home");
  const [health, setHealth] = useState<Health | null>(null);
  const [templates, setTemplates] = useState<VendorTemplate[]>([]);
  const [sample, setSample] = useState<SamplePayload | null>(null);
  const [costBasisEditor, setCostBasisEditor] = useState<string>("");
  const [personalInfoEditor, setPersonalInfoEditor] = useState<string>("");
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string>("");
  const [currentJob, setCurrentJob] = useState<JobRecord | null>(null);
  const [ingestionResult, setIngestionResult] = useState<IngestionResponse | null>(null);
  const [translation, setTranslation] = useState<TranslationResponse | null>(null);
  const [exportReport, setExportReport] = useState<ExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taxYear, setTaxYear] = useState(2024);
  const [vendorSource, setVendorSource] = useState("demo_cost_basis_vendor");
  const [vendorTarget, setVendorTarget] = useState("fis");
  const [aiInput, setAiInput] = useState<string>("");
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiFileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchJson = async <T,>(path: string, role: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(buildUrl(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-User-Role": role,
        ...(options?.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
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
        setSample(payload.payload);
        setTaxYear(payload.payload.tax_year);
        setVendorSource(payload.payload.vendor_source);
        setVendorTarget(payload.payload.vendor_target);
        setCostBasisEditor(JSON.stringify(payload.payload.cost_basis, null, 2));
        setPersonalInfoEditor(JSON.stringify(payload.payload.personal_info, null, 2));
        setAiInput(
          [
            `Vendor target: ${payload.payload.vendor_target}`,
            "Cost basis sample:",
            JSON.stringify(payload.payload.cost_basis, null, 2),
            "Personal info sample:",
            JSON.stringify(payload.payload.personal_info, null, 2),
          ].join("\n"),
        );
      })
      .catch(() => setSample(null));
    refreshJobs();
  }, []);

  const refreshJobs = () => {
    fetchJson<JobRecord[]>("/jobs", DEFAULT_ROLE)
      .then((records) => {
        setJobs(records);
        if (currentJobId) {
          const match = records.find((job) => job.job_id === currentJobId);
          if (match) setCurrentJob(match);
        }
      })
      .catch(() => setJobs([]));
  };

  const startJob = async () => {
    setError(null);
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
      setIngestionResult(null);
      setTranslation(null);
      setExportReport(null);
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const uploadPersonalInfo = async () => {
    setError(null);
    try {
      const records = JSON.parse(personalInfoEditor || "[]");
      await fetchJson(`/ingest/personal-info`, DEFAULT_ROLE, {
        method: "POST",
        body: JSON.stringify({ job_id: currentJobId, records }),
      });
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const uploadCostBasis = async () => {
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

  const fetchJob = async (jobId: string) => {
    try {
      const record = await fetchJson<JobRecord>(`/jobs/${jobId}`, "internal_ops");
      setCurrentJob(record);
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleTransform = async () => {
    if (!currentJobId) return;
    setError(null);
    try {
      const result = await fetchJson<TranslationResponse>(
        `/jobs/${currentJobId}/transform`,
        DEFAULT_ROLE,
        {
          method: "POST",
          body: JSON.stringify({ vendor_key: vendorTarget, include_normalized: true }),
        }
      );
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
      const result = await fetchJson<ExportResponse>(`/jobs/${currentJobId}/export`, DEFAULT_ROLE, {
        method: "POST",
      });
      setExportReport(result);
      await fetchJob(currentJobId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAiTranslate = async () => {
    setError(null);
    setAiResult(null);
    setAiLoading(true);
    try {
      const attachments: Record<string, unknown> = {};
      try {
        attachments.cost_basis = JSON.parse(costBasisEditor || "[]");
      } catch {
        // ignore
      }
      try {
        attachments.personal_info = JSON.parse(personalInfoEditor || "[]");
      } catch {
        // ignore
      }
      const result = await fetchJson<AIResponse>("/ai/translate", DEFAULT_ROLE, {
        method: "POST",
        body: JSON.stringify({
          input_text: aiInput || "Translate current editors and validate for downstream tax engine.",
          vendor_target: vendorTarget,
          include_checks: true,
          attachments,
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
    } catch (err) {
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
    link.download = "ai-translation.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalWarnings = jobs.reduce((acc, job) => acc + job.warnings.length, 0);
  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.vendor_key === vendorTarget) ?? templates[0],
    [templates, vendorTarget]
  );

  return (
    <div className="page">
      <aside className="sidebar">
        <div className="identity-card">
          <div className="avatar">T</div>
          <div>
            <p className="eyebrow">Tax processor</p>
            <h2>Taxinator</h2>
            <p className="muted">Middleware between cost-basis vendors and downstream tax engines.</p>
          </div>
        </div>

        <nav className="nav">
          <p className="nav-label">Navigation</p>
          <ul className="module-list">
            <li>
              <button className="link-btn" onClick={() => setView("home")}>Home</button>
            </li>
            <li>
              <button className="link-btn" onClick={() => setView("tammy")}>Use Tammy (AI)</button>
            </li>
            <li>
              <button className="link-btn" onClick={() => setView("manual")}>Manual translation</button>
            </li>
          </ul>
        </nav>

        <div className="card subtle">
          <p className="eyebrow">Status</p>
          <div className="status-row">
            <span className={`status-dot ${health ? "on" : "off"}`} />
            <div>
              <strong>{health ? "Online" : "Idle"}</strong>
              <p className="muted">{health?.environment ?? "Awaiting connection"}</p>
            </div>
          </div>
          <p className="muted small">Role headers applied automatically.</p>
        </div>
      </aside>

      <main className="content">
        {view === "home" && (
          <>
            <header className="hero">
              <div>
                <p className="eyebrow">Middleware for tax reporting</p>
                <h1>Choose your path</h1>
                <p className="muted">
                  Use Tammy for AI-assisted translations or continue with the manual ingest → transform → export pipeline.
                </p>
              </div>
            </header>
            <section className="two-column">
              <div className="card gradient">
                <h2>Use Tammy (AI)</h2>
                <p className="muted">Paste or upload any payload and let Tammy draft a vendor-ready translation.</p>
                <button className="btn primary" onClick={() => setView("tammy")}>Launch Tammy</button>
              </div>
              <div className="card">
                <h2>Manual translation</h2>
                <p className="muted">Create jobs, upload datasets, transform, reconcile, and export yourself.</p>
                <button className="btn" onClick={() => setView("manual")}>Go manual</button>
              </div>
            </section>
          </>
        )}

        {view === "tammy" && (
          <>
            <header className="hero">
              <div>
                <p className="eyebrow">Tammy · AI translator</p>
                <h1>AI-powered translation</h1>
                <p className="muted">
                  Paste or upload any payload and Tammy will draft a vendor-ready translation for your selected target.
                </p>
              </div>
              <div className="hero-meta">
                <button className="btn" onClick={() => setView("manual")}>Manual flow</button>
              </div>
            </header>

            <section className="panel highlight">
              <div className="panel-heading">
                <div>
                  <h2>Use Tammy</h2>
                  <p className="muted">Upload or paste; Tammy returns a clean translation only.</p>
                </div>
                <div className="panel-actions">
                  <input
                    ref={aiFileInputRef}
                    type="file"
                    accept=".json,text/plain,application/json"
                    style={{ display: "none" }}
                    onChange={handleAiFileUpload}
                  />
                  <button className="btn" onClick={() => aiFileInputRef.current?.click()} disabled={aiLoading}>
                    Upload file
                  </button>
                  <label className="select">
                    <span>Vendor target</span>
                    <select value={vendorTarget} onChange={(e) => setVendorTarget(e.target.value)}>
                      {templates.map((template) => (
                        <option key={template.vendor_key} value={template.vendor_key}>
                          {template.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn primary" onClick={handleAiTranslate} disabled={aiLoading}>
                    {aiLoading ? "Thinking..." : "AI translate"}
                  </button>
                  <button className="btn" onClick={handleDownloadAi} disabled={!aiResult?.translation}>
                    Download
                  </button>
                </div>
              </div>
              <div className="editor-grid">
                <div>
                  <p className="eyebrow">Input (paste text or JSON)</p>
                  <textarea
                    className="editor"
                    rows={10}
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder="Paste payload, mapping notes, or freeform instructions..."
                  />
                </div>
                <div>
                  <p className="eyebrow">Tammy output</p>
                  {aiResult ? (
                    <div className="ai-output">
                      <pre className="code-block">{aiResult.translation}</pre>
                    </div>
                  ) : (
                    <p className="muted">AI results will appear here.</p>
                  )}
                </div>
              </div>
              {aiResult?.notes?.length ? <p className="muted small">Notes: {aiResult.notes.join(" | ")}</p> : null}
              {error && <p className="error">{error}</p>}
            </section>
          </>
        )}

        {view === "manual" && (
          <>
            <header className="hero">
              <div>
                <p className="eyebrow">Manual translation</p>
                <h1>Control the pipeline</h1>
                <p className="muted">
                  Create jobs, upload datasets, transform, reconcile, and export vendor-ready payloads.
                </p>
              </div>
              <div className="hero-meta">
                <button className="btn" onClick={() => setView("tammy")}>Use Tammy instead</button>
              </div>
            </header>

            <section className="stat-grid">
              <div className="card gradient">
                <p className="eyebrow">Service</p>
                <h3>{health ? "Healthy" : "Offline"}</h3>
                <p className="muted">{health?.service ?? "Awaiting backend"}</p>
              </div>
              <div className="card">
                <p className="eyebrow">Templates</p>
                <h3>{templates.length || "–"}</h3>
                <p className="muted">Vendor payload definitions ready to translate.</p>
              </div>
              <div className="card">
                <p className="eyebrow">Jobs</p>
                <h3>{jobs.length}</h3>
                <p className="muted">In-flight ingestions this session.</p>
              </div>
              <div className="card">
                <p className="eyebrow">Warnings</p>
                <h3>{totalWarnings}</h3>
                <p className="muted">Data quality flags from validation.</p>
              </div>
            </section>

            <section className="panel highlight">
              <div className="panel-heading">
                <div>
                  <h2>Start a job</h2>
                  <p className="muted">Select tax year, vendor source, and downstream engine target.</p>
                </div>
                <button className="btn primary" onClick={startJob}>Start new job</button>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Tax year</span>
                  <input type="number" value={taxYear} onChange={(e) => setTaxYear(parseInt(e.target.value, 10))} />
                </label>
                <label className="field">
                  <span>Vendor source</span>
                  <input value={vendorSource} onChange={(e) => setVendorSource(e.target.value)} />
                </label>
                <label className="field">
                  <span>Vendor target</span>
                  <select value={vendorTarget} onChange={(e) => setVendorTarget(e.target.value)}>
                    {templates.map((template) => (
                      <option key={template.vendor_key} value={template.vendor_key}>
                        {template.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {currentJobId && <div className="callout">Job {currentJobId} created. Upload datasets to continue.</div>}
            </section>

            <div className="two-column">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Upload datasets</h2>
                    <p className="muted">Cost basis, personal info, and optional trades follow the same ingestion path.</p>
                  </div>
                  <div className="panel-actions">
                    <button className="btn" onClick={uploadPersonalInfo} disabled={!currentJobId}>Upload PII</button>
                    <button className="btn primary" onClick={uploadCostBasis} disabled={!currentJobId}>Ingest cost basis</button>
                  </div>
                </div>
                <div className="editor-grid">
                  <div>
                    <p className="eyebrow">Personal info (PII)</p>
                    <textarea
                      className="editor"
                      rows={8}
                      value={personalInfoEditor}
                      onChange={(e) => setPersonalInfoEditor(e.target.value)}
                    />
                  </div>
                  <div>
                    <p className="eyebrow">Cost basis / trades</p>
                    <textarea
                      className="editor"
                      rows={8}
                      value={costBasisEditor}
                      onChange={(e) => setCostBasisEditor(e.target.value)}
                    />
                  </div>
                </div>
                {ingestionResult && (
                  <div className="callout">
                    <strong>Job {ingestionResult.job_id}</strong> ingested {ingestionResult.ingestion_summary.total_rows} row(s). Missing:{" "}
                    {ingestionResult.ingestion_summary.missing_fields.join(", ") || "none"}.
                  </div>
                )}
                {error && <p className="error">{error}</p>}
              </section>

              <section className="panel minimal">
                <div className="panel-heading">
                  <div>
                    <h2>Templates & required fields</h2>
                    <p className="muted">Vendor inputs expected for the selected target.</p>
                  </div>
                </div>
                {selectedTemplate ? (
                  <div className="template">
                    <div className="template-heading">
                      <h3>{selectedTemplate.display_name}</h3>
                      <span className="badge">{selectedTemplate.version}</span>
                    </div>
                    <p className="muted">Format: {selectedTemplate.format.toUpperCase()}</p>
                    <p className="muted">Required: {selectedTemplate.required_fields.join(", ")}</p>
                    <ul className="notes">
                      {selectedTemplate.mapping_notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="muted">No templates returned; check backend.</p>
                )}
              </section>
            </div>

            {translation && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Transformation output</h2>
                    <p className="muted">Rendered payload from the vendor target.</p>
                  </div>
                  <span className="badge success">{translation.payload.vendor_key}</span>
                </div>
                <pre className="code-block">{JSON.stringify(translation.payload, null, 2)}</pre>
              </section>
            )}

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Reconcile & export</h2>
                  <p className="muted">Run reconciliation, then export a vendor-ready payload.</p>
                </div>
                <div className="panel-actions">
                  <button className="btn" onClick={handleReconcile} disabled={!currentJobId}>Reconcile</button>
                  <button className="btn primary" onClick={handleExport} disabled={!currentJobId}>Export & emit webhook</button>
                </div>
              </div>
              {exportReport && (
                <div className="callout">
                  <strong>Export ready</strong> – {exportReport.download_url} ({exportReport.webhook_event})
                </div>
              )}
              {error && <p className="error">{error}</p>}
            </section>

            <div className="two-column">
              <section className="panel minimal">
                <div className="panel-heading">
                  <div>
                    <h2>Jobs & statuses</h2>
                    <p className="muted">Broker admins, internal ops, and API clients share visibility.</p>
                  </div>
                  <button className="btn" onClick={refreshJobs}>Refresh</button>
                </div>
                {jobs.length === 0 ? (
                  <p className="muted">No ingestions yet. Submit a payload to see normalized jobs.</p>
                ) : (
                  <div className="jobs">
                    {jobs.map((job) => (
                      <article
                        key={job.job_id}
                        className={`job-card ${currentJobId === job.job_id ? "active" : ""}`}
                        onClick={() => {
                          setCurrentJobId(job.job_id);
                          fetchJob(job.job_id);
                        }}
                      >
                        <div className="job-heading">
                          <div>
                            <p className="eyebrow">
                              {job.vendor_source} → {job.vendor_target}
                            </p>
                            <h3>{job.job_id}</h3>
                            <p className="muted">Tax year {job.tax_year}</p>
                          </div>
                          <span className="badge success">{job.status}</span>
                        </div>
                        {job.warnings.length > 0 && (
                          <ul className="warning-list">
                            {job.warnings.map((warning) => (
                              <li key={`${job.job_id}-${warning.code}`}>
                                <strong>{warning.code}</strong>: {warning.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel subtle">
                <div className="panel-heading">
                  <h2>Health & metadata</h2>
                  {health ? <span className="badge success">Online</span> : <span className="badge">Idle</span>}
                </div>
                {health ? (
                  <ul className="meta-list">
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
                  <p className="muted">Unable to reach backend. Ensure `uvicorn` is running.</p>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
