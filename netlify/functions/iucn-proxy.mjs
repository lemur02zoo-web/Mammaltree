/**
 * netlify/functions/iucn-proxy.mjs
 * 
 * Correct IUCN v4 endpoint: /api/v4/taxa/scientific_name/{Genus species}
 * Scientific name goes in the PATH, not as query params.
 * Auth via Bearer token in header.
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (request, context) => {
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

  // The app calls: /api/iucn/taxa/scientific_name/Panthera leo
  // Netlify routes to: /.netlify/functions/iucn-proxy/taxa/scientific_name/Panthera leo
  // We forward to:     https://apiv4.iucnredlist.org/api/v4/taxa/scientific_name/Panthera%20leo

  const url = new URL(request.url);
  const iucnPath = url.pathname
    .replace(/^\/.netlify\/functions\/iucn-proxy/, "")
    .replace(/^\/api\/iucn/, "");

  // Preserve query string (page, per_page etc.) if present
  const iucnUrl = `https://apiv4.iucnredlist.org/api/v4${iucnPath}${url.search}`;

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

export const config = { path: "/api/iucn/*" };
