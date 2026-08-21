import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const DUMMY_PATH = join(dirname(fileURLToPath(import.meta.url)), "assets", "dummy-asset.jpg");
const TIMEOUT_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function briefBody(text, n = 280) {
  let value = String(text || "");
  const heading = value.match(/<h1>([^<]+)<\/h1>/i)?.[1];
  const paragraph = value.match(/<p>([^<]+)<\/p>/i)?.[1];
  if (heading || paragraph) {
    value = [heading, paragraph].filter(Boolean).join(" — ");
  }
  return value.replace(/\s+/g, " ").slice(0, n);
}

function deriveAuthorUrl(clientId) {
  const match = String(clientId || "").match(/^cm-p(\d+)-e(\d+)/i);
  if (!match) return null;
  return `https://author-p${match[1]}-e${match[2]}.adobeaemcloud.com`;
}

function parseIntegration(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Technical account JSON is empty or invalid.");
  }
  const integration = payload.integration || payload;
  const technicalAccount = integration.technicalAccount || {};
  if (!technicalAccount.clientId || !technicalAccount.clientSecret || !integration.privateKey) {
    throw new Error(
      "JSON must include integration.technicalAccount.clientId, clientSecret, and privateKey.",
    );
  }
  return {
    imsEndpoint: integration.imsEndpoint || "ims-na1.adobelogin.com",
    metascopes: integration.metascopes || "ent_aem_cloud_api",
    clientId: technicalAccount.clientId,
    clientSecret: technicalAccount.clientSecret,
    email: integration.email || null,
    id: integration.id,
    org: integration.org,
    privateKey: String(integration.privateKey).replace(/\\r\\n/g, "\n").replace(/\r\n/g, "\n"),
    certificateExpirationDate: integration.certificateExpirationDate || null,
    authorUrlFromFile: payload["aemaacs-author-url"] || payload.authorUrl || null,
  };
}

async function httpJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { response, text, json };
  } finally {
    clearTimeout(timer);
  }
}

async function imsAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    exp: now + 3600,
    iss: account.org,
    sub: account.id,
    aud: `https://${account.imsEndpoint}/c/${account.clientId}`,
  };
  for (const scope of String(account.metascopes)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    payload[`https://${account.imsEndpoint}/s/${scope}`] = true;
  }
  const signed = jwt.sign(payload, account.privateKey, { algorithm: "RS256" });
  const body = new URLSearchParams({
    client_id: account.clientId,
    client_secret: account.clientSecret,
    jwt_token: signed,
  });
  const { response, text, json } = await httpJson(`https://${account.imsEndpoint}/ims/exchange/jwt`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok || !json?.access_token) {
    throw new Error(`IMS JWT exchange failed HTTP ${response.status}: ${briefBody(text)}`);
  }
  return json.access_token;
}

async function aemRequest(authorUrl, token, path, options = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${authorUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: options.accept || "application/json",
    ...(options.headers || {}),
  };
  if (options.csrfToken) headers["CSRF-Token"] = options.csrfToken;
  return httpJson(url, { ...options, headers });
}

async function waitDamAsset(authorUrl, token, assetPath) {
  let primary = null;
  for (let i = 0; i < 20; i += 1) {
    const { response, json } = await aemRequest(authorUrl, token, `${assetPath}.json`);
    if (response.ok && json) {
      primary = json["jcr:primaryType"] || null;
      if (primary === "dam:Asset") return primary;
    }
    await sleep(1000);
  }
  return primary;
}

async function deleteAsset(authorUrl, token, csrfToken, assetPath) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const body = new URLSearchParams({ ":operation": "delete" });
    const { response, text } = await aemRequest(authorUrl, token, assetPath, {
      method: "POST",
      csrfToken,
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      body,
    });
    if (response.ok || response.status === 404) {
      return { ok: true, detail: `HTTP ${response.status} on attempt ${attempt}` };
    }
    if (attempt === 5) {
      return { ok: false, detail: `HTTP ${response.status} ${briefBody(text)}` };
    }
    await sleep(1500 * attempt);
  }
  return { ok: false, detail: "delete exhausted retries" };
}

export async function validateTechnicalAccount({ payload, authorUrl, damFolder }) {
  const steps = [];
  const record = (name, ok, detail) => {
    steps.push({ name, ok, detail });
  };

  let account;
  try {
    account = parseIntegration(payload);
  } catch (error) {
    record("Parse technical account JSON", false, error.message);
    return buildReport(steps, { authorUrl, damFolder });
  }

  const resolvedAuthor =
    (authorUrl || account.authorUrlFromFile || deriveAuthorUrl(account.clientId) || "").replace(/\/$/, "");
  const folder = (damFolder || "/content/dam").replace(/\/$/, "") || "/content/dam";
  const assetName = `etl-permcheck-${Date.now()}.jpg`;
  const assetPath = `${folder}/${assetName}`;

  const publicAccount = {
    email: account.email,
    id: account.id,
    clientId: account.clientId,
    org: account.org,
    certificateExpirationDate: account.certificateExpirationDate,
    authorUrl: resolvedAuthor,
    damFolder: folder,
    groups: [],
  };

  if (!resolvedAuthor) {
    record(
      "Resolve author URL",
      false,
      "Could not derive AEMaaCS author URL from clientId. Provide Author URL explicitly.",
    );
    return buildReport(steps, publicAccount);
  }
  record("Resolve author URL", true, resolvedAuthor);

  let token;
  try {
    token = await imsAccessToken(account);
    record("IMS JWT exchange", true, "access_token issued");
  } catch (error) {
    record("IMS JWT exchange", false, error.message);
    return buildReport(steps, publicAccount);
  }

  const csrf = await aemRequest(resolvedAuthor, token, "/libs/granite/csrf/token.json");
  const csrfToken = csrf.json?.token || null;

  const userinfo = await aemRequest(resolvedAuthor, token, "/libs/cq/security/userinfo.json");
  if (userinfo.response.ok && userinfo.json?.userID) {
    record("AEM auth probe", true, `authenticated as ${userinfo.json.userID}`);
    publicAccount.userId = userinfo.json.userID;
    publicAccount.home = userinfo.json.home || null;
  } else {
    record("AEM auth probe", false, `HTTP ${userinfo.response.status} ${briefBody(userinfo.text)}`);
  }

  if (publicAccount.home) {
    const home = await aemRequest(resolvedAuthor, token, `${publicAccount.home}.1.json`);
    if (home.response.ok && home.json) {
      publicAccount.groups = home.json["rep:externalPrincipalNames"] || [];
      record("IMS product profiles / groups", true, publicAccount.groups.join(", ") || "(none)");
    } else {
      record("IMS product profiles / groups", false, `HTTP ${home.response.status}`);
    }
  }

  const folderGet = await aemRequest(resolvedAuthor, token, `${folder}.1.json`);
  record(
    "READ folder",
    folderGet.response.ok,
    folderGet.response.ok
      ? `HTTP 200 jcr:primaryType=${folderGet.json?.["jcr:primaryType"]}`
      : `HTTP ${folderGet.response.status} ${briefBody(folderGet.text)}`,
  );

  const dummy = await readFile(DUMMY_PATH);
  let uploaded = false;

  const initBody = new URLSearchParams({
    fileName: assetName,
    fileSize: String(dummy.length),
  });
  const init = await aemRequest(resolvedAuthor, token, `${folder}.initiateUpload.json`, {
    method: "POST",
    csrfToken,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: initBody,
  });

  if (!init.response.ok) {
    record("CREATE initiateUpload", false, `HTTP ${init.response.status} ${briefBody(init.text)}`);
  } else {
    record("CREATE initiateUpload", true, "HTTP 200 upload slot received");
    const files = init.json?.files || [];
    const slot = files.find((f) => f.fileName === assetName) || files[0];
    if (!slot) {
      record("CREATE parse initiateUpload", false, "no files[] slot in response");
    } else {
      let putOk = true;
      const started = Date.now();
      for (const uri of slot.uploadURIs || []) {
        const put = await fetch(uri, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: dummy,
        });
        if (!put.ok) {
          putOk = false;
          record("CREATE PUT binary to cloud", false, `HTTP ${put.status}`);
          break;
        }
      }
      if (putOk) {
        record("CREATE PUT binary to cloud", true, `HTTP 2xx (${dummy.length} bytes)`);
        const completePath = init.json?.completeURI || `${folder}.completeUpload.json`;
        const completeBody = new URLSearchParams({
          fileName: assetName,
          mimeType: slot.mimeType || "image/jpeg",
          uploadToken: slot.uploadToken,
          fileSize: String(dummy.length),
          uploadDuration: String(Date.now() - started),
          createVersion: "false",
          replace: "true",
        });
        const complete = await aemRequest(resolvedAuthor, token, completePath, {
          method: "POST",
          csrfToken,
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
          body: completeBody,
        });
        record(
          "CREATE completeUpload",
          complete.response.ok,
          complete.response.ok ? "HTTP 2xx" : `HTTP ${complete.response.status} ${briefBody(complete.text)}`,
        );
        uploaded = complete.response.ok;
      }
    }
  }

  if (uploaded) {
    const primary = await waitDamAsset(resolvedAuthor, token, assetPath);
    const settled = primary === "dam:Asset";
    record("CREATE verify dam:Asset", settled, `jcr:primaryType=${primary}`);
    uploaded = settled;
  }

  if (!uploaded) {
    record("UPDATE metadata", false, "skipped because upload did not succeed");
    record("READ/DOWNLOAD original binary", false, "skipped because upload did not succeed");
    record("DELETE asset", false, "skipped because upload did not succeed");
    return buildReport(steps, publicAccount);
  }

  const metaBody = new URLSearchParams({
    "dc:title": "ETL permission check",
    "dc:description": "Temporary dummy asset for AEMaaCS tech-account CRUD verification",
  });
  const meta = await aemRequest(resolvedAuthor, token, `${assetPath}/jcr:content/metadata`, {
    method: "POST",
    csrfToken,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: metaBody,
  });
  record(
    "UPDATE metadata",
    meta.response.ok,
    meta.response.ok ? `HTTP ${meta.response.status}` : `HTTP ${meta.response.status} ${briefBody(meta.text)}`,
  );

  const readMeta = await aemRequest(resolvedAuthor, token, `${assetPath}/jcr:content/metadata.json`);
  if (readMeta.response.ok) {
    const title = readMeta.json?.["dc:title"];
    const titleOk = title === "ETL permission check" || (Array.isArray(title) && title.includes("ETL permission check"));
    record("READ metadata after update", titleOk, `dc:title=${JSON.stringify(title)}`);
  } else {
    record("READ metadata after update", false, `HTTP ${readMeta.response.status}`);
  }

  const downloadUrl = `${resolvedAuthor}${assetPath}/jcr:content/renditions/original`;
  const downloadResp = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "*/*" },
  });
  const downloadBytes = Buffer.from(await downloadResp.arrayBuffer());
  record(
    "READ/DOWNLOAD original binary",
    downloadResp.ok && downloadBytes.length > 0,
    downloadResp.ok
      ? `HTTP ${downloadResp.status}, ${downloadBytes.length} bytes (source ${dummy.length} bytes)`
      : `HTTP ${downloadResp.status}`,
  );

  const deleted = await deleteAsset(resolvedAuthor, token, csrfToken, assetPath);
  record("DELETE asset", deleted.ok, deleted.detail);
  const gone = await aemRequest(resolvedAuthor, token, `${assetPath}.json`);
  record("DELETE verify gone", gone.response.status === 404, `HTTP ${gone.response.status} after delete`);

  return buildReport(steps, publicAccount);
}

function crudFlags(steps) {
  const has = (prefix) => steps.some((s) => s.name.startsWith(prefix) && s.ok);
  return {
    create: has("CREATE verify"),
    read: has("READ folder") || has("READ/DOWNLOAD") || has("READ metadata"),
    update: has("UPDATE metadata"),
    delete: has("DELETE asset") && has("DELETE verify"),
  };
}

function buildReport(steps, account) {
  const crud = crudFlags(steps);
  const passed = steps.filter((s) => s.ok).length;
  const failed = steps.filter((s) => !s.ok).length;
  return {
    ok: failed === 0 && steps.length > 0,
    summary: {
      passed,
      failed,
      total: steps.length,
      crud,
    },
    account,
    steps,
  };
}
