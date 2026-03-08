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
    return Response.json({ error: "IUCN_API_KEY not set" }, { status: 500, headers: CORS });
  }

  const url = new URL(request.url);

  // Strip ALL known prefixes to get just e.g. /taxa/scientific_name
  const iucnPath = url.pathname
    .replace(/^\/.netlify\/functions\/iucn-proxy/, "")
    .replace(/^\/api\/iucn/, "")
    || "/";

  const iucnUrl = `https://apiv4.iucnredlist.org/api/v4${iucnPath}${url.search}`;

  try {
    const resp = await fetch(iucnUrl, {
      headers: {
        "Accept":        "application/json",
        "Authorization": `Bearer ${IUCN_KEY}`,
      },
    });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to reach IUCN API", detail: err.message, tried: iucnUrl },
      { status: 502, headers: CORS }
    );
  }
};

export const config = { path: "/api/iucn/*" };
