// ========== FILES (relative to project root) ==========
const GEO_FILE = "./custom.geo.json";

const FILES = {
  ELEC: "data/7_EG.ELC.ACCS.ZS.csv",
  NET: "data/9_IT.NET.USER.ZS.csv",
  WATER: "data/6_SH.H2O.SMDW.ZS.csv",
  POP: "data/SP.POP.TOTL.csv",
  GDPPC: "data/8_NY.GDP.PCAP.CD.csv" // GDP per capita (current US$)
};

// ========= SDG banner dismiss (persist across reloads) =========
(function () {
  const key = "hide_sdg_banner";
  const el = document.getElementById("sdg-banner");
  if (!el) return;
  if (localStorage.getItem(key) === "1") el.hidden = true;
  el.querySelector("button.close")?.addEventListener("click", () => {
    el.hidden = true;
    try {
      localStorage.setItem(key, "1");
    } catch {}
  });
})();

// ========= Formatters =========
const fmtPct = (d) => (d == null ? "—" : d3.format(".1f")(d) + "%");
const fmtPP = (d) => (d >= 0 ? "+" : "") + d3.format(".1f")(d) + " pp";
const fmtUSD0 = (d) => (d == null ? "—" : "$" + d3.format(",.0f")(d));

// ========= Loader (World Bank CSV tolerant) =========
async function loadWB(file) {
  const raw = await d3.text(file);
  const text = raw.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) =>
    /^"Country Name","Country Code","Indicator Name","Indicator Code"/.test(l)
  );
  const csvText = headerIdx >= 0 ? lines.slice(headerIdx).join("\n") : text;
  const rows = d3.csvParse(csvText);
  const cols = rows.columns ?? Object.keys(rows[0] || {});
  const years = cols
    .filter((c) => /^\d{4}$/.test(c))
    .map(Number)
    .sort((a, b) => a - b);
  const byISO3 = new Map(rows.map((r) => [r["Country Code"], r]));
  return { rows, years, byISO3 };
}

// ========= Accessors =========
function val(ind, iso3, year) {
  const row = DATA[ind].byISO3.get(iso3);
  if (!row) return null;
  const raw = row[String(year)];
  const num = raw === "" || raw == null ? NaN : +raw;
  return Number.isFinite(num) ? num : null;
}
function pop(iso3, year) {
  const row = DATA.POP.byISO3.get(iso3);
  if (!row) return null;
  const raw = row[String(year)];
  const num = raw === "" || raw == null ? NaN : +raw;
  return Number.isFinite(num) ? num : null;
}
function getISO3(f) {
  const p = f.properties || {};
  let iso = p.iso_a3 || p.adm0_a3 || p.ADM0_A3 || p.ISO_A3 || f.id;
  if (iso === "-99") iso = "XKX";
  return iso;
}
function getName(f) {
  return (
    f.properties?.name ||
    f.properties?.name_en ||
    f.properties?.ADMIN ||
    getISO3(f)
  );
}
function getRegion(f) {
  const p = f.properties || {};
  return (
    p.region_wb ||
    p.REGION_WB ||
    p.region ||
    p.REGION ||
    p.continent ||
    p.CONTINENT ||
    "Other"
  );
}

// ========= Global =========
const DATA = {}; // ELEC, NET, WATER, POP, GDPPC
const SCENES = {};
let GEO;
let yearsCommon;
let latestCommonYear;
const SDG_START = 2015;
let CURRENT_YEAR = SDG_START;
let CURRENT_SCENE = null; // track active scene

// ========= Map setup =========
const mapEl = d3.select("#map");
const tooltip = d3.select("#tooltip");

// Create SVG once; size and projection will be managed via layout()
const svg = mapEl
  .append("svg")
  .attr("width", "100%")
  .attr("height", "100%")
  .attr("preserveAspectRatio", "xMidYMid meet");

const gMain = svg.append("g");
const gCountries = gMain.append("g");
// annotations layer
const gAnno = gMain.append("g").attr("class", "annotations");

const projection = d3.geoNaturalEarth1();
const path = d3.geoPath(projection);

// Pan/zoom
const zoom = d3
  .zoom()
  .scaleExtent([1, 8])
  .on("zoom", (e) => gMain.attr("transform", e.transform));
svg.call(zoom);

// Color scales
const color = d3
  .scaleSequential()
  .interpolator(d3.interpolateYlGnBu)
  .domain([0, 100]);
const colorGDP = d3
  .scaleSequentialLog(d3.interpolatePuBuGn)
  .domain([500, 60000]); // log scale for GDPpc
const noDataColor = "#e0e0e0";

// Legend (accepts a color fn)
function renderLegendContinuous(domain = [0, 100], label = "%", colorFn = color) {
  const root = d3.select("#legend");
  root.html("");
  const w = 220,
    h = 12;
  const svgL = root.append("svg").attr("width", w + 120).attr("height", 42);
  const defs = svgL.append("defs");
  const id = "grad-" + Math.random().toString(36).slice(2);
  const grad = defs.append("linearGradient").attr("id", id);
  grad
    .selectAll("stop")
    .data(d3.range(0, 1.0001, 0.1))
    .join("stop")
    .attr("offset", (d) => d * 100 + "%")
    .attr("stop-color", (d) => {
      const v = domain[0] + d * (domain[1] - domain[0]);
      return colorFn(v);
    });
  svgL
    .append("rect")
    .attr("x", 10)
    .attr("y", 10)
    .attr("width", w)
    .attr("height", h)
    .attr("fill", `url(#${id})`)
    .attr("rx", 3)
    .attr("stroke", "#e2e8f0");
  const scale = d3.scaleLinear().domain(domain).range([10, 10 + w]);
  const axis = d3.axisBottom(scale).ticks(5).tickSize(4);
  svgL
    .append("g")
    .attr("transform", `translate(0, ${10 + h})`)
    .call(axis)
    .select(".domain")
    .remove();
  svgL
    .append("text")
    .attr("x", 10 + w + 8)
    .attr("y", 20)
    .attr("font-size", 11)
    .text(label);
  svgL
    .append("rect")
    .attr("x", 10 + w + 8)
    .attr("y", 24)
    .attr("width", 14)
    .attr("height", 10)
    .attr("fill", noDataColor)
    .attr("rx", 2)
    .attr("stroke", "#e2e8f0");
  svgL
    .append("text")
    .attr("x", 10 + w + 26)
    .attr("y", 33)
    .attr("font-size", 11)
    .text("No data");
}

// Map painters
function setMapMetric_Electricity(year) {
  gCountries.selectAll("path.country").attr("fill", (d) => {
    const v = val("ELEC", getISO3(d), year);
    return v == null ? noDataColor : color(Math.max(0, Math.min(100, v)));
  });
  renderLegendContinuous([0, 100], "% access", color);
}
function setMapMetric_Internet(year) {
  gCountries.selectAll("path.country").attr("fill", (d) => {
    const v = val("NET", getISO3(d), year);
    return v == null ? noDataColor : color(Math.max(0, Math.min(100, v)));
  });
  renderLegendContinuous([0, 100], "% users", color);
}
function setMapMetric_Water(year) {
  gCountries.selectAll("path.country").attr("fill", (d) => {
    const v = val("WATER", getISO3(d), year);
    return v == null ? noDataColor : color(Math.max(0, Math.min(100, v)));
  });
  renderLegendContinuous([0, 100], "% safely managed", color);
}
function setMapMetric_GDPpc(year) {
  gCountries.selectAll("path.country").attr("fill", (d) => {
    const v = val("GDPPC", getISO3(d), year);
    return v == null ? noDataColor : colorGDP(Math.max(500, Math.min(60000, v)));
  });
  renderLegendContinuous([500, 60000], "US$ (log scale)", colorGDP);
}

function attachTooltip(metricCode, year) {
  gCountries
    .selectAll("path.country")
    .on("mousemove", (event, d) => {
      const iso = getISO3(d);
      const name = getName(d);
      let v = null,
        label = "";
      if (metricCode === "ELEC") {
        v = val("ELEC", iso, year);
        label = "Electricity access";
      }
      if (metricCode === "NET") {
        v = val("NET", iso, year);
        label = "Internet users";
      }
      if (metricCode === "WATER") {
        v = val("WATER", iso, year);
        label = "Safely managed water";
      }
      if (metricCode === "GDPPC") {
        v = val("GDPPC", iso, year);
        label = "GDP per capita (const US$)";
      }
      const valueTxt = metricCode === "GDPPC" ? fmtUSD0(v) : fmtPct(v);
      tooltip
        .style("left", event.clientX + "px")
        .style("top", event.clientY + "px")
        .style("opacity", 1)
        .html(`<strong>${name}</strong><br>${label}: ${valueTxt} (${year})`);
    })
    .on("mouseout", () => tooltip.style("opacity", 0));
}

// ===== Vega-Lite charts =====
async function drawElectricityLollipop(containerSelector, features, y0, y1) {
  const rows = [];
  for (const f of features) {
    const iso = getISO3(f),
      name = getName(f);
    const v0 = val("ELEC", iso, y0),
      v1 = val("ELEC", iso, y1);
    if (v0 == null || v1 == null) continue;
    rows.push({ country: name, v2015: +v0, vLatest: +v1, dv: +v1 - +v0 });
  }
  const top = rows
    .sort((a, b) => d3.descending(a.dv, b.dv))
    .slice(0, 10)
    .reverse();
  const long = top.flatMap((d) => [
    { country: d.country, type: "2015", value: d.v2015, dv: null, dv_fmt: "" },
    {
      country: d.country,
      type: "Latest",
      value: d.vLatest,
      dv: d.dv,
      dv_fmt: `${d.dv >= 0 ? "+" : ""}${d.dv.toFixed(1)} pp`
    }
  ]);
  const spec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    width: "container",
    height: 420,
    data: { values: long },
    encoding: {
      y: {
        field: "country",
        type: "nominal",
        sort: top.map((d) => d.country),
        axis: { title: null }
      }
    },
    layer: [
      {
        mark: { type: "rule", strokeWidth: 2, opacity: 0.6 },
        encoding: {
          x: {
            aggregate: "min",
            field: "value",
            type: "quantitative",
            title: "% access",
            scale: { domain: [0, 100] }
          },
          x2: { aggregate: "max", field: "value", type: "quantitative" }
        }
      },
      {
        transform: [{ filter: "datum.type === '2015'" }],
        mark: { type: "point", filled: true, size: 60, color: "#64748b" },
        encoding: {
          x: { field: "value", type: "quantitative" },
          tooltip: [
            { field: "country" },
            { field: "value", title: "2015", format: ".1f" }
          ]
        }
      },
      {
        transform: [{ filter: "datum.type === 'Latest'" }],
        mark: { type: "point", filled: true, size: 70, color: "#0ea5e9" },
        encoding: {
          x: { field: "value", type: "quantitative" },
          tooltip: [
            { field: "country" },
            { field: "value", title: "Latest", format: ".1f" },
            { field: "dv", title: "Δ (pp)", format: ".1f" }
          ]
        }
      },
      {
        transform: [{ filter: "datum.type === 'Latest'" }],
        mark: {
          type: "text",
          dx: 6,
          align: "left",
          baseline: "middle",
          fontSize: 11,
          color: "#0f172a"
        },
        encoding: {
          x: { field: "value", type: "quantitative" },
          text: { field: "dv_fmt" }
        }
      }
    ]
  };
  const el = document.querySelector(containerSelector);
  if (!el) return;
  el.innerHTML = "";
  try {
    await vegaEmbed(containerSelector, spec, { actions: false });
  } catch (e) {
    console.error("vegaEmbed failed:", e);
  }
}

// SDG 9 – Internet users: horizontal boxplots, one region per row
// Adds a "Comparison Year" slider below the legend to compare 2015 vs any later year.
async function drawInternetRegionBoxplots(containerSelector, features, y0, y1Default) {
  // Friendly region name mapping
  const aliasMap = {
    "Sub-Saharan Africa": "Africa",
    "Europe & Central Asia": "Europe",
    "Middle East & North Africa": "Middle East",
    "Latin America & Caribbean": "S. America",
    "East Asia & Pacific": "E. Asia",
    "South Asia": "S. Asia",
    "North America": "N. America"
  };

  const el = document.querySelector(containerSelector);
  if (!el) return;

  // Build available years (>= 2015) from the dataset to drive the slider
  const yearsAvail = (DATA?.NET?.years || [])
    .filter(y => y >= y0)
    .sort((a, b) => a - b);

  // Fallback if we can’t find years
  const compareYearInit = yearsAvail.length ? yearsAvail[yearsAvail.length - 1] : y1Default;

  // Prepare a little host structure: chart DIV + controls DIV (slider under legend)
  el.innerHTML = `
    <div class="vl-host"></div>
    <div class="viz-controls" style="padding:10px 4px 0 4px;">
      <label style="font-size:12px;color:#334155;margin-right:8px;">Compare to:</label>
      <input type="range" min="${yearsAvail[0] || compareYearInit}" max="${yearsAvail[yearsAvail.length - 1] || compareYearInit}"
             value="${compareYearInit}" step="1" class="net-year-range" style="width:260px; vertical-align:middle;">
      <span class="net-year-label" style="font-size:12px;color:#334155;margin-left:6px;">${compareYearInit}</span>
    </div>
  `;
  const host = el.querySelector(".vl-host");
  const slider = el.querySelector(".net-year-range");
  const yearLabel = el.querySelector(".net-year-label");

  // Helper to build long-form rows for 2015 and the selected comparison year
  function buildRows(compareYear) {
    const rows = [];
    for (const f of features) {
      const iso = getISO3(f);
      const region = getRegion(f);
      const alias = aliasMap[region] || region;
      const vBase = val("NET", iso, y0);
      const vCmp = val("NET", iso, compareYear);
      if (vBase != null) rows.push({ region, regionLabel: alias, year: String(y0), value: +vBase });
      if (vCmp != null) rows.push({ region, regionLabel: alias, year: String(compareYear), value: +vCmp });
    }
    return rows;
  }

  async function render(compareYear) {
    const rows = buildRows(compareYear);

    if (!rows.length) {
      host.innerHTML = `<div style="padding:8px;color:#334155;font-size:14px;">
        No internet data available for ${y0} or ${compareYear}.
      </div>`;
      return;
    }

    // ► Explicit facet cell width (faceted charts can’t use width:"container")
    const containerWidth = Math.max(360, el.clientWidth || 700);
    const cellWidth = containerWidth - 24;

    const regions = Array.from(new Set(rows.map(d => d.regionLabel))).filter(Boolean).sort();
    const yearOrder = [String(y0), String(compareYear)];

    const spec = {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      padding: { top: 6, left: 8, right: 8, bottom: 20 },
      data: { values: rows },
      transform: [{ filter: "isFinite(datum.value)" }],
      facet: {
        row: {
          field: "regionLabel",
          type: "nominal",
          sort: regions,
          header: {
            // default font; just a bit of space so labels don’t collide with plots
            labelFontSize: 12,
            labelPadding: 6,
            title: null
          }
        }
      },
      spec: {
        width: cellWidth,
        height: 90, // per-region height
        mark: { type: "boxplot", extent: "min-max", median: { color: "#0f172a" } },
        encoding: {
          // Horizontal orientation
          x: {
            field: "value",
            type: "quantitative",
            title: "% of population using the Internet",
            scale: { domain: [0, 100] }
          },
          y: {
            field: "year",
            type: "nominal",
            sort: yearOrder,
            axis: { title: null }
          },
          color: {
            field: "year",
            type: "nominal",
            sort: yearOrder,
            scale: { range: ["#64748b", "#0ea5e9"] },
            legend: {
              orient: "bottom",
              direction: "horizontal",
              title: "Year"
            }
          },
          tooltip: [
            { field: "regionLabel", title: "Region" },
            { field: "year", title: "Year" },
            { field: "value", title: "% users", format: ".1f" }
          ]
        }
      },
      resolve: { scale: { x: "shared" } },
      spacing: 14
    };

    host.innerHTML = "";
    try {
      await vegaEmbed(host, spec, { actions: false });
    } catch (e) {
      console.error("vegaEmbed failed:", e);
      host.innerHTML = `<div style="padding:8px;color:#b91c1c;font-size:14px;">
        Couldn’t render SDG-9 boxplots. Check console for details.
      </div>`;
    }
  }

  // Initial render with the latest available year
  await render(compareYearInit);

  // Wire up the slider (beneath the legend)
  slider?.addEventListener("input", async (e) => {
    const yr = +e.target.value;
    if (yearLabel) yearLabel.textContent = String(yr);
    await render(yr);
  });
}


/**
 * Helper: nearest non-null value to a target year within +/- window.
 * preferFuture = true will check future years before past years at each radius.
 */
function getNearestYearValue(ind, iso, target, window = 3, preferFuture = true) {
  let v = val(ind, iso, target);
  if (v != null) return [target, v];
  for (let r = 1; r <= window; r++) {
    const years = preferFuture ? [target + r, target - r] : [target - r, target + r];
    for (const y of years) {
      v = val(ind, iso, y);
      if (v != null) return [y, v];
    }
  }
  return [null, null];
}

/**
 * NEW: SDG 6 — "Top Improvers" since ~2015
 * Ranks countries by absolute people gaining access to safely managed water.
 * Also shows pp-change with a slope/dumbbell.
 */
async function drawWaterTopImprovers(containerSelector, features, baseYear = SDG_START) {
  const rows = [];
  for (const f of features) {
    const iso = getISO3(f);
    const name = getName(f);

    // Baseline: nearest to 2015 within +/-3 years (prefer future)
    const [y0, v0] = getNearestYearValue("WATER", iso, baseYear, 3, true);

    // Latest: latest year >= 2015 with data
    const ys = DATA.WATER.years.filter((y) => y >= baseYear).sort((a, b) => a - b);
    let y1 = null,
      v1 = null;
    for (let i = ys.length - 1; i >= 0; i--) {
      const candidate = ys[i];
      const vv = val("WATER", iso, candidate);
      if (vv != null) {
        y1 = candidate;
        v1 = vv;
        break;
      }
    }
    if (y0 == null || v0 == null || y1 == null || v1 == null) continue;
    if (y1 <= y0) continue;

    // Population at latest (fallback to nearest year if needed)
    const p1 = pop(iso, y1) ?? pop(iso, y1 - 1) ?? pop(iso, y1 + 1);
    if (p1 == null) continue;

    const dv_pp = v1 - v0; // percentage points
    const dv_people = (dv_pp / 100) * p1; // absolute people who gained access
    rows.push({
      iso,
      country: name,
      y0,
      v0: +v0,
      y1,
      v1: +v1,
      dv_pp,
      dv_people
    });
  }

  // Focus on top 12 by people gained (most impactful)
  const top = rows
    .filter((d) => Number.isFinite(d.dv_people) && Number.isFinite(d.dv_pp))
    .sort((a, b) => d3.descending(a.dv_people, b.dv_people))
    .slice(0, 12)
    .sort((a, b) => d3.ascending(a.v1, b.v1)); // order for nicer slope layout

  // Long form for Vega-Lite slope/dumbbell
  const long = top.flatMap((d) => [
    {
      country: d.country,
      type: "Baseline",
      year: d.y0,
      value: d.v0,
      dv_pp: d.dv_pp,
      dv_people: d.dv_people
    },
    {
      country: d.country,
      type: "Latest",
      year: d.y1,
      value: d.v1,
      dv_pp: d.dv_pp,
      dv_people: d.dv_people
    }
  ]);

  const spec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    width: "container",
    height: 440,
    data: { values: long },
    encoding: {
      y: {
        field: "country",
        type: "nominal",
        sort: top.map((d) => d.country),
        axis: { title: null }
      }
    },
    layer: [
      {
        mark: { type: "rule", strokeWidth: 2, opacity: 0.6 },
        encoding: {
          x: {
            aggregate: "min",
            field: "value",
            type: "quantitative",
            title: "% safely managed",
            scale: { domain: [0, 100] }
          },
          x2: { aggregate: "max", field: "value" }
        }
      },
      {
        transform: [{ filter: "datum.type === 'Baseline'" }],
        mark: { type: "point", filled: true, size: 55, color: "#64748b" },
        encoding: {
          x: { field: "value", type: "quantitative" },
          tooltip: [
            { field: "country" },
            { field: "year", title: "Baseline year" },
            { field: "value", title: "Baseline %", format: ".1f" }
          ]
        }
      },
      {
        transform: [{ filter: "datum.type === 'Latest'" }],
        mark: { type: "point", filled: true, size: 70, color: "#0ea5e9" },
        encoding: {
          x: { field: "value", type: "quantitative" },
          tooltip: [
            { field: "country" },
            { field: "year", title: "Latest year" },
            { field: "value", title: "Latest %", format: ".1f" },
            { field: "dv_pp", title: "Δ (pp)", format: ".1f" },
            { field: "dv_people", title: "People gained", format: ",.0f" }
          ]
        }
      },
      {
        transform: [{ filter: "datum.type === 'Latest'" }],
        mark: {
          type: "text",
          dx: 6,
          align: "left",
          baseline: "middle",
          fontSize: 11,
          color: "#0f172a"
        },
        encoding: {
          x: { field: "value", type: "quantitative" },
          text: { field: "dv_people", type: "quantitative", format: ",.2s" }
        }
      }
    ]
  };

  const el = document.querySelector(containerSelector);
  if (!el) return;
  el.innerHTML = "";
  try {
    await vegaEmbed(containerSelector, spec, { actions: false });
  } catch (e) {
    console.error("vegaEmbed failed:", e);
  }
}

// SDG 8 scatter — single plot, nearest-year alignment, legends below
async function drawSDG8Scatter(containerSelector, features, yearLatest) {
  // helper: nearest non-null value for any indicator in DATA[...] (±window yrs)
  function nearestVal(indKey, iso, target, window = 3, preferFuture = true) {
    // exact
    let v = val(indKey, iso, target);
    if (v != null) return [target, v];
    for (let r = 1; r <= window; r++) {
      const cand = preferFuture ? [target + r, target - r] : [target - r, target + r];
      for (const y of cand) {
        v = val(indKey, iso, y);
        if (v != null) return [y, v];
      }
    }
    return [null, null];
  }
  // helper: nearest population
  function nearestPop(iso, target, window = 2, preferFuture = true) {
    let p = pop(iso, target);
    if (p != null) return [target, p];
    for (let r = 1; r <= window; r++) {
      const cand = preferFuture ? [target + r, target - r] : [target - r, target + r];
      for (const y of cand) {
        p = pop(iso, y);
        if (p != null) return [y, p];
      }
    }
    return [null, null];
  }

  const metricMap = {
    Electricity: "ELEC",
    Internet: "NET",
    Water: "WATER"
  };

  const rows = [];
  for (const f of features) {
    const iso = getISO3(f), region = getRegion(f), name = getName(f);

    // Try all three metrics, aligned to their own nearest year around yearLatest
    for (const [metricName, key] of Object.entries(metricMap)) {
      const [mYear, mVal] = nearestVal(key, iso, yearLatest, 3, true);
      if (mYear == null || mVal == null) continue;

      // Align GDPpc & Pop to the metric's year (nearest values)
      const [gYear, gVal] = nearestVal("GDPPC", iso, mYear, 2, true);
      const [pYear, pVal] = nearestPop(iso, mYear, 2, true);
      if (gYear == null || gVal == null || pYear == null || pVal == null) continue;

      rows.push({
        country: name,
        region,
        metric: metricName,
        value: +mVal,       // % access
        gdppc: +gVal,       // GDP per capita (current US$ in your file)
        pop: +pVal,         // population
        year_metric: mYear, // for tooltip context
        year_gdp: gYear,
        year_pop: pYear
      });
    }
  }

  const spec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    autosize: { type: "fit-x", contains: "padding" },
    width: "container",
    height: 420,
    padding: { top: 10, left: 5, right: 5, bottom: 30 }, // room for bottom legends
    data: { values: rows },

    // Metric selector (default "Internet")
    params: [{
      name: "metricSel",
      value: "Internet",
      bind: { input: "select", options: ["Electricity", "Internet", "Water"], name: "Metric: " }
    }],

    transform: [
      { filter: "datum.metric === metricSel" },
      { filter: "isValid(datum.gdppc) && datum.gdppc <= 100000" }  // ← add this
    ],


    mark: { type: "point", filled: true, opacity: 0.9 },
    encoding: {
    x: {
      field: "gdppc",
      type: "quantitative",
      title: "GDP per capita (US$)",
      scale: { type: "linear", nice: true, zero: false },  // no domain/domainMax here
      axis: { tickCount: 6 }
    },

      y: {
        field: "value", type: "quantitative",
        title: "% with access", scale: { domain: [0, 100] }
      },
      size: {
        field: "pop", type: "quantitative", title: "Population",
        scale: { range: [20, 1200] },
        legend: { orient: "bottom", direction: "horizontal", titleFontSize: 11, labelFontSize: 10 }
      },
      color: {
        field: "region", type: "nominal", title: "Region",
        legend: { orient: "bottom", direction: "horizontal", columns: 3, symbolType: "circle", titleFontSize: 11, labelFontSize: 10 }
      },
      tooltip: [
        { field: "country", title: "Country" },
        { field: "region",  title: "Region" },
        { field: "gdppc",   title: "GDP pc (US$)", format: ",.0f" },
        { field: "value",   title: "% access", format: ".1f" },
        { field: "pop",     title: "Population", format: ",.0f" },
        { field: "year_metric", title: "Metric year" },
        { field: "year_gdp",    title: "GDP year" },
        { field: "year_pop",    title: "Pop year" }
      ]
    }
  };

  const el = document.querySelector(containerSelector);
  if (!el) return;
  el.innerHTML = "";
  try {
    await vegaEmbed(containerSelector, spec, { actions: false });
  } catch (e) {
    console.error("vegaEmbed failed:", e);
  }
}



// ========= Year control helpers =========
function syncYearUI(year) {
  CURRENT_YEAR = year;
  const lab = document.getElementById("year-label");
  if (lab) lab.textContent = String(year);
  const slider = document.getElementById("year-range");
  if (slider && +slider.value !== year) slider.value = String(year);
}
function setYear_Electricity(year) {
  setMapMetric_Electricity(year);
  attachTooltip("ELEC", year);
  syncYearUI(year);
  refreshAnnotations();
}
function setYear_Internet(year) {
  setMapMetric_Internet(year);
  attachTooltip("NET", year);
  syncYearUI(year);
  refreshAnnotations();
}
function setYear_Water(year) {
  setMapMetric_Water(year);
  attachTooltip("WATER", year);
  syncYearUI(year);
  refreshAnnotations();
}
function setYear_GDPpc(year) {
  setMapMetric_GDPpc(year);
  attachTooltip("GDPPC", year);
  syncYearUI(year);
  refreshAnnotations();
}

// ========= Annotations =========
function clearAnnotations() {
  gAnno.selectAll("*").remove();
}

function renderCallout([x, y], lines, opts = {}) {
  const {
    dx = 44,
    dy = -24,
    color = "#f59e0b",
    textColor = "#0f172a",
    padding = 8,
    r = 5,
    fontSize = 12
  } = opts;

  gAnno
    .append("circle")
    .attr("cx", x)
    .attr("cy", y)
    .attr("r", 4)
    .attr("fill", color)
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5);

  const lx = x + dx;
  const ly = y + dy;
  const labelG = gAnno.append("g").attr("transform", `translate(${lx},${ly})`);

  const text = labelG
    .append("text")
    .attr("x", padding)
    .attr("y", padding + fontSize)
    .attr("font-size", fontSize)
    .attr("fill", textColor);

  lines.forEach((t, i) => {
    text
      .append("tspan")
      .attr("x", padding)
      .attr("dy", i === 0 ? 0 : fontSize + 4)
      .text(t)
      .attr("font-weight", i === 0 ? "700" : "400");
  });

  const bbox = text.node().getBBox();
  labelG
    .insert("rect", "text")
    .attr("x", 0)
    .attr("y", 0)
    .attr("rx", r)
    .attr("ry", r)
    .attr("width", bbox.width + padding * 2)
    .attr("height", bbox.height + padding * 2 - 3)
    .attr("fill", "#fff")
    .attr("stroke", color)
    .attr("stroke-width", 2);

  gAnno
    .append("line")
    .attr("x1", x)
    .attr("y1", y)
    .attr("x2", lx + bbox.width / 2)
    .attr("y2", ly)
    .attr("stroke", color)
    .attr("stroke-width", 2)
    .attr("opacity", 0.9);
}

// SDG7 annotations — South Sudan + Australia
function showAnnotation_SDG7() {
  if (!GEO) return;
  clearAnnotations();

  // South Sudan (ISO3: SSD)
  const fSSD = GEO.features.find((f) => getISO3(f) === "SSD");
  if (fSSD) {
    const [cx, cy] = path.centroid(fSSD);
    const vSSD = val("ELEC", "SSD", CURRENT_YEAR);
    const textSSD = vSSD == null ? "5.4%" : fmtPct(vSSD);
    renderCallout(
      [cx, cy],
      [
        "South Sudan — very low access",
        `Electricity access: ${textSSD}`,
        `Year: ${CURRENT_YEAR}`
      ],
      { dx: -230, dy: 210, color: "#f59e0b" }
    );
  }

  // Australia (ISO3: AUS)
  const fAUS = GEO.features.find((f) => getISO3(f) === "AUS");
  if (fAUS) {
    const [ax, ay] = path.centroid(fAUS);
    const vAUS = val("ELEC", "AUS", CURRENT_YEAR);
    const textAUS = vAUS == null ? "100%" : fmtPct(vAUS);
    renderCallout(
      [ax, ay],
      [
        "Australia — near-universal access",
        `Electricity access: ${textAUS}`,
        `Year: ${CURRENT_YEAR}`
      ],
      { dx: -150, dy: 100, color: "#f59e0b" }
    );
  }
}

// SDG9 annotations — Burundi + United Arab Emirates
function showAnnotation_SDG9() {
  if (!GEO) return;
  clearAnnotations();

  const picks = [
    // Burundi (ISO3: BDI)
    {
      iso: "BDI",
      title: "Central African countries generally has the least Internet access, such as Burundi",
      fallbackPct: 11.08,   // used if data missing for CURRENT_YEAR
      dx: -280,              // pullout box offset from dot (tweak if needed)
      dy: 200,
      color: "#3b82f6"       // blue
    },
    // United Arab Emirates (ISO3: ARE)
    {
      iso: "ARE",
      title: "United Arab Emirates — near-universal",
      fallbackPct: 100,
      dx: -50,
      dy: 150,
      color: "#3b82f6"
    }
  ];

  for (const t of picks) {
    const feature = GEO.features.find(f => getISO3(f) === t.iso);
    if (!feature) continue;

    const [cx, cy] = path.centroid(feature);
    const v = val("NET", t.iso, CURRENT_YEAR);
    // if missing, show the supplied figure
    const valueText = v == null ? `${d3.format(".2f")(t.fallbackPct)}%` : fmtPct(v);

    renderCallout(
      [cx, cy],
      [
        t.title,
        `Internet users: ${valueText}`,
        `Year: ${CURRENT_YEAR}`
      ],
      { dx: t.dx, dy: t.dy, color: t.color }
    );
  }
}


function refreshAnnotations() {
  clearAnnotations();
  if (CURRENT_SCENE === "electricity") {
    showAnnotation_SDG7();
  }
  if (CURRENT_SCENE === "internet") {
    showAnnotation_SDG9();
  }
}


// ========= Scenes =========
SCENES.intro = () => {
  gCountries.selectAll("path.country").attr("fill", "#f1f5f9");
  tooltip.style("opacity", 0);
  const y0 = SDG_START,
    y1 = latestCommonYear;

  function weightedMean(code) {
    let num = 0,
      den = 0,
      n0 = 0,
      d0 = 0;
    for (const f of GEO.features) {
      const iso = getISO3(f);
      const v = val(code, iso, y1),
        p = pop(iso, y1);
      if (v != null && p != null) {
        num += (v / 100) * p;
        den += p;
      }
      const v0 = val(code, iso, y0),
        p0 = pop(iso, y0) ?? p;
      if (v0 != null && p0 != null) {
        n0 += (v0 / 100) * p0;
        d0 += p0;
      }
    }
    return {
      mean2015: d0 ? (n0 / d0) * 100 : null,
      meanLatest: den ? (num / den) * 100 : null
    };
  }

  for (const t of [
    { id: "#tile-electricity", code: "ELEC" },
    { id: "#tile-internet", code: "NET" },
    { id: "#tile-water", code: "WATER" }
  ]) {
    const { mean2015, meanLatest } = weightedMean(t.code);
    const delta =
      mean2015 != null && meanLatest != null ? meanLatest - mean2015 : null;
    const tile = d3.select(t.id);
    tile.select("[data-2015]").text(fmtPct(mean2015));
    tile.select("[data-latest]").text(fmtPct(meanLatest));
    tile.select("[data-delta]").text(delta == null ? "(—)" : `(${fmtPP(delta)})`);
    tile.select("[data-yearnote]").text(`2015 → ${y1}`);
  }
  d3
    .select("#legend")
    .html(
      '<div class="legend-row"><span class="legend-label">Scroll to begin →</span></div>'
    );
  refreshAnnotations();
};

SCENES.electricity = () => {
  CURRENT_SCENE = "electricity";
  const y0 = SDG_START,
    y1 = Math.max(...DATA.ELEC.years.filter((y) => y >= y0));
  const slider = document.getElementById("year-range"),
    label = document.getElementById("year-label"),
    ctl = document.getElementById("year-control");
  slider.min = String(y0);
  slider.max = String(y1);
  slider.value = String(y1);
  label.textContent = String(y1);
  ctl.hidden = false;
  setYear_Electricity(y1);
  let raf = null;
  const onInput = () => {
    const t = +slider.value;
    label.textContent = String(t);
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setYear_Electricity(t));
  };
  slider.oninput = onInput;
  slider.onchange = onInput;
  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setYear_Electricity(Math.max(+slider.min, CURRENT_YEAR - 1));
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setYear_Electricity(Math.min(+slider.max, CURRENT_YEAR + 1));
    }
  });

  drawElectricityLollipop("#slope", GEO.features, y0, y1).then(() => {
    refreshAnnotations();
  });
  d3
    .select("#slope-title")
    .text(
      `Top 10 countries by absolute gain in electricity access since 2015 (to ${y1})`
    );
};

SCENES.internet = async () => {
  const y0 = SDG_START,
    y1 = Math.max(...DATA.NET.years.filter((y) => y >= y0));
  const slider = document.getElementById("year-range"),
    label = document.getElementById("year-label"),
    ctl = document.getElementById("year-control");
  slider.min = String(y0);
  slider.max = String(y1);
  if (+slider.value > y1) slider.value = String(y1);
  label.textContent = slider.value;
  ctl.hidden = false;
  setYear_Internet(+slider.value);
  let raf = null;
  const onInput = () => {
    const t = +slider.value;
    label.textContent = String(t);
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setYear_Internet(t));
  };
  slider.oninput = onInput;
  slider.onchange = onInput;
  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setYear_Internet(Math.max(+slider.min, CURRENT_YEAR - 1));
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setYear_Internet(Math.min(+slider.max, CURRENT_YEAR + 1));
    }
  });
  await drawInternetRegionBoxplots("#net-boxplots", GEO.features, y0, y1);
  d3
    .select("#net-title")
    .text(`Internet users (%): distribution by region — 2015 vs ${y1}`);
};

SCENES.water = async () => {
  const y0 = SDG_START;
  const y1 = Math.max(...DATA.WATER.years.filter((y) => y >= y0));

  const slider = document.getElementById("year-range");
  const label = document.getElementById("year-label");
  const ctl = document.getElementById("year-control");

  slider.min = String(y0);
  slider.max = String(y1);
  slider.value = String(y1);
  label.textContent = String(y1);
  ctl.hidden = false;

  setYear_Water(y1);
  let raf = null;
  const onInput = () => {
    const t = +slider.value;
    label.textContent = String(t);
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setYear_Water(t));
  };
  slider.oninput = onInput;
  slider.onchange = onInput;
  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setYear_Water(Math.max(+slider.min, CURRENT_YEAR - 1));
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setYear_Water(Math.min(+slider.max, CURRENT_YEAR + 1));
    }
  });

  // NEW: Top improvers chart
  await drawWaterTopImprovers("#water-heat", GEO.features, y0);
  d3
    .select("#water-title")
    .text(`Safely managed water — Top improvers since ~2015 (labels show people gained)`);
};

SCENES.sdg8 = async () => {
  const y0 = Math.max(1980, SDG_START);
  const y1 = Math.max(...DATA.GDPPC.years.filter((y) => y >= SDG_START));
  const slider = document.getElementById("year-range"),
    label = document.getElementById("year-label"),
    ctl = document.getElementById("year-control");
  slider.min = String(y0);
  slider.max = String(y1);
  if (+slider.value > y1) slider.value = String(y1);
  label.textContent = slider.value;
  ctl.hidden = false;
  setYear_GDPpc(+slider.value);
  let raf = null;
  const onInput = () => {
    const t = +slider.value;
    label.textContent = String(t);
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setYear_GDPpc(t));
  };
  slider.oninput = onInput;
  slider.onchange = onInput;
  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setYear_GDPpc(Math.max(+slider.min, CURRENT_YEAR - 1));
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setYear_GDPpc(Math.min(+slider.max, CURRENT_YEAR + 1));
    }
  });
  const latest = y1;
  await drawSDG8Scatter("#sdg8-scatter", GEO.features, latest);
  d3
    .select("#sdg8-title")
    .text(
      `GDP per capita vs access (${latest}) — faceted by metric; circle size = population`
    );
};

// ========= Theme + active step handling =========
function setThemeForScene(scene) {
  const body = document.body;
  body.classList.remove("theme-6", "theme-7", "theme-8", "theme-9");
  if (scene === "water") body.classList.add("theme-6");
  if (scene === "electricity") body.classList.add("theme-7");
  if (scene === "sdg8") body.classList.add("theme-8");
  if (scene === "internet") body.classList.add("theme-9");
}

function setActiveStep(el) {
  document.querySelectorAll(".step").forEach((s) => s.classList.remove("active"));
  el?.classList.add("active");
}

// ========= Layout & resize handling =========
function layoutAndFit() {
  const node = mapEl.node();
  if (!node || !GEO) return;

  const rect = node.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(380, Math.round(width * 0.58));

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const PAD = 28;
  const ZOOM_OUT = 0.92;

  projection.fitExtent(
    [
      [PAD, PAD],
      [width - PAD, height - PAD]
    ],
    GEO
  );
  projection.scale(projection.scale() * ZOOM_OUT);

  svg.call(zoom.transform, d3.zoomIdentity);
  gMain.attr("transform", null);

  gCountries.selectAll("path.country").attr("d", path);

  refreshAnnotations();
}

function debounce(fn, ms = 150) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

// ========= Init =========
(async function init() {
  try {
    const GEOraw = await d3.json(GEO_FILE);
    GEO =
      GEOraw && GEOraw.type === "FeatureCollection"
        ? GEOraw
        : { type: "FeatureCollection", features: GEOraw.features || [] };

    gCountries
      .selectAll("path.country")
      .data(GEO.features, (d) => getISO3(d))
      .join("path")
      .attr("class", "country")
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .attr("fill", "#f1f5f9");

    layoutAndFit();
    window.addEventListener("resize", debounce(layoutAndFit, 150));

    svg.call(zoom);

    const [ELEC, NET, WATER, POP, GDPPC] = await Promise.all([
      loadWB(FILES.ELEC),
      loadWB(FILES.NET),
      loadWB(FILES.WATER),
      loadWB(FILES.POP),
      loadWB(FILES.GDPPC)
    ]);
    DATA.ELEC = ELEC;
    DATA.NET = NET;
    DATA.WATER = WATER;
    DATA.POP = POP;
    DATA.GDPPC = GDPPC;

    yearsCommon = [
      ...[ELEC.years, NET.years, WATER.years].reduce((acc, ys) => {
        return acc == null ? new Set(ys) : new Set([...acc].filter((x) => ys.includes(x)));
      }, null)
    ]
      .filter((y) => y >= SDG_START)
      .sort((a, b) => a - b);
    latestCommonYear = yearsCommon.at(-1);

    SCENES.intro();
    setThemeForScene("water");

    const steps = document.querySelectorAll(".step");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const scene = entry.target.dataset.scene;
            CURRENT_SCENE = scene;
            setActiveStep(entry.target);
            if (SCENES[scene]) SCENES[scene]();
            if (
              scene === "water" ||
              scene === "electricity" ||
              scene === "sdg8" ||
              scene === "internet"
            ) {
              setThemeForScene(scene);
            }
            refreshAnnotations();
          }
        });
      },
      { root: null, threshold: 0.6, rootMargin: "-10% 0% -10% 0%" }
    );
    steps.forEach((s) => io.observe(s));
  } catch (err) {
    console.error(err);
    alert("Error initializing. See console for details.");
  }
})();
