/**
 * netlify/edge-functions/iucn-proxy.js
 *
 * Proxies IUCN API requests so your API key is never exposed in the browser.
 *
 * SETUP: In Netlify dashboard → Site Settings → Environment Variables, add:
 *   IUCN_API_KEY = yh6HAHLo93MGNoFBxP3GmsG9C82V7bfaJ2Jn
 * Then redeploy.
 */
export default async function handler(request, context) {
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

  const IUCN_KEY = Deno.env.get("IUCN_API_KEY");
  if (!IUCN_KEY) {
    return new Response(JSON.stringify({ error: "IUCN_API_KEY not set in Netlify environment variables" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const iucnPath = url.pathname.replace(/^\/api\/iucn/, "");
  const iucnUrl = new URL(`https://apiv4.iucnredlist.org/api/v4${iucnPath}`);

  url.searchParams.forEach((value, key) => iucnUrl.searchParams.set(key, value));
  iucnUrl.searchParams.set("token", IUCN_KEY);

  try {
    const resp = await fetch(iucnUrl.toString(), {
      headers: { "Accept": "application/json" },
    });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...(resp.ok ? { "Cache-Control": "public, max-age=86400" } : {}),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
