/**
 * netlify/functions/iucn-proxy.js
 *
 * Regular Netlify Function (Node.js) — has full outbound network access.
 * Proxies IUCN Red List API v4 so your key stays secret on the server.
 *
 * Called by the app as: /api/iucn/taxa/scientific_name?genus_name=X&species_name=Y
 * Netlify routes /api/iucn/* → /.netlify/functions/iucn-proxy via netlify.toml redirect.
 *
 * SETUP (only needed once):
 *   Netlify dashboard → Site Settings → Environment Variables → Add:
 *   Key:   IUCN_API_KEY
 *   Value: yh6HAHLo93MGNoFBxP3GmsG9C82V7bfaJ2Jn
 *   Then: Deploys → Trigger deploy
 */

const https = require("https");

exports.handler = async function (event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

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

  // Strip the routing prefix to get the real IUCN path + query
  // e.g. /api/iucn/taxa/scientific_name?genus_name=Panthera&species_name=leo
  //   → /taxa/scientific_name?genus_name=Panthera&species_name=leo
  const iucnPath = event.path.replace(/^\/.netlify\/functions\/iucn-proxy/, "").replace(/^\/api\/iucn/, "") || "/";
  const qs = event.rawQuery ? `?${event.rawQuery}` : "";
  const iucnUrl = `https://apiv4.iucnredlist.org/api/v4${iucnPath}${qs}`;

  try {
    const body = await new Promise((resolve, reject) => {
      const req = https.request(
        iucnUrl,
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${IUCN_KEY}`,
          },
        },
        (res) => {
          let data = "";
          res.on("data", chunk => { data += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on("error", reject);
      req.end();
    });

    return {
      statusCode: body.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        ...(body.status === 200 ? { "Cache-Control": "public, max-age=86400" } : {}),
      },
      body: body.body,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to reach IUCN API", detail: err.message }),
    };
  }
};
