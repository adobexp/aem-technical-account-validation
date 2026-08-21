import { useMemo, useRef, useState } from "react";

function deriveAuthorUrl(clientId) {
  const match = String(clientId || "").match(/^cm-p(\d+)-e(\d+)/i);
  if (!match) return "";
  return `https://author-p${match[1]}-e${match[2]}.adobeaemcloud.com`;
}

export default function ValidatorForm({ onSubmit, loading }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [technicalAccount, setTechnicalAccount] = useState(null);
  const [authorUrl, setAuthorUrl] = useState("");
  const [damFolder, setDamFolder] = useState("/content/dam");
  const [parseError, setParseError] = useState("");

  const canSubmit = Boolean(technicalAccount) && !loading;

  const parsedHint = useMemo(() => {
    if (!technicalAccount) return "";
    const integration = technicalAccount.integration || technicalAccount;
    return integration.email || integration.id || fileName;
  }, [technicalAccount, fileName]);

  async function handleFile(file) {
    setParseError("");
    setTechnicalAccount(null);
    setFileName(file?.name || "");
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text.replace(/\u00a0/g, " ").replace(/^\uFEFF/, ""));
      const integration = json.integration || json;
      if (!integration?.technicalAccount?.clientId || !integration?.privateKey) {
        throw new Error("File is not a valid AEMaaCS technical account JSON.");
      }
      setTechnicalAccount(json);
      const derived =
        json["aemaacs-author-url"] || json.authorUrl || deriveAuthorUrl(integration.technicalAccount.clientId);
      if (derived) setAuthorUrl(derived);
    } catch (error) {
      setParseError(error.message || "Could not parse JSON.");
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      technicalAccount,
      authorUrl: authorUrl.trim(),
      damFolder: damFolder.trim() || "/content/dam",
    });
  }

  return (
    <section className="card">
      <h2>Validate technical account</h2>
      <p className="lede">
        Upload the Adobe Developer Console technical-account JSON, optionally confirm the author URL and DAM
        folder, then run a live Create / Read / Update / Delete check. The dummy asset is deleted at the end.
        Credentials are not stored.
      </p>
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="tech-account-file">Technical account JSON</label>
          <div
            className={`dropzone${technicalAccount ? " is-loaded" : ""}`}
            onClick={() => fileRef.current?.click()}
          >
            <strong>{fileName || "Choose JSON or TXT file"}</strong>
            <span>{parsedHint || "Adobe IMS integration payload with clientId, clientSecret, and privateKey"}</span>
            <input
              id="tech-account-file"
              ref={fileRef}
              type="file"
              accept=".json,.txt,application/json,text/plain"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
          </div>
          {parseError ? <p className="hint">{parseError}</p> : null}
        </div>

        <div className="field">
          <label htmlFor="author-url">AEMaaCS author URL</label>
          <input
            id="author-url"
            type="text"
            value={authorUrl}
            placeholder="https://author-pXXXXXX-eXXXXXXX.adobeaemcloud.com"
            onChange={(event) => setAuthorUrl(event.target.value)}
          />
          <p className="hint">Filled automatically from clientId when possible.</p>
        </div>

        <div className="field">
          <label htmlFor="dam-folder">DAM folder path</label>
          <input
            id="dam-folder"
            type="text"
            value={damFolder}
            onChange={(event) => setDamFolder(event.target.value)}
          />
          <p className="hint">CRUD is executed against this folder using a temporary dummy JPEG.</p>
        </div>

        <div className="actions">
          <button className="btn-primary btn" type="submit" disabled={!canSubmit}>
            {loading ? "Running…" : "Submit"}
          </button>
        </div>
      </form>
    </section>
  );
}
