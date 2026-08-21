import { useState } from "react";
import Header from "./components/Header.jsx";
import Report from "./components/Report.jsx";
import ValidatorForm from "./components/ValidatorForm.jsx";

export default function App() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  async function handleSubmit(payload) {
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const response = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok && !json?.steps) {
        throw new Error(json?.error || `Request failed HTTP ${response.status}`);
      }
      setReport(json);
    } catch (err) {
      setError(err.message || "Validation request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <Header />
      <main className="main">
        <ValidatorForm onSubmit={handleSubmit} loading={loading} />
        <Report report={report} error={error} loading={loading} />
      </main>
    </div>
  );
}
