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

const defaultRole = "provider";

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Role": defaultRole,
      ...(options?.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [templates, setTemplates] = useState<VendorTemplate[]>([]);
  const [samplePayload, setSamplePayload] = useState<string>("");
  const [ingestionResult, setIngestionResult] = useState<IngestionResponse | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [translation, setTranslation] = useState<TranslationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<Health>("/api/health", { headers: { "X-User-Role": "admin" } })
      .then(setHealth)
      .catch(() => setHealth(null));

    fetchJson<VendorTemplate[]>("/api/templates", { headers: { "X-User-Role": "admin" } })
      .then(setTemplates)
      .catch(() => setTemplates([]));

    fetchJson<{ payload: unknown }>("/api/playbooks/sample-ingestion", {
      headers: { "X-User-Role": "admin" },
    })
      .then((payload) => setSamplePayload(JSON.stringify(payload.payload, null, 2)))
      .catch(() => setSamplePayload(""));

    refreshJobs();
  }, []);

  const refreshJobs = () => {
    fetchJson<JobRecord[]>("/api/jobs", { headers: { "X-User-Role": "auditor" } })
      .then(setJobs)
      .catch(() => setJobs([]));
  };

  const handleIngest = async () => {
    setError(null);
    try {
      const body = JSON.parse(samplePayload);
      const result = await fetchJson<IngestionResponse>("/api/ingestions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setIngestionResult(result);
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleTranslate = async (jobId: string, vendorKey: string) => {
    setError(null);
    try {
      const result = await fetchJson<TranslationResponse>(`/api/jobs/${jobId}/translate`, {
        method: "POST",
        headers: { "X-User-Role": "tax_engine" },
        body: JSON.stringify({ vendor_key: vendorKey, include_normalized: true }),
      });
      setTranslation(result);
      refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const firstTemplate = useMemo(() => templates[0]?.vendor_key ?? "fis", [templates]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Stripe-like middleware for tax reporting</p>
          <h1>Taxinator Control Center</h1>
          <p>
            Normalize cost-basis feeds, reconcile discrepancies, and hand off vendor-ready payloads
            to tax form engines like FIS without brittle spreadsheets.
          </p>
        </div>
        <div className="pill">Role headers required: X-User-Role</div>
      </header>

      <main className="app-main">
        <section className="panel">
          <div className="panel-heading">
            <h2>Service status</h2>
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

        <section className="panel">
          <div className="panel-heading">
            <h2>Ingest cost-basis payload</h2>
            <button className="btn primary" onClick={handleIngest}>
              Normalize & store
            </button>
          </div>
          <p className="muted">Payloads are validated and enriched; warnings remain non-blocking.</p>
          <textarea
            className="editor"
            rows={14}
            value={samplePayload}
            onChange={(e) => setSamplePayload(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          {ingestionResult && (
            <div className="callout">
              <strong>Job {ingestionResult.job_id}</strong> normalized with {" "}
              {ingestionResult.summary.total_transactions} transaction(s). Short-term: {" "}
              {ingestionResult.summary.short_term_count}, Long-term: {" "}
              {ingestionResult.summary.long_term_count}.
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Jobs & translations</h2>
            <button className="btn" onClick={refreshJobs}>
              Refresh
            </button>
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
                        <li key={warning.code}>
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

        <section className="panel">
          <div className="panel-heading">
            <h2>Vendor templates</h2>
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

        {translation && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Latest translation</h2>
              <span className="badge success">{translation.payload.vendor_key}</span>
            </div>
            <p className="muted">Preview the downstream payload for the selected vendor.</p>
            <pre className="code-block">{JSON.stringify(translation.payload, null, 2)}</pre>
            {translation.payload.human_readable && (
              <p className="muted">{translation.payload.human_readable}</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
