/**
 * netlify/functions/iucn-proxy.js
 *
 * Proxies requests to the IUCN Red List API v4.
 * The app calls: /api/iucn/taxa/scientific_name?genus_name=X&species_name=Y
 * netlify.toml rewrites that to: /.netlify/functions/iucn-proxy/taxa/scientific_name?...
 * This function forwards to: https://apiv4.iucnredlist.org/api/v4/taxa/scientific_name?...
 *
 * SETUP: Netlify dashboard → Site Settings → Environment Variables
 *   IUCN_API_KEY = yh6HAHLo93MGNoFBxP3GmsG9C82V7bfaJ2Jn
 */

const https = require("https");
const urlLib = require("url");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function httpsGet(fullUrl, reqHeaders) {
  return new Promise((resolve, reject) => {
    const parsed = urlLib.parse(fullUrl);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path:     parsed.path,
        method:   "GET",
        headers:  reqHeaders,
      },
      (res) => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end",  () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("Timed out after 15s")); });
    req.end();
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const IUCN_KEY = process.env.IUCN_API_KEY;
  if (!IUCN_KEY) {
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "IUCN_API_KEY not set in Netlify environment variables" }),
    };
  }

  // Strip the Netlify function prefix to get just the IUCN API path
  // event.path = /.netlify/functions/iucn-proxy/taxa/scientific_name
  const fnPrefix = "/.netlify/functions/iucn-proxy";
  const iucnPath = event.path.startsWith(fnPrefix)
    ? event.path.slice(fnPrefix.length) || "/"
    : event.path.replace(/^\/api\/iucn/, "") || "/";

  const qs = event.rawQuery ? "?" + event.rawQuery : "";
  const iucnUrl = "https://apiv4.iucnredlist.org/api/v4" + iucnPath + qs;

  let result;
  try {
    result = await httpsGet(iucnUrl, {
      "Accept":        "application/json",
      "Authorization": "Bearer " + IUCN_KEY,
      "User-Agent":    "MammalTreeOfLife/1.0",
    });
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        error:  "Failed to reach IUCN API",
        detail: err.message,
        tried:  iucnUrl,
      }),
    };
  }

  return {
    statusCode: result.status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      ...(result.status === 200 ? { "Cache-Control": "public, max-age=86400" } : {}),
    },
    body: result.body,
  };
};
