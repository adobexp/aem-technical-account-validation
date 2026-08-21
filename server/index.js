import express from "express";
import { createServer as createViteServer } from "vite";
import { validateTechnicalAccount } from "./crud.js";

const PORT = Number(process.env.PORT) || 3000;

function sanitizeError(error) {
  return String(error?.message || error || "Unexpected error").slice(0, 500);
}

async function start() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  app.post("/api/validate", async (req, res) => {
    try {
      const { technicalAccount, authorUrl, damFolder } = req.body || {};
      if (!technicalAccount) {
        res.status(400).json({
          ok: false,
          error: "Request body must include technicalAccount JSON.",
        });
        return;
      }
      const report = await validateTechnicalAccount({
        payload: technicalAccount,
        authorUrl,
        damFolder,
      });
      res.json(report);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: sanitizeError(error),
      });
    }
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.listen(PORT, () => {
    console.log(`AdobeXP AEM Technical Account Validation → http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", sanitizeError(error));
  process.exit(1);
});
