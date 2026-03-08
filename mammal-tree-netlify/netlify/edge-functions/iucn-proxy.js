/**
 * Netlify Edge Function: iucn-proxy
 * ──────────────────────────────────────────────────────────────────────────
 * File location: netlify/edge-functions/iucn-proxy.js
 *
 * This function runs on Netlify's edge servers (not in the user's browser).
 * It receives requests from the frontend, adds your secret IUCN API key,
 * forwards them to the real IUCN API, and returns the response.
 *
 * Your IUCN key is NEVER visible to website visitors — it lives only in
 * Netlify's encrypted environment variables.
 *
 * HOW TO SET YOUR IUCN KEY IN NETLIFY:
 *   1. Go to your Netlify site dashboard
 *   2. Site Settings → Environment Variables
 *   3. Add variable:  IUCN_API_KEY  =  yh6HAHLo93MGNoFBxP3GmsG9C82V7bfaJ2Jn
 *   4. Redeploy the site (Deploys → Trigger deploy)
 * ──────────────────────────────────────────────────────────────────────────
 */

export default async function handler(request, context) {
  // ── CORS preflight (browsers send this before the real request) ──────────
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // ── Only allow GET requests ───────────────────────────────────────────────
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Read the IUCN key from Netlify environment variables ─────────────────
  const IUCN_KEY = Deno.env.get("IUCN_API_KEY");
  if (!IUCN_KEY) {
    return new Response(
      JSON.stringify({ error: "IUCN_API_KEY environment variable not set. See setup instructions in netlify/edge-functions/iucn-proxy.js" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Build the IUCN API URL ────────────────────────────────────────────────
  // Incoming URL:  /api/iucn/taxa/scientific_name?name=Panthera+leo
  // Outgoing URL:  https://apiv4.iucnredlist.org/api/v4/taxa/scientific_name?name=Panthera+leo&token=...
  const url = new URL(request.url);

  // Strip the /api/iucn prefix to get the real IUCN path
  const iucnPath = url.pathname.replace(/^\/api\/iucn/, "");
  const iucnUrl = new URL(`https://apiv4.iucnredlist.org/api/v4${iucnPath}`);

  // Forward all query parameters from the original request
  url.searchParams.forEach((value, key) => {
    iucnUrl.searchParams.set(key, value);
  });

  // Add the secret token
  iucnUrl.searchParams.set("token", IUCN_KEY);

  // ── Fetch from IUCN ───────────────────────────────────────────────────────
  let iucnResponse;
  try {
    iucnResponse = await fetch(iucnUrl.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": "MammalTreeOfLife/1.0 (conservation education tool)",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to reach IUCN API", detail: err.message }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Stream the response back to the browser ───────────────────────────────
  const body = await iucnResponse.text();

  return new Response(body, {
    status: iucnResponse.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Cache successful responses for 24 hours at the edge
      // (IUCN data doesn't change minute-to-minute)
      ...(iucnResponse.ok ? { "Cache-Control": "public, max-age=86400, s-maxage=86400" } : {}),
    },
  });
}
