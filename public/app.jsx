// Mammal Tree of Life — app.jsx
// IUCN calls go through /api/iucn/ (Netlify Edge Function — key hidden server-side)
// iNaturalist called directly (no key required, CC0 filter applied)

const { useState, useEffect, useCallback, useMemo } = React;

// ── Status colours ────────────────────────────────────────────────────────────
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

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useIUCN(sciName) {
  const [state, setState] = useState({ data: null, loading: false, error: null });
  useEffect(() => {
    if (!sciName) return;
    setState({ data: null, loading: true, error: null });
    // v4 API requires genus_name + species_name as separate params, auth via Bearer header (handled by edge function)
    const parts = sciName.trim().split(/\s+/);
    const genus = parts[0];
    const species = parts.slice(1).join(" ");
    if (!genus || !species) {
      setState({ data: null, loading: false, error: "Could not parse name" });
      return;
    }
    fetch(`/api/iucn/taxa/scientific_name?genus_name=${encodeURIComponent(genus)}&species_name=${encodeURIComponent(species)}`)
      .then(r => r.json())
      .then(d => {
        // v4 returns taxon even when assessments=[] for some species
        if (d?.taxon) {
          setState({ data: d, loading: false, error: null });
        } else if (d?.error) {
          // Show the exact URL tried so we can debug routing issues
          const detail = d.tried ? ` (tried: ${d.tried})` : (d.detail ? `: ${d.detail}` : "");
          setState({ data: null, loading: false, error: (d.error || "API error") + detail });
        } else {
          setState({ data: null, loading: false, error: "Not found in IUCN Red List" });
        }
      })
      .catch(e => setState({ data: null, loading: false, error: e.message }));
  }, [sciName]);
  return state;
}

function useINaturalist(sciName) {
  const [state, setState] = useState({ photos: [], loading: false });
  useEffect(() => {
    if (!sciName) return;
    setState({ photos: [], loading: true });
    fetch(`https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(sciName)}&quality_grade=research&license=cc0&photos=true&per_page=8&order=votes&order_by=votes`)
      .then(r => r.json())
      .then(d => {
        const imgs = [];
        (d.results || []).forEach(obs =>
          (obs.photos || []).forEach(ph => {
            if ((ph.license_code || "").toLowerCase() === "cc0")
              imgs.push({
                url: ph.url?.replace("square", "medium"),
                thumb: ph.url,
                attr: ph.attribution || "",
                obsUrl: `https://www.inaturalist.org/observations/${obs.id}`,
                place: obs.place_guess || "",
              });
          })
        );
        setState({ photos: imgs.slice(0, 6), loading: false });
      })
      .catch(() => setState({ photos: [], loading: false }));
  }, [sciName]);
  return state;
}

// ── Small shared components ───────────────────────────────────────────────────
function Badge({ status, large }) {
  const m = SM[status] || SM.NE;
  return <span style={{
    background: m.c + "22", color: m.c, border: `1px solid ${m.c}55`,
    borderRadius: 4, padding: large ? "3px 10px" : "2px 6px",
    fontSize: large ? 12 : 10, fontWeight: 700, fontFamily: "monospace", whiteSpace: "nowrap",
  }}>{status || "NE"}</span>;
}

// ── Photo gallery ─────────────────────────────────────────────────────────────
function PhotoGallery({ sciName }) {
  const { photos, loading } = useINaturalist(sciName);
  const [idx, setIdx] = useState(0);

  if (loading) return (
    <div style={{ textAlign: "center", padding: 32, color: "#475569" }}>
      <div style={{ fontSize: 32 }}>📸</div>
      <div style={{ fontSize: 12, marginTop: 8 }}>Loading CC0 photos…</div>
    </div>
  );
  if (!photos.length) return (
    <div style={{ textAlign: "center", padding: 32, color: "#334155", fontSize: 13 }}>
      No CC0 photos found on iNaturalist.
    </div>
  );

  const p = photos[idx];
  return (
    <div>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", marginBottom: 8, background: "#0a0a0a" }}>
        <img src={p.url} alt={sciName}
          style={{ width: "100%", height: 220, objectFit: "cover", display: "block" }}
          onError={e => e.target.style.display = "none"} />
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "linear-gradient(transparent,#000000aa)",
          padding: "20px 10px 8px", fontSize: 10, color: "#ccc",
        }}>
          CC0 · {p.attr.replace("(c) ", "© ")}{p.place ? ` · ${p.place}` : ""}
          {" · "}<a href={p.obsUrl} target="_blank" rel="noreferrer"
            style={{ color: "#7dd3fc", textDecoration: "none" }}>iNaturalist ↗</a>
        </div>
      </div>
      {photos.length > 1 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {photos.map((ph, i) => (
            <img key={i} src={ph.thumb} alt="" onClick={() => setIdx(i)}
              style={{
                width: 46, height: 46, objectFit: "cover", borderRadius: 6, cursor: "pointer",
                border: `2px solid ${i === idx ? "#7dd3fc" : "transparent"}`,
                opacity: i === idx ? 1 : 0.5, transition: "all 0.15s",
              }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── IUCN panel ────────────────────────────────────────────────────────────────
function IUCNPanel({ sciName }) {
  const { data, loading, error } = useIUCN(sciName);
  if (loading) return <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 20 }}>Fetching IUCN data…</div>;
  if (error) return <div style={{ color: "#f87171", fontSize: 12, padding: 10, background: "#1a0505", borderRadius: 6 }}>⚠ {error}</div>;
  if (!data) return null;

  const taxon = data.taxon || {};
  // assessments is an array; first entry is the latest
  const a = (data.assessments && data.assessments.length > 0) ? data.assessments[0] : null;
  const noAssessment = !a;

  const Row = ({ label, value }) => value ? (
    <div style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid #0f172a", fontSize: 13 }}>
      <div style={{ color: "#475569", minWidth: 130, flexShrink: 0 }}>{label}</div>
      <div style={{ color: "#e2e8f0" }}>{value}</div>
    </div>
  ) : null;

  // v4 assessment fields: red_list_category.code, population_trend, criteria, url
  const catCode = a?.red_list_category?.code || a?.category;
  const trend = a?.population_trend || a?.populationTrend;
  const criteria = a?.criteria || a?.red_list_criteria;
  const assessUrl = a?.url || (taxon.sis_id ? `https://www.iucnredlist.org/species/${taxon.sis_id}` : null);

  return (
    <div>
      {noAssessment ? (
        <div style={{ fontSize: 12, color: "#475569", padding: "10px 14px", background: "#0a1628", borderRadius: 8, marginBottom: 14 }}>
          Taxon found in IUCN (ID: {taxon.sis_id}) but no published assessment data available via API.
          {taxon.sis_id && <> <a href={`https://www.iucnredlist.org/species/${taxon.sis_id}`} target="_blank" rel="noreferrer" style={{ color: "#7dd3fc" }}>View on Red List ↗</a></>}
        </div>
      ) : (
        <>
          {catCode && (
            <div style={{ marginBottom: 14, padding: "12px 14px", background: "#0a1628", borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: "#334155", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>IUCN Red List Category</div>
              <Badge status={catCode} large />
              {a.year_published && <span style={{ color: "#475569", marginLeft: 8, fontSize: 11 }}>({a.year_published})</span>}
            </div>
          )}
          <Row label="Population trend" value={trend} />
          <Row label="Criteria" value={criteria} />
        </>
      )}
      {taxon.class_name && <Row label="Classification" value={[taxon.class_name, taxon.order_name, taxon.family_name].filter(Boolean).join(" › ")} />}
      {taxon.common_names?.length > 0 && <Row label="Common names" value={taxon.common_names.filter(n => n.language === "eng").map(n => n.name).join(", ")} />}
      {assessUrl && <a href={assessUrl} target="_blank" rel="noreferrer"
        style={{ display: "inline-block", marginTop: 12, color: "#7dd3fc", fontSize: 12, textDecoration: "none" }}>
        View on IUCN Red List ↗
      </a>}
    </div>
  );
}

// ── Species detail side-panel ─────────────────────────────────────────────────
function SpeciesPanel({ sp, onClose }) {
  const [tab, setTab] = useState("photos");
  const [sci, common, order, family, genus, status, extinct] = sp;
  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: 360,
      background: "#0a1220", borderLeft: "1px solid #0f2040",
      display: "flex", flexDirection: "column", zIndex: 100,
      boxShadow: "-16px 0 48px #00000099",
    }}>
      {/* header */}
      <div style={{ padding: "18px 18px 12px", borderBottom: "1px solid #0f172a" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, fontStyle: "italic", color: "#f1f5f9", lineHeight: 1.25, marginBottom: 3 }}>{sci}</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>{common || "—"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <Badge status={status} />
              {extinct === 1 && <span style={{ fontSize: 10, color: "#94a3b8", background: "#1e293b", padding: "2px 6px", borderRadius: 4 }}>EXTINCT</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 2 }}>✕</button>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "#1e3a5f", fontFamily: "monospace" }}>{order} › {family} › {genus}</div>
      </div>
      {/* tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #0f172a" }}>
        {[["photos","📸 Photos"],["iucn","🛡 IUCN"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: "10px 0", fontSize: 12, fontWeight: 600, border: "none",
            background: tab === id ? "#0f172a" : "none",
            borderBottom: `2px solid ${tab === id ? "#7dd3fc" : "transparent"}`,
            color: tab === id ? "#f1f5f9" : "#475569", cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>
      {/* content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {tab === "photos" && <PhotoGallery sciName={sci} />}
        {tab === "iucn"   && <IUCNPanel   sciName={sci} />}
      </div>
      <div style={{ padding: "8px 16px", borderTop: "1px solid #0f172a", fontSize: 10, color: "#1e293b" }}>
        Photos: iNaturalist CC0 · Status: IUCN Red List API v4
      </div>
    </div>
  );
}

// ── Tree nodes ────────────────────────────────────────────────────────────────
function SpeciesRow({ sp, onClick, isSelected }) {
  const [sci, common,,,,status, extinct] = sp;
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 10px 5px 28px", cursor: "pointer", borderRadius: 6,
        background: isSelected ? "#0f2040" : hov ? "#070f1d" : "transparent", transition: "background 0.1s",
      }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: sc(status), flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: "'Playfair Display',serif", fontStyle: "italic", fontSize: 13, color: "#e2e8f0" }}>{sci}</span>
        {common && <span style={{ fontSize: 11, color: "#334155", marginLeft: 6 }}>{common}</span>}
      </div>
      {extinct === 1 && <span style={{ fontSize: 9, color: "#475569" }}>†</span>}
      <Badge status={status} />
    </div>
  );
}

function GenusNode({ name, spp, onSelect, selected }) {
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(false);
  const threatened = useMemo(() => spp.filter(([,,,,, s]) => ["CR","EN","VU"].includes(s)).length, [spp]);
  return (
    <div>
      <div onClick={() => setOpen(o => !o)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 16px", cursor: "pointer", borderRadius: 6, background: hov ? "#070f1d" : "transparent" }}>
        <span style={{ color: "#1e3a5f", fontSize: 10, width: 12, textAlign: "center" }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontFamily: "'Playfair Display',serif", fontStyle: "italic", fontSize: 13, color: "#64748b" }}>{name}</span>
        <span style={{ fontSize: 10, color: "#1e293b" }}>({spp.length})</span>
        {threatened > 0 && <span style={{ fontSize: 9, color: "#fb923c", marginLeft: 2 }}>⚠ {threatened}</span>}
      </div>
      {open && spp.map((sp, i) => (
        <SpeciesRow key={i} sp={sp} onClick={() => onSelect(sp)} isSelected={selected && selected[0] === sp[0]} />
      ))}
    </div>
  );
}

function FamilyNode({ name, genera, onSelect, selected }) {
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(false);
  const { total, threatened } = useMemo(() => {
    let total = 0, threatened = 0;
    Object.values(genera).forEach(spp => spp.forEach(([,,,,, s]) => { total++; if (["CR","EN","VU"].includes(s)) threatened++; }));
    return { total, threatened };
  }, [genera]);
  return (
    <div style={{ marginBottom: 1 }}>
      <div onClick={() => setOpen(o => !o)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px", cursor: "pointer", borderRadius: 6, background: hov ? "#070f1d" : "transparent" }}>
        <span style={{ color: "#1e3a5f", fontSize: 11, width: 14, textAlign: "center" }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#7dd3fc" }}>{name}</span>
        <span style={{ fontSize: 10, color: "#1e293b", marginLeft: 4 }}>{total} spp</span>
        {threatened > 0 && <span style={{ fontSize: 9, color: "#f87171", background: "#1a0505", padding: "1px 5px", borderRadius: 3, marginLeft: 4 }}>{threatened} threatened</span>}
      </div>
      {open && Object.entries(genera).map(([genus, spp]) => (
        <GenusNode key={genus} name={genus} spp={spp} onSelect={onSelect} selected={selected} />
      ))}
    </div>
  );
}

function OrderNode({ name, families, onSelect, selected, filterStatus }) {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!filterStatus) return families;
    const r = {};
    Object.entries(families).forEach(([f, genera]) => {
      const fg = {};
      Object.entries(genera).forEach(([g, spp]) => {
        const s = spp.filter(([,,,,, st]) => st === filterStatus);
        if (s.length) fg[g] = s;
      });
      if (Object.keys(fg).length) r[f] = fg;
    });
    return r;
  }, [families, filterStatus]);

  const total = useMemo(() =>
    Object.values(filtered).reduce((s, g) => s + Object.values(g).reduce((s2, spp) => s2 + spp.length, 0), 0)
  , [filtered]);

  if (total === 0) return null;

  return (
    <div style={{ marginBottom: 3 }}>
      <div onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
        background: open ? "#0a1e38" : "#070f1d", borderRadius: 8,
        border: `1px solid ${open ? "#1e3a5f" : "#0a1628"}`, transition: "all 0.15s",
      }}>
        <span style={{ color: "#1e3a5f", fontSize: 12 }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: "#e2e8f0", flex: 1 }}>{name}</span>
        <span style={{ fontSize: 10, color: "#1e3a5f" }}>{Object.keys(filtered).length} fam</span>
        <span style={{ fontSize: 10, color: "#1e293b", marginLeft: 8 }}>{total} spp</span>
      </div>
      {open && (
        <div style={{ paddingTop: 3 }}>
          {Object.entries(filtered).map(([fam, genera]) => (
            <FamilyNode key={fam} name={fam} genera={genera} onSelect={onSelect} selected={selected} />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({ query, tree, onSelect }) {
  const results = useMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const found = [];
    Object.values(tree).forEach(fams =>
      Object.values(fams).forEach(genera =>
        Object.values(genera).forEach(spp =>
          spp.forEach(sp => {
            if (sp[0].toLowerCase().includes(q) || (sp[1] || "").toLowerCase().includes(q))
              found.push(sp);
          })
        )
      )
    );
    return found.slice(0, 40);
  }, [query, tree]);
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ fontSize: 11, color: "#334155", padding: "4px 12px 8px" }}>{results.length} results for "{query}"</div>
      {results.map((sp, i) => <SpeciesRow key={i} sp={sp} onClick={() => onSelect(sp)} isSelected={false} />)}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  const [tree, setTree]           = useState(null);
  const [counts, setCounts]       = useState({});
  const [selected, setSelected]   = useState(null);
  const [search, setSearch]       = useState("");
  const [filter, setFilter]       = useState(null);
  const [loadErr, setLoadErr]     = useState(null);

  useEffect(() => {
    fetch("/mdd_full.json")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} — is mdd_full.json in the public/ folder?`); return r.json(); })
      .then(data => {
        const t = {}, c = { total: 0 };
        Object.entries(data.tr).forEach(([order, fams]) => {
          t[order] = {};
          Object.entries(fams).forEach(([fam, genera]) => {
            t[order][fam] = {};
            Object.entries(genera).forEach(([genus, indices]) => {
              t[order][fam][genus] = indices.map(i => data.sp[i]);
              indices.forEach(i => { c.total++; const s = data.sp[i][5]; c[s] = (c[s]||0)+1; });
            });
          });
        });
        setTree(t); setCounts(c);
        document.getElementById("splash").style.display = "none";
      })
      .catch(e => { setLoadErr(e.message); document.getElementById("splash").style.display = "none"; });
  }, []);

  const onSelect = useCallback(sp => setSelected(s => s && s[0] === sp[0] ? null : sp), []);

  if (loadErr) return (
    <div style={{ background: "#040d1a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: "center", fontFamily: "monospace" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
        <div style={{ color: "#f87171", marginBottom: 8 }}>Could not load species data</div>
        <div style={{ color: "#475569", fontSize: 12 }}>{loadErr}</div>
      </div>
    </div>
  );

  if (!tree) return null;

  const orders = Object.keys(tree).sort();

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", background: "#040d1a", minHeight: "100vh", color: "#e2e8f0" }}>
      {/* Main column */}
      <div style={{
        position: "fixed", left: 0, top: 0, bottom: 0,
        width: selected ? "calc(100vw - 360px)" : "100vw",
        display: "flex", flexDirection: "column", transition: "width 0.25s ease",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 16px 12px", background: "#040d1a", borderBottom: "1px solid #0a1628" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 26 }}>🌳</span>
            <div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px", color: "#f1f5f9" }}>Mammal Tree of Life</div>
              <div style={{ fontSize: 11, color: "#1e3a5f" }}>MDD v2.4 · {counts.total?.toLocaleString()} species · IUCN · iNaturalist CC0</div>
            </div>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search scientific or common name…"
            style={{ width: "100%", padding: "8px 12px", background: "#07101f", border: "1px solid #0f2040", borderRadius: 8, color: "#e2e8f0", fontSize: 13, outline: "none" }} />
          <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
            {Object.entries(SM).map(([code, m]) => (
              <button key={code} onClick={() => setFilter(f => f === code ? null : code)} style={{
                background: filter === code ? m.c+"33" : "transparent",
                border: `1px solid ${filter === code ? m.c : "#0f2040"}`,
                color: filter === code ? m.c : "#334155",
                borderRadius: 4, padding: "2px 7px", fontSize: 10, cursor: "pointer",
                fontWeight: 700, fontFamily: "monospace", transition: "all 0.1s",
              }}>{code}</button>
            ))}
            {filter && <button onClick={() => setFilter(null)} style={{ background:"none", border:"none", color:"#334155", fontSize:10, cursor:"pointer" }}>✕ clear</button>}
          </div>
        </div>

        {/* Stats */}
        <div style={{ padding: "8px 14px", background: "#040c18", borderBottom: "1px solid #0a1628", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {Object.entries(SM).map(([code, m]) => counts[code] ? (
            <div key={code} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: m.c }} />
              <span style={{ color: m.c }}>{code}</span>
              <span style={{ color: "#334155" }}>{counts[code]}</span>
            </div>
          ) : null)}
        </div>

        {/* Tree */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          {search
            ? <SearchResults query={search} tree={tree} onSelect={onSelect} />
            : orders.map(o => <OrderNode key={o} name={o} families={tree[o]} onSelect={onSelect} selected={selected} filterStatus={filter} />)
          }
        </div>

        {/* Legend */}
        <div style={{ padding: "8px 14px", borderTop: "1px solid #0a1628", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(SM).map(([code, m]) => (
            <div key={code} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#1e293b" }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: m.c }} />
              <span style={{ color: m.c+"99" }}>{code}</span> {m.l}
            </div>
          ))}
        </div>
      </div>

      {/* Species panel */}
      {selected && <SpeciesPanel sp={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
