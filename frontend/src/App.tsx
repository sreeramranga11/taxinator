import { useEffect, useMemo, useState } from "react";
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

export function App() {
  const [activeRole, setActiveRole] = useState("broker_admin");
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

  const fetchJson = async <T,>(path: string, role: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(path, {
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
    fetchJson<Health>("/api/health", "broker_admin").then(setHealth).catch(() => setHealth(null));
    fetchJson<VendorTemplate[]>("/api/templates", "broker_admin")
      .then((data) => {
        setTemplates(data);
        setVendorTarget(data[0]?.vendor_key ?? "fis");
      })
      .catch(() => setTemplates([]));
    fetchJson<{ payload: SamplePayload }>("/api/playbooks/sample-ingestion", "broker_admin")
      .then((payload) => {
        setSample(payload.payload);
        setTaxYear(payload.payload.tax_year);
        setVendorSource(payload.payload.vendor_source);
        setVendorTarget(payload.payload.vendor_target);
        setCostBasisEditor(JSON.stringify(payload.payload.cost_basis, null, 2));
        setPersonalInfoEditor(JSON.stringify(payload.payload.personal_info, null, 2));
      })
      .catch(() => setSample(null));
    refreshJobs();
  }, []);

  const refreshJobs = () => {
    fetchJson<JobRecord[]>("/api/jobs", "internal_ops")
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
      const result = await fetchJson<{ job_id: string }>("/api/jobs/start", activeRole, {
        method: "POST",
        body: JSON.stringify({
          tax_year: taxYear,
          vendor_source: vendorSource,
          vendor_target: vendorTarget,
          started_by: activeRole,
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
      await fetchJson(`/api/ingest/personal-info`, activeRole, {
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
      const result = await fetchJson<IngestionResponse>("/api/ingest/costbasis", activeRole, {
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
      const record = await fetchJson<JobRecord>(`/api/jobs/${jobId}`, "internal_ops");
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
        `/api/jobs/${currentJobId}/transform`,
        "tax_engine",
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
      await fetchJson(`/api/jobs/${currentJobId}/reconcile`, "internal_ops", { method: "POST" });
      await fetchJob(currentJobId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleExport = async () => {
    if (!currentJobId) return;
    setError(null);
    try {
      const result = await fetchJson<ExportResponse>(`/api/jobs/${currentJobId}/export`, "tax_engine", {
        method: "POST",
      });
      setExportReport(result);
      await fetchJob(currentJobId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const personaCards = [
    { key: "broker_admin", label: "Broker Admin", note: "Uploads cost basis + PII" },
    { key: "internal_ops", label: "Internal Ops", note: "Reprocess & reconcile" },
    { key: "tax_engine", label: "Tax Engine", note: "Transforms & exports" },
    { key: "api_client", label: "API Client", note: "Headless ingestion" },
  ];

  const pipelineSteps = [
    { title: "Data Ingestion", status: ingestionResult ? "Done" : "Pending" },
    { title: "Validation", status: currentJob?.validation_report ? "Evaluated" : "Pending" },
    { title: "Transformation", status: translation ? translation.status : "Pending" },
    { title: "Reconciliation", status: currentJob?.reconciliation ? "Complete" : "Pending" },
    { title: "Export", status: currentJob?.export_report ? "Ready" : "Pending" },
  ];

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
          <p className="nav-label">Personas</p>
          <div className="persona-grid">
            {personaCards.map((persona) => (
              <button
                key={persona.key}
                className={`chip ${activeRole === persona.key ? "active" : ""}`}
                onClick={() => setActiveRole(persona.key)}
              >
                <span>{persona.label}</span>
                <small>{persona.note}</small>
              </button>
            ))}
          </div>

          <p className="nav-label">Pipeline modules</p>
          <ul className="module-list">
            <li>Data ingestion</li>
            <li>Validation</li>
            <li>Transformation</li>
            <li>Reconciliation</li>
            <li>Export + Webhooks</li>
            <li>Job status & reporting</li>
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
          <p className="muted small">Role headers required via X-User-Role.</p>
        </div>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">Stripe-like middleware for tax reporting</p>
            <h1>Operations dashboard</h1>
            <p className="muted">
              Configure vendor templates, ingest datasets, validate compatibility, reconcile identities,
              and export vendor-ready tax payloads with webhook signals.
            </p>
          </div>
          <div className="hero-meta">
            <div className="badge ghost">Active persona</div>
            <div className="pill strong">{activeRole}</div>
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
              <h2>Step 1: Start job</h2>
              <p className="muted">Select tax year, vendor source, and downstream engine target.</p>
            </div>
            <button className="btn primary" onClick={startJob}>
              Start new job
            </button>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Tax year</span>
              <input type="number" value={taxYear} onChange={(e) => setTaxYear(parseInt(e.target.value, 10))} />
            </label>
            <label className="field">
              <span>Vendor #1 source</span>
              <input value={vendorSource} onChange={(e) => setVendorSource(e.target.value)} />
            </label>
            <label className="field">
              <span>Vendor #2 target</span>
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
                <h2>Step 2: Upload datasets</h2>
                <p className="muted">Cost basis, personal info, and optional trades follow the same ingestion path.</p>
              </div>
              <div className="panel-actions">
                <button className="btn" onClick={uploadPersonalInfo} disabled={!currentJobId}>
                  Upload PII
                </button>
                <button className="btn primary" onClick={uploadCostBasis} disabled={!currentJobId}>
                  Ingest cost basis
                </button>
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
                <strong>Job {ingestionResult.job_id}</strong> ingested {ingestionResult.ingestion_summary.total_rows} row(s). Missing:
                {" "}
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

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Step 3-6: Validate, transform, reconcile, export</h2>
              <p className="muted">Run the downstream pipeline once data is ingested.</p>
            </div>
            <div className="panel-actions">
              <button className="btn" onClick={handleTransform} disabled={!currentJobId}>
                Transform
              </button>
              <button className="btn" onClick={handleReconcile} disabled={!currentJobId}>
                Reconcile
              </button>
              <button className="btn primary" onClick={handleExport} disabled={!currentJobId}>
                Export
              </button>
            </div>
          </div>
          <div className="pipeline-grid">
            {pipelineSteps.map((step) => (
              <div key={step.title} className="mini-card">
                <p className="eyebrow">{step.title}</p>
                <h4>{step.status}</h4>
              </div>
            ))}
          </div>
          {currentJob?.validation_report && (
            <div className="report">
              <h3>Validation report</h3>
              {currentJob.validation_report.errors.length === 0 ? (
                <p className="muted">No blocking errors detected.</p>
              ) : (
                <ul className="warning-list">
                  {currentJob.validation_report.errors.map((issue) => (
                    <li key={`${issue.code}-${issue.transaction_id ?? "all"}`}>
                      <strong>{issue.code}</strong>: {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              {currentJob.validation_report.warnings.length > 0 && (
                <ul className="warning-list">
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
            <div className="report">
              <h3>Transformation output</h3>
              <pre className="code-block">{JSON.stringify(translation.payload, null, 2)}</pre>
              {translation.payload.human_readable && <p className="muted">{translation.payload.human_readable}</p>}
            </div>
          )}
          {currentJob?.reconciliation && (
            <div className="report">
              <h3>Reconciliation summary</h3>
              <p className="muted">
                Mismatches: {currentJob.reconciliation.mismatched_accounts.join(", ") || "none"}
              </p>
              <p className="muted">
                Gain/loss alignment: {currentJob.reconciliation.gain_loss_alignment ? "yes" : "no"}
              </p>
            </div>
          )}
          {exportReport && (
            <div className="report">
              <h3>Export report</h3>
              <p className="muted">Download: {exportReport.download_url}</p>
              <p className="muted">Webhook: {exportReport.webhook_event}</p>
            </div>
          )}
        </section>

        <div className="two-column">
          <section className="panel minimal">
            <div className="panel-heading">
              <div>
                <h2>Jobs & statuses</h2>
                <p className="muted">Broker admins, internal ops, and API clients share visibility.</p>
              </div>
              <button className="btn" onClick={refreshJobs}>
                Refresh
              </button>
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
                        <p className="eyebrow">{job.vendor_source} → {job.vendor_target}</p>
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
      </main>
    </div>
  );
}

export default App;

