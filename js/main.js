/* ═══════════════════════════════════════════════════════════════
   The Gathering Room — MTG Analytics Dashboard
   D3.js v7  |  Enter/Exit/Update with transitions throughout
   ═══════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────
const COLORS = ['W', 'U', 'B', 'R', 'G'];
const COLOR_NAMES = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

// Convert internal identity (WUBRG) to land abbreviations (PISMF)
const LAND_ABBR = { W: 'P', U: 'I', B: 'S', R: 'M', G: 'F' };
function toLandId(id) {
  if (!id || id === 'C') return 'C';
  return [...id].map(c => LAND_ABBR[c] || c).join('');
}

const COLOR_HEX = {
  W: '#f0d080', U: '#7ab0d0', B: '#c090d0', R: '#d07060', G: '#8a9a5b', C: '#b0a8a0'
};

// Guild/faction names for identity labels
const IDENTITY_NAMES = {
  C:'Colorless', W:'White', U:'Blue', B:'Black', R:'Red', G:'Green',
  WU:'Azorius', WB:'Orzhov', WR:'Boros', WG:'Selesnya',
  UB:'Dimir', UR:'Izzet', UG:'Simic', BR:'Rakdos', BG:'Golgari', RG:'Gruul',
  WUB:'Esper', WUR:'Jeskai', WUG:'Bant', WBR:'Mardu', WBG:'Abzan', WRG:'Naya',
  UBR:'Grixis', UBG:'Sultai', URG:'Temur', BRG:'Jund',
  WUBR:'PISM', WUBG:'PISF', WURG:'PIMF',
  WBRG:'PSMF', UBRG:'ISMF', WUBRG:'5-Color'
};

const RARITY_LABEL = { C: 'Common', U: 'Uncommon', R: 'Rare', M: 'Mythic' };
const TRANS = 600;  // ms, all D3 transitions

// ── Application State ──────────────────────────────────────────
const state = {
  selectedColor: null,    // single primary filter (string | null)
  compareColors: new Set(), // secondary comparison set (max 2)
  compareMode: false,     // compare mode on/off
  sortBy: 'count',        // 'count' | 'color' | 'alpha'
  metaIndex: 0,           // which meta is shown in timeline
  playing: false,         // animation running
  playTimer: null,
  topView: 'competitive', // 'competitive' | 'draft'
  scatterX: 'alsa',
  scatterY: 'gih_wr',
};

// ── Data Store ─────────────────────────────────────────────────
const DATA = {};

// ── Tooltip ────────────────────────────────────────────────────
const tip = d3.select('#tooltip');

function showTip(html, evt) {
  tip.html(html)
    .style('left', (evt.clientX + 14) + 'px')
    .style('top',  (evt.clientY - 36) + 'px')
    .style('opacity', 1);
}
function hideTip() { tip.style('opacity', 0); }

// ── Card panel (scatter click) ─────────────────────────────────
const cardPanel    = document.getElementById('card-panel');
const cardBackdrop = document.getElementById('card-panel-backdrop');
const cardImg      = document.getElementById('card-panel-img');
const cardLoader   = document.getElementById('card-panel-loader');
const cardStats    = document.getElementById('card-panel-stats');

function openCardPanel(d) {
  // Stats HTML
  const iwd = d.iwd >= 0 ? `+${d.iwd}pp` : `${d.iwd}pp`;
  const iwdClass = d.iwd >= 0 ? 'good' : 'bad';
  const wrClass  = d.gih_wr >= 55 ? 'good' : d.gih_wr < 50 ? 'bad' : '';
  cardStats.innerHTML = `
    <div class="stat-name">${d.name}</div>
    <div class="stat-row">
      <span class="stat-label">Rarity</span>
      <span class="stat-value">${RARITY_LABEL[d.rarity] || d.rarity}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">GIH Win Rate <span class="stat-hint" data-hint="Games In Hand Win Rate — postotak pobjeda u partijama gdje si imao ovu kartu u ruci barem jednom. Glavna mjera kvalitete karte.">?</span></span>
      <span class="stat-value ${wrClass}">${d.gih_wr}%</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Pick order (ALSA) <span class="stat-hint" data-hint="Average Last Seen At — prosječna pozicija u packetu kad karta zadnji put prođe dalje. Manji broj = uzima se ranije = visoko cijenjena.">?</span></span>
      <span class="stat-value">${d.alsa}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Play rate <span class="stat-hint" data-hint="Koliko često se karta stavi u deck kad se drafta. Visok postotak = gotovo uvijek igrana.">?</span></span>
      <span class="stat-value">${d.gp_pct}%</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Improves win rate by <span class="stat-hint" data-hint="IWD — za koliko postotnih poena raste win rate kad izvučeš ovu kartu, u odnosu na partije kad je nisi izvukao.">?</span></span>
      <span class="stat-value ${iwdClass}">${iwd}</span>
    </div>
  `;

  // Fetch card data from Scryfall (image + price)
  cardLoader.classList.remove('hidden');
  cardLoader.textContent = 'Loading…';
  cardImg.style.opacity = 0;
  cardImg.src = '';

  fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(d.name)}`)
    .then(r => r.json())
    .then(card => {
      // Image
      const imgUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal;
      if (imgUrl) {
        cardImg.onload = () => { cardLoader.classList.add('hidden'); cardImg.style.opacity = 1; };
        cardImg.src = imgUrl;
      } else {
        cardLoader.textContent = 'Image not found';
      }
      // Price — append to stats
      const usd = card.prices?.usd;
      const foil = card.prices?.usd_foil;
      const priceStr = usd ? `$${usd}` + (foil ? ` · foil $${foil}` : '') : 'N/A';
      const priceRow = document.createElement('div');
      priceRow.className = 'stat-row';
      priceRow.innerHTML = `<span class="stat-label">Price (TCGPlayer)</span><span class="stat-value">${priceStr}</span>`;
      cardStats.appendChild(priceRow);
    })
    .catch(() => { cardLoader.textContent = 'Failed to load'; });

  cardPanel.classList.add('open');
  cardBackdrop.classList.add('open');
  cardPanel.setAttribute('aria-hidden', 'false');
}

function closeCardPanel() {
  cardPanel.classList.remove('open');
  cardBackdrop.classList.remove('open');
  cardPanel.setAttribute('aria-hidden', 'true');
}

document.getElementById('card-panel-close').addEventListener('click', closeCardPanel);
cardBackdrop.addEventListener('click', closeCardPanel);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCardPanel(); });

// ── Color helpers ──────────────────────────────────────────────
function colorOf(identity) {
  if (!identity || identity === 'C') return COLOR_HEX.C;
  if (identity.length === 1)         return COLOR_HEX[identity] || COLOR_HEX.C;
  return COLOR_HEX[identity[0]];     // dominant color for multi
}

function identityLabel(id) {
  if (!id) return '';
  if (id.length === 1) return COLOR_NAMES[id] || id;
  return IDENTITY_NAMES[id] || toLandId(id);  // fallback to land abbr if no name
}

function isHighlighted(identity) {
  if (!state.selectedColor && state.compareColors.size === 0) return true;
  if (state.selectedColor && identity.includes(state.selectedColor)) return true;
  // 2 colors selected → highlight only identities that contain BOTH
  if (state.compareColors.size >= 2)
    return [...state.compareColors].every(c => identity.includes(c));
  if (state.compareColors.size === 1)
    return identity.includes([...state.compareColors][0]);
  return false;
}

// ════════════════════════════════════════════════════════════════
//  CHART 1: META EVOLUTION — Animated Bar Chart
// ════════════════════════════════════════════════════════════════
const TL = {};   // timeline chart state

function initTimeline() {
  const el = document.getElementById('timeline-chart');
  const M = { top: 18, right: 18, bottom: 66, left: 58 };
  TL.W = el.clientWidth  - M.left - M.right;
  TL.H = el.clientHeight - M.top  - M.bottom;

  TL.svg = d3.select('#timeline-chart').append('svg')
    .attr('width', '100%').attr('height', '100%')
    .append('g').attr('transform', `translate(${M.left},${M.top})`);

  TL.x = d3.scaleBand().range([0, TL.W]).padding(0.18);
  TL.y = d3.scaleLinear().range([TL.H, 0]);

  TL.svg.append('g').attr('class', 'x-axis axis')
    .attr('transform', `translate(0,${TL.H})`);
  TL.svg.append('g').attr('class', 'y-axis axis');
  TL.svg.append('g').attr('class', 'grid-group');
  TL.svg.append('g').attr('class', 'bars-group');
  TL.svg.append('g').attr('class', 'compare-bars-group');

  // Axis labels
  TL.svg.append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -TL.H / 2).attr('y', -48)
    .attr('text-anchor', 'middle').text('Deck Count');
}

function updateTimeline() {
  const meta = DATA.metaEvolution[state.metaIndex];
  if (!meta) return;
  document.getElementById('meta-label').textContent =
    `${meta.meta_name} — ${meta.total.toLocaleString()} decks`;

  // Build bar data, apply color filter
  let bars = meta.colors.slice();
  if (state.selectedColor)
    bars = bars.filter(d => d.id.includes(state.selectedColor));

  // Sort
  if (state.sortBy === 'count') bars.sort((a, b) => b.count - a.count);
  else if (state.sortBy === 'alpha') bars.sort((a, b) => a.id.localeCompare(b.id));
  else if (state.sortBy === 'color') bars.sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));

  bars = bars.slice(0, 14);

  // When 2 colors selected → filter to identities containing BOTH colors
  if (state.compareColors.size >= 2) {
    const colors = [...state.compareColors];
    bars = bars.filter(d => colors.every(c => d.id.includes(c)));
  }

  TL.x.domain(bars.map(d => d.id));
  TL.y.domain([0, (d3.max(bars, d => d.count) || 10) * 1.12]);
  const bw = TL.x.bandwidth();

  const xAxis = d3.axisBottom(TL.x).tickFormat(d => identityLabel(d));
  const yAxis = d3.axisLeft(TL.y).ticks(5).tickFormat(d3.format(','));

  TL.svg.select('.x-axis').transition().duration(TRANS).call(xAxis)
    .selectAll('text').attr('transform', 'rotate(-35)')
    .style('text-anchor', 'end').style('font-size', '11px');
  TL.svg.select('.y-axis').transition().duration(TRANS).call(yAxis);

  // Horizontal grid lines
  const ticks = TL.y.ticks(5);
  const grid = TL.svg.select('.grid-group').selectAll('line.grid-line').data(ticks);
  grid.enter().append('line').attr('class', 'grid-line')
    .merge(grid).transition().duration(TRANS)
    .attr('x1', 0).attr('x2', TL.W)
    .attr('y1', d => TL.y(d)).attr('y2', d => TL.y(d));
  grid.exit().remove();

  // ── ENTER / UPDATE / EXIT ──────────────────────────────────
  const rects = TL.svg.select('.bars-group')
    .selectAll('rect.bar').data(bars, d => d.id);

  const mainW = bw;

  // ENTER
  rects.enter().append('rect').attr('class', 'bar')
    .attr('x',      d => TL.x(d.id))
    .attr('y',      TL.y(0))
    .attr('width',  mainW)
    .attr('height', 0)
    .attr('fill',   d => colorOf(d.id))
    .attr('rx', 2)
    .on('mouseover', function(evt, d) {
      d3.select(this).attr('filter', 'brightness(1.4)');
      showTip(
        `<b>${identityLabel(d.id)}</b><br>` +
        `${d.count.toLocaleString()} decks &nbsp;(${d.pct}%)`, evt);
    })
    .on('mousemove', (evt, d) => showTip(
        `<b>${identityLabel(d.id)}</b><br>${d.count.toLocaleString()} decks (${d.pct}%)`, evt))
    .on('mouseout', function() {
      d3.select(this).attr('filter', null); hideTip();
    })
    .on('click', (evt, d) => {
      if (d.id.length === 1) selectColor(d.id);
    })
    .transition().duration(TRANS)          // animate into view
    .attr('y',      d => TL.y(d.count))
    .attr('height', d => TL.y(0) - TL.y(d.count));

  // UPDATE
  rects.transition().duration(TRANS)
    .attr('x',      d => TL.x(d.id))
    .attr('y',      d => TL.y(d.count))
    .attr('width',  mainW)
    .attr('height', d => TL.y(0) - TL.y(d.count))
    .attr('fill',   d => colorOf(d.id))
    .attr('opacity', 0.88);

  // EXIT
  rects.exit().transition().duration(TRANS)
    .attr('y', TL.y(0)).attr('height', 0).attr('opacity', 0).remove();

  // Clear any leftover compare bars from previous renders
  TL.svg.select('.compare-bars-group').selectAll('rect.bar-compare').remove();

  updateMetaDots();
}

function updateMetaDots() {
  const metas = DATA.metaEvolution.slice(0, 30);
  const sel = d3.select('#meta-dots').selectAll('.meta-dot').data(metas, d => d.meta_id);

  sel.enter().append('span').attr('class', 'meta-dot')
    .attr('title', d => d.meta_name)
    .on('click', function(evt, d) {
      state.metaIndex = DATA.metaEvolution.indexOf(d);
      stopAnimation();
      updateTimeline();
    })
    .merge(sel)
    .classed('active', (d, i) => i === state.metaIndex);

  sel.exit().remove();
}

// ════════════════════════════════════════════════════════════════
//  CHART 2: COLOR WEB — Chord Diagram
// ════════════════════════════════════════════════════════════════
const CH = {};

function initChord() {
  const el = document.getElementById('chord-chart');
  CH.svg = d3.select('#chord-chart').append('svg')
    .attr('width', '100%').attr('height', '100%');
  CH.g = CH.svg.append('g');
}

function updateChord() {
  const el   = document.getElementById('chord-chart');
  const W    = el.clientWidth;
  const H    = el.clientHeight;
  const size = Math.min(W, H);
  const outerR = size / 2 - 42;
  const innerR = outerR - 22;

  CH.g.attr('transform', `translate(${W / 2},${H / 2})`);

  // Build (possibly filtered) matrix
  const raw     = DATA.colorMatrix.matrix;
  const colors  = DATA.colorMatrix.colors;  // ['W','U','B','R','G']
  let   indices = [0, 1, 2, 3, 4];

  if (state.selectedColor) {
    // Show only rows/cols that connect to selected color
    const si = colors.indexOf(state.selectedColor);
    if (si !== -1) {
      // Keep all, but dim unrelated; don't filter out to keep diagram shape
    }
  }

  const chord  = d3.chord().padAngle(0.05).sortSubgroups(d3.descending);
  const chords = chord(raw);

  const arc    = d3.arc().innerRadius(innerR).outerRadius(outerR);
  const ribbon = d3.ribbon().radius(innerR);

  // ── Groups (outer arcs) — Enter/Update/Exit ────────────────
  const groups = CH.g.selectAll('g.chord-group')
    .data(chords.groups, d => d.index);

  const gEnter = groups.enter().append('g').attr('class', 'chord-group');
  gEnter.append('path').attr('class', 'chord-arc');
  gEnter.append('text').attr('class', 'chord-label');

  const gAll = gEnter.merge(groups);

  gAll.select('.chord-arc')
    .on('mouseover', function(evt, d) {
      const c = colors[d.index];
      showTip(`<b>${COLOR_NAMES[c]}</b><br>${d.value.toLocaleString()} total appearances`, evt);
      CH.g.selectAll('.chord-ribbon').transition().duration(150)
        .attr('opacity', r =>
          r.source.index === d.index || r.target.index === d.index ? 0.85 : 0.07);
    })
    .on('mousemove', (evt, d) =>
      showTip(`<b>${COLOR_NAMES[colors[d.index]]}</b><br>${d.value.toLocaleString()} deck appearances`, evt))
    .on('mouseout', function() {
      hideTip();
      CH.g.selectAll('.chord-ribbon').transition().duration(300).attr('opacity', 0.65);
    })
    .on('click', (evt, d) => selectColor(colors[d.index]))
    .transition().duration(TRANS)
    .attr('d', arc)
    .attr('fill', d => COLOR_HEX[colors[d.index]])
    .attr('stroke', 'rgba(8,8,16,0.5)')
    .attr('opacity', d => {
      const c = colors[d.index];
      if (!state.selectedColor && state.compareColors.size === 0) return 1;
      return (c === state.selectedColor || state.compareColors.has(c)) ? 1 : 0.3;
    });

  gAll.select('.chord-label')
    .transition().duration(TRANS)
    .attr('transform', d => {
      const angle = (d.startAngle + d.endAngle) / 2;
      const r     = outerR + 16;
      return `rotate(${angle * 180 / Math.PI - 90}) translate(${r},0)` +
             (angle > Math.PI ? ' rotate(180)' : '');
    })
    .attr('dy', '0.35em')
    .attr('text-anchor', d => (d.startAngle + d.endAngle) / 2 > Math.PI ? 'end' : 'start')
    .text(d => COLOR_NAMES[colors[d.index]]);

  groups.exit().transition().duration(TRANS).style('opacity', 0).remove();

  // ── Ribbons — Enter/Update/Exit ────────────────────────────
  const ribbons = CH.g.selectAll('path.chord-ribbon')
    .data(chords, d => `${d.source.index}-${d.target.index}`);

  ribbons.enter().append('path').attr('class', 'chord-ribbon')
    .attr('opacity', 0)
    .on('mouseover', function(evt, d) {
      const s = colors[d.source.index], t = colors[d.target.index];
      d3.select(this).transition().duration(100).attr('opacity', 0.9);
      const label = s === t
        ? `<b>${COLOR_NAMES[s]}</b> (mono-color)`
        : `<b>${COLOR_NAMES[s]} + ${COLOR_NAMES[t]}</b>`;
      showTip(`${label}<br>${d.source.value.toLocaleString()} decks`, evt);
    })
    .on('mousemove', (evt, d) => {
      const s = colors[d.source.index], t = colors[d.target.index];
      const label = s === t
        ? `<b>${COLOR_NAMES[s]}</b> (mono-color)`
        : `<b>${COLOR_NAMES[s]} + ${COLOR_NAMES[t]}</b>`;
      showTip(`${label}<br>${d.source.value.toLocaleString()} decks`, evt);
    })
    .on('mouseout', function() {
      d3.select(this).transition().duration(200).attr('opacity', 0.65); hideTip();
    })
    .merge(ribbons)
    .transition().duration(TRANS)
    .attr('d', ribbon)
    .attr('fill', d => COLOR_HEX[colors[d.source.index]])
    .attr('stroke', 'rgba(0,0,0,0.2)')
    .attr('opacity', 0.65);

  ribbons.exit().transition().duration(TRANS).attr('opacity', 0).remove();
}

// ════════════════════════════════════════════════════════════════
//  CHART 3: OTJ DRAFT COMPASS — Scatter Plot
// ════════════════════════════════════════════════════════════════
const SC = {};

function initScatter() {
  const el = document.getElementById('scatter-chart');
  const M  = { top: 14, right: 28, bottom: 52, left: 58 };
  SC.W = el.clientWidth  - M.left - M.right;
  SC.H = el.clientHeight - M.top  - M.bottom;

  SC.svg = d3.select('#scatter-chart').append('svg')
    .attr('width', '100%').attr('height', '100%')
    .append('g').attr('transform', `translate(${M.left},${M.top})`);

  SC.x    = d3.scaleLinear().range([SC.W, 0]);  // inverted: low ALSA = right = better
  SC.y    = d3.scaleLinear().range([SC.H, 0]);
  SC.size = d3.scaleSqrt().range([3, 15]);

  SC.svg.append('g').attr('class', 'x-axis axis').attr('transform', `translate(0,${SC.H})`);
  SC.svg.append('g').attr('class', 'y-axis axis');
  SC.svg.append('g').attr('class', 'grid-h');
  SC.svg.append('g').attr('class', 'grid-v');
  SC.svg.append('line').attr('class', 'ref-line x-ref');
  SC.svg.append('line').attr('class', 'ref-line y-ref');
  SC.svg.append('g').attr('class', 'dots-group');

  // Quadrant labels
  SC.svg.append('text').attr('class', 'quadrant-label ql-tr').attr('text-anchor', 'end');
  SC.svg.append('text').attr('class', 'quadrant-label ql-tl').attr('text-anchor', 'start');
  SC.svg.append('text').attr('class', 'quadrant-label ql-br').attr('text-anchor', 'end');

  // Axis labels
  SC.svg.append('text').attr('class', 'axis-label sc-xl')
    .attr('text-anchor', 'middle').attr('y', SC.H + 46);
  SC.svg.append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -SC.H / 2).attr('y', -50)
    .attr('text-anchor', 'middle').text('Win Rate (%)');

  // Rarity legend
  const legend = SC.svg.append('g').attr('class', 'legend-item')
    .attr('transform', `translate(${SC.W - 85},10)`);
  [['C','Common'],['U','Uncommon'],['R','Rare'],['M','Mythic']].forEach(([r, label], i) => {
    const row = legend.append('g').attr('transform', `translate(0,${i * 16})`);
    const sizes = { C: 3, U: 5, R: 8, M: 11 };
    row.append('circle').attr('r', sizes[r]).attr('cx', 8)
      .attr('fill', '#7a7a9a').attr('opacity', 0.7);
    row.append('text').attr('x', 18).attr('dy', '0.35em')
      .style('font-size', '10px').text(label);
  });
}

function updateScatter() {
  const xKey = state.scatterX;
  const yKey = state.scatterY;

  const xLabels = { alsa: 'Pick Order (ALSA) — right = picked earlier', gp_pct: 'Play Rate (% of games)' };
  const yLabels = { gih_wr: 'Win Rate (GIH WR %)', iwd: 'Improvement When Drawn (pp)' };

  let dots = DATA.otjRatings.filter(d => d.num_gp > 30);

  const xExt = d3.extent(dots, d => d[xKey]);
  const yExt = d3.extent(dots, d => d[yKey]);
  const pad  = ([a, b]) => [a - (b - a) * 0.05, b + (b - a) * 0.05];

  SC.x.domain(pad(xExt));
  SC.y.domain(pad(yExt));
  SC.size.domain([0, d3.max(dots, d => d.num_gp)]);

  SC.svg.select('.x-axis').transition().duration(TRANS)
    .call(d3.axisBottom(SC.x).ticks(6));
  SC.svg.select('.y-axis').transition().duration(TRANS)
    .call(d3.axisLeft(SC.y).ticks(6).tickFormat(d => d + '%'));
  SC.svg.select('.sc-xl').attr('x', SC.W / 2).text(xLabels[xKey]);

  // Grid lines
  const yticks = SC.y.ticks(6);
  const xticks = SC.x.ticks(6);

  const gh = SC.svg.select('.grid-h').selectAll('line.grid-line').data(yticks);
  gh.enter().append('line').attr('class', 'grid-line')
    .merge(gh).transition().duration(TRANS)
    .attr('x1', 0).attr('x2', SC.W)
    .attr('y1', d => SC.y(d)).attr('y2', d => SC.y(d));
  gh.exit().remove();

  const gv = SC.svg.select('.grid-v').selectAll('line.grid-line').data(xticks);
  gv.enter().append('line').attr('class', 'grid-line')
    .merge(gv).transition().duration(TRANS)
    .attr('x1', d => SC.x(d)).attr('x2', d => SC.x(d))
    .attr('y1', 0).attr('y2', SC.H);
  gv.exit().remove();

  // Average reference lines
  const avgX = d3.mean(dots, d => d[xKey]);
  const avgY = d3.mean(dots, d => d[yKey]);

  SC.svg.select('.x-ref').transition().duration(TRANS)
    .attr('x1', SC.x(avgX)).attr('x2', SC.x(avgX))
    .attr('y1', 0).attr('y2', SC.H);
  SC.svg.select('.y-ref').transition().duration(TRANS)
    .attr('x1', 0).attr('x2', SC.W)
    .attr('y1', SC.y(avgY)).attr('y2', SC.y(avgY));

  // Quadrant labels
  SC.svg.select('.ql-tr').attr('x', SC.x(avgX) - 6).attr('y', 16)
    .text('High pick, high WR ★');
  SC.svg.select('.ql-tl').attr('x', SC.x(avgX) + 6).attr('y', 16)
    .text('Late pick, high WR');
  SC.svg.select('.ql-br').attr('x', SC.x(avgX) - 6).attr('y', SC.H - 6)
    .text('High pick, low WR');

  // ── ENTER / UPDATE / EXIT dots ─────────────────────────────
  const circles = SC.svg.select('.dots-group')
    .selectAll('circle.dot').data(dots, d => d.name);

  // ENTER
  circles.enter().append('circle').attr('class', 'dot')
    .attr('cx', d => SC.x(d[xKey]))
    .attr('cy', SC.y(avgY))
    .attr('r', 0)
    .attr('fill', d => COLOR_HEX[d.color] || COLOR_HEX.C)
    .attr('stroke', 'rgba(0,0,0,0.4)').attr('stroke-width', 0.5)
    .on('mouseover', function(evt, d) {
      d3.select(this).raise()
        .transition().duration(120).attr('r', SC.size(d.num_gp) * 1.5)
        .attr('stroke', '#fff').attr('stroke-width', 1.5);
      showTip(
        `<b>${d.name}</b> <small>${RARITY_LABEL[d.rarity] || d.rarity}</small><br>` +
        `GIH WR: <b>${d.gih_wr}%</b><br>` +
        `Pick order (ALSA): <b>${d.alsa}</b><br>` +
        `Play rate: <b>${d.gp_pct}%</b>  IWD: <b>${d.iwd > 0 ? '+' : ''}${d.iwd}pp</b>`, evt);
    })
    .on('mousemove', (evt, d) => showTip(
        `<b>${d.name}</b> — ${d.gih_wr}% WR`, evt))
    .on('mouseout', function(evt, d) {
      d3.select(this).transition().duration(150)
        .attr('r', SC.size(d.num_gp))
        .attr('stroke', 'rgba(0,0,0,0.4)').attr('stroke-width', 0.5);
      hideTip();
    })
    .on('click', function(evt, d) {
      evt.stopPropagation();
      hideTip();
      openCardPanel(d);
    })
    .attr('cursor', 'pointer')
    .transition().duration(TRANS)
    .attr('cy', d => SC.y(d[yKey]))
    .attr('r',  d => SC.size(d.num_gp));

  // UPDATE
  circles.transition().duration(TRANS)
    .attr('cx', d => SC.x(d[xKey]))
    .attr('cy', d => SC.y(d[yKey]))
    .attr('r',  d => SC.size(d.num_gp))
    .attr('fill', d => COLOR_HEX[d.color] || COLOR_HEX.C)
    .attr('opacity', d => {
      const c = d.color;
      if (!state.selectedColor && state.compareColors.size === 0) return 0.82;
      if (state.compareColors.has(c)) return 1;
      if (c === state.selectedColor) return 1;
      return 0.1;
    })
    .attr('stroke-width', d =>
      state.compareColors.has(d.color) ? 2 : 0.5)
    .attr('stroke', d =>
      state.compareColors.has(d.color) ? '#fff' : 'rgba(0,0,0,0.4)');

  // EXIT
  circles.exit().transition().duration(TRANS).attr('r', 0).remove();
}

// ════════════════════════════════════════════════════════════════
//  CHART 4: TOP CARDS — Horizontal Bar Chart
// ════════════════════════════════════════════════════════════════
const TC = {};

function initTopCards() {
  const el = document.getElementById('topcards-chart');
  const M  = { top: 6, right: 78, bottom: 36, left: 148 };
  TC.W = el.clientWidth  - M.left - M.right;
  TC.H = el.clientHeight - M.top  - M.bottom;

  TC.svg = d3.select('#topcards-chart').append('svg')
    .attr('width', '100%').attr('height', '100%')
    .append('g').attr('transform', `translate(${M.left},${M.top})`);

  TC.x = d3.scaleLinear().range([0, TC.W]);
  TC.y = d3.scaleBand().range([0, TC.H]).padding(0.18);

  TC.svg.append('g').attr('class', 'x-axis axis')
    .attr('transform', `translate(0,${TC.H})`);
  TC.svg.append('g').attr('class', 'y-axis axis');
  TC.svg.append('g').attr('class', 'bars-group');
  TC.svg.append('g').attr('class', 'val-group');
}

function updateTopCards() {
  const isComp = state.topView === 'competitive';
  let   cards;
  let   valKey, valFmt;

  if (isComp) {
    cards  = DATA.topCompetitive.slice();
    valKey = 'freq';
    valFmt = d => d[valKey].toLocaleString();
  } else {
    cards  = DATA.otjRatings.filter(d => d.num_gp > 80).slice();
    valKey = 'gih_wr';
    valFmt = d => d[valKey].toFixed(1) + '%';
  }

  // Color filter
  if (state.selectedColor || state.compareColors.size > 0) {
    const activeColors = new Set(
      state.selectedColor
        ? [state.selectedColor, ...state.compareColors]
        : state.compareColors
    );
    cards = cards.filter(d => {
      const id = isComp ? d.identity : d.color;
      return id && [...activeColors].some(c => id.includes(c));
    });
  }

  cards.sort((a, b) => b[valKey] - a[valKey]);
  cards = cards.slice(0, 15);

  TC.y.domain(cards.map(d => d.name));
  TC.x.domain([0, d3.max(cards, d => d[valKey]) * 1.1 || 1]);

  TC.svg.select('.x-axis').transition().duration(TRANS)
    .call(d3.axisBottom(TC.x).ticks(5).tickFormat(
      isComp ? d3.format(',') : d => d + '%'));
  TC.svg.select('.y-axis').transition().duration(TRANS)
    .call(d3.axisLeft(TC.y).tickFormat(d => d.length > 18 ? d.slice(0, 17) + '…' : d));

  // ── ENTER / UPDATE / EXIT bars ─────────────────────────────
  const bars = TC.svg.select('.bars-group')
    .selectAll('rect.tc-bar').data(cards, d => d.name);

  // ENTER
  bars.enter().append('rect').attr('class', 'tc-bar')
    .attr('x', 0)
    .attr('y',      d => TC.y(d.name) ?? 0)
    .attr('height', TC.y.bandwidth())
    .attr('width',  0)
    .attr('rx', 2)
    .attr('fill', d => colorOf(isComp ? d.identity : d.color))
    .on('mouseover', function(evt, d) {
      d3.select(this).attr('filter', 'brightness(1.35)');
      const id = isComp ? d.identity : d.color;
      showTip(
        `<b>${d.name}</b><br>${identityLabel(id)}<br>` +
        (isComp
          ? `${d[valKey].toLocaleString()} deck appearances`
          : `GIH WR: <b>${d[valKey].toFixed(1)}%</b>  IWD: ${d.iwd > 0 ? '+' : ''}${d.iwd}pp`
        ), evt);
    })
    .on('mousemove', (evt, d) =>
      showTip(`<b>${d.name}</b> — ${valFmt(d)}`, evt))
    .on('mouseout', function() {
      d3.select(this).attr('filter', null); hideTip();
    })
    .transition().duration(TRANS).attr('width', d => TC.x(d[valKey]));

  // UPDATE
  bars.transition().duration(TRANS)
    .attr('y',      d => TC.y(d.name) ?? 0)
    .attr('height', TC.y.bandwidth())
    .attr('width',  d => TC.x(d[valKey]))
    .attr('fill', d => colorOf(isComp ? d.identity : d.color))
    .attr('opacity', d => {
      const id = isComp ? d.identity : d.color;
      if (!state.selectedColor && state.compareColors.size === 0) return 0.88;
      return isHighlighted(id) ? 1 : 0.25;
    });

  // EXIT
  bars.exit().transition().duration(TRANS)
    .attr('width', 0).attr('opacity', 0).remove();

  // ── Value labels — Enter/Update/Exit ──────────────────────
  const labels = TC.svg.select('.val-group')
    .selectAll('text.val-label').data(cards, d => d.name);

  labels.enter().append('text').attr('class', 'val-label')
    .attr('x', 0).attr('y', d => (TC.y(d.name) ?? 0) + TC.y.bandwidth() / 2)
    .attr('dy', '0.35em').attr('opacity', 0)
    .merge(labels)
    .transition().duration(TRANS)
    .attr('x', d => TC.x(d[valKey]) + 5)
    .attr('y', d => (TC.y(d.name) ?? 0) + TC.y.bandwidth() / 2)
    .attr('opacity', 1)
    .text(valFmt);

  labels.exit().transition().duration(TRANS).attr('opacity', 0).remove();
}

// ════════════════════════════════════════════════════════════════
//  LINKED INTERACTION
// ════════════════════════════════════════════════════════════════

function selectColor(color) {
  if (state.compareMode) {
    // In compare mode, toggle in compareColors set (max 2)
    if (state.compareColors.has(color)) {
      state.compareColors.delete(color);
    } else {
      if (state.compareColors.size >= 2) {
        const first = state.compareColors.values().next().value;
        state.compareColors.delete(first);
      }
      state.compareColors.add(color);
    }
  } else {
    // Normal mode: single selection toggle
    state.selectedColor = state.selectedColor === color ? null : color;
  }
  syncChipStates();
  updateAll();
}

function syncChipStates() {
  document.querySelectorAll('#color-filters .color-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.color === state.selectedColor);
  });
  document.querySelectorAll('#compare-filters .color-chip').forEach(el => {
    el.classList.toggle('compare-active', state.compareColors.has(el.dataset.color));
  });
  // sync vertical legend
  const anySelected = state.selectedColor || state.compareColors.size > 0;
  document.querySelectorAll('#color-legend .legend-chip').forEach(el => {
    el.classList.toggle('active',          el.dataset.color === state.selectedColor);
    el.classList.toggle('compare-active',  state.compareColors.has(el.dataset.color));
  });
  const legendClear = document.getElementById('legend-clear');
  if (legendClear) legendClear.style.display = anySelected ? 'flex' : 'none';
  const clearBtn = document.getElementById('clear-compare-btn');
  if (clearBtn) clearBtn.style.display = state.compareColors.size > 0 ? '' : 'none';
}

function updateAll() {
  updateTimeline();
  updateChord();
  updateScatter();
  updateTopCards();
}

// ════════════════════════════════════════════════════════════════
//  ANIMATION
// ════════════════════════════════════════════════════════════════

function startAnimation() {
  if (state.playing) return;
  state.playing = true;
  const btn = document.getElementById('play-btn');
  btn.textContent = '⏸ Pause';
  btn.classList.add('playing');
  state.playTimer = setInterval(() => {
    state.metaIndex = (state.metaIndex + 1) % DATA.metaEvolution.length;
    updateTimeline();
  }, 1800);
}

function stopAnimation() {
  if (!state.playing) return;
  state.playing = false;
  clearInterval(state.playTimer);
  const btn = document.getElementById('play-btn');
  btn.textContent = '▶ Play';
  btn.classList.remove('playing');
}

// ════════════════════════════════════════════════════════════════
//  CONTROLS
// ════════════════════════════════════════════════════════════════

function initControls() {
  // Primary color filter chips
  const filterContainer  = d3.select('#color-filters');
  const compareContainer = d3.select('#compare-filters');

  COLORS.forEach(c => {
    filterContainer.append('button')
      .attr('class', `color-chip chip-${c}`)
      .attr('data-color', c)
      .attr('title', COLOR_NAMES[c])
      .text(LAND_ABBR[c])
      .on('click', () => { if (!state.compareMode) selectColor(c); });

    compareContainer.append('button')
      .attr('class', `color-chip chip-${c}`)
      .attr('data-color', c)
      .attr('title', COLOR_NAMES[c])
      .text(LAND_ABBR[c])
      .on('click', () => { if (state.compareMode) selectColor(c); });
  });

  // Toggle compare mode
  // Primary chips work in normal mode, compare chips work in compare mode
  // Let's simplify: the compare chips are always for compare mode
  // Re-wire: primary filter uses selectedColor, compare filter uses compareColors
  d3.select('#color-filters').selectAll('.color-chip')
    .on('click', function() {
      const c = this.dataset.color;
      state.selectedColor = state.selectedColor === c ? null : c;
      syncChipStates();
      updateAll();
    });

  d3.select('#compare-filters').selectAll('.color-chip')
    .on('click', function() {
      const c = this.dataset.color;
      if (state.compareColors.has(c)) {
        state.compareColors.delete(c);
      } else {
        if (state.compareColors.size >= 2) {
          state.compareColors.delete(state.compareColors.values().next().value);
        }
        state.compareColors.add(c);
      }
      syncChipStates();
      updateAll();
    });

  document.getElementById('clear-compare-btn').addEventListener('click', () => {
    state.compareColors.clear();
    syncChipStates();
    updateAll();
  });

  // Sort select
  document.getElementById('sort-select').addEventListener('change', function() {
    state.sortBy = this.value;
    updateTimeline();
  });

  // Play/Pause button
  document.getElementById('play-btn').addEventListener('click', () => {
    state.playing ? stopAnimation() : startAnimation();
  });

  // Scatter axis selects
  document.getElementById('scatter-x').addEventListener('change', function() {
    state.scatterX = this.value;
    updateScatter();
  });
  document.getElementById('scatter-y').addEventListener('change', function() {
    state.scatterY = this.value;
    updateScatter();
  });

  // Top Cards toggle
  document.querySelectorAll('#topcards-toggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      state.topView = this.dataset.view;
      document.querySelectorAll('#topcards-toggle .toggle-btn')
        .forEach(b => b.classList.toggle('active', b === this));
      updateTopCards();
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ════════════════════════════════════════════════════════════════

async function init() {
  try {
    [
      DATA.metaEvolution,
      DATA.colorMatrix,
      DATA.timeline,
      DATA.otjRatings,
      DATA.topCompetitive,
    ] = await Promise.all([
      d3.json('data/meta_evolution.json'),
      d3.json('data/color_matrix.json'),
      d3.json('data/timeline.json'),
      d3.json('data/otj_ratings.json'),
      d3.json('data/top_competitive.json'),
    ]);

    initControls();
    initTimeline();
    initChord();
    initScatter();
    initTopCards();

    // Start on the most populated Standard meta
    const stdIdx = DATA.metaEvolution.findIndex(m =>
      m.meta_name.includes('Standard') && m.total > 500);
    state.metaIndex = stdIdx >= 0 ? stdIdx : 0;

    updateAll();

    // ── Scroll-reveal panels ─────────────────────────────────────
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          // re-trigger D3 update when each panel first enters view
          // so bars/dots animate in on scroll (not just on load)
          const id = e.target.id;
          if (id === 'panel-timeline')  updateTimeline();
          if (id === 'panel-chord')     updateChord();
          if (id === 'panel-scatter')   updateScatter();
          if (id === 'panel-topcards')  updateTopCards();
          revealObs.unobserve(e.target); // only animate in once
        }
      });
    }, { threshold: 0.12 });

    document.querySelectorAll('.panel, .hero-section').forEach(p => revealObs.observe(p));

    // ── Show legend only after hero scrolls out of view ──────────
    const colorLegend = document.getElementById('color-legend');
    const heroSection  = document.getElementById('hero-section');
    if (colorLegend && heroSection) {
      new IntersectionObserver((entries) => {
        colorLegend.classList.toggle('visible', !entries[0].isIntersecting);
      }, { threshold: 0.1 }).observe(heroSection);
    }

    // ── Wire vertical legend: 1 click = filter, 2 = compare ─────
    if (colorLegend) {
      colorLegend.querySelectorAll('.legend-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const c = btn.dataset.color;

          if (state.selectedColor === c) {
            // deselect single
            state.selectedColor = null;
          } else if (state.compareColors.has(c)) {
            // remove from compare; if 1 left, move back to selectedColor
            state.compareColors.delete(c);
            if (state.compareColors.size === 1) {
              state.selectedColor = [...state.compareColors][0];
              state.compareColors.clear();
            }
          } else if (state.selectedColor) {
            // second pick → enter compare mode
            state.compareColors.add(state.selectedColor);
            state.compareColors.add(c);
            state.selectedColor = null;
          } else if (state.compareColors.size < 2) {
            state.compareColors.add(c);
          } else {
            // already 2 in compare → swap oldest
            state.compareColors.delete([...state.compareColors][0]);
            state.compareColors.add(c);
          }

          syncChipStates();
          updateAll();
        });
      });

      // X button — clear everything
      const legendClear = document.getElementById('legend-clear');
      if (legendClear) {
        legendClear.addEventListener('click', () => {
          state.selectedColor = null;
          state.compareColors.clear();
          syncChipStates();
          updateAll();
        });
      }
    }

  } catch (err) {
    document.body.innerHTML =
      `<div class="error">Failed to load data: ${err.message}<br><br>` +
      `Run <code>preprocess.py</code> first, then serve with a local HTTP server ` +
      `(e.g. <code>python -m http.server 8080</code>)</div>`;
    console.error(err);
  }
}

init();
