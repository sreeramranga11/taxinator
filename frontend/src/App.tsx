import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
  normalized: unknown[];
  warnings: { code: string; message: string; transaction_id?: string }[];
};

type JobRecord = {
  job_id: string;
  vendor: { name: string; kind: string };
  status: string;
  payload_source: string;
  tags: string[];
  warnings: { code: string; message: string }[];
  normalized: unknown[];
};

type TranslationResponse = {
  payload: { vendor_key: string; records: unknown[]; human_readable?: string };
};

const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000/api").replace(/\/$/, "");
const buildUrl = (path: string) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
const DEFAULT_INGEST_ROLE = "provider";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [templates, setTemplates] = useState<VendorTemplate[]>([]);
  const [samplePayload, setSamplePayload] = useState<string>("");
  const [ingestionResult, setIngestionResult] = useState<IngestionResponse | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [translation, setTranslation] = useState<TranslationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferredVendor, setPreferredVendor] = useState("fis");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ingestionRef = useRef<HTMLElement | null>(null);
  const jobsRef = useRef<HTMLElement | null>(null);
  const templatesRef = useRef<HTMLElement | null>(null);
  const healthRef = useRef<HTMLElement | null>(null);

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
    fetchJson<Health>("/health", "admin")
      .then(setHealth)
      .catch(() => setHealth(null));

    fetchJson<VendorTemplate[]>("/templates", "admin")
      .then((data) => {
        setTemplates(data);
        setPreferredVendor(data[0]?.vendor_key ?? "fis");
      })
      .catch(() => setTemplates([]));

    fetchJson<{ payload: unknown }>("/playbooks/sample-ingestion", "admin")
      .then((payload) => setSamplePayload(JSON.stringify(payload.payload, null, 2)))
      .catch(() => setSamplePayload(""));

    refreshJobs();
  }, []);

  const refreshJobs = () => {
    fetchJson<JobRecord[]>("/jobs", "auditor")
      .then(setJobs)
      .catch(() => setJobs([]));
  };

  const handleIngest = async () => {
    setError(null);
    try {
      const body = JSON.parse(samplePayload);
      const result = await fetchJson<IngestionResponse>("/ingestions", DEFAULT_INGEST_ROLE, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setIngestionResult(result);
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const contents = await file.text();
      const parsed = JSON.parse(contents);
      setSamplePayload(JSON.stringify(parsed, null, 2));
    } catch (err) {
      setError("Invalid JSON file. Please upload a valid JSON payload.");
    } finally {
      event.target.value = "";
    }
  };

  const handleTranslate = async (jobId: string, vendorKey: string) => {
    setError(null);
    try {
      const result = await fetchJson<TranslationResponse>(`/jobs/${jobId}/translate`, "tax_engine", {
        method: "POST",
        body: JSON.stringify({ vendor_key: vendorKey, include_normalized: true }),
      });
      setTranslation(result);
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const firstTemplate = useMemo(() => preferredVendor || templates[0]?.vendor_key || "fis", [preferredVendor, templates]);
  const totalWarnings = jobs.reduce((acc, job) => acc + job.warnings.length, 0);
  const navItems = [
    { label: "Ingestion studio", ref: ingestionRef },
    { label: "Jobs & translations", ref: jobsRef },
    { label: "Vendor templates", ref: templatesRef },
    { label: "Health & metadata", ref: healthRef },
  ];

  const scrollToSection = (sectionRef: React.RefObject<HTMLElement>) => {
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
          <ul>
            {navItems.map((item) => (
              <li key={item.label}>
                <button type="button" onClick={() => scrollToSection(item.ref)}>
                  {item.label}
                </button>
              </li>
            ))}
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
          <p className="muted small">Role headers are applied automatically for each action.</p>
        </div>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">Middleware for tax reporting</p>
            <h1>Operations dashboard</h1>
            <p className="muted">
              Normalize cost-basis feeds, reconcile discrepancies, and deliver vendor-ready payloads
              that tax engines can ingest without brittle spreadsheets or manual rework.
            </p>
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
            <p className="muted">Normalized submissions stored this session.</p>
          </div>
          <div className="card">
            <p className="eyebrow">Warnings</p>
            <h3>{totalWarnings}</h3>
            <p className="muted">Data quality flags surfaced during normalization.</p>
          </div>
        </section>

        <section ref={ingestionRef} className="panel highlight">
          <div className="panel-heading">
            <div>
              <h2>Ingestion studio</h2>
              <p className="muted">Validate, normalize, and store cost-basis payloads.</p>
            </div>
            <div className="panel-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImport}
                style={{ display: "none" }}
              />
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                Import JSON
              </button>
              <button className="btn primary" onClick={handleIngest}>
                Normalize & store
              </button>
            </div>
          </div>
          <textarea
            className="editor"
            rows={12}
            value={samplePayload}
            onChange={(e) => setSamplePayload(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          {ingestionResult && (
            <div className="callout">
              <strong>Job {ingestionResult.job_id}</strong> normalized {" "}
              {ingestionResult.summary.total_transactions} transaction(s). Short-term: {" "}
              {ingestionResult.summary.short_term_count}, Long-term: {" "}
              {ingestionResult.summary.long_term_count}.
            </div>
          )}
        </section>

        <div className="two-column">
          <section ref={jobsRef} className="panel">
            <div className="panel-heading">
              <div>
                <h2>Jobs & translations</h2>
                <p className="muted">Each ingestion produces a normalized job and translation preview.</p>
              </div>
              <div className="panel-actions">
                <label className="select">
                  <span>Vendor</span>
                  <select
                    value={firstTemplate}
                    onChange={(e) => setPreferredVendor(e.target.value)}
                  >
                    {templates.map((template) => (
                      <option key={template.vendor_key} value={template.vendor_key}>
                        {template.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn" onClick={refreshJobs}>
                  Refresh
                </button>
              </div>
            </div>
            {jobs.length === 0 ? (
              <p className="muted">No ingestions yet. Submit a payload to see normalized jobs.</p>
            ) : (
              <div className="jobs">
                {jobs.map((job) => (
                  <article key={job.job_id} className="job-card">
                    <div className="job-heading">
                      <div>
                        <p className="eyebrow">{job.vendor.name}</p>
                        <h3>{job.job_id}</h3>
                        <p className="muted">Source: {job.payload_source}</p>
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
                    <div className="job-actions">
                      <button
                        className="btn primary"
                        onClick={() => handleTranslate(job.job_id, firstTemplate)}
                      >
                        Translate to {firstTemplate.toUpperCase()}
                      </button>
                      <span className="muted">{job.normalized.length} normalized rows</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section ref={templatesRef} className="panel minimal">
            <div className="panel-heading">
              <div>
                <h2>Vendor templates</h2>
                <p className="muted">Fields and mapping notes for downstream engines.</p>
              </div>
            </div>
            {templates.length === 0 ? (
              <p className="muted">No templates returned; check backend.</p>
            ) : (
              <div className="templates">
                {templates.map((template) => (
                  <div key={template.vendor_key} className="template">
                    <div className="template-heading">
                      <h3>{template.display_name}</h3>
                      <span className="badge">{template.version}</span>
                    </div>
                    <p className="muted">Format: {template.format.toUpperCase()}</p>
                    <p className="muted">Required: {template.required_fields.join(", ")}</p>
                    <ul className="notes">
                      {template.mapping_notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {translation && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Latest translation</h2>
                <p className="muted">Preview the downstream payload for the selected vendor.</p>
              </div>
              <span className="badge success">{translation.payload.vendor_key}</span>
            </div>
            <pre className="code-block">{JSON.stringify(translation.payload, null, 2)}</pre>
            {translation.payload.human_readable && (
              <p className="muted">{translation.payload.human_readable}</p>
            )}
          </section>
        )}

        <section ref={healthRef} className="panel subtle">
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
      </main>
    </div>
  );
}

export default App;
