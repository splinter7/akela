import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const demoDir = join(__dirname, "../../demo");
const port = Number(process.env.PORT ?? 4173);

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  // Fake Snowplow collector — accept beacons, return 204
  if (
    url.pathname.includes("/snowplow/") ||
    url.pathname.includes("/i") ||
    url.pathname.includes("/com.snowplowanalytics.snowplow/tp2")
  ) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(204);
      res.end();
    });
    return;
  }

  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(demoDir, path);

  if (!filePath.startsWith(demoDir) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const type = mime[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(readFileSync(filePath));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Demo site: http://127.0.0.1:${port}`);
  console.log("Snowplow-like collector paths: /snowplow/i , /snowplow/tp2");
});
