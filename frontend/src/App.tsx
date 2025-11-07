import "./styles/global.css";

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Taxinator Control Center</h1>
        <p>
          Middleware that reconciles cost-basis data and prepares filings for downstream tax
          engines.
        </p>
      </header>
      <main className="app-main">
        <section>
          <h2>System status</h2>
          <ul>
            <li>Backend API: <span className="status status--idle">not connected</span></li>
            <li>Integration pipeline: <span className="status status--idle">awaiting data</span></li>
          </ul>
        </section>
        <section>
          <h2>Next steps</h2>
          <ol>
            <li>Connect cost-basis vendor ingestion feed.</li>
            <li>Configure validation and reconciliation rules.</li>
            <li>Deliver normalized payloads to tax form engines.</li>
          </ol>
        </section>
      </main>
    </div>
  );
}

export default App;
