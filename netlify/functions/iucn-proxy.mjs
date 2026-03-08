/**
 * netlify/functions/iucn-proxy.mjs
 *
 * Modern Netlify Function using ES modules + global fetch (Node 18+).
 * Netlify's newer runtime provides fetch natively — no https module needed.
 *
 * SETUP: Netlify → Site Settings → Environment Variables → Add:
 *   IUCN_API_KEY = yh6HAHLo93MGNoFBxP3GmsG9C82V7bfaJ2Jn
 * Then redeploy.
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (request, context) => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const IUCN_KEY = process.env.IUCN_API_KEY;
  if (!IUCN_KEY) {
    return Response.json(
      { error: "IUCN_API_KEY not set in Netlify environment variables" },
      { status: 500, headers: CORS }
    );
  }

  // Build the IUCN URL from the incoming request
  // Incoming: /.netlify/functions/iucn-proxy/taxa/scientific_name?genus_name=X&species_name=Y
  // Target:   https://apiv4.iucnredlist.org/api/v4/taxa/scientific_name?genus_name=X&species_name=Y
  const url = new URL(request.url);
  const iucnPath = url.pathname.replace(/^\/.netlify\/functions\/iucn-proxy/, "") || "/";
  const iucnUrl  = `https://apiv4.iucnredlist.org/api/v4${iucnPath}${url.search}`;

  try {
    const resp = await fetch(iucnUrl, {
      headers: {
        "Accept":        "application/json",
        "Authorization": `Bearer ${IUCN_KEY}`,
        "User-Agent":    "MammalTreeOfLife/1.0",
      },
    });

    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        ...(resp.ok ? { "Cache-Control": "public, max-age=86400" } : {}),
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to reach IUCN API", detail: err.message, tried: iucnUrl },
      { status: 502, headers: CORS }
    );
  }
};

// Tell Netlify the URL path this function handles
export const config = { path: "/api/iucn/*" };
