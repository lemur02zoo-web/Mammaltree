/**
 * IUCN proxy — Netlify Function v2 (ES module, Node 18+, esbuild bundled)
 * Uses native fetch which is available in Node 18.
 *
 * SETUP: Netlify → Site Settings → Environment Variables:
 *   IUCN_API_KEY = yh6HAHLo93MGNoFBxP3GmsG9C82V7bfaJ2Jn
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const key = process.env.IUCN_API_KEY;
  if (!key) {
    return new Response(
      JSON.stringify({ error: "IUCN_API_KEY not set in Netlify environment variables" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  // req.url is the full incoming URL, e.g.:
  // https://yoursite.netlify.app/.netlify/functions/iucn-proxy/taxa/scientific_name/Panthera%20leo
  // We want just:  /taxa/scientific_name/Panthera%20leo
  const incoming = new URL(req.url);
  const iucnPath = incoming.pathname
    .replace(/^\/.netlify\/functions\/iucn-proxy/, "")
    .replace(/^\/api\/iucn/, "");
  const iucnURL = `https://apiv4.iucnredlist.org/api/v4${iucnPath}${incoming.search}`;

  console.log("IUCN proxy → ", iucnURL); // visible in Netlify function logs

  try {
    const resp = await fetch(iucnURL, {
      method: "GET",
      headers: {
        "Accept":        "application/json",
        "Authorization": `Bearer ${key}`,
        "User-Agent":    "MammalTreeOfLife/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        ...(resp.ok ? { "Cache-Control": "public, max-age=86400" } : {}),
      },
    });
  } catch (err) {
    console.error("IUCN proxy error:", err.message, "→", iucnURL);
    return new Response(
      JSON.stringify({ error: "Failed to reach IUCN API", detail: err.message, tried: iucnURL }),
      { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
};

// Function is called directly at /.netlify/functions/iucn-proxy/*
