function CrudPills({ crud }) {
  const items = [
    ["Create", crud?.create],
    ["Read", crud?.read],
    ["Update", crud?.update],
    ["Delete", crud?.delete],
  ];
  return (
    <div className="summary-grid">
      {items.map(([label, ok]) => (
        <div key={label} className={`pill ${ok ? "is-pass" : "is-fail"}`}>
          <span>{label.toUpperCase()}</span>
          {ok ? "PASS" : "FAIL"}
        </div>
      ))}
    </div>
  );
}

export default function Report({ report, error, loading }) {
  if (loading) {
    return (
      <section className="card">
        <div className="loading">
          <span className="spinner" aria-hidden="true" />
          Running IMS authentication and DAM CRUD checks…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card">
        <h2>Report</h2>
        <div className="error-banner">{error}</div>
      </section>
    );
  }

  if (!report) return null;

  const account = report.account || {};

  return (
    <section className="card">
      <h2>CRUD report</h2>
      <p className="lede">
        {report.ok
          ? "This technical account can perform Create, Read, Update, and Delete on the target DAM path."
          : "One or more checks failed. Review the steps below."}
      </p>
      <CrudPills crud={report.summary?.crud} />
      <div className="meta">
        <div>
          <b>Author:</b> {account.authorUrl || "—"}
        </div>
        <div>
          <b>DAM folder:</b> {account.damFolder || "—"}
        </div>
        <div>
          <b>Account:</b> {account.email || account.userId || account.id || "—"}
        </div>
        <div>
          <b>Groups:</b> {(account.groups || []).join(", ") || "—"}
        </div>
        <div>
          <b>Score:</b> {report.summary?.passed || 0}/{report.summary?.total || 0} steps passed
        </div>
      </div>
      <div className="steps">
        {(report.steps || []).map((step) => (
          <article key={step.name} className="step">
            <div className={`badge ${step.ok ? "is-pass" : "is-fail"}`}>{step.ok ? "PASS" : "FAIL"}</div>
            <div>
              <h3>{step.name}</h3>
              <p>{step.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
