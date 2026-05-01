import http from "node:http";
import { readFileSync } from "node:fs";

function loadEnvFile(path) {
  try {
    const contents = readFileSync(path, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();

      if (key && process.env[key] == null) {
        process.env[key] = value;
      }
    }
  } catch {
    // No local .env file; rely on existing environment variables.
  }
}

loadEnvFile("./.env");

const { default: roastHandler } = await import("./api/roast.js");

const port = 3001;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/api/roast") {
    return sendJson(res, 404, { error: "Not found" });
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", async () => {
    try {
      req.body = body ? JSON.parse(body) : {};
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" });
    }

    res.status = (statusCode) => {
      res.statusCode = statusCode;
      return res;
    };

    res.json = (payload) => sendJson(res, res.statusCode || 200, payload);

    try {
      await roastHandler(req, res);
    } catch (error) {
      console.error("Server error:", error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Roast failed" });
      }
    }
  });
});

server.listen(port, () => {
  console.log(`Roastify API running on port ${port}`);
});