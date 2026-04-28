// Configure execution environment for fast request handling at the edge
export const config = {
  runtime: "edge",
};

// Base endpoint for upstream service (defined via environment variable)
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// Headers excluded to ensure compatibility with upstream service expectations
const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

// Entry point for handling incoming requests
export default async function handler(req) {
  // Validate required configuration
  if (!TARGET_BASE) {
    return new Response("Service configuration is incomplete", { status: 500 });
  }

  try {
    // Derive upstream request URL from incoming request structure
    const url = new URL(req.url);
    const targetUrl = TARGET_BASE + url.pathname + url.search;

    // Prepare request headers for upstream communication
    const headers = new Headers();
    let clientIp = null;

    // Process incoming headers and filter as needed
    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();

      // Skip headers that are managed by the platform or not required upstream
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;

      // Capture originating client address when available
      if (k === "x-real-ip") {
        clientIp = value;
        continue;
      }

      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = value;
        continue;
      }

      // Forward relevant headers
      headers.set(k, value);
    }

    // Attach client address metadata if present
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const method = req.method;

    // Identify whether request payload should be included
    const hasBody = method !== "GET" && method !== "HEAD";

    // Configure upstream request options
    const fetchOpts = {
      method,
      headers,
      redirect: "manual",
    };

    // Include body for applicable request types
    if (hasBody) {
      fetchOpts.body = req.body;
      fetchOpts.duplex = "half";
    }

    // Execute request against upstream service
    const upstream = await fetch(targetUrl, fetchOpts);

    // Normalize response headers for client delivery
    const respHeaders = new Headers();
    for (const [k, v] of upstream.headers) {
      if (k.toLowerCase() === "transfer-encoding") continue;
      respHeaders.set(k, v);
    }

    // Return upstream response as-is
    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    // Fallback response in case of upstream communication failure
    return new Response("Upstream request failed", { status: 502 });
  }
}