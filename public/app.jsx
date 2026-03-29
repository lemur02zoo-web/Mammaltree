// Tree of Life — app.jsx
// Mammals: mdd_full.json (MDD v2.4) | Birds: birds_full.json (AviList 2025)
// Photos: iNaturalist CC0 (live) | Conservation: IUCN Red List API v4

const { useState, useEffect, useCallback, useMemo, useRef } = React;

const SM = {
  LC: { c: "#4ade80", l: "Least Concern" },
  NT: { c: "#a3e635", l: "Near Threatened" },
  VU: { c: "#facc15", l: "Vulnerable" },
  EN: { c: "#fb923c", l: "Endangered" },
  CR: { c: "#f87171", l: "Critically Endangered" },
  EW: { c: "#c084fc", l: "Extinct in Wild" },
  EX: { c: "#94a3b8", l: "Extinct" },
  DD: { c: "#60a5fa", l: "Data Deficient" },
  NE: { c: "#475569", l: "Not Evaluated" },
};
const sc = s => (SM[s] || SM.NE).c;

// Filter out fossil-only subspecies (MDD marks these with "(fossil)" suffix)
const liveSsp = ssp => (ssp || []).filter(s => !s.includes("(fossil)"));

// ── IUCN live lookup via Cloudflare Worker proxy ─────────────────────────
// Set this to your Worker URL after deploying cloudflare-worker/iucn-proxy.js
// e.g. "https://iucn-proxy.YOUR-SUBDOMAIN.workers.dev"
const IUCN_PROXY = "https://iucn-proxy.lemur02zoo.workers.dev";

// Per-session cache so we don't re-fetch the same species twice
const iucnCache = {};

function useIUCN(sciName) {
  const [state, setState] = useState({ data: null, loading: false, error: null });
  useEffect(() => {
    if (!sciName) return;

    // Return from cache instantly if already fetched this session
    if (iucnCache[sciName] !== undefined) {
      const cached = iucnCache[sciName];
      if (cached) setState({ data: cached, loading: false, error: null });
      else        setState({ data: null, loading: false, error: "Not found in IUCN Red List" });
      return;
    }

    setState({ data: null, loading: true, error: null });
    const encoded = encodeURIComponent(sciName.trim());

    // Step 1: get taxon + assessment list
    const parts = sciName.trim().split(" ");
    const params = new URLSearchParams({ genus_name: parts[0], species_name: parts[1] || "" });
    if (parts[2]) params.set("infra_name", parts[2]);

    fetch(`${IUCN_PROXY}/taxa/scientific_name?${params}`)
      .then(r => { if (!r.ok) throw new Error(`Taxa fetch failed: ${r.status}`); return r.json(); })
      .then(async resp => {
        // Response structure: { taxon: { ...infrarank_taxa, subpopulation_taxa }, assessments: [...] }
        const taxon       = resp.taxon;
        const assessments = resp.assessments || [];

        if (!taxon) {
          iucnCache[sciName] = null;
          setState({ data: null, loading: false, error: "Not found in IUCN Red List" });
          return;
        }

        // Latest global assessment: latest=true AND scope code "1" (not regional)
        const latest = assessments.find(a => a.latest && a.scopes?.some(s => s.code === "1"))
                    || assessments.find(a => a.latest)
                    || assessments[0];

        // Subspecies: infrarank_taxa lives inside taxon
        const sspNames = (taxon.infrarank_taxa || [])
          .map(t => t.scientific_name).filter(Boolean);

        // Subpopulations: subpopulation_taxa lives inside taxon
        const subpopNames = (taxon.subpopulation_taxa || [])
          .map(t => t.scientific_name).filter(Boolean);

        let assessment = null;
        if (latest?.assessment_id) {
          assessment = await fetch(`${IUCN_PROXY}/assessment/${latest.assessment_id}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null);
        }

        const result = {
          taxon,
          assessment,
          assessment_history:     assessments,
          subspecies_accounts:    sspNames,
          subpopulation_accounts: subpopNames,
        };

        iucnCache[sciName] = result;
        setState({ data: result, loading: false, error: null });
      })
      .catch(e => setState({ data: null, loading: false, error: e.message }));
  }, [sciName]);
  return state;
}

// Per-session cache for iNat taxon ID lookups
const inatTaxonCache = {};
// Fetch enough observations per page so that after CC0 filtering we reliably get 6 photos.
// Each observation typically has 1-3 photos; requesting 24 gives a big buffer.
const INAT_OBS_PER_PAGE = 24;
const INAT_PHOTOS_PER_PAGE = 6;

async function resolveInatTaxon(sciName) {
  if (sciName in inatTaxonCache) return inatTaxonCache[sciName];
  const isSsp = sciName.trim().split(" ").length >= 3;
  const rank = isSsp ? "subspecies" : "species";
  const taxaData = await fetch(
    `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(sciName)}&rank=${rank}&per_page=10`
  ).then(r => r.json());
  const exact = (taxaData.results || []).find(
    t => t.name.toLowerCase() === sciName.toLowerCase()
  );
  const id = exact ? exact.id : null;
  inatTaxonCache[sciName] = id;
  return id;
}

function obsToImgs(results, sciName) {
  const isSsp = sciName.trim().split(" ").length >= 3;
  const nameLower = sciName.toLowerCase();
  const imgs = [];
  (results || []).forEach(obs => {
    // Verify the observation belongs to the right taxon:
    // - For subspecies pages: exact match only (prevents parent-species bleed)
    // - For species pages: accept exact match OR any subspecies of this species
    //   (obs.taxon.name may be "Bubo bubo bubo" which is still correct for the Bubo bubo page)
    //   but reject genuinely different species (e.g. "Bubo virginianus")
    const obsName = (obs.taxon?.name || "").toLowerCase();
    if (isSsp) {
      if (obsName !== nameLower) return;
    } else {
      // Accept: exact match, or trinomial starting with "genus species "
      if (obsName !== nameLower && !obsName.startsWith(nameLower + " ")) return;
    }
    (obs.photos || []).forEach(ph => {
      if ((ph.license_code || "").toLowerCase() === "cc0")
        imgs.push({
          url:   ph.url?.replace("square", "medium"),
          thumb: ph.url,
          attr:  ph.attribution || "",
          link:  `https://www.inaturalist.org/observations/${obs.id}`,
          place: obs.place_guess || "",
          // quality_grade from parent obs — used for ordering
          grade: obs.quality_grade === "research" ? 1 : 0,
        });
    });
  });
  return imgs;
}

function buildObsUrl(sciName, taxonId, page) {
  const isSsp = sciName.trim().split(" ").length >= 3;
  const rankPin = (taxonId && isSsp) ? "&lrank=subspecies&hrank=subspecies" : "";
  const base = taxonId
    ? `https://api.inaturalist.org/v1/observations?taxon_id=${taxonId}${rankPin}`
    : `https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(sciName)}`;
  return `${base}&quality_grade=research&license=cc0&photos=true&per_page=${INAT_OBS_PER_PAGE}&page=${page}&order=votes&order_by=votes`;
}

function useINat(sciName) {
  const [photos, setPhotos]           = useState([]);
  const [loading, setLoading]         = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(false);
  // We track which obs page we've fetched up to, and how many photos we've shown
  const stateRef = useRef({ obsPage: 1, totalObs: 0, taxonId: null, buffer: [] });

  useEffect(() => {
    if (!sciName) return;
    let cancelled = false;
    setPhotos([]); setHasMore(false); setLoading(true);
    stateRef.current = { obsPage: 1, totalObs: 0, taxonId: null, buffer: [] };
    (async () => {
      try {
        const taxonId = await resolveInatTaxon(sciName);
        if (cancelled) return;
        stateRef.current.taxonId = taxonId;
        const data = await fetch(buildObsUrl(sciName, taxonId, 1)).then(r => r.json());
        if (cancelled) return;
        const imgs = obsToImgs(data.results, sciName);
        stateRef.current.totalObs = data.total_results || 0;
        stateRef.current.buffer = imgs;
        const show = imgs.slice(0, INAT_PHOTOS_PER_PAGE);
        const remaining = imgs.slice(INAT_PHOTOS_PER_PAGE);
        stateRef.current.buffer = remaining;
        const moreInBuffer = remaining.length > 0;
        const moreOnServer = stateRef.current.totalObs > INAT_OBS_PER_PAGE;
        setPhotos(show);
        setHasMore(moreInBuffer || moreOnServer);
        setLoading(false);
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [sciName]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !sciName) return;
    setLoadingMore(true);
    const s = stateRef.current;
    try {
      // First drain the buffer from previously fetched observations
      if (s.buffer.length >= INAT_PHOTOS_PER_PAGE) {
        const show = s.buffer.slice(0, INAT_PHOTOS_PER_PAGE);
        s.buffer = s.buffer.slice(INAT_PHOTOS_PER_PAGE);
        setPhotos(prev => [...prev, ...show]);
        setHasMore(s.buffer.length > 0 || s.totalObs > s.obsPage * INAT_OBS_PER_PAGE);
      } else {
        // Need to fetch the next obs page
        const nextPage = s.obsPage + 1;
        if (nextPage * INAT_OBS_PER_PAGE - INAT_OBS_PER_PAGE >= s.totalObs && s.buffer.length === 0) {
          setHasMore(false);
        } else {
          const data = await fetch(buildObsUrl(sciName, s.taxonId, nextPage)).then(r => r.json());
          s.obsPage = nextPage;
          const newImgs = [...s.buffer, ...obsToImgs(data.results, sciName)];
          const show = newImgs.slice(0, INAT_PHOTOS_PER_PAGE);
          s.buffer = newImgs.slice(INAT_PHOTOS_PER_PAGE);
          setPhotos(prev => [...prev, ...show]);
          setHasMore(s.buffer.length > 0 || s.totalObs > nextPage * INAT_OBS_PER_PAGE);
        }
      }
    } catch {}
    setLoadingMore(false);
  }, [sciName, loadingMore]);

  return { photos, loading, loadingMore, hasMore, loadMore };
}

// Expand abbreviated MDD subspecies name to full trinomial for iNat search
// e.g. "T. a. acanthion" + "Tachyglossus aculeatus" -> "Tachyglossus aculeatus acanthion"
function expandSspName(abbrev, parentSci) {
  const parts = (parentSci||"").trim().split(" ");
  if (parts.length < 2) return abbrev;
  const [genus, species] = parts;
  const tokens = abbrev.trim().split(" ");
  if (tokens.length >= 3 && !abbrev.includes(".")) return abbrev;
  const epithet = [...tokens].reverse().find(t => !t.includes("."));
  return epithet ? `${genus} ${species} ${epithet}` : abbrev;
}

function Badge({ status, large }) {
  const m = SM[status] || SM.NE;
  return <span style={{ background: m.c+"22", color: m.c, border: `1px solid ${m.c}55`, borderRadius: 4, padding: large?"3px 10px":"2px 6px", fontSize: large?12:10, fontWeight:700, fontFamily:"monospace", whiteSpace:"nowrap" }}>{status||"NE"}</span>;
}

function InfoRow({ label, value, mono }) {
  if (!value) return null;
  return (
    <div style={{ display:"flex", gap:10, padding:"7px 0", borderBottom:"1px solid #0a1628", fontSize:13 }}>
      <div style={{ color:"#475569", minWidth:130, flexShrink:0, fontSize:12 }}>{label}</div>
      <div style={{ color:"#cbd5e1", fontFamily:mono?"monospace":"inherit", fontSize:mono?11:13 }}>{value}</div>
    </div>
  );
}

function PhotoGalleryRaw({ photos, sciName, hasMore, loadMore, loadingMore }) {
  const [idx, setIdx] = useState(0);
  // Keep selected index in bounds when more photos load in
  const safeIdx = Math.min(idx, photos.length - 1);
  const p = photos[safeIdx];
  if (!p) return null;
  return (
    <div>
      <div style={{ position:"relative", borderRadius:10, overflow:"hidden", marginBottom:8, background:"#0a0a0a" }}>
        <img src={p.url} alt={sciName} style={{ width:"100%", height:220, objectFit:"cover", display:"block" }} onError={e=>e.target.style.display="none"} />
        <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"linear-gradient(transparent,#000000aa)", padding:"20px 10px 8px", fontSize:10, color:"#ccc" }}>
          CC0 · {p.attr.replace("(c) ","© ")}{p.place?` · ${p.place}`:""} · <a href={p.link} target="_blank" rel="noreferrer" style={{ color:"#7dd3fc", textDecoration:"none" }}>iNaturalist ↗</a>
        </div>
        {photos.length>1 && (
          <div style={{ position:"absolute", top:"50%", left:0, right:0, transform:"translateY(-50%)", display:"flex", justifyContent:"space-between", pointerEvents:"none" }}>
            <button onClick={e=>{e.stopPropagation();setIdx(i=>Math.max(0,i-1));}} style={{ pointerEvents:"auto", background:"#00000066", border:"none", color:"#fff", fontSize:18, padding:"4px 10px", cursor:"pointer", borderRadius:"0 6px 6px 0", opacity:safeIdx>0?1:0 }}>‹</button>
            <button onClick={e=>{e.stopPropagation();setIdx(i=>Math.min(photos.length-1,i+1));}} style={{ pointerEvents:"auto", background:"#00000066", border:"none", color:"#fff", fontSize:18, padding:"4px 10px", cursor:"pointer", borderRadius:"6px 0 0 6px", opacity:safeIdx<photos.length-1?1:0 }}>›</button>
          </div>
        )}
      </div>
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
        {photos.map((ph,i)=>(
          <img key={i} src={ph.thumb} alt="" onClick={()=>setIdx(i)}
            style={{ width:46, height:46, objectFit:"cover", borderRadius:6, cursor:"pointer", border:`2px solid ${i===safeIdx?"#7dd3fc":"transparent"}`, opacity:i===safeIdx?1:0.5, transition:"all 0.15s" }}/>
        ))}
        {hasMore && (
          <button onClick={loadMore} disabled={loadingMore}
            style={{ height:46, padding:"0 10px", background:"#07101f", border:"1px solid #1e3a5f", borderRadius:6, color:loadingMore?"#334155":"#7dd3fc", fontSize:11, cursor:loadingMore?"default":"pointer", flexShrink:0 }}>
            {loadingMore ? "…" : "More ›"}
          </button>
        )}
      </div>
      <div style={{ marginTop:6, fontSize:10, color:"#1e3a5f" }}>{safeIdx+1} / {photos.length}{hasMore?" (more available)":""}</div>
    </div>
  );
}

function PhotoGallery({ sciName }) {
  const { photos, loading, loadingMore, hasMore, loadMore } = useINat(sciName);
  if (loading) return <div style={{ textAlign:"center", padding:32, color:"#475569" }}><div style={{ fontSize:32 }}>📸</div><div style={{ fontSize:12, marginTop:8 }}>Loading CC0 photos…</div></div>;
  if (!photos.length) return <div style={{ textAlign:"center", padding:32, color:"#334155", fontSize:13 }}>No CC0 photos found on iNaturalist.</div>;
  return <PhotoGalleryRaw photos={photos} sciName={sciName} hasMore={hasMore} loadMore={loadMore} loadingMore={loadingMore}/>;
}

class IUCNErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e.message }; }
  render() {
    if (this.state.err) return (
      <div style={{ color:"#64748b", fontSize:12, padding:12, background:"#0a1628", borderRadius:6 }}>
        ⚠ Render error: {this.state.err}
      </div>
    );
    return this.props.children;
  }
}

function safeStr(val) {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object") return JSON.stringify(val).slice(0, 200);
  return String(val);
}

function IUCNPanel({ sciName, taxon }) {
  const { data, loading, error } = useIUCN(sciName);
  if (loading) return <div style={{ color:"#475569", fontSize:12, textAlign:"center", padding:20 }}>Looking up IUCN data…</div>;
  if (error)   return <div style={{ color:"#64748b", fontSize:12, padding:12, background:"#0a1628", borderRadius:6, lineHeight:1.6 }}>ℹ {error}</div>;
  if (!data)   return null;

  const a   = data.assessment || {};
  const t   = data.taxon || {};
  const doc = a.documentation || {};
  const sup = a.supplementary_info || {};

  // Helper: extract string from {description:{en:"..."}} or plain string
  const str = (v) => {
    if (!v) return null;
    if (typeof v === "string") return v;
    if (v.description?.en) return v.description.en;
    if (v.description && typeof v.description === "string") return v.description;
    if (v.code) return v.code;
    if (v.name) return v.name;
    return null;
  };

  // Strip HTML tags from narrative text
  const stripHtml = (s) => s ? s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;

  const catCode = (a.red_list_category || {}).code;
  const trend   = str(a.population_trend);
  const sisId   = t.sis_id;
  const sisUrl  = a.url || (sisId ? `https://www.iucnredlist.org/species/${sisId}` : null);

  // Narratives are all inside a.documentation
  const narratives = {
    rationale:    stripHtml(doc.rationale),
    population:   stripHtml(doc.population),
    habitat:      stripHtml(doc.habitats),
    threats:      stripHtml(doc.threats),
    conservation: stripHtml(doc.measures),
    use_trade:    stripHtml(doc.use_trade),
    range:        stripHtml(doc.range),
  };

  // Structured arrays
  const habitats = Array.isArray(a.habitats) ? a.habitats : [];
  const threats  = Array.isArray(a.threats)  ? a.threats  : [];

  // Population estimate from supplementary_info
  const popSize  = sup.population_size;
  const genLen   = sup.generational_length ? `${parseFloat(sup.generational_length).toFixed(1)} yrs` : null;
  const eoo      = sup.estimated_extent_of_occurence
    ? `${Math.round(parseFloat(sup.estimated_extent_of_occurence)).toLocaleString()} km²` : null;

  const NarrBlock = ({label, text}) => {
    const s = safeStr(text);
    if (!s) return null;
    return (
      <div style={{ marginTop:12 }}>
        <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>{label}</div>
        <div style={{ fontSize:12, color:"#64748b", lineHeight:1.7 }}>{s.slice(0,600)}{s.length>600?"…":""}</div>
      </div>
    );
  };

  return (
    <div>
      {catCode && (
        <div style={{ marginBottom:14, padding:"12px 14px", background:"#0a1628", borderRadius:8 }}>
          <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>IUCN Red List Category</div>
          <Badge status={catCode} large />
          {a.year_published && <span style={{ color:"#475569", marginLeft:8, fontSize:11 }}>({a.year_published})</span>}
        </div>
      )}
      <InfoRow label="Population trend"     value={trend} />
      <InfoRow label="Criteria"             value={a.criteria} />
      <InfoRow label="Population size"      value={popSize ? String(popSize) : null} />
      <InfoRow label="Generation length"    value={genLen} />
      <InfoRow label="Extent of occurrence" value={eoo} />
      <InfoRow label="No. of locations"     value={sup.number_of_locations ? String(sup.number_of_locations) : null} />
      {(a.possibly_extinct || a.possibly_extinct_in_the_wild) && (
        <InfoRow label="Possibly extinct" value={a.possibly_extinct_in_the_wild ? "⚠ In the wild" : "⚠ Yes"} />
      )}

      {threats.length>0 && (() => {
        // Group leaf threats under their parent category (code "5_1_1" → parent "5_1")
        const isUnknown = s => !s || s.toLowerCase().includes("unknown") || s.toLowerCase().includes("unrecorded");
        const groups = [];
        const groupMap = {};
        threats.forEach(threat => {
          if (isUnknown(threat.description?.en)) return;
          const code = threat.code || "";
          const parts = code.split("_");
          // Parent code = all but last segment, e.g. "5_1_1" → "5_1"
          const parentCode = parts.length > 1 ? parts.slice(0, -1).join("_") : null;
          const parentName = threat.title || null; // IUCN v4 sometimes provides parent title
          // Try to find existing group with this parentCode
          if (parentCode && groupMap[parentCode]) {
            groupMap[parentCode].children.push(threat);
          } else if (parentCode) {
            const g = { parentCode, parentName, children: [threat] };
            groups.push(g);
            groupMap[parentCode] = g;
          } else {
            // Top-level threat with no parent
            groups.push({ parentCode: null, parentName: null, children: [threat] });
          }
        });
        if (groups.length === 0) return null;
        return (
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Main threats</div>
            {groups.slice(0,8).map((g,gi) => (
              <div key={gi} style={{ marginBottom:6, borderLeft:"2px solid #0f2040", paddingLeft:10 }}>
                {/* Show parent label if multiple children share it */}
                {g.children.length > 1 && (
                  <div style={{ fontSize:10, color:"#475569", marginBottom:3, fontStyle:"italic" }}>
                    {g.children[0].description?.en?.split(":")[0] || ""}
                  </div>
                )}
                {g.children.map((threat,ti) => {
                  // Leaf name: strip parent prefix if present (e.g. "Hunting…: Intentional use")
                  const fullName = threat.description?.en || "";
                  const colonIdx = fullName.indexOf(":");
                  const leafName = g.children.length > 1 && colonIdx > -1
                    ? fullName.slice(colonIdx + 1).trim()
                    : fullName;
                  return (
                    <div key={ti} style={{ fontSize:12, color:"#94a3b8", padding:"3px 0", borderBottom:"1px solid #0a1628", display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8 }}>
                      <span>{leafName}</span>
                      <span style={{ whiteSpace:"nowrap", fontSize:11 }}>
                        {!isUnknown(threat.scope)    && <span style={{ color:"#475569" }}>{threat.scope}</span>}
                        {!isUnknown(threat.scope) && !isUnknown(threat.severity) && <span style={{ color:"#334155" }}> · </span>}
                        {!isUnknown(threat.severity) && <span style={{ color:"#334155" }}>{threat.severity}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })()}

      {habitats.length>0 && (
        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 }}>Habitats</div>
          {habitats.slice(0,8).map((hab,i)=>(
            <div key={i} style={{ fontSize:12, color:"#94a3b8", padding:"2px 0" }}>
              {hab.description?.en || hab.description || ""}
              {hab.suitability ? <span style={{ color:"#475569" }}> · {hab.suitability}</span> : ""}
              {hab.majorImportance==="Yes" ? <span style={{ color:"#64748b" }}> ★</span> : ""}
            </div>
          ))}
        </div>
      )}

      <NarrBlock label="Rationale"         text={narratives.rationale} />
      <NarrBlock label="Population"        text={narratives.population} />
      <NarrBlock label="Habitat & Ecology" text={narratives.habitat} />
      <NarrBlock label="Threats"           text={narratives.threats} />
      <NarrBlock label="Conservation"      text={narratives.conservation} />
      <NarrBlock label="Use & Trade"       text={narratives.use_trade} />

      {/* Assessed subspecies */}
      {data.subspecies_accounts?.length > 0 && (
        <div style={{ marginTop:14, padding:"10px 12px", background:"#07101f", borderRadius:6 }}>
          <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>IUCN-assessed subspecies</div>
          {data.subspecies_accounts.map((name,i)=>(
            <div key={i} style={{ fontSize:12, color:"#475569", fontStyle:"italic", padding:"2px 0" }}>{name}</div>
          ))}
        </div>
      )}

      {sisUrl && <a href={sisUrl} target="_blank" rel="noreferrer" style={{ display:"inline-block", marginTop:14, color:"#7dd3fc", fontSize:12, textDecoration:"none" }}>View on IUCN Red List ↗</a>}

      <div style={{ marginTop:16, paddingTop:12, borderTop:"1px solid #0f172a", fontSize:10, color:"#1e3a5f", lineHeight:1.7 }}>
        {(TAXA[taxon]||TAXA.mammals).credits.map((c,i)=><div key={i} style={{ marginBottom:2 }}>{c}</div>)}
      </div>
    </div>
  );
}

function MDDPanel({ sp, taxon }) {
  const isBird = taxon === "birds";
  const cfg = TAXA[taxon] || TAXA.mammals;
  return (
    <div>
      {sp.auth && (
        <div style={{ marginBottom:14, padding:"10px 14px", background:"#0a1628", borderRadius:8 }}>
          <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Taxonomic Authority</div>
          <div style={{ fontFamily:"monospace", fontSize:13, color:"#94a3b8" }}>{sp.auth}</div>
          {!isBird && sp.orig && sp.orig.replace(/_/g," ")!==sp.sci && (
            <div style={{ fontSize:11, color:"#334155", marginTop:4 }}>Originally: <span style={{ fontStyle:"italic" }}>{sp.orig.replace(/_/g," ")}</span></div>
          )}
        </div>
      )}
      {!isBird && <InfoRow label="MDD ID"    value={sp.mdd_id} mono />}
      {isBird  && <InfoRow label="eBird code" value={sp.sp_code} mono />}
      <InfoRow label="Other names"  value={sp.com2} />
      {!isBird && <InfoRow label="Subgenus"  value={sp.sgen?`(${sp.sgen})`:null} />}
      {!isBird && <InfoRow label="Subfamily" value={sp.sfam} />}
      {!isBird && <InfoRow label="Tribe"     value={sp.tribe} />}
      {sp.dist && (
        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Range</div>
          <div style={{ fontSize:12, color:"#64748b", lineHeight:1.6 }}>{sp.dist}</div>
        </div>
      )}
      {!isBird && <InfoRow label="Countries" value={sp.countries} />}
      {!isBird && <InfoRow label="Realm"     value={sp.realms} />}
      <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap" }}>
        {sp.dom  && <span style={{ fontSize:10, color:"#fbbf24", background:"#1c1000", border:"1px solid #fbbf2444", borderRadius:4, padding:"2px 7px" }}>🏠 Domestic</span>}
        {sp.flag && <span style={{ fontSize:10, color:"#f87171", background:"#1a0505", border:"1px solid #f8717144", borderRadius:4, padding:"2px 7px" }}>⚑ Flagged</span>}
        {sp.ex   && <span style={{ fontSize:10, color:"#94a3b8", background:"#0f172a", border:"1px solid #94a3b844", borderRadius:4, padding:"2px 7px" }}>† Extinct</span>}
      </div>
      {!isBird && sp.synonyms?.length>0 && (
        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Nominal names / synonyms</div>
          <div style={{ fontSize:11, color:"#334155", fontFamily:"monospace", lineHeight:1.8 }}>
            {sp.synonyms.slice(0,8).join(" · ")}
            {sp.synonyms.length>8 && <span style={{ color:"#1e293b" }}> +{sp.synonyms.length-8} more</span>}
          </div>
        </div>
      )}
      {sp.tax_notes && (
        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:10, color:"#334155", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>{isBird ? "Taxonomic decision" : "Taxonomy notes"}</div>
          <div style={{ fontSize:11, color:"#334155", lineHeight:1.6 }}>{sp.tax_notes.slice(0,600)}{sp.tax_notes.length>600?"…":""}</div>
        </div>
      )}
      {isBird && (
        <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:5 }}>
          {sp.botw_url && <a href={sp.botw_url} target="_blank" rel="noreferrer" style={{ color:"#7dd3fc", fontSize:12, textDecoration:"none" }}>Birds of the World ↗</a>}
          {sp.bl_url   && <a href={sp.bl_url}   target="_blank" rel="noreferrer" style={{ color:"#7dd3fc", fontSize:12, textDecoration:"none" }}>BirdLife Datazone ↗</a>}
        </div>
      )}
      <div style={{ marginTop:16, paddingTop:12, borderTop:"1px solid #0f172a", fontSize:10, color:"#1e3a5f", lineHeight:1.7 }}>
        {cfg.credits.map((c,i)=><div key={i} style={{ marginBottom:2 }}>{c}</div>)}
      </div>
    </div>
  );
}

function SubspeciesPanel({ sp, onSelectSsp, taxon }) {
  const [hov, setHov] = useState(null);
  const ssps = liveSsp(sp.ssp);
  const srcLabel = taxon==="birds" ? "AviList 2025" : "MDD v2.4";
  if (!ssps.length) return <div style={{ textAlign:"center", padding:32, color:"#334155", fontSize:13 }}>No subspecies recorded in {srcLabel}.</div>;
  return (
    <div>
      <div style={{ fontSize:11, color:"#334155", marginBottom:12 }}>{ssps.length} subspecies recognised in {srcLabel} · click to view photos</div>
      {ssps.map((name,i)=>(
        <div key={i} onClick={()=>onSelectSsp({name, parentSp:sp})}
          onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
          style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:6, marginBottom:3, background:hov===i?"#0f2040":"#07101f", cursor:"pointer", transition:"background 0.1s" }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:sc(sp.st), flexShrink:0 }}/>
          <span style={{ fontFamily:"'Playfair Display',serif", fontStyle:"italic", fontSize:13, color:"#e2e8f0", flex:1 }}>{name}</span>
          <span style={{ fontSize:11, color:"#1e3a5f" }}>📸 →</span>
        </div>
      ))}
    </div>
  );
}

function SpeciesPanel({ sp, onClose, onSelectSsp, taxon }) {
  const [tab, setTab] = useState("photos");
  const ssps = liveSsp(sp.ssp);
  const tabs = [["photos","📸","Photos"],["iucn","🛡","IUCN"],["mdd","📋",taxon==="birds"?"AviList":"MDD"],
    ...(ssps.length?[["ssp","🔬","Subspecies"]]:[])]

  // Fetch IUCN to get live status for header badge
  const { data: iucnData } = useIUCN(sp.sci);
  const liveCat = iucnData?.assessment?.red_list_category?.code;

  return (
    <div style={{ position:"fixed", right:0, top:0, bottom:0, width:370, background:"#0a1220", borderLeft:"1px solid #0f2040", display:"flex", flexDirection:"column", zIndex:100, boxShadow:"-16px 0 48px #00000099" }}>
      <div style={{ padding:"18px 18px 12px", borderBottom:"1px solid #0f172a" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, fontStyle:"italic", color:"#f1f5f9", lineHeight:1.25, marginBottom:2 }}>{sp.sci}</div>
            {sp.auth && <div style={{ fontSize:10, color:"#1e3a5f", fontFamily:"monospace", marginBottom:5 }}>{sp.auth}</div>}
            <div style={{ fontSize:13, color:"#94a3b8", marginBottom:8 }}>{sp.com||"—"}{sp.com2?<span style={{ color:"#334155", fontSize:11 }}> · {sp.com2}</span>:""}</div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
              <Badge status={liveCat || sp.st} />
              {sp.ex  && <span style={{ fontSize:10, color:"#64748b", background:"#0f172a", padding:"2px 6px", borderRadius:4 }}>† EXTINCT</span>}
              {sp.dom && <span style={{ fontSize:10, color:"#fbbf24", background:"#0f172a", padding:"2px 6px", borderRadius:4 }}>DOMESTIC</span>}
              {sp.flag && <span style={{ fontSize:10, color:"#f87171", background:"#0f172a", padding:"2px 6px", borderRadius:4 }}>⚑ FLAGGED</span>}
              {ssps.length>0 && <span style={{ fontSize:10, color:"#7dd3fc", background:"#0f172a", padding:"2px 6px", borderRadius:4 }}>{ssps.length} ssp.</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#475569", fontSize:22, cursor:"pointer", lineHeight:1, padding:2 }}>✕</button>
        </div>
        <div style={{ marginTop:8, fontSize:11, color:"#1e3a5f", fontFamily:"monospace" }}>
          {sp.ord} › {sp.fam}{sp.sfam?` › ${sp.sfam}`:""} › <span style={{ fontStyle:"italic" }}>{sp.gen}</span>
        </div>
        {sp.realms && <div style={{ marginTop:4, fontSize:10, color:"#1e293b" }}>🌐 {sp.realms}</div>}
      </div>
      <div style={{ display:"flex", borderBottom:"1px solid #0f172a" }}>
        {tabs.map(([id,icon,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:"8px 0 4px", fontSize:16, border:"none", background:tab===id?"#0f172a":"none", borderBottom:`2px solid ${tab===id?"#7dd3fc":"transparent"}`, color:tab===id?"#f1f5f9":"#334155", cursor:"pointer" }}>{icon}</button>
        ))}
      </div>
      <div style={{ display:"flex", borderBottom:"1px solid #071020" }}>
        {tabs.map(([id,,label])=>(
          <div key={id} style={{ flex:1, textAlign:"center", fontSize:9, color:tab===id?"#475569":"#1e293b", padding:"2px 0", letterSpacing:"0.05em", textTransform:"uppercase" }}>{label}</div>
        ))}
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:16 }}>
        {tab==="photos" && <PhotoGallery sciName={sp.sci}/>}
        {tab==="iucn"   && <IUCNErrorBoundary><IUCNPanel sciName={sp.sci}/></IUCNErrorBoundary>}
        {tab==="mdd"    && <MDDPanel    sp={sp} taxon={taxon}/>}
        {tab==="ssp"    && <SubspeciesPanel sp={sp} onSelectSsp={onSelectSsp}/>}
      </div>
      <div style={{ padding:"7px 14px", borderTop:"1px solid #0f172a", fontSize:9, color:"#1e293b", display:"flex", justifyContent:"space-between" }}>
        <span>{taxon==="birds"?"AviList 2025":"MDD v2.4"} · iNaturalist CC0</span><span>IUCN Red List v4</span>
      </div>
    </div>
  );
}


// ── Subspecies detail panel ────────────────────────────────────────────────
function SubspeciesDetailPanel({ ssp, onClose, onOpenParent, taxon }) {
  const { name, parentSp } = ssp;
  // Birds: ssp names are already full trinomials; mammals: need expansion from abbreviation
  const fullName = taxon === "birds" ? name : expandSspName(name, parentSp.sci);
  const { photos, loading, loadingMore, hasMore, loadMore } = useINat(fullName);
  const [tab, setTab] = useState("photos");
  const tabs = [["photos","📸","Photos"],["iucn","🛡","IUCN"]];

  // Fetch own IUCN status for badge in header
  const { data: iucnData } = useIUCN(fullName);
  const ownCatCode = iucnData?.assessment?.red_list_category?.code;
  const ownAssessed = !!ownCatCode;

  return (
    <div style={{ position:"fixed", right:0, top:0, bottom:0, width:370, background:"#0a1220", borderLeft:"1px solid #0f2040", display:"flex", flexDirection:"column", zIndex:101, boxShadow:"-16px 0 48px #00000099" }}>
      {/* Header */}
      <div style={{ padding:"18px 18px 12px", borderBottom:"1px solid #0f172a" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div onClick={onOpenParent} style={{ fontSize:11, color:"#1e3a5f", fontFamily:"monospace", marginBottom:6, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ fontSize:13 }}>←</span>
              <span style={{ fontStyle:"italic" }}>{parentSp.sci}</span>
              <span style={{ color:"#0f2040" }}>· {parentSp.com||""}</span>
            </div>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, fontStyle:"italic", color:"#f1f5f9", lineHeight:1.25, marginBottom:4 }}>{name}</div>
            <div style={{ fontSize:11, color:"#334155", marginBottom:8 }}>Subspecies of <span style={{ fontStyle:"italic", color:"#64748b" }}>{parentSp.sci}</span></div>
            {ownAssessed
              ? <Badge status={ownCatCode}/>
              : <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <Badge status={parentSp.st}/>
                  <span style={{ fontSize:10, color:"#334155", fontStyle:"italic" }}>parent species</span>
                </div>
            }
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#475569", fontSize:22, cursor:"pointer", lineHeight:1, padding:2 }}>✕</button>
        </div>
        <div style={{ marginTop:8, fontSize:11, color:"#1e3a5f", fontFamily:"monospace" }}>
          {parentSp.ord} › {parentSp.fam}{parentSp.sfam?` › ${parentSp.sfam}`:""} › <span style={{ fontStyle:"italic" }}>{parentSp.gen}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid #0f172a" }}>
        {tabs.map(([id,icon,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:"8px 4px", background:"none", border:"none", borderBottom: tab===id ? "2px solid #3b82f6" : "2px solid transparent", color: tab===id ? "#93c5fd" : "#334155", fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
            <span>{icon}</span><span style={{ textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:"auto", padding:16 }}>
        {tab === "photos" && <>
          {loading && (
            <div style={{ textAlign:"center", padding:32, color:"#475569" }}>
              <div style={{ fontSize:32 }}>📸</div>
              <div style={{ fontSize:12, marginTop:8 }}>Searching iNaturalist for <span style={{ fontStyle:"italic" }}>{fullName}</span>…</div>
            </div>
          )}
          {!loading && photos.length === 0 && (
            <div style={{ textAlign:"center", padding:32 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🔍</div>
              <div style={{ fontSize:13, color:"#334155", marginBottom:8 }}>No CC0 photos found for</div>
              <div style={{ fontFamily:"'Playfair Display',serif", fontStyle:"italic", fontSize:14, color:"#64748b", marginBottom:16 }}>{fullName}</div>
              <div style={{ fontSize:11, color:"#1e293b", lineHeight:1.7 }}>
                Subspecies records on iNaturalist are often filed under the parent species.<br/>
                <span onClick={onOpenParent} style={{ color:"#7dd3fc", cursor:"pointer" }}>View parent species photos →</span>
              </div>
            </div>
          )}
          {!loading && photos.length > 0 && <PhotoGalleryRaw photos={photos} sciName={fullName} hasMore={hasMore} loadMore={loadMore} loadingMore={loadingMore}/>}
        </>}
        {tab === "iucn" && <IUCNErrorBoundary><IUCNPanel sciName={fullName} taxon={taxon}/></IUCNErrorBoundary>}
      </div>

      <div style={{ padding:"7px 14px", borderTop:"1px solid #0f172a", fontSize:9, color:"#1e293b", display:"flex", justifyContent:"space-between" }}>
        <span>{taxon==="birds"?"AviList 2025":"MDD v2.4"} subspecies</span><span>iNaturalist CC0</span>
      </div>
    </div>
  );
}

// ── Tree components ────────────────────────────────────────────────────────
function SubspeciesRows({ sp, onSelectSsp }) {
  const [hov, setHov] = useState(null);
  return (
    <div>
      {liveSsp(sp.ssp).map((name,i)=>(
        <div key={i} onClick={()=>onSelectSsp({name, parentSp: sp})}
          onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
          style={{ display:"flex", alignItems:"center", gap:7, padding:"4px 10px 4px 50px", cursor:"pointer", borderRadius:6, background:hov===i?"#070f1d":"transparent", transition:"background 0.1s" }}>
          <div style={{ width:3, height:3, borderRadius:"50%", background:"#1e3a5f", flexShrink:0 }}/>
          <span style={{ fontFamily:"'Playfair Display',serif", fontStyle:"italic", fontSize:11, color:"#475569" }}>{name}</span>
          <span style={{ fontSize:9, color:"#1e3a5f", marginLeft:"auto" }}>📸</span>
        </div>
      ))}
    </div>
  );
}

function SpeciesRow({ sp, onClick, isSelected, showSsp, onSelectSsp }) {
  const [hov, setHov] = useState(false);
  const [sspOpen, setSspOpen] = useState(false);
  const ssps = liveSsp(sp.ssp);
  const hasSsp = showSsp && ssps.length > 0;
  return (
    <div>
      <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 10px 5px 28px", cursor:"pointer", borderRadius:6, background:isSelected?"#0f2040":hov?"#070f1d":"transparent", transition:"background 0.1s" }}>
        {hasSsp
          ? <span onClick={e=>{e.stopPropagation();setSspOpen(o=>!o);}} style={{ color:"#1e3a5f", fontSize:9, width:10, textAlign:"center", cursor:"pointer", flexShrink:0 }}>{sspOpen?"▾":"▸"}</span>
          : <div style={{ width:10, flexShrink:0 }}/>
        }
        <div style={{ width:6, height:6, borderRadius:"50%", background:sc(sp.st), flexShrink:0 }} onClick={onClick}/>
        <div style={{ flex:1, minWidth:0 }} onClick={onClick}>
          <span style={{ fontFamily:"'Playfair Display',serif", fontStyle:"italic", fontSize:13, color: sp.ex?"#475569":"#e2e8f0" }}>{sp.sci}</span>
          {sp.com && <span style={{ fontSize:11, color:"#334155", marginLeft:6 }}>{sp.com}</span>}
        </div>
        {sp.ex   && <span style={{ fontSize:9, color:"#475569" }} title="Extinct">†</span>}
        {sp.dom  && <span style={{ fontSize:9 }} title="Domestic">🏠</span>}
        {sp.flag && <span style={{ fontSize:9, color:"#f87171" }} title="Flagged">⚑</span>}
        {hasSsp  && <span style={{ fontSize:9, color:"#1e3a5f" }}>{ssps.length}ssp</span>}
        <Badge status={sp.st}/>
      </div>
      {sspOpen && hasSsp && <SubspeciesRows sp={sp} onSelectSsp={onSelectSsp}/>}
    </div>
  );
}

function GenusNode({ name, spp, onSelect, selected, showSsp, onSelectSsp }) {
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(false);
  const threatened = useMemo(()=>spp.filter(s=>["CR","EN","VU"].includes(s.st)).length,[spp]);

  // Group by subgenus if >1 subgenus present in this genus
  const subgenera = useMemo(()=>{
    const sgens = new Set(spp.map(s=>s.sgen).filter(Boolean));
    if (sgens.size < 2) return null;
    const groups = {};
    spp.forEach(s => {
      const sg = s.sgen || "(unplaced)";
      if (!groups[sg]) groups[sg] = [];
      groups[sg].push(s);
    });
    return groups;
  }, [spp]);

  return (
    <div>
      <div onClick={()=>setOpen(o=>!o)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 10px 4px 16px", cursor:"pointer", borderRadius:6, background:hov?"#070f1d":"transparent" }}>
        <span style={{ color:"#1e3a5f", fontSize:10, width:12, textAlign:"center" }}>{open?"▾":"▸"}</span>
        <span style={{ fontFamily:"'Playfair Display',serif", fontStyle:"italic", fontSize:13, color:"#64748b" }}>{name}</span>
        <span style={{ fontSize:10, color:"#1e293b" }}>({spp.length})</span>
        {threatened>0 && <span style={{ fontSize:9, color:"#fb923c", marginLeft:2 }}>⚠ {threatened}</span>}
      </div>
      {open && (subgenera
        ? Object.entries(subgenera).sort(([a],[b])=>a.localeCompare(b)).map(([sg, sgSpp])=>(
            <SubgenusNode key={sg} name={sg} spp={sgSpp} onSelect={onSelect} selected={selected} showSsp={showSsp} onSelectSsp={onSelectSsp}/>
          ))
        : spp.map((sp,i)=>(
            <SpeciesRow key={i} sp={sp} onClick={()=>onSelect(sp)} isSelected={selected?.sci===sp.sci} showSsp={showSsp} onSelectSsp={onSelectSsp}/>
          ))
      )}
    </div>
  );
}

function SubgenusNode({ name, spp, onSelect, selected, showSsp, onSelectSsp }) {
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(false);
  const threatened = useMemo(()=>spp.filter(s=>["CR","EN","VU"].includes(s.st)).length,[spp]);
  return (
    <div>
      <div onClick={()=>setOpen(o=>!o)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        style={{ display:"flex", alignItems:"center", gap:6, padding:"3px 10px 3px 28px", cursor:"pointer", borderRadius:6, background:hov?"#070f1d":"transparent" }}>
        <span style={{ color:"#1e293b", fontSize:9, width:10, textAlign:"center" }}>{open?"▾":"▸"}</span>
        <span style={{ fontFamily:"'Playfair Display',serif", fontStyle:"italic", fontSize:12, color:"#475569" }}>({name})</span>
        <span style={{ fontSize:9, color:"#1e293b" }}>{spp.length}</span>
        {threatened>0 && <span style={{ fontSize:9, color:"#fb923c" }}>⚠ {threatened}</span>}
      </div>
      {open && spp.map((sp,i)=>(
        <SpeciesRow key={i} sp={sp} onClick={()=>onSelect(sp)} isSelected={selected?.sci===sp.sci} showSsp={showSsp} onSelectSsp={onSelectSsp}/>
      ))}
    </div>
  );
}

function FamilyNode({ name, genera, onSelect, selected, showSsp, onSelectSsp }) {
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(false);
  const { total, threatened } = useMemo(()=>{
    let total=0, threatened=0;
    Object.values(genera).forEach(spp=>spp.forEach(s=>{total++;if(["CR","EN","VU"].includes(s.st))threatened++;}));
    return {total,threatened};
  },[genera]);

  // Group genera by subfamily if >1 subfamily present in this family
  const subfamilies = useMemo(()=>{
    const allSpp = Object.values(genera).flat();
    const sfams = new Set(allSpp.map(s=>s.sfam).filter(Boolean));
    if (sfams.size < 2) return null;
    // Map genus → subfamily (use majority vote per genus)
    const genSfam = {};
    Object.entries(genera).forEach(([gen, spp]) => {
      const counts = {};
      spp.forEach(s => { if (s.sfam) counts[s.sfam] = (counts[s.sfam]||0) + 1; });
      const best = Object.entries(counts).sort(([,a],[,b])=>b-a)[0];
      genSfam[gen] = best ? best[0] : "(unplaced)";
    });
    const groups = {};
    Object.entries(genera).forEach(([gen, spp]) => {
      const sf = genSfam[gen];
      if (!groups[sf]) groups[sf] = {};
      groups[sf][gen] = spp;
    });
    return groups;
  }, [genera]);

  return (
    <div style={{ marginBottom:1 }}>
      <div onClick={()=>setOpen(o=>!o)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px 5px 8px", cursor:"pointer", borderRadius:6, background:hov?"#070f1d":"transparent" }}>
        <span style={{ color:"#1e3a5f", fontSize:11, width:14, textAlign:"center" }}>{open?"▾":"▸"}</span>
        <span style={{ fontSize:13, fontWeight:600, color:"#7dd3fc" }}>{name}</span>
        <span style={{ fontSize:10, color:"#1e293b", marginLeft:4 }}>{total} spp</span>
        {threatened>0 && <span style={{ fontSize:9, color:"#f87171", background:"#1a0505", padding:"1px 5px", borderRadius:3 }}>{threatened} threatened</span>}
      </div>
      {open && (subfamilies
        ? Object.entries(subfamilies).sort(([a],[b])=>a.localeCompare(b)).map(([sf, sfGenera])=>(
            <SubfamilyNode key={sf} name={sf} genera={sfGenera} onSelect={onSelect} selected={selected} showSsp={showSsp} onSelectSsp={onSelectSsp}/>
          ))
        : Object.entries(genera).sort(([a],[b])=>a.localeCompare(b)).map(([genus,spp])=>(
            <GenusNode key={genus} name={genus} spp={spp} onSelect={onSelect} selected={selected} showSsp={showSsp} onSelectSsp={onSelectSsp}/>
          ))
      )}
    </div>
  );
}

function SubfamilyNode({ name, genera, onSelect, selected, showSsp, onSelectSsp }) {
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(false);
  const { total, threatened } = useMemo(()=>{
    let total=0, threatened=0;
    Object.values(genera).forEach(spp=>spp.forEach(s=>{total++;if(["CR","EN","VU"].includes(s.st))threatened++;}));
    return {total,threatened};
  },[genera]);
  return (
    <div style={{ marginLeft:8, marginBottom:1 }}>
      <div onClick={()=>setOpen(o=>!o)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 10px 4px 10px", cursor:"pointer", borderRadius:6, background:hov?"#070f1d":"transparent" }}>
        <span style={{ color:"#1e293b", fontSize:10, width:12, textAlign:"center" }}>{open?"▾":"▸"}</span>
        <span style={{ fontSize:12, fontWeight:500, color:"#38bdf8" }}>{name}</span>
        <span style={{ fontSize:10, color:"#1e293b" }}>{total} spp</span>
        {threatened>0 && <span style={{ fontSize:9, color:"#f87171" }}>⚠ {threatened}</span>}
      </div>
      {open && Object.entries(genera).sort(([a],[b])=>a.localeCompare(b)).map(([genus,spp])=>(
        <GenusNode key={genus} name={genus} spp={spp} onSelect={onSelect} selected={selected} showSsp={showSsp} onSelectSsp={onSelectSsp}/>
      ))}
    </div>
  );
}

function OrderNode({ name, families, onSelect, selected, filterStatus, filterRealm, showSsp, onSelectSsp }) {
  const [open, setOpen] = useState(false);
  const filtered = useMemo(()=>{
    const r={};
    Object.entries(families).forEach(([fam,genera])=>{
      const fg={};
      Object.entries(genera).forEach(([gen,spp])=>{
        const f=spp.filter(s=>(!filterStatus||s.st===filterStatus)&&(!filterRealm||(s.realms&&s.realms.includes(filterRealm))));
        if(f.length)fg[gen]=f;
      });
      if(Object.keys(fg).length)r[fam]=fg;
    });
    return r;
  },[families,filterStatus,filterRealm]);
  const total = useMemo(()=>Object.values(filtered).reduce((s,g)=>s+Object.values(g).reduce((s2,spp)=>s2+spp.length,0),0),[filtered]);
  if(total===0)return null;
  return (
    <div style={{ marginBottom:3 }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", cursor:"pointer", background:open?"#0a1e38":"#070f1d", borderRadius:8, border:`1px solid ${open?"#1e3a5f":"#0a1628"}`, transition:"all 0.15s" }}>
        <span style={{ color:"#1e3a5f", fontSize:12 }}>{open?"▾":"▸"}</span>
        <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:14, color:"#e2e8f0", flex:1 }}>{name}</span>
        <span style={{ fontSize:10, color:"#1e3a5f" }}>{Object.keys(filtered).length} fam · {total} spp</span>
      </div>
      {open && (
        <div style={{ paddingTop:3 }}>
          {Object.entries(filtered).sort(([a],[b])=>a.localeCompare(b)).map(([fam,genera])=>(
            <FamilyNode key={fam} name={fam} genera={genera} onSelect={onSelect} selected={selected} showSsp={showSsp} onSelectSsp={onSelectSsp}/>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({ query, allSpecies, onSelect }) {
  const results = useMemo(()=>{
    if(!query||query.length<2)return[];
    const q=query.toLowerCase();
    return allSpecies.filter(sp=>
      sp.sci.toLowerCase().includes(q)||
      (sp.com&&sp.com.toLowerCase().includes(q))||
      (sp.com2&&sp.com2.toLowerCase().includes(q))||
      sp.synonyms?.some(s=>s.toLowerCase().includes(q))||
      liveSsp(sp.ssp).some(s=>s.toLowerCase().includes(q))
    ).slice(0,60);
  },[query,allSpecies]);
  return (
    <div style={{ padding:"8px 0" }}>
      <div style={{ fontSize:11, color:"#334155", padding:"4px 12px 8px" }}>{results.length} results</div>
      {results.map((sp,i)=><SpeciesRow key={i} sp={sp} onClick={()=>onSelect(sp)} isSelected={false} showSsp={false}/>)}
    </div>
  );
}

// ── Taxon dataset config ──────────────────────────────────────────────────
const TAXA = {
  mammals: {
    key: "mammals", icon: "🦣", label: "Mammals",
    file: "/mdd_full.json",
    subtitle: d => `MDD v2.4 · ${d.toLocaleString()} species · iNaturalist CC0`,
    credits: [
      "Mammal Diversity Database (2026). MDD v2.4. Zenodo. doi:10.5281/zenodo.18135819",
      "IUCN 2025. IUCN Red List of Threatened Species. Version 2025-2. www.iucnredlist.org"
    ],
    hasRealms: true,
  },
  birds: {
    key: "birds", icon: "🐦", label: "Birds",
    file: "/birds_full.json",
    subtitle: d => `AviList 2025 · ${d.toLocaleString()} species · iNaturalist CC0`,
    credits: [
      "AviList Core Team. 2025. AviList: The Global Avian Checklist, v2025. https://doi.org/10.2173/avilist.v2025",
      "IUCN 2025. IUCN Red List of Threatened Species. Version 2025-2. www.iucnredlist.org"
    ],
    hasRealms: false,
  },
};

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const [taxon, setTaxon]       = useState("mammals");
  const [tree, setTree]         = useState(null);
  const [allSp, setAllSp]       = useState([]);
  const [counts, setCounts]     = useState({});
  const [selected, setSelected]     = useState(null);
  const [selectedSsp, setSelectedSsp] = useState(null);
  const [search, setSearch]           = useState("");
  const [filter, setFilter]     = useState(null);
  const [realmFilter, setRealmFilter] = useState(null);
  const [showSsp, setShowSsp]   = useState(true);
  const [loadErr, setLoadErr]   = useState(null);
  const [loading, setLoading]   = useState(false);

  const loadTaxon = useCallback((key) => {
    const cfg = TAXA[key];
    setTree(null); setAllSp([]); setCounts({}); setSelected(null);
    setSelectedSsp(null); setSearch(""); setFilter(null); setRealmFilter(null);
    setLoadErr(null); setLoading(true);
    fetch(cfg.file)
      .then(r=>{ if(!r.ok)throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data=>{
        const t={}, c={total:0};
        Object.entries(data.tr).forEach(([order,fams])=>{
          t[order]={};
          Object.entries(fams).forEach(([fam,genera])=>{
            t[order][fam]={};
            Object.entries(genera).forEach(([genus,indices])=>{
              const spp=indices.map(i=>data.sp[i]);
              spp.sort((a,b)=>(a.sort||0)-(b.sort||0));
              t[order][fam][genus]=spp;
              spp.forEach(sp=>{c.total++;c[sp.st]=(c[sp.st]||0)+1;});
            });
          });
        });
        setTree(t); setCounts(c);
        setAllSp(data.sp.slice().sort((a,b)=>(a.sort||0)-(b.sort||0)));
        setLoading(false);
        document.getElementById("splash").style.display="none";
      })
      .catch(e=>{setLoadErr(e.message); setLoading(false); document.getElementById("splash").style.display="none";});
  }, []);

  useEffect(()=>{ loadTaxon("mammals"); },[loadTaxon]);

  const switchTaxon = useCallback((key)=>{
    if(key===taxon) return;
    setTaxon(key);
    loadTaxon(key);
  },[taxon, loadTaxon]);

  const onSelect = useCallback(sp=>{
    setSelectedSsp(null);
    setSelected(s=>s?.sci===sp.sci?null:sp);
  },[]);

  const onSelectSsp = useCallback(ssp=>{
    setSelectedSsp(ssp);
    setSelected(null);
  },[]);

  const openParentFromSsp = useCallback(()=>{
    if(selectedSsp){ setSelected(selectedSsp.parentSp); setSelectedSsp(null); }
  },[selectedSsp]);

  const realms = useMemo(()=>{
    if(!TAXA[taxon].hasRealms) return [];
    const r=new Set();
    allSp.forEach(sp=>{if(sp.realms)sp.realms.split("|").forEach(x=>r.add(x.trim()));});
    return [...r].filter(x=>x&&x!=="NA").sort();
  },[allSp, taxon]);

  const cfg = TAXA[taxon];

  if(loadErr) return <div style={{ background:"#040d1a", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#f87171", fontFamily:"monospace", padding:24 }}>⚠ {loadErr}</div>;

  const orders = tree ? Object.keys(tree).sort((a,b)=>{
    const mn=o=>Math.min(...Object.values(tree[o]).flatMap(f=>Object.values(f).flatMap(spp=>spp.map(s=>s.sort||9999))));
    return mn(a)-mn(b);
  }) : [];

  const panelWidth = (selected || selectedSsp) ? "calc(100vw - 370px)" : "100vw";

  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif", background:"#040d1a", minHeight:"100vh", color:"#e2e8f0" }}>
      <div style={{ position:"fixed", left:0, top:0, bottom:0, width:panelWidth, display:"flex", flexDirection:"column", transition:"width 0.25s ease" }}>

        {/* Header */}
        <div style={{ padding:"14px 14px 10px", background:"#040d1a", borderBottom:"1px solid #0a1628" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>

            {/* Taxon switcher */}
            <div style={{ display:"flex", background:"#070f1d", borderRadius:8, border:"1px solid #0f2040", overflow:"hidden", flexShrink:0 }}>
              {Object.values(TAXA).map(t=>(
                <button key={t.key} onClick={()=>switchTaxon(t.key)}
                  style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 10px", background:taxon===t.key?"#0f2040":"transparent", border:"none", color:taxon===t.key?"#93c5fd":"#334155", fontSize:12, cursor:"pointer", fontWeight:taxon===t.key?700:400, transition:"all 0.15s" }}>
                  <span style={{ fontSize:15 }}>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, letterSpacing:"-0.5px", color:"#f1f5f9" }}>Tree of Life</div>
              <div style={{ fontSize:10, color:"#1e3a5f" }}>{loading ? "Loading…" : cfg.subtitle(counts.total||0)}</div>
            </div>

            <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              <span style={{ fontSize:10, color:"#334155" }}>Ssp</span>
              <div onClick={()=>setShowSsp(s=>!s)} style={{ width:32, height:18, borderRadius:9, background:showSsp?"#1e3a5f":"#0f172a", border:"1px solid #1e3a5f", cursor:"pointer", position:"relative", transition:"all 0.2s" }}>
                <div style={{ position:"absolute", top:2, left:showSsp?14:2, width:12, height:12, borderRadius:"50%", background:showSsp?"#7dd3fc":"#334155", transition:"all 0.2s" }}/>
              </div>
            </div>
          </div>

          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder={`Search ${cfg.label.toLowerCase()}, common name, or subspecies…`}
            style={{ width:"100%", padding:"7px 12px", background:"#07101f", border:"1px solid #0f2040", borderRadius:7, color:"#e2e8f0", fontSize:13, outline:"none", marginBottom:8, boxSizing:"border-box" }}/>
          <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:6 }}>
            {Object.entries(SM).map(([code,m])=>(
              <button key={code} onClick={()=>setFilter(f=>f===code?null:code)} style={{ background:filter===code?m.c+"33":"transparent", border:`1px solid ${filter===code?m.c:"#0f2040"}`, color:filter===code?m.c:"#334155", borderRadius:4, padding:"2px 6px", fontSize:10, cursor:"pointer", fontWeight:700, fontFamily:"monospace", transition:"all 0.1s" }}>{code}</button>
            ))}
          </div>
          {realms.length>0 && (
            <select value={realmFilter||""} onChange={e=>setRealmFilter(e.target.value||null)}
              style={{ width:"100%", padding:"5px 8px", background:"#07101f", border:"1px solid #0f2040", borderRadius:6, color:realmFilter?"#e2e8f0":"#334155", fontSize:11, outline:"none" }}>
              <option value="">All biogeographic realms</option>
              {realms.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          )}
        </div>

        {/* Stats */}
        <div style={{ padding:"5px 12px", background:"#040c18", borderBottom:"1px solid #0a1628", display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          {loading
            ? <span style={{ fontSize:10, color:"#1e3a5f" }}>Loading dataset…</span>
            : Object.entries(SM).map(([code,m])=>counts[code]?(
              <div key={code} style={{ display:"flex", alignItems:"center", gap:3, fontSize:10 }}>
                <div style={{ width:7, height:7, borderRadius:2, background:m.c }}/>
                <span style={{ color:m.c }}>{code} </span><span style={{ color:"#334155" }}>{counts[code]}</span>
              </div>
            ):null)
          }
        </div>

        {/* Tree */}
        <div style={{ flex:1, overflowY:"auto", padding:"6px 4px" }}>
          {loading
            ? <div style={{ textAlign:"center", padding:48, color:"#1e3a5f", fontSize:13 }}>Loading {cfg.label}…</div>
            : !tree ? null
            : search
              ? <SearchResults query={search} allSpecies={allSp} onSelect={onSelect}/>
              : orders.map(o=><OrderNode key={o} name={o} families={tree[o]} onSelect={onSelect} selected={selected} filterStatus={filter} filterRealm={realmFilter} showSsp={showSsp} onSelectSsp={onSelectSsp}/>)
          }
        </div>

        {/* Legend */}
        <div style={{ padding:"6px 12px", borderTop:"1px solid #0a1628", display:"flex", gap:8, flexWrap:"wrap" }}>
          {Object.entries(SM).map(([code,m])=>(
            <div key={code} style={{ display:"flex", alignItems:"center", gap:3, fontSize:9, color:"#1e293b" }}>
              <div style={{ width:6, height:6, borderRadius:2, background:m.c }}/>
              <span style={{ color:m.c+"99" }}>{code}</span> {m.l}
            </div>
          ))}
        </div>
      </div>

      {selected    && <SpeciesPanel sp={selected} onClose={()=>setSelected(null)} onSelectSsp={onSelectSsp} taxon={taxon}/>}
      {selectedSsp && <SubspeciesDetailPanel ssp={selectedSsp} onClose={()=>setSelectedSsp(null)} onOpenParent={openParentFromSsp} taxon={taxon}/>}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App/>);
