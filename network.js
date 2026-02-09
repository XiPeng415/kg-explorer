/* ============================================================
   Singapore Urban Knowledge Graph Explorer - Network View
   Renders 1,869 parcel nodes + 102,494 edges on HTML Canvas
   with Leaflet mini-map, search, filters, and detail popup.
   ============================================================ */

(function () {
  'use strict';

  // ---- State ----
  let canvas, ctx, W, H;
  let tx = 0, ty = 0, k = 1;          // pan-x, pan-y, zoom
  let selected = -1, hovered = -1;
  let visibleCats = {};                 // category -> boolean
  let showAllEdges = false;
  let showLabels = false;
  let miniMap = null;
  let miniMapLayers = [];               // layers added for selection
  let geoJsonLayer = null;

  // Geographic bounds (computed on init)
  let minLat, maxLat, minLng, maxLng;
  let padFrac = 0.04;                   // padding fraction

  // Drag state
  let dragging = false, dragStartX, dragStartY, dragStartTx, dragStartTy;
  let dragMoved = false;

  // ---- Helpers ----

  /** Map geographic coords to pixel coords */
  function geoToPixel(lat, lng) {
    var x = (lng - minLng) / (maxLng - minLng) * W;
    var y = (1 - (lat - minLat) / (maxLat - minLat)) * H;
    return { x: x, y: y };
  }

  /** Transform pixel to screen coords */
  function toScreen(px, py) {
    return { x: px * k + tx, y: py * k + ty };
  }

  /** Transform screen to pixel coords */
  function fromScreen(sx, sy) {
    return { x: (sx - tx) / k, y: (sy - ty) / k };
  }

  /** Get node radius based on GFA, scaled by zoom */
  function nodeRadius(n) {
    var base = Math.max(2, Math.sqrt((n.gfa || 1000) / 1000) * 1.2);
    return Math.max(1.5, base);
  }

  /** Check if a node's category is currently visible */
  function isVisible(n) {
    return visibleCats[n.category] !== false;
  }

  /** Build adjacency lookup for a node: returns {type: [nodeIdx, ...]} */
  function getConnections(idx) {
    var groups = {};
    if (!adj || !adj[idx]) return groups;
    var list = adj[idx];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var other = e[0]; // neighbor index
      var t = e[1];     // edge type
      if (!groups[t]) groups[t] = [];
      groups[t].push(other);
    }
    return groups;
  }

  /** Get all connected node indices for a selected node */
  function getConnectedSet(idx) {
    var set = {};
    if (!adj || !adj[idx]) return set;
    var list = adj[idx];
    for (var i = 0; i < list.length; i++) {
      set[list[i][0]] = true; // list[i] = [neighborIdx, edgeType]
    }
    return set;
  }

  // ============================================================
  //  initNetwork
  // ============================================================
  function initNetwork() {
    canvas = document.getElementById('networkCanvas');
    if (!canvas) return;
    var wrap = canvas.parentElement;
    W = wrap.clientWidth;
    H = wrap.clientHeight;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');

    // Compute geographic bounds
    minLat = Infinity; maxLat = -Infinity;
    minLng = Infinity; maxLng = -Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.lat < minLat) minLat = n.lat;
      if (n.lat > maxLat) maxLat = n.lat;
      if (n.lng < minLng) minLng = n.lng;
      if (n.lng > maxLng) maxLng = n.lng;
    }
    // Add padding
    var latPad = (maxLat - minLat) * padFrac;
    var lngPad = (maxLng - minLng) * padFrac;
    minLat -= latPad; maxLat += latPad;
    minLng -= lngPad; maxLng += lngPad;

    // Compute pixel positions for each node
    for (var i = 0; i < nodes.length; i++) {
      var p = geoToPixel(nodes[i].lat, nodes[i].lng);
      nodes[i].px = p.x;
      nodes[i].py = p.y;
    }

    // Init visible categories
    for (var cat in CAT_COLORS) {
      visibleCats[cat] = true;
    }

    // Reset state
    tx = 0; ty = 0; k = 1;
    selected = -1; hovered = -1;
    showAllEdges = false;
    showLabels = false;

    // Setup interactions
    setupMouseEvents();
    setupSearch();
    populateStats();
    populateFilters();

    // Info badge
    var badge = document.getElementById('netInfoBadge');
    if (badge) {
      badge.textContent = nodes.length.toLocaleString() + ' nodes | ' +
        edges.length.toLocaleString() + ' edges | All loaded';
    }

    // Populate edge legend in sidebar
    var edgeLegendEl = document.getElementById('edgeLegend');
    if (edgeLegendEl) {
      var elHtml = '';
      for (var t in EDGE_COLORS) {
        elHtml += '<div class="edge-legend-item">';
        elHtml += '<span class="edge-legend-line" style="background:' + EDGE_COLORS[t] + '"></span>';
        elHtml += '<span>' + (EDGE_LABELS[t] || t) + '</span>';
        elHtml += '</div>';
      }
      edgeLegendEl.innerHTML = elHtml;
    }

    // Init mini map
    setupMiniMap();

    // Initial render
    renderNet();
  }

  // ============================================================
  //  renderNet
  // ============================================================
  function renderNet() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#fafbfc';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid
    ctx.strokeStyle = '#eef0f2';
    ctx.lineWidth = 0.5;
    var gridStep = 60;
    for (var gx = 0; gx < W; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (var gy = 0; gy < H; gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    var connSet = selected >= 0 ? getConnectedSet(selected) : {};

    // ---- Draw ALL edges (faint) ----
    if (showAllEdges) {
      ctx.globalAlpha = 0.03;
      ctx.strokeStyle = '#7f8c8d';
      ctx.lineWidth = 0.5 / k;
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var a = nodes[e[0]], b = nodes[e[1]];
        if (!isVisible(a) || !isVisible(b)) continue;
        var sa = toScreen(a.px, a.py);
        var sb = toScreen(b.px, b.py);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    // ---- Draw selected node's edges ----
    if (selected >= 0 && adj[selected]) {
      var selEdges = adj[selected];
      ctx.lineWidth = 1.5 / k;
      ctx.globalAlpha = 0.7;
      for (var i = 0; i < selEdges.length; i++) {
        var e = selEdges[i];
        var bi = e[0], t = e[1]; // adj entry = [neighborIdx, edgeType]
        var a = nodes[selected], b = nodes[bi];
        if (!isVisible(a) || !isVisible(b)) continue;
        ctx.strokeStyle = EDGE_COLORS[t] || '#95a5a6';
        var sa = toScreen(a.px, a.py);
        var sb = toScreen(b.px, b.py);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;

      // Draw edge type labels when zoomed in
      if (k > 3) {
        ctx.globalAlpha = 0.85;
        ctx.font = Math.max(8, 10 / k) + 'px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var i = 0; i < selEdges.length; i++) {
          var e = selEdges[i];
          var bi = e[0], t = e[1]; // adj entry = [neighborIdx, edgeType]
          var a = nodes[selected], b = nodes[bi];
          if (!isVisible(a) || !isVisible(b)) continue;
          var sa = toScreen(a.px, a.py);
          var sb = toScreen(b.px, b.py);
          var mx = (sa.x + sb.x) / 2;
          var my = (sa.y + sb.y) / 2;
          var label = EDGE_LABELS[t] || t;
          // Background for readability
          var tw = ctx.measureText(label).width + 6;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(mx - tw / 2, my - 6, tw, 12);
          ctx.fillStyle = EDGE_COLORS[t] || '#333';
          ctx.fillText(label, mx, my);
        }
        ctx.globalAlpha = 1.0;
      }
    }

    // ---- Draw nodes ----
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!isVisible(n)) continue;

      var s = toScreen(n.px, n.py);
      // Skip if off-screen
      if (s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) continue;

      var r = nodeRadius(n) * k;
      var isSelected = (i === selected);
      var isConnected = (selected >= 0 && connSet[i]);
      var isHovered = (i === hovered);

      // Dimming when something is selected
      if (selected >= 0 && !isSelected && !isConnected) {
        ctx.globalAlpha = 0.2;
      } else {
        ctx.globalAlpha = 1.0;
      }

      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(r, 1.5), 0, Math.PI * 2);

      if (isSelected) {
        // Selected: red fill, white + dark stroke
        ctx.fillStyle = '#e74c3c';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Dashed selection ring
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isConnected) {
        ctx.fillStyle = '#e67e22';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = CAT_COLORS[n.category] || '#95a5a6';
        ctx.fill();
        if (isHovered) {
          ctx.strokeStyle = '#2c3e50';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1.0;
    }

    // ---- Draw labels when zoomed in ----
    if (showLabels && k > 2.5) {
      ctx.font = Math.max(8, 10 / k * k) + 'px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!isVisible(n)) continue;
        var isSelected = (i === selected);
        var isConnected = (selected >= 0 && connSet[i]);
        if (selected >= 0 && !isSelected && !isConnected) continue;

        var s = toScreen(n.px, n.py);
        if (s.x < -50 || s.x > W + 50 || s.y < -50 || s.y > H + 50) continue;

        var r = nodeRadius(n) * k;
        ctx.fillStyle = isSelected ? '#c0392b' : (isConnected ? '#d35400' : '#2c3e50');
        ctx.fillText(n.id, s.x + r + 3, s.y - 2);
      }
    }
  }

  // ============================================================
  //  selectNode
  // ============================================================
  function selectNode(idx) {
    selected = idx;
    renderNet();

    var wrap = document.querySelector('.network-canvas-wrap');
    if (!wrap) return;

    // Get or create the popup element
    var popup = wrap.querySelector('.node-detail-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'node-detail-popup';
      wrap.appendChild(popup);
    }

    // ---- Deselect ----
    if (idx < 0 || idx >= nodes.length) {
      popup.classList.remove('visible');
      popup.innerHTML = '';
      clearMiniMapHighlights();
      return;
    }

    var n = nodes[idx];
    var conns = getConnections(idx);
    var connSet = getConnectedSet(idx);
    var catColor = CAT_COLORS[n.category] || '#95a5a6';
    var catLabel = CAT_LABELS[n.category] || n.category;

    // ---- Build HTML ----
    var html = '';

    // Header
    html += '<div class="node-detail-header">';
    html += '<button class="node-detail-close" onclick="NetworkView.selectNode(-1)">&times;</button>';
    html += '<h3>' + escHtml(n.id) + '</h3>';
    html += '<span class="node-cat-badge" style="background:' + catColor + '44;color:' + catColor + '">' + escHtml(catLabel) + '</span>';
    html += '</div>';

    // Body
    html += '<div class="node-detail-body">';

    // Properties section
    html += '<div class="node-detail-section">';
    html += '<h4>Properties</h4>';
    html += propRow('GFA', fmt(n.gfa, 0) + ' m\u00B2');
    html += propRow('Energy', fmt(n.e, 0) + ' kWh/yr');
    html += propRow('Buildings', n.b || '\u2014');
    html += propRow('Units', n.u || '\u2014');
    html += propRow('Max Levels', n.lvl || '\u2014');
    html += propRow('Transit Index', fmt(n.ti, 3));
    html += propRow('Diversity Index', fmt(n.div, 3));
    html += propRow('Bus Distance', n.bd != null ? fmt(n.bd, 0) + ' m' : '\u2014');
    html += propRow('MRT Distance', n.md != null ? fmt(n.md, 0) + ' m' : '\u2014');
    html += propRow('Nearest Bus', n.nb || '\u2014');
    html += propRow('Nearest MRT', n.nm || '\u2014');
    html += '</div>';

    // Facilities section (n.ft is a comma-separated string)
    var ftList = n.ft ? String(n.ft).split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    if (ftList.length > 0) {
      html += '<div class="node-detail-section">';
      html += '<h4>Facilities (' + ftList.length + ')</h4>';
      html += '<div class="facility-tags">';
      for (var f = 0; f < ftList.length; f++) {
        var ft = ftList[f];
        html += '<span class="facility-tag ft-' + escHtml(ft) + '">' + escHtml(ft) + '</span>';
      }
      html += '</div>';
      html += '</div>';
    }

    // Connections section
    var totalConns = 0;
    var edgeTypes = Object.keys(conns);
    for (var e = 0; e < edgeTypes.length; e++) {
      totalConns += conns[edgeTypes[e]].length;
    }

    html += '<div class="node-detail-section">';
    html += '<h4>Connections (' + totalConns + ')</h4>';

    for (var e = 0; e < edgeTypes.length; e++) {
      var t = edgeTypes[e];
      var list = conns[t];
      var eColor = EDGE_COLORS[t] || '#95a5a6';
      var eLabel = EDGE_LABELS[t] || t;

      html += '<div class="conn-group">';
      html += '<div class="conn-type">';
      html += '<span class="conn-type-line" style="background:' + eColor + '"></span>';
      html += escHtml(eLabel);
      html += '<span class="conn-type-count">(' + list.length + ')</span>';
      html += '</div>';
      html += '<div class="conn-list">';

      var showCount = Math.min(list.length, 20);
      for (var j = 0; j < showCount; j++) {
        var ni = list[j];
        html += '<span class="conn-node" onclick="NetworkView.centerOnNode(' + ni + ')">' + escHtml(nodes[ni].id) + '</span>';
      }
      if (list.length > 20) {
        html += '<span class="conn-more">+' + (list.length - 20) + ' more</span>';
      }
      html += '</div></div>';
    }

    // Edge legend
    html += '<div class="edge-legend">';
    for (var t in EDGE_COLORS) {
      if (!conns[t]) continue;
      html += '<span class="edge-legend-item">';
      html += '<span class="edge-legend-line" style="background:' + EDGE_COLORS[t] + '"></span>';
      html += (EDGE_LABELS[t] || t);
      html += '</span>';
    }
    html += '</div>';

    html += '</div>'; // end connections section
    html += '</div>'; // end body

    popup.innerHTML = html;

    // Force reflow before adding 'visible' to trigger CSS transition
    void popup.offsetWidth;
    popup.classList.add('visible');

    // ---- Update mini map ----
    updateMiniMapSelection(idx, connSet);

    // ---- Show map legend ----
    showMapLegend();
  }

  // ============================================================
  //  centerOnNode
  // ============================================================
  function centerOnNode(idx) {
    if (idx < 0 || idx >= nodes.length) return;
    var n = nodes[idx];
    k = 4;
    tx = W / 2 - n.px * k;
    ty = H / 2 - n.py * k;
    selectNode(idx);
  }

  // ============================================================
  //  showNetTooltip
  // ============================================================
  function showNetTooltip(idx, px, py) {
    // Remove existing tooltip
    var existing = document.querySelector('.net-tooltip');
    if (existing) existing.remove();

    if (idx < 0 || idx >= nodes.length) return;

    var n = nodes[idx];
    var conns = adj[idx] ? adj[idx].length : 0;
    var ftCount = n.ft ? String(n.ft).split(',').filter(Boolean).length : 0;
    var catLabel = CAT_LABELS[n.category] || n.category;
    var catColor = CAT_COLORS[n.category] || '#95a5a6';

    var tip = document.createElement('div');
    tip.className = 'tooltip net-tooltip';
    tip.innerHTML =
      '<div style="font-weight:600;font-size:12px;margin-bottom:4px">' + escHtml(n.id) + '</div>' +
      '<div style="display:inline-block;font-size:9px;padding:1px 6px;border-radius:8px;background:' + catColor + '33;color:' + catColor + ';margin-bottom:4px">' + escHtml(catLabel) + '</div>' +
      '<div>GFA: ' + fmt(n.gfa, 0) + ' m\u00B2</div>' +
      '<div>Energy: ' + fmt(n.e, 0) + ' kWh/yr</div>' +
      '<div>Facilities: ' + ftCount + '</div>' +
      '<div>Connections: ' + conns + '</div>';

    // Position
    tip.style.left = Math.min(px + 14, W - 200) + 'px';
    tip.style.top = Math.max(py - 60, 10) + 'px';

    var wrap = document.querySelector('.network-canvas-wrap');
    if (wrap) wrap.appendChild(tip);
  }

  function hideNetTooltip() {
    var existing = document.querySelector('.net-tooltip');
    if (existing) existing.remove();
  }

  // ============================================================
  //  toggleCat / netResetView / netToggleEdges / netToggleLabels
  // ============================================================
  function toggleCat(cat, checked) {
    visibleCats[cat] = checked;
    renderNet();
  }

  function netResetView() {
    tx = 0; ty = 0; k = 1;
    selected = -1; hovered = -1;
    var popup = document.querySelector('.node-detail-popup');
    if (popup) {
      popup.classList.remove('visible');
      popup.innerHTML = '';
    }
    clearMiniMapHighlights();
    renderNet();
  }

  function netToggleEdges() {
    showAllEdges = !showAllEdges;
    renderNet();
  }

  function netToggleLabels() {
    showLabels = !showLabels;
    renderNet();
  }

  // ============================================================
  //  netHitTest  -  find nearest visible node to mouse position
  // ============================================================
  function netHitTest(mx, my) {
    var p = fromScreen(mx, my);
    var bestDist = Infinity;
    var bestIdx = -1;
    var hitThresh = Math.max(8, 12 / k);

    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!isVisible(n)) continue;
      var dx = n.px - p.x;
      var dy = n.py - p.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var r = nodeRadius(n);
      if (dist < r + hitThresh && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  // ============================================================
  //  setupSearch
  // ============================================================
  function setupSearch() {
    var input = document.getElementById('searchInput');
    var results = document.getElementById('searchResults');
    if (!input || !results) return;

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (q.length < 1) {
        results.style.display = 'none';
        return;
      }

      var matches = [];
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id.toLowerCase().indexOf(q) !== -1) {
          matches.push(i);
          if (matches.length >= 30) break;
        }
      }

      if (matches.length === 0) {
        results.style.display = 'none';
        return;
      }

      results.style.display = 'block';
      for (var m = 0; m < matches.length; m++) {
        var idx = matches[m];
        var item = document.createElement('div');
        item.className = 'search-item';
        item.textContent = nodes[idx].id;
        item.dataset.idx = idx;
        item.addEventListener('click', function () {
          var ci = parseInt(this.dataset.idx);
          centerOnNode(ci);
          results.style.display = 'none';
          input.value = nodes[ci].id;
        });
        results.appendChild(item);
      }
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        results.style.display = 'none';
      }
    });

    // Close dropdown on outside click
    document.addEventListener('click', function (ev) {
      if (!input.contains(ev.target) && !results.contains(ev.target)) {
        results.style.display = 'none';
      }
    });
  }

  // ============================================================
  //  Mouse events  -  drag, click, wheel, hover
  // ============================================================
  function setupMouseEvents() {
    if (!canvas) return;

    // ---- Mousedown: start drag ----
    canvas.addEventListener('mousedown', function (ev) {
      dragging = true;
      dragMoved = false;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      dragStartTx = tx;
      dragStartTy = ty;
    });

    // ---- Mousemove: drag pan + hover ----
    canvas.addEventListener('mousemove', function (ev) {
      var rect = canvas.getBoundingClientRect();
      var mx = ev.clientX - rect.left;
      var my = ev.clientY - rect.top;

      if (dragging) {
        var dx = ev.clientX - dragStartX;
        var dy = ev.clientY - dragStartY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
        tx = dragStartTx + dx;
        ty = dragStartTy + dy;
        renderNet();
        return;
      }

      // Hover hit test
      var hit = netHitTest(mx, my);
      if (hit !== hovered) {
        hovered = hit;
        renderNet();
        if (hit >= 0) {
          var s = toScreen(nodes[hit].px, nodes[hit].py);
          showNetTooltip(hit, s.x, s.y);
          canvas.style.cursor = 'pointer';
        } else {
          hideNetTooltip();
          canvas.style.cursor = 'grab';
        }
      }
    });

    // ---- Mouseup: end drag or click ----
    canvas.addEventListener('mouseup', function (ev) {
      if (dragging && !dragMoved) {
        // It was a click, not a drag
        var rect = canvas.getBoundingClientRect();
        var mx = ev.clientX - rect.left;
        var my = ev.clientY - rect.top;
        var hit = netHitTest(mx, my);
        if (hit >= 0) {
          selectNode(hit);
        } else {
          selectNode(-1);
        }
      }
      dragging = false;
      dragMoved = false;
    });

    // ---- Mouseleave ----
    canvas.addEventListener('mouseleave', function () {
      dragging = false;
      hovered = -1;
      hideNetTooltip();
      renderNet();
    });

    // ---- Wheel: zoom ----
    canvas.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var mx = ev.clientX - rect.left;
      var my = ev.clientY - rect.top;

      var zoomFactor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      var newK = Math.max(0.3, Math.min(k * zoomFactor, 30));

      // Zoom toward mouse position
      tx = mx - (mx - tx) * (newK / k);
      ty = my - (my - ty) * (newK / k);
      k = newK;

      hideNetTooltip();
      renderNet();
    }, { passive: false });

    // ---- Resize handler ----
    window.addEventListener('resize', function () {
      var wrap = canvas.parentElement;
      if (!wrap) return;
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = W;
      canvas.height = H;

      // Recompute pixel positions
      for (var i = 0; i < nodes.length; i++) {
        var p = geoToPixel(nodes[i].lat, nodes[i].lng);
        nodes[i].px = p.x;
        nodes[i].py = p.y;
      }
      renderNet();
    });
  }

  // ============================================================
  //  Stats / Filters UI
  // ============================================================
  function populateStats() {
    var el = document.getElementById('networkStats');
    if (!el) return;

    // Count categories
    var catCounts = {};
    for (var i = 0; i < nodes.length; i++) {
      var c = nodes[i].category;
      catCounts[c] = (catCounts[c] || 0) + 1;
    }

    // Count edge types
    var edgeCounts = {};
    for (var i = 0; i < edges.length; i++) {
      var t = edges[i][2];
      edgeCounts[t] = (edgeCounts[t] || 0) + 1;
    }

    var html = '<div class="stat-grid">';
    html += '<div class="stat-card"><div class="stat-value">' + nodes.length.toLocaleString() + '</div><div class="stat-label">Nodes</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + edges.length.toLocaleString() + '</div><div class="stat-label">Edges</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + Object.keys(catCounts).length + '</div><div class="stat-label">Categories</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + Object.keys(edgeCounts).length + '</div><div class="stat-label">Edge Types</div></div>';
    html += '</div>';

    el.innerHTML = html;
  }

  function populateFilters() {
    var el = document.getElementById('networkFilters');
    if (!el) return;

    // Count per category
    var catCounts = {};
    for (var i = 0; i < nodes.length; i++) {
      var c = nodes[i].category;
      catCounts[c] = (catCounts[c] || 0) + 1;
    }

    var html = '';
    for (var cat in CAT_COLORS) {
      var label = CAT_LABELS[cat] || cat;
      var count = catCounts[cat] || 0;
      html += '<label class="filter-item">';
      html += '<input type="checkbox" checked onchange="NetworkView.toggleCat(\'' + cat + '\', this.checked)">';
      html += '<span class="filter-dot" style="background:' + CAT_COLORS[cat] + '"></span>';
      html += '<span>' + escHtml(label) + '</span>';
      html += '<span class="filter-count">' + count + '</span>';
      html += '</label>';
    }

    el.innerHTML = html;
  }

  // ============================================================
  //  Mini Map (Leaflet)
  // ============================================================
  function setupMiniMap() {
    var mapEl = document.getElementById('miniMap');
    if (!mapEl || typeof L === 'undefined') return;

    // Clean up previous instance
    if (miniMap) {
      miniMap.remove();
      miniMap = null;
    }

    miniMap = L.map(mapEl, {
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer(TILE_URL, {
      attribution: '&copy; CARTO',
      maxZoom: 18
    }).addTo(miniMap);

    // Build GeoJSON base layer from nodes colored by category
    var features = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      features.push({
        type: 'Feature',
        properties: { idx: i, id: n.id, category: n.category },
        geometry: { type: 'Point', coordinates: [n.lng, n.lat] }
      });
    }

    var geojson = { type: 'FeatureCollection', features: features };

    geoJsonLayer = L.geoJSON(geojson, {
      pointToLayer: function (feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 3,
          fillColor: CAT_COLORS[feature.properties.category] || '#95a5a6',
          color: '#fff',
          weight: 0.5,
          fillOpacity: 0.7
        });
      },
      onEachFeature: function (feature, layer) {
        layer.bindPopup('<strong>' + feature.properties.id + '</strong><br>' +
          (CAT_LABELS[feature.properties.category] || feature.properties.category));
      }
    }).addTo(miniMap);

    // Fit bounds to data
    var bounds = L.latLngBounds(
      [minLat + (maxLat - minLat) * padFrac, minLng + (maxLng - minLng) * padFrac],
      [maxLat - (maxLat - minLat) * padFrac, maxLng - (maxLng - minLng) * padFrac]
    );
    miniMap.fitBounds(bounds);

    miniMapLayers = [];
  }

  function clearMiniMapHighlights() {
    if (!miniMap) return;
    for (var i = 0; i < miniMapLayers.length; i++) {
      miniMap.removeLayer(miniMapLayers[i]);
    }
    miniMapLayers = [];
  }

  function updateMiniMapSelection(idx, connSet) {
    if (!miniMap) return;
    clearMiniMapHighlights();

    var n = nodes[idx];
    var markers = [];

    // Selected node marker (red, larger)
    var selMarker = L.circleMarker([n.lat, n.lng], {
      radius: 10,
      fillColor: '#e74c3c',
      color: '#fff',
      weight: 2,
      fillOpacity: 0.9
    }).bindPopup('<strong>' + escHtml(n.id) + '</strong><br>' +
      (CAT_LABELS[n.category] || n.category));
    selMarker.addTo(miniMap);
    miniMapLayers.push(selMarker);
    markers.push(selMarker);

    // Connected node markers (orange, smaller)
    var connKeys = Object.keys(connSet);
    for (var c = 0; c < connKeys.length; c++) {
      var ci = parseInt(connKeys[c]);
      var cn = nodes[ci];
      if (!cn) continue;

      // Determine relation types — adj entries are [neighborIdx, edgeType]
      var relTypes = [];
      if (adj[idx]) {
        for (var e = 0; e < adj[idx].length; e++) {
          var edge = adj[idx][e];
          if (edge[0] === ci) {
            relTypes.push(EDGE_LABELS[edge[1]] || edge[1]);
          }
        }
      }

      var connMarker = L.circleMarker([cn.lat, cn.lng], {
        radius: 5,
        fillColor: '#e67e22',
        color: '#fff',
        weight: 1,
        fillOpacity: 0.8
      }).bindPopup('<strong>' + escHtml(cn.id) + '</strong><br>' +
        relTypes.join(', '));
      connMarker.addTo(miniMap);
      miniMapLayers.push(connMarker);
      markers.push(connMarker);
    }

    // Add GeoJSON polygon highlights if geojson data is available
    if (D && D.geojson && D.geojson.features) {
      // Selected parcel polygon (red)
      var selFeature = geoIdx[n.id];
      if (selFeature) {
        var selPoly = L.geoJSON(selFeature, {
          style: { color: '#e74c3c', weight: 2, fillColor: '#e74c3c', fillOpacity: 0.3 }
        }).addTo(miniMap);
        miniMapLayers.push(selPoly);
      }

      // Connected parcel polygons (orange)
      for (var c = 0; c < connKeys.length; c++) {
        var ci = parseInt(connKeys[c]);
        var cn = nodes[ci];
        if (!cn) continue;
        var cFeature = geoIdx[cn.id];
        if (cFeature) {
          var cPoly = L.geoJSON(cFeature, {
            style: { color: '#e67e22', weight: 1, fillColor: '#e67e22', fillOpacity: 0.15 }
          }).addTo(miniMap);
          miniMapLayers.push(cPoly);
        }
      }
    }

    // Fit bounds to markers
    if (markers.length > 1) {
      var group = L.featureGroup(markers);
      miniMap.fitBounds(group.getBounds().pad(0.3));
    } else if (markers.length === 1) {
      miniMap.setView([n.lat, n.lng], 15);
    }
  }

  // Parcel geometry lookup uses the global geoIdx map built in app.js

  function showMapLegend() {
    var el = document.getElementById('mapLegend');
    if (!el) return;

    var html = '<div class="map-legend">';
    html += '<span class="map-legend-item"><span class="map-legend-dot" style="background:#e74c3c"></span> Selected</span>';
    html += '<span class="map-legend-item"><span class="map-legend-dot" style="background:#e67e22"></span> Connected</span>';
    for (var cat in CAT_COLORS) {
      html += '<span class="map-legend-item"><span class="map-legend-dot" style="background:' + CAT_COLORS[cat] + '"></span> ' + (CAT_LABELS[cat] || cat) + '</span>';
    }
    html += '</div>';
    el.innerHTML = html;
    el.style.display = 'block';
  }

  // ============================================================
  //  Utility
  // ============================================================
  function escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ============================================================
  //  Export to window.NetworkView
  // ============================================================
  window.NetworkView = {
    init:           initNetwork,
    render:         renderNet,
    selectNode:     selectNode,
    centerOnNode:   centerOnNode,
    showTooltip:    showNetTooltip,
    hideTooltip:    hideNetTooltip,
    toggleCat:      toggleCat,
    resetView:      netResetView,
    toggleEdges:    netToggleEdges,
    toggleLabels:   netToggleLabels,
    hitTest:        netHitTest,
    invalidateMiniMap: function() { if (miniMap) miniMap.invalidateSize(); }
  };

  // Also attach to window for direct global access
  window.initNetwork    = initNetwork;
  window.renderNet      = renderNet;
  window.selectNode     = selectNode;
  window.centerOnNode   = centerOnNode;
  window.showNetTooltip = showNetTooltip;
  window.toggleCat      = toggleCat;
  window.netResetView   = netResetView;
  window.netToggleEdges = netToggleEdges;
  window.netToggleLabels = netToggleLabels;
  window.netHitTest     = netHitTest;

})();
