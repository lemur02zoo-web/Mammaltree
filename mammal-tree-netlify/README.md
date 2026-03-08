# 🌳 Mammal Tree of Life — Netlify Deployment

Interactive Tree of Life for all 6,871 mammal species, with IUCN Red List
status and iNaturalist CC0 photos.

---

## 📁 Project structure

```
mammal-tree-of-life/
│
├── netlify.toml                         ← Netlify configuration (routing, caching, edge functions)
│
├── netlify/
│   └── edge-functions/
│       └── iucn-proxy.js                ← Hides your IUCN API key server-side
│
└── public/                              ← Everything here becomes the website
    ├── index.html                       ← Entry point
    ├── app.jsx                          ← The full React app
    └── mdd_full.json                    ← All 6,871 mammal species (676 KB)
```

---

## 🚀 How to deploy (no coding required)

### Step 1 — Create a GitHub account
Go to [github.com](https://github.com) and sign up for a free account.

### Step 2 — Create a new repository
1. Click the **+** button → **New repository**
2. Name it `mammal-tree-of-life`
3. Set it to **Public**
4. Click **Create repository**

### Step 3 — Upload all files
1. Click **uploading an existing file** (link shown on the empty repo page)
2. Upload **all files and folders** from this zip, preserving the folder structure:
   - `netlify.toml` goes in the root
   - The `netlify/` folder goes in the root
   - The `public/` folder goes in the root
3. Click **Commit changes**

> **Tip:** GitHub's web uploader handles folders. Just drag the whole
> `mammal-tree-of-life` folder contents onto the upload page.

### Step 4 — Connect to Netlify
1. Go to [netlify.com](https://netlify.com) and sign up free (use your GitHub account)
2. Click **Add new site** → **Import an existing project**
3. Choose **GitHub** → select your `mammal-tree-of-life` repository
4. Settings:
   - **Build command:** leave blank (or type `echo ok`)
   - **Publish directory:** `public`
5. Click **Deploy site**

Your site will be live at a URL like `https://mammal-tree-12345.netlify.app` in about 30 seconds!

### Step 5 — Add your IUCN API key (keeps it secret)
1. In your Netlify dashboard, go to **Site Settings** → **Environment Variables**
2. Click **Add a variable**
3. Key: `IUCN_API_KEY`
4. Value: `yh6HAHLo93MGNoFBxP3GmsG9C82V7bfaJ2Jn`
5. Click **Save**
6. Go to **Deploys** → **Trigger deploy** → **Deploy site**

After this redeploy, your IUCN key is hidden on Netlify's servers. Website
visitors can never see it, even if they inspect the page source.

---

## ✅ What's working after deployment

| Feature | Status | Notes |
|---|---|---|
| Full mammal tree (6,871 spp) | ✅ | Loaded from mdd_full.json |
| IUCN status color-coding | ✅ | Pre-loaded from MDD data |
| Search by name | ✅ | Scientific + common names |
| Filter by IUCN status | ✅ | Click any status badge |
| Live IUCN data per species | ✅ | Via secret edge function proxy |
| CC0 photos per species | ✅ | Live from iNaturalist API |
| IUCN key protected | ✅ | After Step 5 above |

---

## 🔒 Security notes

- Your IUCN API key is stored in Netlify's encrypted environment variables
- It is injected server-side by the Edge Function and never sent to the browser
- iNaturalist is called directly from the browser (no key required)
- The site is read-only — no user data is collected or stored

---

## 💰 Monthly cost

| Service | Cost |
|---|---|
| GitHub | Free |
| Netlify hosting | Free (100 GB bandwidth) |
| Netlify Edge Functions | Free (125k requests/month) |
| IUCN API | Free (your key) |
| iNaturalist API | Free |
| **Total** | **€0** |

---

## 🔧 Next steps (optional improvements)

Ask Claude to help with any of these:

1. **Weekly IUCN data enrichment** — GitHub Actions script that pre-fetches
   IUCN data for all species so cards load instantly (no live API call needed)

2. **Range maps** — Add a Map tab using Leaflet.js + IUCN GeoJSON polygons

3. **Shareable species URLs** — `/species/panthera-leo` links to specific species

4. **Custom domain** — Buy `mammaltree.org` (~€10/yr on Porkbun) and connect
   it in Netlify Site Settings → Domain Management

---

## 📬 Credits

- **Taxonomy data:** [Mammal Diversity Database](https://mammaldiversity.org) v2.4
- **Conservation status:** [IUCN Red List API v4](https://apiv4.iucnredlist.org)
- **Photos:** [iNaturalist](https://inaturalist.org) (CC0 licensed only)
- **App:** Built with Claude (Anthropic)
