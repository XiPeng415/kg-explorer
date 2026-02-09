/* ============================================================
   Singapore Urban Knowledge Graph Explorer — Query Engine
   Natural-language query interface over the parcel knowledge graph.
   Operates entirely client-side against the pre-loaded data arrays.

   Exports: window.QueryEngine
   ============================================================ */
(() => {
  'use strict';

  // ----------------------------------------------------------
  // Helper constants
  // ----------------------------------------------------------
  const CAT_LABELS = {
    TransitOrientedDense: 'Transit-Oriented Dense',
    TransitOriented: 'Transit-Oriented',
    LifestyleHub: 'Lifestyle Hub',
    HighDensity: 'High Density',
    StandardResidential: 'Standard Residential',
    Peripheral: 'Peripheral'
  };

  const CAT_COLORS = {
    TransitOrientedDense: '#c0392b',
    TransitOriented: '#e67e22',
    LifestyleHub: '#27ae60',
    HighDensity: '#8e44ad',
    StandardResidential: '#2980b9',
    Peripheral: '#7f8c8d'
  };

  const EDGE_LABELS = {
    'sn_Bar': 'Shares Nearest Bar',
    'sn_Cafe': 'Shares Nearest Cafe',
    'sn_ChildCare': 'Shares Nearest ChildCare',
    'sn_Facility': 'Shares Nearest Facility',
    'sn_Restaurant': 'Shares Nearest Restaurant',
    'sn_SocialService': 'Shares Nearest Social Service',
    'sn_UseSite': 'Shares Nearest Community Site',
    'sim': 'Similar Lifestyle'
  };

  // Category classification rules (mirrors the pipeline logic)
  const CATEGORY_RULES = [
    { key: 'TransitOrientedDense', desc: 'Transit Index >= 0.8 AND GFA > 100,000 m\u00b2' },
    { key: 'TransitOriented',      desc: 'Transit Index >= 0.7' },
    { key: 'LifestyleHub',         desc: 'Diversity Index >= 0.85' },
    { key: 'HighDensity',          desc: 'GFA > 200,000 m\u00b2' },
    { key: 'Peripheral',           desc: 'Transit Index < 0.3' },
    { key: 'StandardResidential',  desc: 'Default (none of the above)' }
  ];

  // Metric definitions for ranking / stats queries
  const METRICS = {
    energy:    { key: 'e',   label: 'Energy (kWh/yr)',      unit: 'kWh/yr' },
    gfa:       { key: 'gfa', label: 'Gross Floor Area (m\u00b2)', unit: 'm\u00b2' },
    transit:   { key: 'ti',  label: 'Transit Index',        unit: '' },
    diversity: { key: 'div', label: 'Diversity Index',       unit: '' },
    buildings: { key: 'b',   label: 'Buildings',             unit: '' },
    units:     { key: 'u',   label: 'Est. Residential Units',unit: '' },
    levels:    { key: 'lvl', label: 'Avg Building Levels',   unit: '' },
    bus:       { key: 'bd',  label: 'Bus Distance (m)',      unit: 'm' },
    mrt:       { key: 'md',  label: 'MRT Distance (m)',      unit: 'm' }
  };

  // ----------------------------------------------------------
  // Utility helpers
  // ----------------------------------------------------------

  /** Safe number formatter — delegates to global fmt() if available */
  function _fmt(n) {
    if (typeof fmt === 'function') return fmt(n);
    if (n == null || isNaN(n)) return '-';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
  }

  /** Compute mean of an array of numbers */
  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  /** Compute median */
  function median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** Compute standard deviation */
  function stddev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  }

  /** Build a small HTML table from header array and 2D rows */
  function htmlTable(headers, rows, numCols) {
    numCols = numCols || new Set();
    let h = '<table class="data-table"><thead><tr>';
    headers.forEach((hdr, i) => {
      h += `<th${numCols.has(i) ? ' style="text-align:right"' : ''}>${hdr}</th>`;
    });
    h += '</tr></thead><tbody>';
    rows.forEach(row => {
      h += '<tr>';
      row.forEach((cell, i) => {
        h += `<td${numCols.has(i) ? ' class="num"' : ''}>${cell}</td>`;
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  /** Escape HTML entities */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Category color dot HTML */
  function catDot(cat) {
    const c = CAT_COLORS[cat] || '#999';
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:4px;vertical-align:middle"></span>`;
  }

  // ----------------------------------------------------------
  // QueryEngine class
  // ----------------------------------------------------------
  class QueryEngine {
    /**
     * @param {Array}  nodes   - Array of parcel node objects
     * @param {Array}  edges   - Array of [srcIdx, tgtIdx, type]
     * @param {Object} adj     - Adjacency list { nodeIdx: [[neighborIdx, edgeType], ...] }
     * @param {Object} nodeMap - Map of id -> node object
     */
    constructor(nodes, edges, adj, nodeMap) {
      this.nodes = nodes;
      this.edges = edges;
      this.adj = adj;
      this.nodeMap = nodeMap;

      // Pre-compute aggregate statistics
      this._precompute();
    }

    // --------------------------------------------------------
    // Pre-computation
    // --------------------------------------------------------
    _precompute() {
      const n = this.nodes;

      // Group nodes by category
      this.byCategory = {};
      for (const cat of Object.keys(CAT_LABELS)) {
        this.byCategory[cat] = [];
      }
      n.forEach(node => {
        if (this.byCategory[node.category]) {
          this.byCategory[node.category].push(node);
        }
      });

      // Global aggregates
      this.stats = {
        count: n.length,
        totalGFA: n.reduce((s, d) => s + (d.gfa || 0), 0),
        totalEnergy: n.reduce((s, d) => s + (d.e || 0), 0),
        totalBuildings: n.reduce((s, d) => s + (d.b || 0), 0),
        totalUnits: n.reduce((s, d) => s + (d.u || 0), 0),
        avgTransit: mean(n.map(d => d.ti || 0)),
        avgDiversity: mean(n.map(d => d.div || 0)),
        avgGFA: mean(n.map(d => d.gfa || 0)),
        avgEnergy: mean(n.map(d => d.e || 0)),
        avgLevels: mean(n.filter(d => d.lvl > 0).map(d => d.lvl)),
        avgBusDist: mean(n.filter(d => d.bd > 0).map(d => d.bd)),
        avgMrtDist: mean(n.filter(d => d.md > 0).map(d => d.md)),
        edgeCount: this.edges.length
      };

      // Category-level aggregates
      this.catStats = {};
      for (const [cat, group] of Object.entries(this.byCategory)) {
        if (!group.length) {
          this.catStats[cat] = { count: 0 };
          continue;
        }
        this.catStats[cat] = {
          count: group.length,
          avgGFA: mean(group.map(d => d.gfa || 0)),
          avgEnergy: mean(group.map(d => d.e || 0)),
          avgTransit: mean(group.map(d => d.ti || 0)),
          avgDiversity: mean(group.map(d => d.div || 0)),
          avgBuildings: mean(group.map(d => d.b || 0)),
          avgUnits: mean(group.map(d => d.u || 0)),
          avgLevels: mean(group.filter(d => d.lvl > 0).map(d => d.lvl || 0)),
          totalGFA: group.reduce((s, d) => s + (d.gfa || 0), 0),
          totalEnergy: group.reduce((s, d) => s + (d.e || 0), 0)
        };
      }

      // Edge type counts
      this.edgeTypeCounts = {};
      this.edges.forEach(e => {
        const t = e[2];
        this.edgeTypeCounts[t] = (this.edgeTypeCounts[t] || 0) + 1;
      });

      // Collect all facility types
      this.allFacilityTypes = new Set();
      n.forEach(node => {
        if (node.ft) {
          node.ft.split(',').forEach(f => {
            const t = f.trim();
            if (t) this.allFacilityTypes.add(t);
          });
        }
      });
    }

    // --------------------------------------------------------
    // Main query dispatcher
    // --------------------------------------------------------

    /**
     * Process a natural-language query and return a result object.
     * @param {string} text - The user's query
     * @returns {{ title:string, type:string, html:string, chartConfig?:object, mapHighlights?:string[] }}
     */
    query(text) {
      const q = text.trim();
      if (!q) return this._error('Please enter a query.');

      const lower = q.toLowerCase();

      // 1. Parcel lookup — "kml_XXXXX" or "tell me about"
      const parcelMatch = q.match(/kml_\d+/i);
      if (parcelMatch) {
        return this._parcelLookup(parcelMatch[0]);
      }
      if (/tell me about|details? (?:of|for|on)/i.test(lower)) {
        const idInQuery = q.match(/kml_\d+/i);
        if (idInQuery) return this._parcelLookup(idInQuery[0]);
      }

      // 2. Methodology — "how are.*categor" or "node type" or "classification"
      if (/how are.*categor|node type|classification|category rule|how.*classif/i.test(lower)) {
        return this._methodology();
      }

      // 3. Comparison — "compare X and/vs Y"
      const compareMatch = lower.match(/compare\s+(.+?)\s+(?:and|vs\.?|versus|with)\s+(.+)/);
      if (compareMatch) {
        return this._comparison(compareMatch[1].trim(), compareMatch[2].trim());
      }

      // 4. Relationship / neighbor query
      if (/connected to|neighbors? of|connections? of|adjacent to|linked to/i.test(lower)) {
        const relId = q.match(/kml_\d+/i);
        if (relId) return this._relationships(relId[0]);
        return this._error('Please specify a parcel ID (e.g., kml_12345) for relationship queries.');
      }

      // 5. Rankings — "top/highest/largest/bottom/lowest/smallest"
      if (/\b(top|highest|largest|biggest|most|bottom|lowest|smallest|least|best|worst)\b/i.test(lower)) {
        return this._ranking(lower);
      }

      // 6. Facility query — "which parcels have bar/cafe/garden" etc.
      if (/which.*(?:have|with|contain)|parcels.*(?:have|with)|has (?:a )?(?:bar|cafe|garden|library|sport|museum|hawker|childcare|restaurant|social)/i.test(lower)) {
        return this._facilityQuery(lower);
      }

      // 7. Statistics — "average/mean/total/how many/median/std"
      if (/\b(average|mean|total|sum|how many|count|median|standard deviation|std dev)\b/i.test(lower)) {
        return this._statistics(lower);
      }

      // 8. Category info — check if any category name is mentioned
      const matchedCat = this._matchCategory(lower);
      if (matchedCat) {
        return this._categoryInfo(matchedCat);
      }

      // 9. General stats — "overview" or "summary"
      if (/overview|summary|general|dataset|about the (data|graph|knowledge)/i.test(lower)) {
        return this._overview();
      }

      // 10. Facility types listing
      if (/facilit(?:y|ies)|amenities|what (?:types|kinds)/i.test(lower)) {
        return this._facilityTypes();
      }

      // 11. Edge / relationship types
      if (/edge type|relationship type|connection type|link type/i.test(lower)) {
        return this._edgeTypes();
      }

      // Fallback — try to be helpful
      return this._fallback(q);
    }

    // --------------------------------------------------------
    // Query handlers
    // --------------------------------------------------------

    /** Parcel detail lookup */
    _parcelLookup(id) {
      const node = this.nodeMap[id];
      if (!node) {
        return this._error(`Parcel <strong>${esc(id)}</strong> was not found in the dataset.`);
      }

      const catLabel = CAT_LABELS[node.category] || node.category;
      const facilities = node.ft
        ? node.ft.split(',').map(f => f.trim()).filter(Boolean)
        : [];

      // Find connections
      const nodeIdx = this.nodes.indexOf(node);
      const connections = this.adj[nodeIdx] || [];
      const connByType = {};
      connections.forEach(([nIdx, eType]) => {
        if (!connByType[eType]) connByType[eType] = [];
        connByType[eType].push(this.nodes[nIdx]);
      });

      let html = `<div class="q-insight">
        <strong>${esc(id)}</strong> is a <strong>${catLabel}</strong> parcel
        located at (${node.lat.toFixed(4)}, ${node.lng.toFixed(4)}).
      </div>`;

      // Core metrics
      html += '<h4 style="font-size:12px;font-weight:600;margin:10px 0 6px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Core Metrics</h4>';
      const props = [
        ['Transit Index', _fmt(node.ti)],
        ['Diversity Index', _fmt(node.div)],
        ['Gross Floor Area', _fmt(node.gfa) + ' m\u00b2'],
        ['Annual Energy', _fmt(node.e) + ' kWh/yr'],
        ['Buildings', _fmt(node.b)],
        ['Est. Units', _fmt(node.u)],
        ['Avg Levels', _fmt(node.lvl)],
        ['Bus Distance', _fmt(node.bd) + ' m'],
        ['MRT Distance', _fmt(node.md) + ' m'],
        ['Nearest Bus', node.nb || '-'],
        ['Nearest MRT', node.nm || '-']
      ];
      html += '<div style="margin-bottom:14px">';
      props.forEach(([k, v]) => {
        html += `<div class="prop-row"><span class="prop-key">${k}</span><span class="prop-val">${v}</span></div>`;
      });
      html += '</div>';

      // Facilities
      if (facilities.length) {
        html += '<h4 style="font-size:12px;font-weight:600;margin:10px 0 6px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Facility Access</h4>';
        html += '<div class="facility-tags">';
        facilities.forEach(f => {
          html += `<span class="facility-tag ft-${f}">${f}</span>`;
        });
        html += '</div>';
      }

      // Connections summary
      if (connections.length) {
        html += '<h4 style="font-size:12px;font-weight:600;margin:14px 0 6px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Connections (' + connections.length + ')</h4>';
        for (const [eType, neighbors] of Object.entries(connByType)) {
          const label = EDGE_LABELS[eType] || eType;
          html += `<div style="margin-bottom:6px"><span style="font-size:11px;font-weight:600">${label}</span>
            <span style="font-size:10px;color:#7f8c8d">(${neighbors.length})</span>: `;
          const shown = neighbors.slice(0, 8);
          html += shown.map(n => `<code style="font-size:10px">${n.id}</code>`).join(', ');
          if (neighbors.length > 8) html += ` <em style="font-size:10px;color:#7f8c8d">+${neighbors.length - 8} more</em>`;
          html += '</div>';
        }
      }

      // Radar chart for this parcel vs category average
      const cs = this.catStats[node.category] || {};
      const chartConfig = {
        type: 'radar',
        data: {
          labels: ['Transit', 'Diversity', 'GFA (norm)', 'Energy (norm)', 'Buildings (norm)'],
          datasets: [
            {
              label: id,
              data: [
                node.ti || 0,
                node.div || 0,
                Math.min((node.gfa || 0) / 500000, 1),
                Math.min((node.e || 0) / 25000000, 1),
                Math.min((node.b || 0) / 50, 1)
              ],
              borderColor: CAT_COLORS[node.category] || '#2980b9',
              backgroundColor: (CAT_COLORS[node.category] || '#2980b9') + '33',
              borderWidth: 2,
              pointRadius: 3
            },
            {
              label: catLabel + ' Avg',
              data: [
                cs.avgTransit || 0,
                cs.avgDiversity || 0,
                Math.min((cs.avgGFA || 0) / 500000, 1),
                Math.min((cs.avgEnergy || 0) / 25000000, 1),
                Math.min((cs.avgBuildings || 0) / 50, 1)
              ],
              borderColor: '#bdc3c7',
              backgroundColor: '#bdc3c733',
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 2
            }
          ]
        },
        options: {
          scales: {
            r: { beginAtZero: true, max: 1, ticks: { stepSize: 0.25, font: { size: 10 } } }
          },
          plugins: { legend: { labels: { font: { size: 11 } } } }
        }
      };

      return {
        title: `Parcel ${id}`,
        type: 'parcel-detail',
        html,
        chartConfig,
        mapHighlights: [id]
      };
    }

    /** Top-N / Bottom-N ranking */
    _ranking(lower) {
      // Determine direction
      const isBottom = /bottom|lowest|smallest|least|worst/i.test(lower);
      const direction = isBottom ? 'asc' : 'desc';
      const dirLabel = isBottom ? 'Bottom' : 'Top';

      // Determine count (default 10)
      const countMatch = lower.match(/\b(\d+)\b/);
      let count = countMatch ? parseInt(countMatch[1], 10) : 10;
      if (count > 50) count = 50;
      if (count < 1) count = 10;

      // Determine metric
      const metric = this._matchMetric(lower);
      if (!metric) {
        return this._error('Could not determine which metric to rank. Try: energy, gfa, transit, diversity, buildings, units, levels, bus distance, mrt distance.');
      }

      const metricDef = METRICS[metric];
      const sorted = [...this.nodes]
        .filter(d => d[metricDef.key] != null && !isNaN(d[metricDef.key]))
        .sort((a, b) => direction === 'desc'
          ? (b[metricDef.key] || 0) - (a[metricDef.key] || 0)
          : (a[metricDef.key] || 0) - (b[metricDef.key] || 0)
        );

      const topN = sorted.slice(0, count);
      const ids = topN.map(d => d.id);

      // Build table
      const headers = ['Rank', 'Parcel ID', 'Category', metricDef.label];
      const rows = topN.map((d, i) => [
        i + 1,
        `<code>${d.id}</code>`,
        catDot(d.category) + (CAT_LABELS[d.category] || d.category),
        _fmt(d[metricDef.key]) + (metricDef.unit ? ' ' + metricDef.unit : '')
      ]);

      let html = `<div class="q-insight">${dirLabel} <strong>${count}</strong> parcels by <strong>${metricDef.label}</strong>.</div>`;
      html += htmlTable(headers, rows, new Set([0, 3]));

      // Bar chart
      const chartConfig = {
        type: 'bar',
        data: {
          labels: topN.map(d => d.id.replace('kml_', '')),
          datasets: [{
            label: metricDef.label,
            data: topN.map(d => d[metricDef.key] || 0),
            backgroundColor: topN.map(d => CAT_COLORS[d.category] || '#2980b9'),
            borderWidth: 0,
            borderRadius: 3
          }]
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { title: { display: true, text: metricDef.label, font: { size: 11 } }, ticks: { font: { size: 10 } } },
            y: { ticks: { font: { size: 10, family: "'SF Mono','Consolas',monospace" } } }
          }
        }
      };

      return {
        title: `${dirLabel} ${count} Parcels by ${metricDef.label}`,
        type: 'ranking',
        html,
        chartConfig,
        mapHighlights: ids
      };
    }

    /** Aggregate statistics for a metric */
    _statistics(lower) {
      const metric = this._matchMetric(lower);

      // "how many parcels" without a specific metric
      if (!metric && /how many|count/i.test(lower)) {
        // Check if asking about a category
        const cat = this._matchCategory(lower);
        if (cat) {
          const group = this.byCategory[cat] || [];
          return {
            title: `Count: ${CAT_LABELS[cat]}`,
            type: 'statistic',
            html: `<div class="q-insight">There are <strong>${group.length}</strong> parcels
              in the <strong>${CAT_LABELS[cat]}</strong> category
              (${(group.length / this.stats.count * 100).toFixed(1)}% of all ${_fmt(this.stats.count)} parcels).</div>`,
            mapHighlights: group.map(d => d.id)
          };
        }

        // Check if asking about a facility type
        const ft = this._matchFacilityType(lower);
        if (ft) {
          const matching = this.nodes.filter(d => d.ft && d.ft.split(',').map(s => s.trim().toLowerCase()).includes(ft.toLowerCase()));
          return {
            title: `Parcels with ${ft}`,
            type: 'statistic',
            html: `<div class="q-insight"><strong>${matching.length}</strong> parcels have access to a <strong>${ft}</strong>
              (${(matching.length / this.stats.count * 100).toFixed(1)}% of all parcels).</div>`
          };
        }

        // General count
        return {
          title: 'Parcel Count',
          type: 'statistic',
          html: `<div class="q-insight">The dataset contains <strong>${_fmt(this.stats.count)}</strong> parcels,
            connected by <strong>${_fmt(this.stats.edgeCount)}</strong> edges.</div>`
        };
      }

      if (!metric) {
        return this._error('Could not determine which metric to compute. Try: energy, gfa, transit, diversity, buildings, units.');
      }

      const metricDef = METRICS[metric];
      const values = this.nodes.map(d => d[metricDef.key] || 0).filter(v => !isNaN(v));
      const total = values.reduce((s, v) => s + v, 0);
      const avg = mean(values);
      const med = median(values);
      const sd = stddev(values);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);

      let html = `<div class="q-insight">Statistics for <strong>${metricDef.label}</strong> across ${_fmt(this.stats.count)} parcels.</div>`;

      const statRows = [
        ['Count', _fmt(values.length)],
        ['Total', _fmt(total) + (metricDef.unit ? ' ' + metricDef.unit : '')],
        ['Mean', _fmt(avg) + (metricDef.unit ? ' ' + metricDef.unit : '')],
        ['Median', _fmt(med) + (metricDef.unit ? ' ' + metricDef.unit : '')],
        ['Std Dev', _fmt(sd)],
        ['Min', _fmt(minVal) + (metricDef.unit ? ' ' + metricDef.unit : '')],
        ['Max', _fmt(maxVal) + (metricDef.unit ? ' ' + metricDef.unit : '')]
      ];
      html += htmlTable(['Statistic', 'Value'], statRows, new Set([1]));

      // Breakdown by category
      html += '<h4 style="font-size:12px;font-weight:600;margin:14px 0 6px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">By Category</h4>';
      const catHeaders = ['Category', 'Count', 'Mean', 'Total'];
      const catRows = Object.entries(this.byCategory)
        .filter(([, g]) => g.length > 0)
        .map(([cat, group]) => {
          const vals = group.map(d => d[metricDef.key] || 0);
          return [
            catDot(cat) + CAT_LABELS[cat],
            group.length,
            _fmt(mean(vals)),
            _fmt(vals.reduce((s, v) => s + v, 0))
          ];
        });
      html += htmlTable(catHeaders, catRows, new Set([1, 2, 3]));

      // Histogram via chart
      const bins = 12;
      const binWidth = (maxVal - minVal) / bins || 1;
      const histogram = new Array(bins).fill(0);
      values.forEach(v => {
        let b = Math.floor((v - minVal) / binWidth);
        if (b >= bins) b = bins - 1;
        histogram[b]++;
      });
      const binLabels = histogram.map((_, i) => _fmt(minVal + i * binWidth));

      const chartConfig = {
        type: 'bar',
        data: {
          labels: binLabels,
          datasets: [{
            label: 'Frequency',
            data: histogram,
            backgroundColor: '#2471a3',
            borderWidth: 0,
            borderRadius: 2
          }]
        },
        options: {
          plugins: {
            title: { display: true, text: `Distribution of ${metricDef.label}`, font: { size: 12 } },
            legend: { display: false }
          },
          scales: {
            x: { title: { display: true, text: metricDef.label, font: { size: 10 } }, ticks: { font: { size: 9 }, maxRotation: 45 } },
            y: { title: { display: true, text: 'Frequency', font: { size: 10 } }, ticks: { font: { size: 10 } } }
          }
        }
      };

      return {
        title: `Statistics: ${metricDef.label}`,
        type: 'statistics',
        html,
        chartConfig
      };
    }

    /** Category information and comparison */
    _categoryInfo(cat) {
      const cs = this.catStats[cat];
      const group = this.byCategory[cat] || [];
      const label = CAT_LABELS[cat];

      if (!group.length) {
        return this._error(`No parcels found in category <strong>${label}</strong>.`);
      }

      const rule = CATEGORY_RULES.find(r => r.key === cat);
      let html = `<div class="q-insight">
        ${catDot(cat)} <strong>${label}</strong> &mdash; ${group.length} parcels
        (${(group.length / this.stats.count * 100).toFixed(1)}% of dataset).<br>
        <em>Rule: ${rule ? rule.desc : 'N/A'}</em>
      </div>`;

      // Key metrics
      const headers = ['Metric', 'Category Avg', 'Dataset Avg', 'Ratio'];
      const metricsToShow = [
        { key: 'gfa', label: 'GFA (m\u00b2)', catVal: cs.avgGFA, globVal: this.stats.avgGFA },
        { key: 'e', label: 'Energy (kWh/yr)', catVal: cs.avgEnergy, globVal: this.stats.avgEnergy },
        { key: 'ti', label: 'Transit Index', catVal: cs.avgTransit, globVal: this.stats.avgTransit },
        { key: 'div', label: 'Diversity Index', catVal: cs.avgDiversity, globVal: this.stats.avgDiversity },
        { key: 'b', label: 'Buildings', catVal: cs.avgBuildings, globVal: mean(this.nodes.map(d => d.b || 0)) },
        { key: 'u', label: 'Est. Units', catVal: cs.avgUnits, globVal: mean(this.nodes.map(d => d.u || 0)) }
      ];
      const rows = metricsToShow.map(m => {
        const ratio = m.globVal > 0 ? (m.catVal / m.globVal) : 0;
        const ratioStr = ratio >= 1
          ? `<span style="color:#1e8449">${ratio.toFixed(2)}x</span>`
          : `<span style="color:#922b21">${ratio.toFixed(2)}x</span>`;
        return [m.label, _fmt(m.catVal), _fmt(m.globVal), ratioStr];
      });
      html += htmlTable(headers, rows, new Set([1, 2, 3]));

      // List top-5 parcels by GFA
      const top5 = [...group].sort((a, b) => (b.gfa || 0) - (a.gfa || 0)).slice(0, 5);
      html += '<h4 style="font-size:12px;font-weight:600;margin:14px 0 6px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Top 5 Parcels by GFA</h4>';
      const t5Headers = ['Parcel', 'GFA (m\u00b2)', 'Energy (kWh/yr)', 'Transit'];
      const t5Rows = top5.map(d => [
        `<code>${d.id}</code>`,
        _fmt(d.gfa),
        _fmt(d.e),
        _fmt(d.ti)
      ]);
      html += htmlTable(t5Headers, t5Rows, new Set([1, 2, 3]));

      // Bar chart comparing this category across metrics
      const allCats = Object.keys(this.byCategory).filter(c => (this.byCategory[c] || []).length > 0);
      const chartConfig = {
        type: 'bar',
        data: {
          labels: allCats.map(c => CAT_LABELS[c]),
          datasets: [
            {
              label: 'Avg Transit Index',
              data: allCats.map(c => this.catStats[c].avgTransit || 0),
              backgroundColor: '#e67e22',
              borderWidth: 0,
              borderRadius: 2
            },
            {
              label: 'Avg Diversity Index',
              data: allCats.map(c => this.catStats[c].avgDiversity || 0),
              backgroundColor: '#27ae60',
              borderWidth: 0,
              borderRadius: 2
            }
          ]
        },
        options: {
          plugins: {
            title: { display: true, text: 'Category Comparison: Transit & Diversity', font: { size: 12 } },
            legend: { labels: { font: { size: 10 } } }
          },
          scales: {
            x: { ticks: { font: { size: 9 }, maxRotation: 35 } },
            y: { beginAtZero: true, max: 1, ticks: { font: { size: 10 } } }
          }
        }
      };

      return {
        title: `Category: ${label}`,
        type: 'category',
        html,
        chartConfig,
        mapHighlights: group.map(d => d.id)
      };
    }

    /** Facility-based parcel query */
    _facilityQuery(lower) {
      const ft = this._matchFacilityType(lower);
      if (!ft) {
        return this._error(
          'Could not determine which facility type. Available: ' +
          [...this.allFacilityTypes].sort().join(', ')
        );
      }

      const matching = this.nodes.filter(d => {
        if (!d.ft) return false;
        return d.ft.split(',').map(s => s.trim().toLowerCase()).includes(ft.toLowerCase());
      });

      if (!matching.length) {
        return {
          title: `Parcels with ${ft}`,
          type: 'facility',
          html: `<div class="q-insight">No parcels were found with access to <strong>${esc(ft)}</strong>.</div>`
        };
      }

      let html = `<div class="q-insight"><strong>${matching.length}</strong> parcels have access to
        <strong>${esc(ft)}</strong> (${(matching.length / this.stats.count * 100).toFixed(1)}% of all parcels).</div>`;

      // Category breakdown
      const catBreakdown = {};
      matching.forEach(d => {
        catBreakdown[d.category] = (catBreakdown[d.category] || 0) + 1;
      });
      html += '<h4 style="font-size:12px;font-weight:600;margin:10px 0 6px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">By Category</h4>';
      const catRows = Object.entries(catBreakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, cnt]) => [
          catDot(cat) + CAT_LABELS[cat],
          cnt,
          (cnt / matching.length * 100).toFixed(1) + '%'
        ]);
      html += htmlTable(['Category', 'Count', 'Share'], catRows, new Set([1, 2]));

      // Show top 10 by GFA
      const top10 = [...matching].sort((a, b) => (b.gfa || 0) - (a.gfa || 0)).slice(0, 10);
      html += '<h4 style="font-size:12px;font-weight:600;margin:14px 0 6px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Top 10 by GFA</h4>';
      const t10Rows = top10.map((d, i) => [
        i + 1,
        `<code>${d.id}</code>`,
        catDot(d.category) + (CAT_LABELS[d.category] || d.category),
        _fmt(d.gfa) + ' m\u00b2'
      ]);
      html += htmlTable(['#', 'Parcel', 'Category', 'GFA'], t10Rows, new Set([0, 3]));

      // Doughnut chart for category breakdown
      const chartCats = Object.keys(catBreakdown);
      const chartConfig = {
        type: 'doughnut',
        data: {
          labels: chartCats.map(c => CAT_LABELS[c]),
          datasets: [{
            data: chartCats.map(c => catBreakdown[c]),
            backgroundColor: chartCats.map(c => CAT_COLORS[c] || '#999'),
            borderWidth: 1
          }]
        },
        options: {
          plugins: {
            title: { display: true, text: `"${ft}" Parcels by Category`, font: { size: 12 } },
            legend: { position: 'right', labels: { font: { size: 10 } } }
          }
        }
      };

      return {
        title: `Parcels with ${ft}`,
        type: 'facility',
        html,
        chartConfig,
        mapHighlights: matching.map(d => d.id)
      };
    }

    /** Relationships / connections for a specific parcel */
    _relationships(id) {
      const node = this.nodeMap[id];
      if (!node) {
        return this._error(`Parcel <strong>${esc(id)}</strong> was not found.`);
      }

      const nodeIdx = this.nodes.indexOf(node);
      const connections = this.adj[nodeIdx] || [];

      if (!connections.length) {
        return {
          title: `Connections: ${id}`,
          type: 'relationship',
          html: `<div class="q-insight">Parcel <strong>${esc(id)}</strong> has no connections in the graph.</div>`
        };
      }

      // Group by edge type
      const connByType = {};
      connections.forEach(([nIdx, eType]) => {
        if (!connByType[eType]) connByType[eType] = [];
        connByType[eType].push(this.nodes[nIdx]);
      });

      let html = `<div class="q-insight">Parcel <strong>${esc(id)}</strong>
        (${CAT_LABELS[node.category]}) has <strong>${connections.length}</strong>
        connections across <strong>${Object.keys(connByType).length}</strong> relationship types.</div>`;

      // Table per type
      const allNeighborIds = [];
      for (const [eType, neighbors] of Object.entries(connByType)) {
        const label = EDGE_LABELS[eType] || eType;
        html += `<h4 style="font-size:12px;font-weight:600;margin:12px 0 6px;color:#2471a3">${label} (${neighbors.length})</h4>`;

        const shown = neighbors.slice(0, 15);
        const nRows = shown.map(n => [
          `<code>${n.id}</code>`,
          catDot(n.category) + (CAT_LABELS[n.category] || n.category),
          _fmt(n.gfa) + ' m\u00b2',
          _fmt(n.ti)
        ]);
        html += htmlTable(['Parcel', 'Category', 'GFA', 'Transit'], nRows, new Set([2, 3]));
        if (neighbors.length > 15) {
          html += `<div style="font-size:10px;color:#7f8c8d;margin-top:4px">... and ${neighbors.length - 15} more</div>`;
        }

        neighbors.forEach(n => allNeighborIds.push(n.id));
      }

      // Category distribution of neighbors
      const neighborCats = {};
      connections.forEach(([nIdx]) => {
        const c = this.nodes[nIdx].category;
        neighborCats[c] = (neighborCats[c] || 0) + 1;
      });

      const chartCats = Object.keys(neighborCats);
      const chartConfig = {
        type: 'doughnut',
        data: {
          labels: chartCats.map(c => CAT_LABELS[c]),
          datasets: [{
            data: chartCats.map(c => neighborCats[c]),
            backgroundColor: chartCats.map(c => CAT_COLORS[c] || '#999'),
            borderWidth: 1
          }]
        },
        options: {
          plugins: {
            title: { display: true, text: `Neighbors of ${id} by Category`, font: { size: 12 } },
            legend: { position: 'right', labels: { font: { size: 10 } } }
          }
        }
      };

      return {
        title: `Connections of ${id}`,
        type: 'relationship',
        html,
        chartConfig,
        mapHighlights: [id, ...allNeighborIds]
      };
    }

    /** Side-by-side comparison of two categories */
    _comparison(nameA, nameB) {
      const catA = this._matchCategory(nameA);
      const catB = this._matchCategory(nameB);

      if (!catA || !catB) {
        const missing = !catA ? nameA : nameB;
        return this._error(
          `Could not match "<strong>${esc(missing)}</strong>" to a category. Available: ` +
          Object.values(CAT_LABELS).join(', ')
        );
      }

      const csA = this.catStats[catA];
      const csB = this.catStats[catB];
      const labelA = CAT_LABELS[catA];
      const labelB = CAT_LABELS[catB];

      let html = `<div class="q-insight">Comparing ${catDot(catA)}<strong>${labelA}</strong>
        (${csA.count} parcels) vs ${catDot(catB)}<strong>${labelB}</strong> (${csB.count} parcels).</div>`;

      const compMetrics = [
        ['Count', csA.count, csB.count],
        ['Avg GFA (m\u00b2)', _fmt(csA.avgGFA), _fmt(csB.avgGFA)],
        ['Total GFA (m\u00b2)', _fmt(csA.totalGFA), _fmt(csB.totalGFA)],
        ['Avg Energy (kWh/yr)', _fmt(csA.avgEnergy), _fmt(csB.avgEnergy)],
        ['Total Energy (kWh/yr)', _fmt(csA.totalEnergy), _fmt(csB.totalEnergy)],
        ['Avg Transit Index', _fmt(csA.avgTransit), _fmt(csB.avgTransit)],
        ['Avg Diversity Index', _fmt(csA.avgDiversity), _fmt(csB.avgDiversity)],
        ['Avg Buildings', _fmt(csA.avgBuildings), _fmt(csB.avgBuildings)],
        ['Avg Units', _fmt(csA.avgUnits), _fmt(csB.avgUnits)],
        ['Avg Levels', _fmt(csA.avgLevels), _fmt(csB.avgLevels)]
      ];
      html += htmlTable(['Metric', labelA, labelB], compMetrics, new Set([1, 2]));

      // Radar chart
      const normalize = (val, max) => max > 0 ? Math.min(val / max, 1) : 0;
      const maxGFA = Math.max(csA.avgGFA, csB.avgGFA, 1);
      const maxEnergy = Math.max(csA.avgEnergy, csB.avgEnergy, 1);
      const maxBuildings = Math.max(csA.avgBuildings, csB.avgBuildings, 1);
      const maxUnits = Math.max(csA.avgUnits, csB.avgUnits, 1);

      const chartConfig = {
        type: 'radar',
        data: {
          labels: ['Transit', 'Diversity', 'GFA', 'Energy', 'Buildings', 'Units'],
          datasets: [
            {
              label: labelA,
              data: [
                csA.avgTransit,
                csA.avgDiversity,
                normalize(csA.avgGFA, maxGFA),
                normalize(csA.avgEnergy, maxEnergy),
                normalize(csA.avgBuildings, maxBuildings),
                normalize(csA.avgUnits, maxUnits)
              ],
              borderColor: CAT_COLORS[catA],
              backgroundColor: CAT_COLORS[catA] + '33',
              borderWidth: 2,
              pointRadius: 3
            },
            {
              label: labelB,
              data: [
                csB.avgTransit,
                csB.avgDiversity,
                normalize(csB.avgGFA, maxGFA),
                normalize(csB.avgEnergy, maxEnergy),
                normalize(csB.avgBuildings, maxBuildings),
                normalize(csB.avgUnits, maxUnits)
              ],
              borderColor: CAT_COLORS[catB],
              backgroundColor: CAT_COLORS[catB] + '33',
              borderWidth: 2,
              pointRadius: 3
            }
          ]
        },
        options: {
          scales: {
            r: { beginAtZero: true, max: 1, ticks: { stepSize: 0.25, font: { size: 10 } } }
          },
          plugins: {
            title: { display: true, text: `${labelA} vs ${labelB}`, font: { size: 12 } },
            legend: { labels: { font: { size: 11 } } }
          }
        }
      };

      const allIds = [
        ...(this.byCategory[catA] || []).map(d => d.id),
        ...(this.byCategory[catB] || []).map(d => d.id)
      ];

      return {
        title: `${labelA} vs ${labelB}`,
        type: 'comparison',
        html,
        chartConfig,
        mapHighlights: allIds
      };
    }

    /** Explain classification methodology */
    _methodology() {
      let html = `<div class="q-insight">Parcels are classified into <strong>6 categories</strong>
        based on transit accessibility, diversity, and density metrics.
        Rules are evaluated in order; the <em>first matching</em> rule determines the category.</div>`;

      html += '<h4 style="font-size:12px;font-weight:600;margin:12px 0 8px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Classification Rules (in priority order)</h4>';

      const ruleRows = CATEGORY_RULES.map((r, i) => [
        i + 1,
        catDot(r.key) + CAT_LABELS[r.key],
        r.desc,
        _fmt((this.byCategory[r.key] || []).length)
      ]);
      html += htmlTable(['Priority', 'Category', 'Condition', 'Count'], ruleRows, new Set([0, 3]));

      html += `<h4 style="font-size:12px;font-weight:600;margin:14px 0 8px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Key Metrics Used</h4>
        <ul style="margin-left:18px;font-size:12px;line-height:1.8">
          <li><strong>Transit Index (ti)</strong>: 0-1, combining bus and MRT proximity. Higher = better transit access.</li>
          <li><strong>Diversity Index (div)</strong>: 0-1, based on facility type variety. Higher = more diverse amenities.</li>
          <li><strong>Gross Floor Area (gfa)</strong>: Total built-up area in m\u00b2. Proxy for density.</li>
        </ul>`;

      html += `<h4 style="font-size:12px;font-weight:600;margin:14px 0 8px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Edge Types</h4>
        <p style="font-size:12px;margin-bottom:8px">Parcels are connected when they share nearest amenities or have similar lifestyle profiles:</p>`;
      const edgeRows = Object.entries(EDGE_LABELS).map(([key, label]) => [
        label,
        key,
        _fmt(this.edgeTypeCounts[key] || 0)
      ]);
      html += htmlTable(['Relationship', 'Code', 'Count'], edgeRows, new Set([2]));

      // Distribution chart
      const cats = Object.keys(CAT_LABELS);
      const chartConfig = {
        type: 'pie',
        data: {
          labels: cats.map(c => CAT_LABELS[c]),
          datasets: [{
            data: cats.map(c => (this.byCategory[c] || []).length),
            backgroundColor: cats.map(c => CAT_COLORS[c]),
            borderWidth: 1
          }]
        },
        options: {
          plugins: {
            title: { display: true, text: 'Category Distribution', font: { size: 12 } },
            legend: { position: 'right', labels: { font: { size: 10 } } }
          }
        }
      };

      return {
        title: 'Classification Methodology',
        type: 'methodology',
        html,
        chartConfig
      };
    }

    /** Dataset overview */
    _overview() {
      const s = this.stats;

      let html = '<div class="stat-grid">';
      const statCards = [
        [_fmt(s.count), 'Parcels'],
        [_fmt(s.edgeCount), 'Edges'],
        [_fmt(s.totalGFA), 'Total GFA (m\u00b2)'],
        [_fmt(s.totalEnergy), 'Total Energy (kWh/yr)'],
        [_fmt(s.totalBuildings), 'Buildings'],
        [_fmt(s.totalUnits), 'Est. Units']
      ];
      statCards.forEach(([val, label]) => {
        html += `<div class="stat-card"><div class="stat-value">${val}</div><div class="stat-label">${label}</div></div>`;
      });
      html += '</div>';

      // Category breakdown table
      html += '<h4 style="font-size:12px;font-weight:600;margin:14px 0 8px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Category Breakdown</h4>';
      const cats = Object.keys(CAT_LABELS).filter(c => (this.byCategory[c] || []).length > 0);
      const catRows = cats.map(c => {
        const cs = this.catStats[c];
        return [
          catDot(c) + CAT_LABELS[c],
          cs.count,
          (cs.count / s.count * 100).toFixed(1) + '%',
          _fmt(cs.avgGFA),
          _fmt(cs.avgTransit),
          _fmt(cs.avgDiversity)
        ];
      });
      html += htmlTable(['Category', 'Count', 'Share', 'Avg GFA', 'Avg Transit', 'Avg Diversity'], catRows, new Set([1, 2, 3, 4, 5]));

      // Edge type breakdown
      html += '<h4 style="font-size:12px;font-weight:600;margin:14px 0 8px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Edge Types</h4>';
      const edgeRows = Object.entries(this.edgeTypeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([t, cnt]) => [EDGE_LABELS[t] || t, _fmt(cnt), (cnt / s.edgeCount * 100).toFixed(1) + '%']);
      html += htmlTable(['Type', 'Count', 'Share'], edgeRows, new Set([1, 2]));

      // Facility types
      html += '<h4 style="font-size:12px;font-weight:600;margin:14px 0 8px;color:#2471a3;text-transform:uppercase;letter-spacing:0.5px">Facility Types (' + this.allFacilityTypes.size + ')</h4>';
      html += '<div class="facility-tags" style="margin-bottom:12px">';
      [...this.allFacilityTypes].sort().forEach(f => {
        html += `<span class="facility-tag ft-${f}">${f}</span>`;
      });
      html += '</div>';

      // Pie chart
      const chartConfig = {
        type: 'pie',
        data: {
          labels: cats.map(c => CAT_LABELS[c]),
          datasets: [{
            data: cats.map(c => (this.byCategory[c] || []).length),
            backgroundColor: cats.map(c => CAT_COLORS[c]),
            borderWidth: 1
          }]
        },
        options: {
          plugins: {
            title: { display: true, text: 'Parcel Distribution by Category', font: { size: 12 } },
            legend: { position: 'right', labels: { font: { size: 10 } } }
          }
        }
      };

      return {
        title: 'Dataset Overview',
        type: 'overview',
        html,
        chartConfig
      };
    }

    /** List available facility types */
    _facilityTypes() {
      const ftCounts = {};
      this.nodes.forEach(d => {
        if (!d.ft) return;
        d.ft.split(',').forEach(f => {
          const t = f.trim();
          if (t) ftCounts[t] = (ftCounts[t] || 0) + 1;
        });
      });

      const sorted = Object.entries(ftCounts).sort((a, b) => b[1] - a[1]);
      let html = `<div class="q-insight">There are <strong>${sorted.length}</strong> facility types
        across the dataset. A parcel "has access to" a facility if it falls within the parcel boundary or nearest service area.</div>`;

      const rows = sorted.map(([ft, cnt], i) => [
        i + 1,
        `<span class="facility-tag ft-${ft}">${ft}</span>`,
        cnt,
        (cnt / this.stats.count * 100).toFixed(1) + '%'
      ]);
      html += htmlTable(['#', 'Facility Type', 'Parcels', '% Coverage'], rows, new Set([0, 2, 3]));

      const chartConfig = {
        type: 'bar',
        data: {
          labels: sorted.map(([ft]) => ft),
          datasets: [{
            label: 'Parcel Count',
            data: sorted.map(([, cnt]) => cnt),
            backgroundColor: '#2471a3',
            borderWidth: 0,
            borderRadius: 3
          }]
        },
        options: {
          indexAxis: 'y',
          plugins: {
            title: { display: true, text: 'Facility Type Coverage', font: { size: 12 } },
            legend: { display: false }
          },
          scales: {
            x: { title: { display: true, text: 'Number of Parcels', font: { size: 10 } }, ticks: { font: { size: 10 } } },
            y: { ticks: { font: { size: 10 } } }
          }
        }
      };

      return {
        title: 'Facility Types',
        type: 'facility-types',
        html,
        chartConfig
      };
    }

    /** Edge types overview */
    _edgeTypes() {
      let html = `<div class="q-insight">The knowledge graph has <strong>${_fmt(this.stats.edgeCount)}</strong> edges
        across <strong>${Object.keys(this.edgeTypeCounts).length}</strong> relationship types.</div>`;

      const sorted = Object.entries(this.edgeTypeCounts).sort((a, b) => b[1] - a[1]);
      const rows = sorted.map(([t, cnt]) => [
        EDGE_LABELS[t] || t,
        `<code>${t}</code>`,
        _fmt(cnt),
        (cnt / this.stats.edgeCount * 100).toFixed(1) + '%'
      ]);
      html += htmlTable(['Relationship', 'Code', 'Count', 'Share'], rows, new Set([2, 3]));

      const chartConfig = {
        type: 'bar',
        data: {
          labels: sorted.map(([t]) => EDGE_LABELS[t] || t),
          datasets: [{
            label: 'Edge Count',
            data: sorted.map(([, cnt]) => cnt),
            backgroundColor: sorted.map((_, i) => {
              const colors = ['#c0392b', '#e67e22', '#27ae60', '#8e44ad', '#2980b9', '#7f8c8d', '#1abc9c', '#d4ac0d'];
              return colors[i % colors.length];
            }),
            borderWidth: 0,
            borderRadius: 3
          }]
        },
        options: {
          indexAxis: 'y',
          plugins: {
            title: { display: true, text: 'Edge Type Distribution', font: { size: 12 } },
            legend: { display: false }
          },
          scales: {
            x: { title: { display: true, text: 'Count', font: { size: 10 } }, ticks: { font: { size: 10 } } },
            y: { ticks: { font: { size: 10 } } }
          }
        }
      };

      return {
        title: 'Edge / Relationship Types',
        type: 'edge-types',
        html,
        chartConfig
      };
    }

    // --------------------------------------------------------
    // Fallback and error
    // --------------------------------------------------------

    _fallback(q) {
      let html = `<div class="q-insight">I could not understand the query: "<em>${esc(q)}</em>".</div>`;
      html += '<p style="font-size:12px;margin-bottom:10px">Here are some things you can ask:</p>';
      html += '<ul style="margin-left:18px;font-size:12px;line-height:1.8">';
      this.getExampleQuestions().forEach(ex => {
        html += `<li>${esc(ex)}</li>`;
      });
      html += '</ul>';

      return {
        title: 'Query Not Understood',
        type: 'error',
        html
      };
    }

    _error(message) {
      return {
        title: 'Error',
        type: 'error',
        html: `<div class="q-insight" style="border-left-color:#922b21">${message}</div>`
      };
    }

    // --------------------------------------------------------
    // Example questions
    // --------------------------------------------------------

    getExampleQuestions() {
      return [
        'Show me an overview of the dataset',
        'Top 10 parcels by energy consumption',
        'Tell me about kml_10042',
        'How are parcels categorized?',
        'Which parcels have a Cafe?',
        'Compare Transit-Oriented Dense vs Peripheral',
        'Average transit index by category',
        'Neighbors of kml_10042',
        'How many parcels are High Density?',
        'Bottom 5 parcels by diversity index'
      ];
    }

    // --------------------------------------------------------
    // Matching helpers
    // --------------------------------------------------------

    /** Match a category name from freeform text */
    _matchCategory(text) {
      const t = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');

      // Direct key match
      for (const key of Object.keys(CAT_LABELS)) {
        if (t.includes(key.toLowerCase())) return key;
      }

      // Label match (fuzzy)
      const labelMap = {
        'transit oriented dense': 'TransitOrientedDense',
        'transit-oriented dense': 'TransitOrientedDense',
        'tod':                    'TransitOrientedDense',
        'transit oriented':       'TransitOriented',
        'transit-oriented':       'TransitOriented',
        'lifestyle hub':          'LifestyleHub',
        'lifestyle':              'LifestyleHub',
        'high density':           'HighDensity',
        'highdensity':            'HighDensity',
        'dense':                  'HighDensity',
        'standard residential':   'StandardResidential',
        'standard':               'StandardResidential',
        'residential':            'StandardResidential',
        'peripheral':             'Peripheral'
      };

      // Sort by key length descending to match most specific first
      const sorted = Object.entries(labelMap).sort((a, b) => b[0].length - a[0].length);
      for (const [pattern, cat] of sorted) {
        if (t.includes(pattern.replace(/-/g, ''))) return cat;
      }

      return null;
    }

    /** Match a metric keyword from query text */
    _matchMetric(text) {
      const t = text.toLowerCase();

      if (/\benergy\b|consumption|kwh/i.test(t)) return 'energy';
      if (/\bgfa\b|floor area|gross floor/i.test(t)) return 'gfa';
      if (/\btransit\b|accessibility/i.test(t)) return 'transit';
      if (/\bdiversit/i.test(t)) return 'diversity';
      if (/\bbuilding/i.test(t)) return 'buildings';
      if (/\bunits?\b|residential/i.test(t)) return 'units';
      if (/\blevels?\b|stor(?:ey|ies)|floors?\b/i.test(t)) return 'levels';
      if (/\bbus\b|bus dist/i.test(t)) return 'bus';
      if (/\bmrt\b|mrt dist|metro/i.test(t)) return 'mrt';

      return null;
    }

    /** Match a facility type from query text */
    _matchFacilityType(text) {
      const t = text.toLowerCase();

      // Direct match against known types
      const known = [
        'Bar', 'Cafe', 'Restaurant', 'Hawker', 'Garden',
        'Library', 'Sport', 'Museum', 'ChildCare', 'SocialService',
        'CommunityUseSite'
      ];

      for (const ft of known) {
        if (t.includes(ft.toLowerCase())) return ft;
      }

      // Fuzzy aliases
      if (/child\s*care|childcare|daycare|kindergarten/i.test(t)) return 'ChildCare';
      if (/social\s*service/i.test(t)) return 'SocialService';
      if (/community.*site|community.*use/i.test(t)) return 'CommunityUseSite';
      if (/hawk[ea]r/i.test(t)) return 'Hawker';
      if (/park|green/i.test(t)) return 'Garden';
      if (/gym|fitness|swim/i.test(t)) return 'Sport';

      // Try matching against actual facility types in the dataset
      for (const ft of this.allFacilityTypes) {
        if (t.includes(ft.toLowerCase())) return ft;
      }

      return null;
    }
  }

  // ----------------------------------------------------------
  // Export
  // ----------------------------------------------------------
  window.QueryEngine = QueryEngine;

})();
