// ─────────────────────────────────────────────────────────────────────────────
// Mammal Tree of Life — app.jsx
// Uses /api/iucn/* proxy (Netlify Edge Function) — key never exposed to browser
// iNaturalist called directly (no key needed, CC0 filter applied)
// Data: mdd_full.json loaded from /mdd_full.json (same Netlify site)
// ─────────────────────────────────────────────────────────────────────────────

const { useState, useEffect, useCallback, useMemo, useRef } = React;

// ── Status metadata ───────────────────────────────────────────────────────────
const STATUS_META = {
  LC: { color: "#4ade80", label: "Least Concern" },
  NT: { color: "#a3e635", label: "Near Threatened" },
  VU: { color: "#facc15", label: "Vulnerable" },
  EN: { color: "#fb923c", label: "Endangered" },
  CR: { color: "#f87171", label: "Critically Endangered" },
  EW: { color: "#c084fc", label: "Extinct in Wild" },
  EX: { color: "#94a3b8", label: "Extinct" },
  DD: { color: "#60a5fa", label: "Data Deficient" },
  NE: { color: "#475569", label: "Not Evaluated" },
};
const sc = s => (STATUS_META[s] || STATUS_META.NE).color;

// ── IUCN fetch — goes through /api/iucn/ edge proxy ──────────────────────────
async function fetchIUCN(path) {
  const res = await fetch(`/api/iucn${path}`);
  if (!res.ok) throw new Error(`IUCN API error ${res.status}`);
  return res.json();
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useIUCN(sciName) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sciName) return;
    setLoading(true); setData(null); setError(null);
    fetchIUCN(`/taxa/scientific_name?name=${encodeURIComponent(sciName)}`)
      .then(d => d?.taxon ? setData(d) : setError("Not found in IUCN"))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sciName]);

  return { data, loading, error };
}

function useINaturalist(sciName) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sciName) return;
    setLoading(true); setPhotos([]);
    fetch(`https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(sciName)}&quality_grade=research&license=cc0&photos=true&per_page=8&order=votes&order_by=votes`)
      .then(r => r.json())
      .then(d => {
        const imgs = [];
        (d.results || []).forEach(obs => {
          (obs.photos || []).forEach(ph => {
            if ((ph.license_code || "").toLowerCase() === "cc0") {
              imgs.push({
                url: ph.url?.replace("square", "medium"),
                thumb: ph.url,
                attribution: ph.attribution || "",
                obsUrl: `https://www.inaturalist.org/observations/${obs.id}`,
                location: obs.place_guess || "",
              });
            }
          });
        });
        setPhotos(imgs.slice(0, 6));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sciName]);

  return { photos, loading };
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
function StatusBadge({ status, size = "sm" }) {
  const meta = STATUS_META[status] || STATUS_META.NE;
  return React.createElement("span", {
    style: {
      background: meta.color + "22", color: meta.color,
      border: `1px solid ${meta.color}55`, borderRadius: 4,
      padding: size === "lg" ? "3px 10px" : "2px 6px",
      fontSize: size === "lg" ? 12 : 10, fontWeight: 700,
      fontFamily: "monospace", whiteSpace: "nowrap",
    }
  }, status || "NE");
}

// ── Photo Gallery ─────────────────────────────────────────────────────────────
function PhotoGallery({ sciName }) {
  const { photos, loading } = useINaturalist(sciName);
  const [active, setActive] = useState(0);

  if (loading) return React.createElement("div", {
    style: { textAlign: "center", padding: 32, color: "#475569" }
  }, React.createElement("div", { style: { fontSize: 32, marginBottom: 8 } }, "📸"),
    React.createElement("div", { style: { fontSize: 12 } }, "Loading CC0 photos from iNaturalist…"));

  if (!photos.length) return React.createElement("div", {
    style: { textAlign: "center", padding: 32, color: "#334155", fontSize: 13 }
  }, "No CC0 photos found on iNaturalist for this species.");

  const p = photos[active];
  return React.createElement("div", null,
    React.createElement("div", {
      style: { position: "relative", borderRadius: 10, overflow: "hidden", marginBottom: 8, background: "#0a0a0a" }
    },
      React.createElement("img", {
        src: p.url, alt: sciName,
        style: { width: "100%", height: 220, objectFit: "cover", display: "block" },
        onError: e => { e.target.style.display = "none"; }
      }),
      React.createElement("div", {
        style: {
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "linear-gradient(transparent,#00000099)",
          padding: "20px 10px 8px", fontSize: 10, color: "#ccc"
        }
      },
        "CC0 · ", p.attribution.replace("(c) ", "© "),
        p.location ? ` · ${p.location}` : "",
        " · ",
        React.createElement("a", {
          href: p.obsUrl, target: "_blank", rel: "noreferrer",
          style: { color: "#7dd3fc", textDecoration: "none" }
        }, "View on iNaturalist ↗")
      )
    ),
    photos.length > 1 && React.createElement("div", {
      style: { display: "flex", gap: 5, flexWrap: "wrap" }
    }, photos.map((ph, i) =>
      React.createElement("img", {
        key: i, src: ph.thumb, alt: "",
        onClick: () => setActive(i),
        style: {
          width: 48, height: 48, objectFit: "cover", borderRadius: 6,
          cursor: "pointer", transition: "all 0.15s",
          border: `2px solid ${i === active ? "#7dd3fc" : "transparent"}`,
          opacity: i === active ? 1 : 0.55,
        }
      })
    ))
  );
}

// ── IUCN Panel ────────────────────────────────────────────────────────────────
function IUCNPanel({ sciName }) {
  const { data, loading, error } = useIUCN(sciName);

  if (loading) return React.createElement("div", {
    style: { color: "#475569", fontSize: 12, textAlign: "center", padding: 20 }
  }, "Fetching IUCN Red List data…");

  if (error) return React.createElement("div", {
    style: { color: "#f87171", fontSize: 12, padding: 10, background: "#1a0505", borderRadius: 6 }
  }, "⚠ ", error);

  if (!data) return null;

  const taxon = data.taxon || {};
  const assessment = data.assessments?.[0] || {};

  const row = (label, value) => value ? React.createElement("div", {
    style: { display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid #0f172a", fontSize: 13 }
  },
    React.createElement("div", { style: { color: "#475569", minWidth: 130, flexShrink: 0 } }, label),
    React.createElement("div", { style: { color: "#e2e8f0" } }, value)
  ) : null;

  return React.createElement("div", null,
    assessment.red_list_category && React.createElement("div", {
      style: { marginBottom: 16, padding: "12px 14px", background: "#0a1628", borderRadius: 8 }
    },
      React.createElement("div", { style: { fontSize: 10, color: "#334155", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 } }, "IUCN Red List Category"),
      React.createElement(StatusBadge, { status: assessment.red_list_category?.code, size: "lg" }),
      assessment.year_published && React.createElement("span", {
        style: { color: "#475569", marginLeft: 8, fontSize: 11 }
      }, `(assessed ${assessment.year_published})`)
    ),
    row("Population trend", assessment.population_trend),
    row("Criteria", assessment.red_list_criteria),
    taxon.class_name && row("Classification", [taxon.class_name, taxon.order_name, taxon.family_name].filter(Boolean).join(" › ")),
    assessment.url && React.createElement("a", {
      href: assessment.url, target: "_blank", rel: "noreferrer",
      style: { display: "inline-block", marginTop: 12, color: "#7dd3fc", fontSize: 12, textDecoration: "none" }
    }, "View full IUCN assessment ↗")
  );
}

// ── Species Detail Panel ──────────────────────────────────────────────────────
function SpeciesPanel({ species, onClose }) {
  const [tab, setTab] = useState("photos");
  const [sci, common, order, family, genus, status, extinct] = species;

  return React.createElement("div", {
    style: {
      position: "fixed", right: 0, top: 0, bottom: 0, width: 360,
      background: "#0a1220", borderLeft: "1px solid #0f2040",
      display: "flex", flexDirection: "column", zIndex: 100,
      boxShadow: "-16px 0 48px #00000088",
    }
  },
    // Header
    React.createElement("div", {
      style: { padding: "20px 20px 14px", borderBottom: "1px solid #0f172a" }
    },
      React.createElement("div", {
        style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" }
      },
        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
          React.createElement("div", {
            style: { fontFamily: "'Playfair Display', serif", fontSize: 17, fontStyle: "italic", color: "#f1f5f9", lineHeight: 1.2, marginBottom: 3 }
          }, sci),
          React.createElement("div", { style: { fontSize: 13, color: "#94a3b8", marginBottom: 8 } }, common || "—"),
          React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
            React.createElement(StatusBadge, { status }),
            extinct === 1 && React.createElement("span", {
              style: { fontSize: 10, color: "#94a3b8", background: "#1e293b", padding: "2px 6px", borderRadius: 4 }
            }, "EXTINCT")
          )
        ),
        React.createElement("button", {
          onClick: onClose,
          style: { background: "none", border: "none", color: "#475569", fontSize: 20, cursor: "pointer", padding: 4, lineHeight: 1 }
        }, "✕")
      ),
      React.createElement("div", {
        style: { marginTop: 10, fontSize: 11, color: "#1e3a5f", fontFamily: "monospace" }
      }, `${order} › ${family} › ${genus}`)
    ),
    // Tabs
    React.createElement("div", {
      style: { display: "flex", borderBottom: "1px solid #0f172a" }
    }, [["photos", "📸 Photos"], ["iucn", "🛡 IUCN"]].map(([id, label]) =>
      React.createElement("button", {
        key: id, onClick: () => setTab(id),
        style: {
          flex: 1, padding: "10px 0", fontSize: 12, fontWeight: 600,
          background: tab === id ? "#0f172a" : "none", border: "none",
          borderBottom: `2px solid ${tab === id ? "#7dd3fc" : "transparent"}`,
          color: tab === id ? "#f1f5f9" : "#475569", cursor: "pointer",
        }
      }, label)
    )),
    // Content
    React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: 16 } },
      tab === "photos" && React.createElement(PhotoGallery, { sciName: sci }),
      tab === "iucn"   && React.createElement(IUCNPanel,    { sciName: sci })
    ),
    // Footer
    React.createElement("div", {
      style: { padding: "10px 16px", borderTop: "1px solid #0f172a", fontSize: 10, color: "#1e293b" }
    }, "Photos: iNaturalist CC0 · Status: IUCN Red List API v4")
  );
}

// ── Tree Nodes ────────────────────────────────────────────────────────────────
function SpeciesRow({ sp, onClick, isSelected }) {
  const [sci, common,,,,status, extinct] = sp;
  const [hover, setHover] = useState(false);
  return React.createElement("div", {
    onClick, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
    style: {
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 10px 5px 28px", cursor: "pointer", borderRadius: 6,
      background: isSelected ? "#0f2040" : hover ? "#070f1d" : "transparent",
      transition: "background 0.1s",
    }
  },
    React.createElement("div", {
      style: { width: 6, height: 6, borderRadius: "50%", background: sc(status), flexShrink: 0 }
    }),
    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      React.createElement("span", {
        style: { fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontSize: 13, color: "#e2e8f0" }
      }, sci),
      common && React.createElement("span", { style: { fontSize: 11, color: "#334155", marginLeft: 6 } }, common)
    ),
    extinct === 1 && React.createElement("span", { style: { fontSize: 9, color: "#475569" } }, "†"),
    React.createElement(StatusBadge, { status })
  );
}

function GenusNode({ name, speciesList, onSelect, selected }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const threatened = useMemo(() =>
    speciesList.filter(([,,,,, st]) => ["CR","EN","VU"].includes(st)).length
  , [speciesList]);

  return React.createElement("div", null,
    React.createElement("div", {
      onClick: () => setOpen(o => !o),
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 10px 4px 16px", cursor: "pointer", borderRadius: 6,
        background: hover ? "#070f1d" : "transparent",
      }
    },
      React.createElement("span", { style: { color: "#1e3a5f", fontSize: 10, width: 12, textAlign: "center" } }, open ? "▾" : "▸"),
      React.createElement("span", { style: { fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontSize: 13, color: "#64748b" } }, name),
      React.createElement("span", { style: { fontSize: 10, color: "#1e293b" } }, ` (${speciesList.length})`),
      threatened > 0 && React.createElement("span", { style: { fontSize: 9, color: "#fb923c", marginLeft: 2 } }, `⚠ ${threatened}`)
    ),
    open && speciesList.map((sp, i) =>
      React.createElement(SpeciesRow, {
        key: i, sp, onClick: () => onSelect(sp),
        isSelected: selected && selected[0] === sp[0]
      })
    )
  );
}

function FamilyNode({ name, genera, onSelect, selected }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const { total, threatened } = useMemo(() => {
    let total = 0, threatened = 0;
    Object.values(genera).forEach(spp => spp.forEach(([,,,,, st]) => {
      total++;
      if (["CR","EN","VU"].includes(st)) threatened++;
    }));
    return { total, threatened };
  }, [genera]);

  return React.createElement("div", { style: { marginBottom: 1 } },
    React.createElement("div", {
      onClick: () => setOpen(o => !o),
      onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: {
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 10px 5px 8px", cursor: "pointer", borderRadius: 6,
        background: hover ? "#070f1d" : "transparent",
      }
    },
      React.createElement("span", { style: { color: "#1e3a5f", fontSize: 11, width: 14, textAlign: "center" } }, open ? "▾" : "▸"),
      React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "#7dd3fc" } }, name),
      React.createElement("span", { style: { fontSize: 10, color: "#1e293b", marginLeft: 4 } }, `${total} spp`),
      threatened > 0 && React.createElement("span", {
        style: { fontSize: 9, color: "#f87171", background: "#1a0505", padding: "1px 5px", borderRadius: 3, marginLeft: 4 }
      }, `${threatened} threatened`)
    ),
    open && Object.entries(genera).map(([genus, spp]) =>
      React.createElement(GenusNode, { key: genus, name: genus, speciesList: spp, onSelect, selected })
    )
  );
}

function OrderNode({ name, families, onSelect, selected, filterStatus }) {
  const [open, setOpen] = useState(false);

  const filteredFamilies = useMemo(() => {
    if (!filterStatus) return families;
    const result = {};
    Object.entries(families).forEach(([fam, genera]) => {
      const fg = {};
      Object.entries(genera).forEach(([gen, spp]) => {
        const f = spp.filter(([,,,,, st]) => st === filterStatus);
        if (f.length) fg[gen] = f;
      });
      if (Object.keys(fg).length) result[fam] = fg;
    });
    return result;
  }, [families, filterStatus]);

  const { total, famCount } = useMemo(() => ({
    total: Object.values(filteredFamilies).reduce((s, g) => s + Object.values(g).reduce((s2, spp) => s2 + spp.length, 0), 0),
    famCount: Object.keys(filteredFamilies).length,
  }), [filteredFamilies]);

  if (total === 0) return null;

  return React.createElement("div", { style: { marginBottom: 3 } },
    React.createElement("div", {
      onClick: () => setOpen(o => !o),
      style: {
        display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
        background: open ? "#0a1e38" : "#070f1d", borderRadius: 8,
        border: `1px solid ${open ? "#1e3a5f" : "#0a1628"}`,
        transition: "all 0.15s",
      }
    },
      React.createElement("span", { style: { color: "#1e3a5f", fontSize: 12 } }, open ? "▾" : "▸"),
      React.createElement("span", {
        style: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: "#e2e8f0", flex: 1 }
      }, name),
      React.createElement("span", { style: { fontSize: 10, color: "#1e3a5f" } }, `${famCount} fam`),
      React.createElement("span", { style: { fontSize: 10, color: "#1e293b", marginLeft: 8 } }, `${total} spp`)
    ),
    open && React.createElement("div", { style: { paddingTop: 3 } },
      Object.entries(filteredFamilies).map(([fam, genera]) =>
        React.createElement(FamilyNode, { key: fam, name: fam, genera, onSelect, selected })
      )
    )
  );
}

// ── Search ────────────────────────────────────────────────────────────────────
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

  if (!query) return null;
  return React.createElement("div", { style: { padding: "8px 0" } },
    React.createElement("div", {
      style: { fontSize: 11, color: "#334155", padding: "4px 12px", marginBottom: 4 }
    }, `${results.length} results for "${query}"`),
    results.map((sp, i) =>
      React.createElement(SpeciesRow, { key: i, sp, onClick: () => onSelect(sp), isSelected: false })
    )
  );
}

// ── Stats Bar ─────────────────────────────────────────────────────────────────
function StatsBar({ counts }) {
  return React.createElement("div", {
    style: {
      padding: "10px 16px", background: "#040c18", borderBottom: "1px solid #0a1628",
      display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center"
    }
  },
    React.createElement("div", { style: { fontSize: 11, color: "#334155" } },
      React.createElement("span", { style: { color: "#e2e8f0", fontWeight: 700, fontSize: 14 } }, counts.total?.toLocaleString()),
      " species"
    ),
    Object.entries(STATUS_META).map(([code, meta]) => counts[code] ?
      React.createElement("div", {
        key: code,
        style: { fontSize: 10, color: "#1e293b", display: "flex", alignItems: "center", gap: 4 }
      },
        React.createElement("div", { style: { width: 8, height: 8, borderRadius: 2, background: meta.color } }),
        React.createElement("span", { style: { color: meta.color } }, code),
        React.createElement("span", { style: { color: "#334155" } }, counts[code])
      ) : null
    )
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  const [tree, setTree] = useState(null);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState(null);

  // Load full MDD data from /mdd_full.json
  useEffect(() => {
    fetch("/mdd_full.json")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        // data.sp = [[sci, common, order, family, genus, status, extinct], ...]
        // data.tr = {order: {family: {genus: [indices]}}}
        const t = {};
        const c = { total: 0 };

        Object.entries(data.tr).forEach(([order, fams]) => {
          t[order] = {};
          Object.entries(fams).forEach(([fam, genera]) => {
            t[order][fam] = {};
            Object.entries(genera).forEach(([genus, indices]) => {
              t[order][fam][genus] = indices.map(i => data.sp[i]);
              indices.forEach(i => {
                const st = data.sp[i][5];
                c.total++;
                c[st] = (c[st] || 0) + 1;
              });
            });
          });
        });

        setTree(t);
        setCounts(c);
        setLoading(false);
        // Hide the loading screen
        const el = document.getElementById("loading");
        if (el) el.style.display = "none";
      })
      .catch(e => {
        setLoadError(e.message);
        setLoading(false);
        const el = document.getElementById("loading");
        if (el) el.style.display = "none";
      });
  }, []);

  const handleSelect = useCallback(sp => {
    setSelected(s => s && s[0] === sp[0] ? null : sp);
  }, []);

  if (loadError) return React.createElement("div", {
    style: { background: "#040d1a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontFamily: "monospace", padding: 24, textAlign: "center" }
  }, "⚠ Could not load mdd_full.json: ", loadError, React.createElement("br"), React.createElement("small", { style: { color: "#475569" } }, "Make sure mdd_full.json is in the public/ folder"));

  if (loading || !tree) return null;

  const orders = Object.keys(tree).sort();

  return React.createElement("div", {
    style: { fontFamily: "'DM Sans', sans-serif", background: "#040d1a", minHeight: "100vh", color: "#e2e8f0" }
  },
    // Sidebar / main panel
    React.createElement("div", {
      style: {
        position: "fixed", left: 0, top: 0, bottom: 0,
        width: selected ? "calc(100vw - 360px)" : "100vw",
        display: "flex", flexDirection: "column",
        transition: "width 0.25s ease",
      }
    },
      // Header
      React.createElement("div", {
        style: { padding: "18px 18px 14px", background: "#040d1a", borderBottom: "1px solid #0a1628" }
      },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 } },
          React.createElement("div", { style: { fontSize: 28 } }, "🌳"),
          React.createElement("div", null,
            React.createElement("div", {
              style: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-0.5px", color: "#f1f5f9" }
            }, "Mammal Tree of Life"),
            React.createElement("div", { style: { fontSize: 11, color: "#1e3a5f" } },
              "Mammal Diversity Database v2.4 · IUCN Red List · iNaturalist CC0")
          )
        ),
        // Search
        React.createElement("input", {
          value: search,
          onChange: e => setSearch(e.target.value),
          placeholder: "Search scientific or common name…",
          style: {
            width: "100%", padding: "8px 14px",
            background: "#07101f", border: "1px solid #0f2040",
            borderRadius: 8, color: "#e2e8f0", fontSize: 13, outline: "none",
          }
        }),
        // Status filter
        React.createElement("div", { style: { display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" } },
          Object.entries(STATUS_META).map(([code, meta]) =>
            React.createElement("button", {
              key: code, onClick: () => setFilterStatus(f => f === code ? null : code),
              style: {
                background: filterStatus === code ? meta.color + "33" : "transparent",
                border: `1px solid ${filterStatus === code ? meta.color : "#0f2040"}`,
                color: filterStatus === code ? meta.color : "#334155",
                borderRadius: 4, padding: "2px 7px", fontSize: 10,
                cursor: "pointer", fontWeight: 700, fontFamily: "monospace",
                transition: "all 0.1s",
              }
            }, code)
          ),
          filterStatus && React.createElement("button", {
            onClick: () => setFilterStatus(null),
            style: { background: "none", border: "none", color: "#334155", fontSize: 10, cursor: "pointer" }
          }, "clear ✕")
        )
      ),
      // Stats
      React.createElement(StatsBar, { counts }),
      // Tree
      React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: "8px 6px" } },
        search
          ? React.createElement(SearchResults, { query: search, tree, onSelect: handleSelect })
          : orders.map(order =>
              React.createElement(OrderNode, {
                key: order, name: order, families: tree[order],
                onSelect: handleSelect, selected, filterStatus
              })
            )
      ),
      // Legend
      React.createElement("div", {
        style: { padding: "8px 14px", borderTop: "1px solid #0a1628", display: "flex", gap: 10, flexWrap: "wrap" }
      },
        Object.entries(STATUS_META).map(([code, meta]) =>
          React.createElement("div", {
            key: code,
            style: { display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#1e293b" }
          },
            React.createElement("div", { style: { width: 8, height: 8, borderRadius: 2, background: meta.color } }),
            React.createElement("span", { style: { color: meta.color + "99" } }, code),
            " ", meta.label
          )
        )
      )
    ),
    // Species detail panel
    selected && React.createElement(SpeciesPanel, { species: selected, onClose: () => setSelected(null) })
  );
}

// Mount
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(App));
