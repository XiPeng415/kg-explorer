/* ============================================================
   Singapore Urban Knowledge Graph Explorer — Main Application
   ============================================================ */

// ---- Global Data Setup ----
const D = window.VIZ_DATA;
const nodes = D.network.nodes;
const edges = D.network.edges;

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = 'OpenStreetMap, CARTO';

const CAT_COLORS = {
  TransitOrientedDense: '#c0392b', TransitOriented: '#e67e22',
  LifestyleHub: '#27ae60', HighDensity: '#8e44ad',
  StandardResidential: '#2980b9', Peripheral: '#7f8c8d'
};
const CAT_LABELS = {
  TransitOrientedDense: 'Transit-Oriented Dense', TransitOriented: 'Transit-Oriented',
  LifestyleHub: 'Lifestyle Hub', HighDensity: 'High Density',
  StandardResidential: 'Standard Residential', Peripheral: 'Peripheral'
};
const EDGE_COLORS = {
  'sn_Bar': '#e74c3c', 'sn_Cafe': '#9b59b6', 'sn_ChildCare': '#3498db',
  'sn_Facility': '#2ecc71', 'sn_Restaurant': '#e67e22', 'sn_SocialService': '#1abc9c',
  'sn_UseSite': '#34495e', 'sim': '#f39c12'
};
const EDGE_LABELS = {
  'sn_Bar': 'Shares Nearest Bar', 'sn_Cafe': 'Shares Nearest Cafe',
  'sn_ChildCare': 'Shares Nearest ChildCare', 'sn_Facility': 'Shares Nearest Facility',
  'sn_Restaurant': 'Shares Nearest Restaurant', 'sn_SocialService': 'Shares Nearest Social Service',
  'sn_UseSite': 'Shares Nearest Community Site', 'sim': 'Similar Lifestyle'
};

// ---- Build indices ----
const nodeMap = {};
nodes.forEach(function(n) { nodeMap[n.id] = n; });

const adj = new Array(nodes.length);
for (var i = 0; i < nodes.length; i++) adj[i] = [];
edges.forEach(function(e) {
  adj[e[0]].push([e[1], e[2]]);
  adj[e[1]].push([e[0], e[2]]);
});

const geoIdx = {};
if (D.geojson && D.geojson.features) {
  D.geojson.features.forEach(function(f) { geoIdx[f.properties.id] = f; });
}

// ---- Utility functions ----
function fmt(n) {
  if (typeof n !== 'number') return n;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return n.toLocaleString();
  if (n % 1 !== 0) return n.toFixed(n < 10 ? 3 : 1);
  return n.toString();
}

function propRow(k, v) {
  return '<div class="prop-row"><span class="prop-key">' + k + '</span><span class="prop-val">' + v + '</span></div>';
}

function makeTable(headers, rows, numCols) {
  var h = '<table class="data-table"><thead><tr>' + headers.map(function(x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>';
  rows.forEach(function(row) {
    h += '<tr>' + row.map(function(c, i) { return '<td' + (numCols && numCols[i] ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>';
  });
  return h + '</tbody></table>';
}

function chartOpts(xL, yL) {
  return {
    responsive: true,
    plugins: { legend: { labels: { font: { family: "'Segoe UI'", size: 10 } } } },
    scales: {
      x: { title: { display: true, text: xL, font: { family: "'Segoe UI'", size: 10 } }, ticks: { font: { family: "'Segoe UI'", size: 9 }, maxRotation: 45 } },
      y: { title: { display: true, text: yL, font: { family: "'Segoe UI'", size: 10 } }, ticks: { font: { family: "'Segoe UI'", size: 9 } } }
    }
  };
}

function interpolateColor(t) {
  t = Math.max(0, Math.min(1, t));
  var r, g, b;
  if (t < 0.25) { var s = t * 4; r = 49; g = Math.round(130 + s * 60); b = Math.round(189 - s * 50); }
  else if (t < 0.5) { var s = (t - 0.25) * 4; r = Math.round(49 + s * 150); g = Math.round(190 + s * 30); b = Math.round(139 - s * 100); }
  else if (t < 0.75) { var s = (t - 0.5) * 4; r = Math.round(199 + s * 42); g = Math.round(220 - s * 100); b = Math.round(39 - s * 20); }
  else { var s = (t - 0.75) * 4; r = Math.round(241 - s * 49); g = Math.round(120 - s * 63); b = Math.round(19 + s * 14); }
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// Category aggregates (reused across Q tabs)
function computeCatAggregates() {
  var cats = {};
  var catOrder = ['TransitOrientedDense', 'TransitOriented', 'LifestyleHub', 'HighDensity', 'StandardResidential', 'Peripheral'];
  catOrder.forEach(function(c) { cats[c] = { count: 0, sumGfa: 0, sumE: 0, sumTi: 0, sumDiv: 0, cntE: 0, sumFac: 0 }; });
  nodes.forEach(function(n) {
    var c = cats[n.category];
    if (!c) return;
    c.count++;
    c.sumGfa += n.gfa || 0;
    c.sumTi += n.ti || 0;
    c.sumDiv += n.div || 0;
    if (n.e > 0) { c.sumE += n.e; c.cntE++; }
    if (n.ft) c.sumFac += n.ft.split(',').length;
  });
  var result = {};
  catOrder.forEach(function(k) {
    var c = cats[k];
    result[k] = {
      count: c.count,
      avgGfa: c.count > 0 ? c.sumGfa / c.count : 0,
      avgEnergy: c.cntE > 0 ? c.sumE / c.cntE : 0,
      avgTi: c.count > 0 ? c.sumTi / c.count : 0,
      avgDiv: c.count > 0 ? c.sumDiv / c.count : 0,
      avgFac: c.count > 0 ? c.sumFac / c.count : 0
    };
  });
  return { data: result, order: catOrder };
}

// ============================================================
// TAB SWITCHING
// ============================================================
var tabFlags = {};
function showTab(id) {
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-tabs button').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('tab-' + id).classList.add('active');
  var tabs = ['dashboard', 'network', 'query', 'q1', 'q2', 'q3', 'q4', 'ontology', 'reports'];
  var idx = tabs.indexOf(id);
  if (idx >= 0) document.querySelectorAll('.nav-tabs button')[idx].classList.add('active');

  if (id === 'network' && !tabFlags.network) { tabFlags.network = true; initNetwork(); }
  if (id === 'query' && !tabFlags.query) { tabFlags.query = true; initQuery(); }
  if (id === 'q1' && !tabFlags.q1) { tabFlags.q1 = true; initQ1(); }
  if (id === 'q2' && !tabFlags.q2) { tabFlags.q2 = true; initQ2(); }
  if (id === 'q3' && !tabFlags.q3) { tabFlags.q3 = true; initQ3(); }
  if (id === 'q4' && !tabFlags.q4) { tabFlags.q4 = true; initQ4(); }
  if (id === 'ontology' && !tabFlags.ont) { tabFlags.ont = true; initOntology(); }
  if (id === 'reports' && !tabFlags.rep) { tabFlags.rep = true; initReports(); }

  setTimeout(function() {
    if (window.NetworkView) NetworkView.invalidateMiniMap();
    ['q1', 'q2', 'q3', 'q4'].forEach(function(q) { if (qMaps[q]) qMaps[q].invalidateSize(); });
  }, 150);
}

// ============================================================
// DASHBOARD
// ============================================================
(function initDashboard() {
  var o = D.overview;
  var stats = [
    [o.totalParcels, 'Residential Parcels'], [o.totalEntities.toLocaleString(), 'Total Entities'],
    [o.parcelsWithEnergy.toLocaleString(), 'Parcels with Energy'], [o.busStations.toLocaleString(), 'Bus Stations'],
    [o.mrtStations, 'MRT/LRT Stations'], [o.networkPaths.toLocaleString(), 'Network Paths'],
    [o.facilityTypes, 'Facility Types'], [o.energyIntensity + ' kWh/m\u00B2', 'Energy Intensity'],
    [o.ontologyClasses, 'OWL Classes'], [o.objectProperties + o.dataProperties, 'OWL Properties']
  ];
  document.getElementById('statGrid').innerHTML = stats.map(function(s) {
    return '<div class="stat-card"><div class="stat-value">' + s[0] + '</div><div class="stat-label">' + s[1] + '</div></div>';
  }).join('');

  new Chart(document.getElementById('entityChart'), {
    type: 'doughnut',
    data: { labels: ['Parcels', 'Network Paths', 'Facilities', 'Access Relations', 'Transit', 'Roads'],
      datasets: [{ data: [1869, 37412, 13786, 33638, 3725, 5050], backgroundColor: ['#2471a3', '#1e8449', '#d4ac0d', '#e67e22', '#148f77', '#7f8c8d'] }] },
    options: { responsive: true, plugins: { legend: { position: 'right', labels: { font: { family: "'Segoe UI'", size: 10 } } } } }
  });

  var q2f = D.q2.facilityTypeFreq;
  new Chart(document.getElementById('facilityChart'), {
    type: 'bar',
    data: { labels: q2f.map(function(r) { return r.facilityType; }),
      datasets: [{ label: 'Coverage %', data: q2f.map(function(r) { return r.percent; }),
        backgroundColor: q2f.map(function(r) { return r.percent >= 95 ? '#1e8449' : r.percent >= 40 ? '#d4ac0d' : '#922b21'; }) }] },
    options: { responsive: true, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { max: 100, ticks: { font: { family: "'Segoe UI'", size: 9 } } }, y: { ticks: { font: { family: "'Segoe UI'", size: 9 } } } } }
  });
})();

// ============================================================
// QUERY INTERFACE
// ============================================================
var queryEngine = null;
function initQuery() {
  if (window.QueryEngine) {
    queryEngine = new QueryEngine(nodes, edges, adj, nodeMap);
    var examples = queryEngine.getExampleQuestions();
    var chipsEl = document.getElementById('exampleChips');
    chipsEl.innerHTML = examples.map(function(q) {
      return '<span class="example-chip" onclick="runQuery(\'' + q.replace(/'/g, "\\'") + '\')">' + q + '</span>';
    }).join('');
  }

  var input = document.getElementById('queryInput');
  var btn = document.getElementById('querySubmit');
  btn.addEventListener('click', function() { runQuery(input.value); });
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') runQuery(input.value); });
}

var queryHistory = [];
function runQuery(text) {
  text = text.trim();
  if (!text) return;
  document.getElementById('queryInput').value = text;

  if (!queryEngine) {
    document.getElementById('queryResultContainer').innerHTML = '<div class="card"><p>Query engine not loaded. Please check that query-engine.js is available.</p></div>';
    return;
  }

  var result = queryEngine.query(text);

  // Add to history
  queryHistory.unshift({ text: text, title: result.title });
  updateQueryHistory();

  // Render result
  var container = document.getElementById('queryResultContainer');
  var html = '<div class="query-result-card">';
  html += '<div class="query-result-header"><h3>' + result.title + '</h3><div class="result-type">' + (result.type || 'analysis') + '</div></div>';
  html += '<div class="query-result-body">' + result.html + '</div>';
  if (result.chartConfig) {
    html += '<div class="query-result-chart"><canvas id="queryChart"></canvas></div>';
  }
  if (result.mapHighlights && result.mapHighlights.length > 0) {
    html += '<div class="query-result-map" id="queryMap"></div>';
  }
  html += '</div>';
  container.innerHTML = html;

  // Render chart if provided
  if (result.chartConfig) {
    setTimeout(function() {
      var canvas = document.getElementById('queryChart');
      if (canvas) new Chart(canvas, result.chartConfig);
    }, 50);
  }

  // Render map if provided
  if (result.mapHighlights && result.mapHighlights.length > 0) {
    setTimeout(function() {
      var mapEl = document.getElementById('queryMap');
      if (!mapEl) return;
      var map = L.map(mapEl, { attributionControl: false }).setView([1.3521, 103.8198], 12);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(map);
      var hlSet = new Set(result.mapHighlights);
      var bounds = [];
      if (D.geojson && D.geojson.features) {
        L.geoJSON(D.geojson, {
          style: function(f) {
            var isHL = hlSet.has(f.properties.id);
            return { fillColor: isHL ? '#e74c3c' : '#ccc', weight: isHL ? 2 : 0.3, color: isHL ? '#c0392b' : '#999', fillOpacity: isHL ? 0.6 : 0.15 };
          },
          onEachFeature: function(f, layer) {
            if (hlSet.has(f.properties.id)) {
              var n = nodeMap[f.properties.id];
              if (n) {
                layer.bindPopup('<strong>' + n.id + '</strong><br>' + (CAT_LABELS[n.category] || n.category) + (n.gfa ? '<br>GFA: ' + fmt(n.gfa) : ''));
                bounds.push([n.lat, n.lng]);
              }
            }
          }
        }).addTo(map);
      }
      if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }, 100);
  }
}

function updateQueryHistory() {
  var el = document.getElementById('queryHistory');
  if (queryHistory.length === 0) {
    el.innerHTML = '<p class="hint">Your queries will appear here.</p>';
    return;
  }
  el.innerHTML = queryHistory.slice(0, 10).map(function(q) {
    return '<div class="query-history-item" onclick="runQuery(\'' + q.text.replace(/'/g, "\\'") + '\')">'
      + '<div class="q-text">' + q.text + '</div>'
      + '<div class="q-preview">' + q.title + '</div></div>';
  }).join('');
}

// ============================================================
// Q1-Q4 CHART INITIALIZATIONS
// ============================================================
function initQ1() {
  var bldg = D.q1.buildingCountEnergy.filter(function(r) { return r.buildingCount <= 25; });
  var lvl = D.q1.levelsVsEnergy;

  new Chart(document.getElementById('q1_bldgGfa'), {
    type: 'bar', data: { labels: bldg.map(function(r) { return r.buildingCount; }),
      datasets: [{ label: 'Avg GFA (m\u00B2)', data: bldg.map(function(r) { return r.avgGFA; }), backgroundColor: '#2471a3' }] },
    options: chartOpts('Building Count', 'Avg GFA (m\u00B2)')
  });
  new Chart(document.getElementById('q1_bldgEnergy'), {
    type: 'bar', data: { labels: bldg.map(function(r) { return r.buildingCount; }),
      datasets: [{ label: 'Avg Energy (kWh/yr)', data: bldg.map(function(r) { return r.avgEnergy; }), backgroundColor: '#e67e22' }] },
    options: chartOpts('Building Count', 'Avg Energy (kWh/yr)')
  });
  new Chart(document.getElementById('q1_levelsDist'), {
    type: 'bar', data: { labels: lvl.map(function(r) { return r.levelRange; }),
      datasets: [{ label: 'Parcels', data: lvl.map(function(r) { return r.parcels; }), backgroundColor: '#1e8449' }] },
    options: chartOpts('Level Range', 'Parcels')
  });
  new Chart(document.getElementById('q1_vertMult'), {
    type: 'line', data: { labels: lvl.map(function(r) { return r.levelRange; }),
      datasets: [{ label: 'GFA/Footprint', data: lvl.map(function(r) { return r.verticalMultiplier; }),
        borderColor: '#8e44ad', backgroundColor: 'rgba(142,68,173,0.1)', fill: true, tension: 0.3 }] },
    options: chartOpts('Level Range', 'Vertical Multiplier')
  });

  // Category charts
  var ca = computeCatAggregates();
  var catLabels = ca.order.map(function(c) { return CAT_LABELS[c]; });
  var catColors = ca.order.map(function(c) { return CAT_COLORS[c]; });

  new Chart(document.getElementById('q1_energyCat'), {
    type: 'bar', data: { labels: catLabels,
      datasets: [{ label: 'Avg Energy (kWh/yr)', data: ca.order.map(function(c) { return Math.round(ca.data[c].avgEnergy); }), backgroundColor: catColors }] },
    options: chartOpts('Category', 'Avg Energy (kWh/yr)')
  });

  var gfaBins = [0, 50000, 100000, 150000, 200000, 300000, 500000, 1000000];
  var gfaLabels = ['0-50K', '50K-100K', '100K-150K', '150K-200K', '200K-300K', '300K-500K', '500K+'];
  var gfaCounts = new Array(gfaLabels.length).fill(0);
  nodes.forEach(function(n) {
    if (n.e <= 0) return;
    for (var j = gfaBins.length - 2; j >= 0; j--) { if (n.gfa >= gfaBins[j]) { gfaCounts[j]++; break; } }
  });
  new Chart(document.getElementById('q1_gfaDist'), {
    type: 'bar', data: { labels: gfaLabels, datasets: [{ label: 'Parcels', data: gfaCounts, backgroundColor: '#8e44ad' }] },
    options: chartOpts('GFA Range (m\u00B2)', 'Parcels')
  });

  createQMap('q1Map', 'e', 'Energy (kWh/yr)');

  var top = D.q1.topParcels;
  document.getElementById('q1Table').innerHTML = makeTable(
    ['Rank', 'Parcel', 'Land Use', 'GFA', 'Bldgs', 'Levels', 'Energy', 'Units', 'Fac'],
    top.map(function(r, i) { return [i + 1, r.parcelId, r.landUse, fmt(r.GFA_m2), r.bldgs, r.avgLvl, fmt(r.totalEnergy_kWh), fmt(r.estUnits), r.accessFacilities]; }),
    [true, false, false, true, true, true, true, true, true]
  );
}

function initQ2() {
  var dist = D.q2.diversityDistribution;
  var freq = D.q2.facilityTypeFreq;

  new Chart(document.getElementById('q2_divDist'), {
    type: 'bar', data: { labels: dist.map(function(r) { return 'Div ' + r.diversity; }),
      datasets: [{ label: 'Parcels', data: dist.map(function(r) { return r.parcels; }), backgroundColor: '#2471a3' }] },
    options: chartOpts('Diversity Index', 'Parcels')
  });
  new Chart(document.getElementById('q2_facFreq'), {
    type: 'bar', data: { labels: freq.map(function(r) { return r.facilityType; }),
      datasets: [{ label: 'Coverage %', data: freq.map(function(r) { return r.percent; }),
        backgroundColor: freq.map(function(r) { return r.percent >= 95 ? '#1e8449' : r.percent >= 40 ? '#d4ac0d' : '#922b21'; }) }] },
    options: Object.assign({}, chartOpts('Facility Type', 'Coverage %'), { indexAxis: 'y' })
  });
  new Chart(document.getElementById('q2_facCount'), {
    type: 'bar', data: { labels: dist.map(function(r) { return 'Div ' + r.diversity; }),
      datasets: [{ label: 'Avg Facilities', data: dist.map(function(r) { return r.avgFacilities; }), backgroundColor: '#27ae60' }] },
    options: chartOpts('Diversity Level', 'Avg Facilities')
  });
  new Chart(document.getElementById('q2_divEnergy'), {
    type: 'bar', data: { labels: dist.map(function(r) { return 'Div ' + r.diversity; }),
      datasets: [{ label: 'Avg Energy', data: dist.map(function(r) { return r.avgEnergy; }), backgroundColor: '#e67e22' }] },
    options: chartOpts('Diversity Level', 'Avg Energy (kWh)')
  });

  var ca = computeCatAggregates();
  var catLabels = ca.order.map(function(c) { return CAT_LABELS[c]; });
  var catColors = ca.order.map(function(c) { return CAT_COLORS[c]; });
  new Chart(document.getElementById('q2_divCat'), {
    type: 'bar', data: { labels: catLabels,
      datasets: [{ label: 'Avg Diversity', data: ca.order.map(function(c) { return +ca.data[c].avgDiv.toFixed(3); }), backgroundColor: catColors }] },
    options: chartOpts('Category', 'Avg Diversity')
  });
  new Chart(document.getElementById('q2_facCat'), {
    type: 'bar', data: { labels: catLabels,
      datasets: [{ label: 'Avg Facility Types', data: ca.order.map(function(c) { return +ca.data[c].avgFac.toFixed(1); }), backgroundColor: catColors }] },
    options: chartOpts('Category', 'Avg Facility Types')
  });

  createQMap('q2Map', 'div', 'Diversity Index');
  document.getElementById('q2Table').innerHTML = makeTable(
    ['Facility Type', 'Parcels', 'Coverage (%)'],
    freq.map(function(r) { return [r.facilityType, r.parcelsWithAccess, r.percent + '%']; }),
    [false, true, true]
  );
}

function initQ3() {
  var tr = D.q3.transitVsEnergy, dist = D.q3.distanceBinsEnergy, road = D.q3.roadUsage;

  new Chart(document.getElementById('q3_transitGfa'), {
    type: 'line', data: { labels: tr.map(function(r) { return r.transitIdx; }),
      datasets: [{ label: 'Avg GFA', data: tr.map(function(r) { return r.avgGFA; }),
        borderColor: '#2471a3', backgroundColor: 'rgba(36,113,163,0.1)', fill: true, tension: 0.3 }] },
    options: chartOpts('Transit Index', 'Avg GFA (m\u00B2)')
  });
  new Chart(document.getElementById('q3_transitEnergy'), {
    type: 'line', data: { labels: tr.map(function(r) { return r.transitIdx; }),
      datasets: [{ label: 'Avg Energy', data: tr.map(function(r) { return r.avgEnergy; }),
        borderColor: '#e67e22', backgroundColor: 'rgba(230,126,34,0.1)', fill: true, tension: 0.3 }] },
    options: chartOpts('Transit Index', 'Avg Energy (kWh)')
  });
  new Chart(document.getElementById('q3_roadUsage'), {
    type: 'bar', data: { labels: road.map(function(r) { return r.road; }),
      datasets: [{ label: 'Usage', data: road.map(function(r) { return r.usageCount; }),
        backgroundColor: road.map(function(r, i) { return i < 4 ? '#2471a3' : '#85929e'; }) }] },
    options: Object.assign({}, chartOpts('Road Type', 'Usage Count'), { indexAxis: 'y' })
  });
  new Chart(document.getElementById('q3_distEnergy'), {
    type: 'bar', data: { labels: dist.map(function(r) { return r.distanceBin; }),
      datasets: [{ label: 'Avg Energy', data: dist.map(function(r) { return r.avgEnergy; }), backgroundColor: '#e67e22' }] },
    options: chartOpts('Distance Bin', 'Avg Energy (kWh)')
  });

  var ca = computeCatAggregates();
  var catLabels = ca.order.map(function(c) { return CAT_LABELS[c]; });
  var catColors = ca.order.map(function(c) { return CAT_COLORS[c]; });
  new Chart(document.getElementById('q3_transitCat'), {
    type: 'bar', data: { labels: catLabels,
      datasets: [{ label: 'Avg Transit', data: ca.order.map(function(c) { return +ca.data[c].avgTi.toFixed(3); }), backgroundColor: catColors }] },
    options: chartOpts('Category', 'Avg Transit Index')
  });

  // High vs low transit comparison
  var sorted = nodes.slice().sort(function(a, b) { return a.ti - b.ti; });
  var q25 = Math.floor(sorted.length * 0.25);
  var lo = sorted.slice(0, q25), hi = sorted.slice(sorted.length - q25);
  function avg(arr, k) { var s = 0, c = 0; arr.forEach(function(n) { if (n[k]) { s += n[k]; c++; } }); return c > 0 ? s / c : 0; }
  var labels = ['GFA (\u00F710K)', 'Energy (\u00F710K)', 'Diversity (\u00D710)', 'Fac Types'];
  new Chart(document.getElementById('q3_transitCompare'), {
    type: 'bar', data: { labels: labels,
      datasets: [
        { label: 'Bottom 25%', data: [avg(lo, 'gfa') / 10000, avg(lo, 'e') / 10000, avg(lo, 'div') * 10, lo.reduce(function(s, n) { return s + (n.ft ? n.ft.split(',').length : 0); }, 0) / lo.length].map(function(v) { return +v.toFixed(1); }), backgroundColor: 'rgba(149,165,166,0.7)' },
        { label: 'Top 25%', data: [avg(hi, 'gfa') / 10000, avg(hi, 'e') / 10000, avg(hi, 'div') * 10, hi.reduce(function(s, n) { return s + (n.ft ? n.ft.split(',').length : 0); }, 0) / hi.length].map(function(v) { return +v.toFixed(1); }), backgroundColor: 'rgba(36,113,163,0.7)' }
      ] },
    options: chartOpts('Metric', 'Value (scaled)')
  });

  createQMap('q3Map', 'ti', 'Transit Index');
  document.getElementById('q3Table').innerHTML = makeTable(
    ['Transit Idx', 'Parcels', 'Avg Energy', 'Avg GFA', 'Avg Div', 'Avg Fac', 'Avg Dist'],
    tr.map(function(r) { return [r.transitIdx, r.parcels, fmt(r.avgEnergy), fmt(r.avgGFA), r.avgDiversity, r.avgAccess, fmt(r.avgFacDist)]; }),
    [true, true, true, true, true, true, true]
  );
}

function initQ4() {
  var counts = D.q4.socialFacilityCounts, equity = D.q4.equityByQuartile;

  new Chart(document.getElementById('q4_counts'), {
    type: 'bar', data: { labels: counts.map(function(r) { return r.type; }),
      datasets: [{ label: 'Count', data: counts.map(function(r) { return r.count; }),
        backgroundColor: ['#2471a3', '#27ae60', '#d4ac0d', '#8e44ad'] }] },
    options: chartOpts('Facility Type', 'Count')
  });
  new Chart(document.getElementById('q4_equity'), {
    type: 'bar', data: { labels: equity.map(function(r) { return r.quartile; }),
      datasets: [
        { label: 'Avg Facilities', data: equity.map(function(r) { return r.avgAccess; }), backgroundColor: '#2471a3' },
        { label: 'Avg Diversity (\u00D725)', data: equity.map(function(r) { return r.avgDiversity * 25; }), backgroundColor: '#27ae60' }
      ] },
    options: chartOpts('GFA Quartile', 'Value')
  });

  // Shared provider doughnut
  var etc = {};
  edges.forEach(function(e) { etc[e[2]] = (etc[e[2]] || 0) + 1; });
  var etKeys = Object.keys(etc).sort(function(a, b) { return etc[b] - etc[a]; });
  new Chart(document.getElementById('q4_sharing'), {
    type: 'doughnut', data: {
      labels: etKeys.map(function(k) { return EDGE_LABELS[k] || k; }),
      datasets: [{ data: etKeys.map(function(k) { return etc[k]; }),
        backgroundColor: etKeys.map(function(k) { return EDGE_COLORS[k] || '#85929e'; }) }] },
    options: { responsive: true, plugins: { legend: { position: 'right', labels: { font: { family: "'Segoe UI'", size: 9 } } } } }
  });

  var ca = computeCatAggregates();
  var catLabels = ca.order.map(function(c) { return CAT_LABELS[c]; });
  var catColors = ca.order.map(function(c) { return CAT_COLORS[c]; });
  new Chart(document.getElementById('q4_accessCat'), {
    type: 'bar', data: { labels: catLabels,
      datasets: [
        { label: 'Avg GFA (\u00F71K)', data: ca.order.map(function(c) { return +(ca.data[c].avgGfa / 1000).toFixed(1); }), backgroundColor: 'rgba(36,113,163,0.6)' },
        { label: 'Avg Fac Types', data: ca.order.map(function(c) { return +ca.data[c].avgFac.toFixed(1); }), backgroundColor: 'rgba(39,174,96,0.6)' }
      ] },
    options: chartOpts('Category', 'Value')
  });

  createQMap('q4Map', 'div', 'Facility Diversity');
  document.getElementById('q4Table').innerHTML = makeTable(
    ['Quartile', 'Parcels', 'Avg GFA', 'ChildCare %', 'Social %', 'Avg Fac', 'Avg Div'],
    equity.map(function(r) { return [r.quartile, r.parcels, fmt(r.avgGFA), '100.0%', '100.0%', r.avgAccess, r.avgDiversity]; }),
    [false, true, true, true, true, true, true]
  );
}

// ============================================================
// Q MAP HELPER
// ============================================================
var qMaps = {};
function createQMap(containerId, prop, label) {
  var map = L.map(containerId, { attributionControl: false }).setView([1.3521, 103.8198], 12);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(map);
  var vals = nodes.filter(function(n) { return n[prop] > 0; }).map(function(n) { return n[prop]; });
  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  if (min === max) max = min + 1;
  if (D.geojson && D.geojson.features.length > 0) {
    L.geoJSON(D.geojson, {
      style: function(feature) {
        var n = nodeMap[feature.properties.id];
        var v = n ? (n[prop] || 0) : 0;
        return { fillColor: interpolateColor((v - min) / (max - min)), weight: 0.5, color: '#666', fillOpacity: 0.65 };
      },
      onEachFeature: function(feature, layer) {
        var n = nodeMap[feature.properties.id];
        if (n) {
          layer.bindPopup('<strong>' + n.id + '</strong><br>' + label + ': ' + fmt(n[prop])
            + '<br>' + (CAT_LABELS[n.category] || n.category)
            + (n.gfa ? '<br>GFA: ' + fmt(n.gfa) + ' m\u00B2' : '')
            + (n.e ? '<br>Energy: ' + fmt(n.e) + ' kWh' : '')
            + '<br>Transit: ' + n.ti + ' | Diversity: ' + n.div);
        }
      }
    }).addTo(map);
  }
  var legend = L.control({ position: 'bottomright' });
  legend.onAdd = function() {
    var div = L.DomUtil.create('div');
    div.style.cssText = 'padding:8px 10px;font-family:Segoe UI,sans-serif;font-size:10px;background:rgba(255,255,255,0.92);border:1px solid #d5d8dc;border-radius:4px;';
    div.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">' + label + '</div>'
      + '<div style="display:flex;height:10px;border-radius:2px;overflow:hidden;">'
      + [0, 0.25, 0.5, 0.75, 1].map(function(t) { return '<div style="flex:1;background:' + interpolateColor(t) + '"></div>'; }).join('')
      + '</div><div style="display:flex;justify-content:space-between;margin-top:2px;"><span>' + fmt(min) + '</span><span>' + fmt(max) + '</span></div>';
    return div;
  };
  legend.addTo(map);
  qMaps[containerId.replace('Map', '')] = map;
}

// ============================================================
// ONTOLOGY
// ============================================================
function initOntology() {
  var ont = D.ontology;
  document.getElementById('owlClassCount').textContent = ont.classes.length;
  document.getElementById('owlObjCount').textContent = ont.objectProperties.length;
  document.getElementById('owlDataCount').textContent = ont.dataProperties.length;

  var childMap = {}, roots = [];
  ont.classes.forEach(function(c) {
    if (c.parent) { if (!childMap[c.parent]) childMap[c.parent] = []; childMap[c.parent].push(c); }
    else roots.push(c);
  });
  function buildTree(list) {
    var h = '<ul>';
    list.forEach(function(n) {
      var ch = childMap[n.name] || [];
      h += '<li class="root"><span class="class-name">' + n.name + '</span>';
      if (ch.length > 0) h += '<span class="class-count">' + ch.length + ' sub</span>';
      if (n.comment) h += '<span class="class-comment">' + n.comment + '</span>';
      if (ch.length > 0) h += buildTree(ch);
      h += '</li>';
    });
    return h + '</ul>';
  }
  document.getElementById('ontologyTree').innerHTML = buildTree(roots);
  document.getElementById('objPropTable').innerHTML = makeTable(['Property', 'Domain', 'Range', 'Description'],
    ont.objectProperties.map(function(p) { return [p.name, p.domain, p.range, p.comment]; }), [false, false, false, false]);
  document.getElementById('dataPropTable').innerHTML = makeTable(['Property', 'Domain', 'Range', 'Description'],
    ont.dataProperties.map(function(p) { return [p.name, p.domain, p.range, p.comment]; }), [false, false, false, false]);
}

// ============================================================
// REPORTS
// ============================================================
function initReports() { showReport('q1'); }
function showReport(qId) {
  document.querySelectorAll('#reportSubTabs button').forEach(function(b) { b.classList.remove('active'); });
  var idx = ['q1', 'q2', 'q3', 'q4'].indexOf(qId);
  if (idx >= 0) document.querySelectorAll('#reportSubTabs button')[idx].classList.add('active');
  document.getElementById('reportContent').innerHTML = renderMarkdown(D.reports[qId] || 'No report available.');
}

function renderMarkdown(md) {
  var h = md;
  h = h.replace(/```([^`]*?)```/gs, function(m, code) { return '<pre>' + code.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>'; });
  h = h.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm, function(m, header, sep, body) {
    var hC = header.split('|').filter(function(c) { return c.trim(); }).map(function(c) { return '<th>' + c.trim() + '</th>'; }).join('');
    var rows = body.trim().split('\n').map(function(row) {
      return '<tr>' + row.split('|').filter(function(c) { return c.trim(); }).map(function(c) { return '<td>' + c.trim() + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<table><thead><tr>' + hC + '</tr></thead><tbody>' + rows + '</tbody></table>';
  });
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/gs, '<ul>$&</ul>');
  h = h.replace(/\n\n/g, '</p><p>');
  h = '<p>' + h + '</p>';
  h = h.replace(/<p>\s*<(h[123]|ul|ol|pre|table|blockquote)/g, '<$1');
  h = h.replace(/<\/(h[123]|ul|ol|pre|table|blockquote)>\s*<\/p>/g, '</$1>');
  h = h.replace(/<p>\s*<\/p>/g, '');
  return h;
}
