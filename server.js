const http = require("http");
const https = require("https");

const upstream = new URL(process.env.UPSTREAM || "https://api.nezhaproxy.com");
const port = Number(process.env.PORT || 10000);

/** App calls only. Anything else, including the website and payments, is refused. */
const allowed = new Set([
  "POST /v1/auth/login",
  "POST /v1/auth/register",
  "POST /v1/auth/refresh",
  "POST /v1/auth/logout",
  "POST /v1/auth/forgot-password",
  "POST /v1/auth/resend-verification",
  "POST /v1/auth/web-handoff",
  "GET /v1/plans",
  "GET /v1/me",
  "GET /v1/subscription",
  "POST /v1/devices",
  "GET /v1/devices",
  "GET /v1/servers",
  "POST /v1/connect",
  "GET /v1/app/update",
  "POST /v1/feedback",
]);

const forwardRequest = ["accept", "authorization", "content-type", "x-encrypted", "x-device-token"];

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength("ok"),
    });
    res.end(req.method === "HEAD" ? undefined : "ok");
    return;
  }

  if (!allowed.has(`${req.method} ${url.pathname}`)) {
    send(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
    return;
  }

  const headers = { host: upstream.host, "accept-encoding": "identity" };
  for (const name of forwardRequest) {
    const value = req.headers[name];
    if (value) headers[name] = value;
  }

  const outgoing = https.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || 443,
      method: req.method,
      path: url.pathname + url.search,
      headers,
      timeout: 25000,
    },
    (incoming) => {
      const responseHeaders = {};
      if (incoming.headers["content-type"]) responseHeaders["content-type"] = incoming.headers["content-type"];
      res.writeHead(incoming.statusCode || 502, responseHeaders);
      incoming.pipe(res);
    }
  );

  outgoing.on("timeout", () => outgoing.destroy());
  outgoing.on("error", () => {
    if (!res.headersSent) {
      send(res, 502, { error: { code: "UPSTREAM", message: "The service is unavailable." } });
    } else {
      res.destroy();
    }
  });
  req.pipe(outgoing);
});

server.listen(port);
