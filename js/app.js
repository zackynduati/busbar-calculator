/* Busbar Sizing Calculator – UI layer. Depends on js/busbar-engine.js (window.BusbarCalc). */
(function () {
  'use strict';
  var BC = window.BusbarCalc;
  var D = BC.DEFAULT_INPUTS;

  // ------------------------------------------------------------ helpers
  function opt2(obj) { return Object.keys(obj).map(function (k) { return [k, obj[k]]; }); }
  function opt(obj) { return Object.keys(obj).map(function (k) { return [k, obj[k].label]; }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function fmt(v, d) {
    if (v === null || v === undefined || Number.isNaN(v)) return '–';
    if (!isFinite(v)) return v > 0 ? '∞' : '−∞';
    d = d === undefined ? 0 : d;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function badge(ok, okText, badText) {
    return ok ? '<span class="badge ok">' + (okText || 'PASS') + '</span>' : '<span class="badge bad">' + (badText || 'FAIL') + '</span>';
  }
  function meter(frac) {
    var cls = frac > 1 ? 'bad' : frac > 0.9 ? 'warn' : '';
    var w = Math.max(0, Math.min(1, isFinite(frac) ? frac : 1)) * 100;
    return '<div class="meter ' + cls + '"><span style="width:' + w.toFixed(1) + '%"></span></div>';
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  var PHASE = ['L1', 'L2', 'L3'];

  // ------------------------------------------------------------ form schema
  var SECTIONS = [
    { id: 'system', title: 'System & fault level', open: true, fields: [
      { id: 'In', label: 'Rated current Iₙ', unit: 'A', type: 'number', min: 1, step: 10 },
      { id: 'freq', label: 'Frequency', type: 'select', options: [['50', '50 Hz'], ['60', '60 Hz']] },
      { id: 'Icw', label: 'Short-time withstand Icw', unit: 'kA', type: 'number', min: 1, step: 1 },
      { id: 'tk', label: 'Icw duration', unit: 's', type: 'number', min: 0.05, step: 0.1, hint: '1 s typical; 3 s if specified' },
      { id: 'peakMode', label: 'Peak factor n', type: 'select', options: [['auto', 'Auto (IEC 61439-1 Tab. 7)'], ['manual', 'Manual']] },
      { id: 'peakFactor', label: 'n = ip / Icw', type: 'number', min: 1.4, max: 2.83, step: 0.05, show: function (s) { return s.peakMode === 'manual'; } },
      { id: 'Uimp', label: 'Rated impulse voltage', type: 'select', options: [['4', '4 kV'], ['6', '6 kV'], ['8', '8 kV'], ['12', '12 kV']] }
    ] },
    { id: 'conductor', title: 'Conductor', open: true, fields: [
      { id: 'material', label: 'Material', type: 'select', options: [['Cu', 'Copper'], ['Al', 'Aluminium']] },
      { id: 'temper', label: 'Grade / temper', type: 'select', options: function (s) { return BC.MATERIALS[s.material].tempers.map(function (t) { return [t.id, t.label]; }); } },
      { id: 'rp', label: '0.2 % proof stress Rp0.2', unit: 'MPa', type: 'number', min: 10, step: 5 },
      { id: 'iacs', label: 'Conductivity', unit: '%IACS', type: 'number', min: 30, max: 102, step: 1 },
      { id: 'width', label: 'Bar width (wide face)', unit: 'mm', type: 'number', min: 10, step: 5, list: 'dl-widths' },
      { id: 'thick', label: 'Bar thickness', unit: 'mm', type: 'number', min: 2, step: 1, list: 'dl-thicks' },
      { id: 'nBars', label: 'Bars per phase', type: 'select', options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] },
      { id: 'gap', label: 'Gap between bars', unit: 'mm', type: 'number', min: 2, step: 1, hint: '≥ bar thickness', show: function (s) { return +s.nBars > 1; } },
      { id: 'finish', label: 'Surface finish', type: 'select', full: true, options: opt(BC.FINISHES).map(function (o) { var e = BC.FINISHES[o[0]].eps; return [o[0], o[1] + (e ? ' (ε ' + e.toFixed(2) + ')' : '')]; }) },
      { id: 'eps', label: 'Emissivity ε', type: 'number', min: 0.02, max: 1, step: 0.05, show: function (s) { return s.finish === 'custom'; } }
    ] },
    { id: 'layout', title: 'Arrangement', open: true, fields: [
      { id: 'mounting', label: 'Mounting', type: 'select', full: true, options: [['edgewise', 'Horizontal run – bars on edge (wide face vertical)'], ['flat', 'Horizontal run – bars flat (wide face horizontal)'], ['vertical', 'Vertical run (riser / dropper)']] },
      { id: 'runLength', label: 'Vertical run height', unit: 'mm', type: 'number', min: 100, step: 50, show: function (s) { return s.mounting === 'vertical'; } },
      { id: 'arrangement', label: 'Phase arrangement', type: 'select', full: true, options: [['face', 'Side by side – wide faces facing each other'], ['edge', 'In one plane – edges facing each other']] },
      { id: 'phaseSpacing', label: 'Phase centre spacing a', unit: 'mm', type: 'number', min: 10, step: 5 }
    ] },
    { id: 'enclosure', title: 'Enclosure & environment', open: true, fields: [
      { id: 'Troom', label: 'Room ambient (24 h mean)', unit: '°C', type: 'number', step: 1 },
      { id: 'altitude', label: 'Site altitude', unit: 'm', type: 'number', min: 0, max: 5000, step: 100, hint: 'Thinner air cools less' },
      { id: 'ip', label: 'IP rating', type: 'select', options: BC.IP_CLASSES.map(function (c) { return [c, c]; }) },
      { id: 'form', label: 'Form of separation', type: 'select', options: BC.FORMS.map(function (f) { return [f, 'Form ' + f]; }) },
      { id: 'location', label: 'Busbar position in board', type: 'select', options: [['top', 'Top (main busbar)'], ['middle', 'Middle'], ['bottom', 'Bottom']] },
      { id: 'internalMode', label: 'Internal air temperature', type: 'select', options: [['estimate', 'Estimate from IP & form'], ['specify', 'Specify / measured']] },
      { id: 'Tinternal', label: 'Internal air temp. at busbars', unit: '°C', type: 'number', step: 1, show: function (s) { return s.internalMode === 'specify'; } },
      { id: 'Tmax', label: 'Max. busbar temperature', unit: '°C', type: 'number', step: 1, hint: '35 °C + 65 K = 100 °C (105 °C plated joints)' },
      { id: 'derate', label: 'Additional derating factor', type: 'number', min: 0.3, max: 1.2, step: 0.01, hint: 'Harmonics, unbalance, margin' }
    ] },
    { id: 'insul', title: 'Insulation coordination', open: true, fields: [
      { id: 'Ui', label: 'Rated insulation voltage Uᵢ', type: 'select', options: [['250', '250 V'], ['400', '400 V'], ['500', '500 V'], ['630', '630 V'], ['690', '690 V (630 V row)'], ['800', '800 V'], ['1000', '1000 V'], ['1250', '1250 V']] },
      { id: 'pollution', label: 'Pollution degree', type: 'select', options: [['1', '1'], ['2', '2'], ['3', '3 (industrial)']] },
      { id: 'matGroup', label: 'Insulating material group', type: 'select', full: true, options: [['I', 'I (CTI ≥ 600)'], ['II', 'II (400 ≤ CTI < 600)'], ['IIIa', 'IIIa (175 ≤ CTI < 400)'], ['IIIb', 'IIIb (100 ≤ CTI < 175)']] },
      { id: 'clrEncl', label: 'Live part to enclosure / earthed part', unit: 'mm', type: 'number', min: 1, step: 5, hint: 'Shortest air gap, bars at rest' },
      { id: 'creepPP', label: 'Creepage across supports, phase–phase', unit: 'mm', type: 'number', min: 1, step: 5, show: function (s) { return s.creepSource !== 'ribs'; } },
      { id: 'creepPE', label: 'Creepage, phase–earth', unit: 'mm', type: 'number', min: 1, step: 5 },
      { id: 'creepReq', label: 'Required creepage override', unit: 'mm', type: 'number', min: 0, step: 0.5, hint: '0 = use IEC 61439-1 Table 2. Ribs ≥ 2 mm high allow 0.8 × Table 2, never below the clearance' }
    ] },
    { id: 'mech', title: 'Short-circuit mechanics', open: false, fields: [
      { id: 'support', label: 'Support arrangement', type: 'select', full: true, options: opt(BC.SUPPORTS) },
      { id: 'span', label: 'Support span l', unit: 'mm', type: 'number', min: 50, step: 25 },
      { id: 'spacer', label: 'Spacer interval lₛ', unit: 'mm', type: 'number', min: 25, step: 25, hint: '= span if no spacers', show: function (s) { return +s.nBars > 1; } },
      { id: 'thetaSC', label: 'Max. temp. during fault', unit: '°C', type: 'number', min: 100, max: 300, step: 5 },
      { id: 'q', label: 'Plasticity factor q', type: 'number', min: 1, max: 1.83, step: 0.01, hint: '1.5 for rectangular bars' },
      { id: 'vsvr', label: 'Vσ·Vr (stress)', type: 'number', min: 0.5, max: 2, step: 0.1, hint: '1.0 without auto-reclosure' },
      { id: 'vfvr', label: 'V_F·Vr (support force)', type: 'number', min: 0.5, max: 2.7, step: 0.1, hint: '2.7 = 3-phase upper bound' }
    ] },
    { id: 'supports', title: 'Busbar support system', open: true, fields: [
      { id: 'runLen', label: 'Busbar run length', unit: 'mm', type: 'number', min: 100, step: 50, hint: 'Length carried by the supports' },
      { id: 'neutralBars', label: 'Neutral bars on the supports', type: 'select', options: [['0', 'none'], ['1', '1 bar'], ['2', '2 bars'], ['3', '3 bars'], ['4', '4 bars']] },
      { id: 'supType', label: 'Support type', type: 'select', full: true, options: [['comb', 'Slotted comb, two-piece (bars held in slots)'], ['flat', 'Flat clamp blocks (held by friction only)']] },
      { id: 'supWidth', label: 'Support width along the bar', unit: 'mm', type: 'number', min: 5, step: 5 },
      { id: 'blkT', label: 'Support block thickness', unit: 'mm', type: 'number', min: 5, step: 1, show: function (s) { return s.supType === 'comb'; } },
      { id: 'slotDepth', label: 'Slot depth', unit: 'mm', type: 'number', min: 1, step: 1, show: function (s) { return s.supType === 'comb'; } },
      { id: 'wallT', label: 'Slot wall thickness', unit: 'mm', type: 'number', min: 2, step: 1, hint: 'Rib between the bars of a phase', show: function (s) { return s.supType === 'comb'; } },
      { id: 'mu', label: 'Friction coefficient bar / block', type: 'number', min: 0.05, max: 0.6, step: 0.05, show: function (s) { return s.supType === 'flat'; } },
      { id: 'shareFactor', label: 'Uneven bar load factor', type: 'number', min: 1, max: 2, step: 0.05, hint: 'Outer bars carry more current', show: function (s) { return +s.nBars > 1; } },
      { id: 'ribN', label: 'Ribs between phases', type: 'select', options: [['0', 'none'], ['1', '1'], ['2', '2'], ['3', '3']] },
      { id: 'ribH', label: 'Rib height', unit: 'mm', type: 'number', min: 1, step: 1, show: function (s) { return +s.ribN > 0; } },
      { id: 'ribT', label: 'Rib thickness', unit: 'mm', type: 'number', min: 1, step: 1, show: function (s) { return +s.ribN > 0; } },
      { id: 'creepSource', label: 'Phase-to-phase creepage', type: 'select', full: true, options: [['manual', 'Use the value I entered above'], ['ribs', 'Calculate from the rib geometry']] },
      { id: 'matFlex', label: 'Support material: bending strength', unit: 'MPa', type: 'number', min: 10, step: 5, hint: 'Typical glass-polyester; use the datasheet' },
      { id: 'matShear', label: 'Support material: shear strength', unit: 'MPa', type: 'number', min: 5, step: 5 },
      { id: 'matTens', label: 'Support material: tensile strength', unit: 'MPa', type: 'number', min: 5, step: 5 },
      { id: 'supSF', label: 'Safety factor on the support material', type: 'number', min: 1, max: 4, step: 0.1 },
      { id: 'spanMargin', label: 'Margin on the permissible span', type: 'number', min: 0.3, max: 1, step: 0.05, hint: '0.85 = use 85 % of the maximum span' },
      { id: 'supRating', label: 'Support rating from manufacturer', unit: 'kN', type: 'number', min: 0, step: 1, hint: '0 = not entered; the calculator shows the rating you need' },
      { id: 'fixN', label: 'Fixing bolts per support', type: 'number', min: 1, step: 1 },
      { id: 'fixSize', label: 'Fixing bolt size', type: 'select', options: Object.keys(BC.BOLTS).map(function (k) { return [k, k]; }) },
      { id: 'fixGrade', label: 'Fixing bolt grade', type: 'select', options: opt(BC.GRADES) },
      { id: 'fixFactor', label: 'Short-circuit load on fixings', type: 'number', min: 0.1, max: 1, step: 0.05, hint: '1.0 = full F_d (conservative)' },
      { id: 'Tinstall', label: 'Installation temperature', unit: '°C', type: 'number', step: 1 },
      { id: 'fixedPoint', label: 'Fixed point of the run', type: 'select', options: [['centre', 'Centre support'], ['end', 'One end']] }
    ] },
    { id: 'joint', title: 'Bolted joints', open: false, fields: [
      { id: 'boltSize', label: 'Bolt size', type: 'select', options: [['auto', 'Auto (by bar width)']].concat(Object.keys(BC.BOLTS).map(function (k) { return [k, k]; })) },
      { id: 'boltCount', label: 'Bolts per joint', type: 'select', options: [['auto', 'Auto']].concat([1, 2, 3, 4, 6, 8].map(function (n) { return [String(n), String(n)]; })) },
      { id: 'grade', label: 'Bolt grade', type: 'select', options: opt(BC.GRADES) },
      { id: 'preloadPct', label: 'Preload', unit: '% proof', type: 'number', min: 30, max: 90, step: 5 },
      { id: 'lube', label: 'Thread condition (nut factor K)', type: 'select', full: true, options: Object.keys(BC.LUBRICATION).map(function (k) { return [k, BC.LUBRICATION[k].label + ' — K ' + BC.LUBRICATION[k].K.toFixed(2)]; }) },
      { id: 'washer', label: 'Washers', type: 'select', full: true, options: opt(BC.WASHERS) },
      { id: 'overlap', label: 'Lap overlap length', unit: 'mm', type: 'number', min: 0, step: 5, hint: '0 = equal to bar width' }
    ] },
    { id: 'arc', title: 'Arc flash (IEEE 1584-2018)', open: false, fields: [
      { id: 'arcVoc', label: 'System voltage (line to line)', unit: 'V', type: 'number', min: 208, max: 15000, step: 5, hint: '208 V – 15 kV' },
      { id: 'arcIbf', label: 'Bolted fault current at the busbars Ibf', unit: 'kA', type: 'number', min: 0.2, step: 1, hint: 'Prospective short-circuit current at the point of the fault' },
      { id: 'arcEC', label: 'Electrode configuration', type: 'select', full: true, options: opt2(BC.ARC_EC) },
      { id: 'arcClass', label: 'Typical equipment (fills gap, distance and box size)', type: 'select', full: true, options: Object.keys(BC.ARC_CLASSES).map(function (k) { return [k, BC.ARC_CLASSES[k].label]; }) },
      { id: 'arcGap', label: 'Gap between conductors G', unit: 'mm', type: 'number', min: 6, step: 1, hint: 'Bar to bar, 6.35 – 76.2 mm at 600 V and below' },
      { id: 'arcDist', label: 'Working distance D', unit: 'mm', type: 'number', min: 305, step: 10, hint: 'Face to the arc, at least 305 mm' },
      { id: 'arcH', label: 'Enclosure height', unit: 'mm', type: 'number', min: 100, step: 10, show: function (s) { return s.arcEC !== 'VOA' && s.arcEC !== 'HOA'; } },
      { id: 'arcW', label: 'Enclosure width', unit: 'mm', type: 'number', min: 100, step: 10, show: function (s) { return s.arcEC !== 'VOA' && s.arcEC !== 'HOA'; } },
      { id: 'arcDepth', label: 'Enclosure depth', unit: 'mm', type: 'number', min: 50, step: 10, show: function (s) { return s.arcEC !== 'VOA' && s.arcEC !== 'HOA'; } },
      { id: 'arcTmax', label: 'Arcing time at maximum current', unit: 'ms', type: 'number', min: 1, step: 5, hint: 'Clearing time of the protection upstream of the fault' },
      { id: 'arcTmin', label: 'Arcing time at minimum current', unit: 'ms', type: 'number', min: 1, step: 5, hint: 'The arc current is lower, so the protection may be slower' }
    ] },
    { id: 'assume', title: 'Enclosure assumptions', open: false, custom: true }
  ];

  var FIELD_INDEX = {};
  SECTIONS.forEach(function (sec) { (sec.fields || []).forEach(function (f) { FIELD_INDEX[f.id] = f; }); });

  // ------------------------------------------------------------ state
  function defaultState() {
    var s = {};
    Object.keys(FIELD_INDEX).forEach(function (k) { s[k] = String(D[k]); });
    BC.IP_CLASSES.forEach(function (c) { s['ipRise.' + c] = String(D.ipRise[c]); });
    BC.FORMS.forEach(function (f) { s['formRise.' + f] = String(D.formRise[f]); s['formConv.' + f] = String(D.formConv[f]); });
    return s;
  }
  var DEFAULTS = defaultState();
  var state = defaultState();

  function toInputs(s) {
    var o = {};
    Object.keys(FIELD_INDEX).forEach(function (k) { o[k] = s[k]; });
    o.ipRise = {}; o.formRise = {}; o.formConv = {};
    BC.IP_CLASSES.forEach(function (c) { o.ipRise[c] = Number(s['ipRise.' + c]); });
    BC.FORMS.forEach(function (f) { o.formRise[f] = Number(s['formRise.' + f]); o.formConv[f] = Number(s['formConv.' + f]); });
    return o;
  }

  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var params = new URLSearchParams(h);
    params.forEach(function (v, k) { if (k in state) state[k] = v; });
    // keep temper / material-dependent values consistent if the link only names the material
    var mat = BC.MATERIALS[state.material] || BC.MATERIALS.Cu;
    if (!BC.MATERIALS[state.material]) state.material = 'Cu';
    if (!mat.tempers.some(function (t) { return t.id === state.temper; })) {
      var t = mat.tempers.filter(function (x) { return x.id === 'R240' || x.id === '6101T6'; })[0] || mat.tempers[0];
      state.temper = t.id;
      if (!params.has('rp')) state.rp = String(t.rp);
      if (!params.has('iacs')) state.iacs = String(t.iacs);
      if (!params.has('thetaSC')) state.thetaSC = String(mat.thetaSC);
    }
  }
  function writeHash() {
    var params = new URLSearchParams();
    Object.keys(state).forEach(function (k) { if (state[k] !== DEFAULTS[k]) params.set(k, state[k]); });
    var str = params.toString();
    history.replaceState(null, '', str ? '#' + str : location.pathname + location.search);
  }

  // ------------------------------------------------------------ form render
  function optionsFor(f) { return typeof f.options === 'function' ? f.options(state) : f.options; }

  function fieldHTML(f) {
    var id = 'f-' + f.id, ctl;
    if (f.type === 'select') {
      ctl = '<select id="' + id + '" data-key="' + f.id + '">' + optionsFor(f).map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(state[f.id]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    } else {
      ctl = '<input id="' + id + '" data-key="' + f.id + '" type="number" inputmode="decimal" value="' + esc(state[f.id]) + '"' +
        (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') +
        (f.step !== undefined ? ' step="' + f.step + '"' : '') + (f.list ? ' list="' + f.list + '"' : '') + '>';
    }
    return '<div class="field' + (f.full ? ' full' : '') + '" data-field="' + f.id + '">' +
      '<label for="' + id + '">' + esc(f.label) + '</label>' +
      '<div class="control' + (f.unit ? ' has-unit' : '') + '">' + ctl + (f.unit ? '<span class="unit">' + esc(f.unit) + '</span>' : '') + '</div>' +
      (f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '') + '</div>';
  }

  function assumptionsHTML() {
    var ip = '<table class="assume-table"><thead><tr><th>IP rating</th><th>Air rise at top of board [K]</th></tr></thead><tbody>' +
      BC.IP_CLASSES.map(function (c) { return '<tr><td>' + c + '</td><td><input type="number" step="1" data-key="ipRise.' + c + '" value="' + esc(state['ipRise.' + c]) + '"></td></tr>'; }).join('') + '</tbody></table>';
    var fm = '<table class="assume-table"><thead><tr><th>Form</th><th>Extra rise [K]</th><th>Convection factor</th></tr></thead><tbody>' +
      BC.FORMS.map(function (f) {
        return '<tr><td>Form ' + f + '</td><td><input type="number" step="1" data-key="formRise.' + f + '" value="' + esc(state['formRise.' + f]) + '"></td>' +
          '<td><input type="number" step="0.01" min="0.3" max="1" data-key="formConv.' + f + '" value="' + esc(state['formConv.' + f]) + '"></td></tr>';
      }).join('') + '</tbody></table>';
    return '<div class="fields"><div class="assume-wrap">' +
      '<p class="hint muted" style="margin:0">Engineering defaults used when the internal air temperature is <em>estimated</em>. Replace them with an IEC TR 60890 calculation, the enclosure maker\'s data or measured values.</p>' +
      '<h4>Internal air-temperature rise by IP rating</h4>' + ip +
      '<h4>Busbar compartment by form of separation</h4>' + fm +
      '<p class="hint muted" style="margin:0">Position factor applied to the IP rise: top 1.0 · middle 0.75 · bottom 0.5.</p>' +
      '</div></div>';
  }

  function renderForm() {
    var host = $('#inputs');
    var openState = {};
    host.querySelectorAll('details[data-sec]').forEach(function (d) { openState[d.dataset.sec] = d.open; });
    host.innerHTML = SECTIONS.map(function (sec, i) {
      var open = sec.id in openState ? openState[sec.id] : sec.open;
      return '<details class="card" data-sec="' + sec.id + '"' + (open ? ' open' : '') + '><summary><span><span class="step">' + (i + 1) + '</span>' + esc(sec.title) + '</span></summary>' +
        (sec.custom ? assumptionsHTML() : '<div class="fields">' + sec.fields.map(fieldHTML).join('') + '</div>') + '</details>';
    }).join('') +
      '<datalist id="dl-widths">' + [20, 25, 30, 40, 50, 60, 80, 100, 120, 160, 200].map(function (w) { return '<option value="' + w + '">'; }).join('') + '</datalist>' +
      '<datalist id="dl-thicks">' + [3, 5, 6, 8, 10, 12, 15, 20].map(function (w) { return '<option value="' + w + '">'; }).join('') + '</datalist>';
    refreshVisibility();
  }

  function refreshVisibility() {
    Object.keys(FIELD_INDEX).forEach(function (k) {
      var f = FIELD_INDEX[k], el = document.querySelector('[data-field="' + k + '"]');
      if (el) el.hidden = f.show ? !f.show(state) : false;
    });
  }

  function setField(key, value) {
    state[key] = String(value);
    var el = document.querySelector('[data-key="' + key + '"]');
    if (el) el.value = String(value);
  }

  function onMaterialChange() {
    var mat = BC.MATERIALS[state.material];
    var temper = mat.tempers.filter(function (t) { return t.id === 'R240' || t.id === '6101T6'; })[0] || mat.tempers[0];
    state.temper = temper.id;
    var sel = document.querySelector('[data-key="temper"]');
    sel.innerHTML = mat.tempers.map(function (t) { return '<option value="' + t.id + '"' + (t.id === temper.id ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('');
    setField('rp', temper.rp); setField('iacs', temper.iacs); setField('thetaSC', mat.thetaSC);
  }
  function onTemperChange() {
    var t = BC.MATERIALS[state.material].tempers.filter(function (x) { return x.id === state.temper; })[0];
    if (t) { setField('rp', t.rp); setField('iacs', t.iacs); }
  }

  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(run, 180); }

  function bindForm() {
    var host = $('#inputs');
    function handler(e) {
      var key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      state[key] = e.target.value;
      if (key === 'material' && e.type === 'change') onMaterialChange();
      if (key === 'temper' && e.type === 'change') onTemperChange();
      if (key === 'arcClass' && e.type === 'change' && BC.ARC_CLASSES[state.arcClass] && state.arcClass !== 'custom') {
        var cl = BC.ARC_CLASSES[state.arcClass];
        setField('arcGap', cl.G); setField('arcDist', cl.D); setField('arcH', cl.H); setField('arcW', cl.W); setField('arcDepth', cl.Dp);
      }
      if (['arcGap', 'arcDist', 'arcH', 'arcW', 'arcDepth'].indexOf(key) >= 0 && state.arcClass !== 'custom') {
        var c0 = BC.ARC_CLASSES[state.arcClass];
        if (c0 && Number(state[key]) !== c0[{ arcGap: 'G', arcDist: 'D', arcH: 'H', arcW: 'W', arcDepth: 'Dp' }[key]]) setField('arcClass', 'custom');
      }
      if (key === 'width' || key === 'thick') autosizeStale = true;
      refreshVisibility();
      writeHash();
      schedule();
    }
    host.addEventListener('input', handler);
    host.addEventListener('change', handler);
  }

  // ------------------------------------------------------------ calculation
  var last = null, autosizeStale = true, autosizeHTML = '';

  function invalidFields() {
    var bad = [];
    Object.keys(state).forEach(function (k) {
      var f = FIELD_INDEX[k];
      var isNum = (f && f.type === 'number') || k.indexOf('.') > 0;
      if (!isNum) return;
      if (f && f.show && !f.show(state)) return;
      if (state[k] === '' || !isFinite(Number(state[k]))) bad.push(f ? f.label : k);
    });
    return bad;
  }

  function run() {
    var bad = invalidFields();
    var host = $('#results');
    if (bad.length) {
      host.innerHTML = '<div class="banner warn"><span class="icon">✎</span><div><h2>Check the inputs</h2><p>Enter a number for: ' + bad.map(esc).join(', ') + '.</p></div></div>';
      return;
    }
    var r;
    try { r = BC.calculate(toInputs(state)); }
    catch (e) {
      host.innerHTML = '<div class="banner bad"><span class="icon">⚠</span><div><h2>Calculation error</h2><p>' + esc(e.message) + '</p></div></div>';
      return;
    }
    last = r;
    host.innerHTML = renderResults(r);
    bindResults();
  }

  // ------------------------------------------------------------ results render
  function renderResults(r) {
    var inp = r.inputs, html = '';
    if (r.errors.length) {
      return '<div class="banner bad"><span class="icon">⚠</span><div><h2>Cannot calculate</h2><ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div></div>';
    }
    var th = r.thermal, sc = r.sc, me = r.mech, jt = r.joint;
    var fails = [];
    if (!th.ok) fails.push('Continuous rating: Iₙ = ' + fmt(inp.In) + ' A exceeds the permissible ' + fmt(th.Iperm) + ' A.');
    if (!sc.ok) fails.push('Short-circuit thermal: cross-section ' + fmt(sc.S) + ' mm² is below the required ' + fmt(sc.Smin) + ' mm².');
    if (!me.ok) fails.push('Short-circuit mechanical: conductor stress exceeds the permissible value – reduce the support span or spacer interval, or increase the bar section / phase spacing.');
    if (!r.insul.ok) fails.push('Clearance / creepage: ' + insulFails(r.insul) + '.');
    if (!r.sup.ok) fails.push('Support system: ' + supFails(r.sup) + '.');

    html += '<div class="print-only"><h2 style="font-size:16px;margin-bottom:6px">Calculation report — ' + esc(describeSection(inp)) + '</h2><p class="muted">' + new Date().toLocaleString() + ' · ' + esc(location.href) + '</p></div>';

    html += r.ok
      ? '<div class="banner ok"><span class="icon">✓</span><div><h2>' + esc(describeSection(inp)) + ' meets all checks</h2><p>' + fmt(inp.In) + ' A continuous, ' + fmt(inp.Icw) + ' kA / ' + fmt(inp.tk, 1) + ' s short-time withstand (' + fmt(me.ip / 1000, 1) + ' kA peak).</p></div></div>'
      : '<div class="banner bad"><span class="icon">✕</span><div><h2>' + esc(describeSection(inp)) + ' does not meet all checks</h2><ul>' + fails.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul><p><button type="button" class="btn btn-primary no-print" data-action="autosize-jump">Find a section that works</button></p></div></div>';
    if (r.warnings.length) {
      html += '<div class="banner warn"><span class="icon">!</span><div><h2>Warnings</h2><ul>' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div></div>';
    }

    // KPIs
    var tempFrac = (th.Top - r.Tint) / (inp.Tmax - r.Tint);
    html += '<div class="kpis">' +
      kpi('Permissible current', th.ok, fmt(th.Iperm) + ' <small>A</small>', 'Iₙ ' + fmt(inp.In) + ' A · utilisation ' + fmt(th.utilisation * 100) + ' %', th.utilisation) +
      kpi('Hottest bar at Iₙ (' + PHASE[th.hottest.idx] + ')', isFinite(th.Top) && th.Top <= inp.Tmax, (isFinite(th.Top) ? fmt(th.Top, 1) : '>' + fmt(r.Tint + 400)) + ' <small>°C</small>', 'Air ' + fmt(r.Tint, 1) + ' °C · limit ' + fmt(inp.Tmax) + ' °C · rise over room ' + fmt(th.riseAboveRoom, 1) + ' K', tempFrac) +
      kpi('Short-circuit thermal', sc.ok, fmt(sc.S) + ' <small>mm²</small>', 'Needs ≥ ' + fmt(sc.Smin) + ' mm² · end temp. ' + fmt(sc.thetaEnd) + ' °C', sc.Smin / sc.S) +
      kpi('Short-circuit stress', me.ok, fmt(me.sigTot) + ' <small>MPa</small>', 'Limit ' + fmt(me.limTot) + ' MPa · max span ' + fmt(me.lmax, 0) + ' mm', me.sigTot / me.limTot) +
      kpi('Clearance during a fault', r.insul.ok, fmt(Math.min(r.insul.clearPPfault, r.insul.clearEnclFault), 1) + ' <small>mm</small>', 'Minimum ' + fmt(r.insul.clearMin, 1) + ' mm · bars deflect ' + fmt(r.insul.deflection, 1) + ' mm' + (r.insul.elastic ? ' (elastic)' : ' (yielding)'), r.insul.clearMin / Math.max(Math.min(r.insul.clearPPfault, r.insul.clearEnclFault), 0.001)) +
      kpi('Support load per phase', r.sup.ok, fmt(r.sup.Fd / 1000, 1) + ' <small>kN</small>', r.sup.nSel + ' supports at ' + fmt(inp.span) + ' mm · bars ' + fmt(r.sup.mass) + ' kg', null) +
      arcKpi(inp) +
      (jt ? kpi('Joint tightening torque', null, fmt(jt.torque, jt.torque < 20 ? 1 : 0) + ' <small>N·m</small>', jt.count + ' × ' + jt.size + ' ' + esc(inp.grade) + ' · preload ' + fmt(jt.preload.F / 1000, 1) + ' kN each', null) : '') +
      '</div>';

    // cross-section + sharing
    html += '<div class="card panel"><h3>Cross-section and AC current distribution</h3>' +
      '<p class="lead">' + esc(describeSection(inp)) + ' per phase · ' + esc(inp.arrangement === 'face' ? 'wide faces facing' : 'edges facing') + ' · a = ' + fmt(inp.phaseSpacing) + ' mm · ' +
      (inp.mounting === 'flat' ? 'bars flat' : inp.mounting === 'vertical' ? 'vertical run (plan view)' : 'bars on edge') + '. Shading shows current density relative to a uniform (DC) distribution at ' + fmt(inp.freq) + ' Hz.</p>' +
      '<div class="grid-2 grid-xsec"><div>' + drawSection(r) + '</div><div>' + sharingTable(r) + '</div></div></div>';

    html += thermalPanel(r) + scPanel(r) + mechPanel(r) + insulPanel(r) + supportPanel(r) + (jt ? jointPanel(r) : '') + arcPanel(r) + autosizePanel() + methodPanel() + inputsSummary(r);
    return html;
  }

  // ---- arc flash (IEEE 1584-2018)
  var arcCache = { key: null, val: null };
  function arcOf(inp) {
    var key = JSON.stringify([inp.arcVoc, inp.arcIbf, inp.arcEC, inp.arcGap, inp.arcDist, inp.arcH, inp.arcW, inp.arcDepth, inp.arcTmax, inp.arcTmin, inp.Icw]);
    if (arcCache.key !== key) arcCache = { key: key, val: BC.arcFlash(inp) };
    return arcCache.val;
  }
  function ppeBadge(ppe) {
    var cls = ppe.cat <= 2 ? 'ok' : ppe.cat <= 4 ? 'warn' : 'bad';
    return '<span class="badge ' + cls + '">' + (ppe.cat === 0 ? 'BELOW 1.2' : ppe.cat > 4 ? 'OVER 40' : 'CAT ' + ppe.cat) + '</span>';
  }
  function arcKpi(inp) {
    var a = arcOf(inp);
    if (a.errors.length) return '<div class="card kpi"><div class="label"><span>Arc flash incident energy</span><span class="badge warn">CHECK INPUTS</span></div><div class="value">–</div><div class="sub">' + esc(a.errors[0]) + '</div></div>';
    var m = a.main;
    return '<div class="card kpi"><div class="label"><span>Arc flash incident energy</span>' + ppeBadge(m.ppe) + '</div>' +
      '<div class="value">' + fmt(m.cal, 1) + ' <small>cal/cm²</small></div>' +
      '<div class="sub">At ' + fmt(a.inputs.D) + ' mm · boundary ' + fmt(m.AFB / 1000, 2) + ' m · arc ' + fmt(m.max.Iarc, 1) + ' kA</div></div>';
  }
  function arcPanel(r) {
    var inp = r.inputs, a = arcOf(inp);
    if (a.errors.length) {
      return '<details class="card panel" open><summary><span>Arc flash incident energy (IEEE 1584-2018)</span><span class="badge warn">CHECK INPUTS</span></summary><ul class="notes">' +
        a.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></details>';
    }
    var m = a.main, p = a.inputs, open = a.ec === 'VOA' || a.ec === 'HOA';
    function scen(label, s) {
      return '<tr><td>' + label + '</td><td class="num">' + fmt(s.Iarc, 2) + ' kA</td><td class="num">' + fmt(s.T, 0) + ' ms</td><td class="num">' + fmt(s.E / 4.184, 2) + ' cal/cm²<br><span class="muted">' + fmt(s.E, 2) + ' J/cm²</span></td><td class="num">' + fmt(s.AFB, 0) + ' mm</td></tr>';
    }
    var left = '<table class="data"><tr><th>Scenario</th><th class="r">Arcing current</th><th class="r">Arcing time</th><th class="r">Incident energy</th><th class="r">Boundary</th></tr>' +
      scen('Maximum arcing current' + (m.worst === 'max' ? ' (worst)' : ''), m.max) +
      scen('Minimum arcing current' + (m.worst === 'min' ? ' (worst)' : ''), m.min) + '</table>' +
      '<p class="lead" style="margin-top:10px">' + ppeBadge(m.ppe) + ' ' + esc(m.ppe.label) + '. The arc flash boundary is the distance at which the energy has fallen to 1.2 cal/cm² (5.0 J/cm²).</p>';
    var right = '<table class="data">' +
      '<tr><td>System voltage · bolted fault current</td><td class="num">' + fmt(p.Voc) + ' V · ' + fmt(p.Ibf, 1) + ' kA</td></tr>' +
      '<tr><td>Electrode configuration</td><td class="num">' + esc(a.ec) + '</td></tr>' +
      '<tr><td>Gap · working distance</td><td class="num">' + fmt(p.G, 1) + ' mm · ' + fmt(p.D, 1) + ' mm</td></tr>' +
      '<tr><td>Arcing-current variation factor</td><td class="num">' + fmt(m.varCF, 3) + '</td></tr>' +
      (open ? '<tr><td>Enclosure correction factor</td><td class="num">1.000 (open air)</td></tr>'
            : '<tr><td>Enclosure ' + fmt(p.H) + ' × ' + fmt(p.W) + ' × ' + fmt(p.Dp) + ' mm (' + esc(m.enclosure.type) + ')</td><td class="num">equivalent size ' + fmt(m.enclosure.EES, 1) + ' in</td></tr>' +
              '<tr><td>Enclosure size correction factor CF</td><td class="num">' + fmt(m.CF, 3) + '</td></tr>') +
      '</table>';
    var tt = '<table class="data" style="margin-top:12px"><tr><th>To keep the energy at or below</th><th class="r">Clear the fault within</th></tr>' +
      [[1.2, m.tFor1_2, ' (below the PPE categories)'], [4, m.tFor4, ' (Category 1)'], [8, m.tFor8, ' (Category 2)']].map(function (x) {
        return '<tr><td>' + x[0] + ' cal/cm²' + x[2] + '</td><td class="num">' + fmt(x[1], 0) + ' ms</td></tr>';
      }).join('') + '</table>' +
      '<p class="hint muted" style="margin:6px 0 0">Incident energy grows in direct proportion to the arcing time, so these times follow from the result above. They hold for both the maximum and minimum current cases.</p>';
    var cmp = '<h4 style="margin:16px 0 6px">All electrode configurations</h4><div class="table-scroll"><table class="data"><tr><th>Configuration</th><th class="r">Arcing current</th><th class="r">Incident energy</th><th class="r">Boundary</th><th></th></tr>' +
      a.all.map(function (c) {
        return '<tr' + (c.ec === a.ec ? ' class="highlight"' : '') + '><td>' + esc(c.ec) + (c.ec === a.ec ? ' (selected)' : '') + (c === a.worstEC ? ' · highest' : '') + '</td><td class="num">' + fmt(c.max.Iarc, 2) + ' kA</td><td class="num">' + fmt(c.cal, 2) + ' cal/cm²</td><td class="num">' + fmt(c.AFB, 0) + ' mm</td><td>' + ppeBadge(c.ppe) + '</td></tr>';
      }).join('') + '</table></div>';
    var notes = '<ul class="notes muted">' +
      '<li>Method: IEEE 1584-2018 empirical model (equations 1 to 25). It is not part of IEC 61439. The incident energy is worked out at both the maximum and the minimum arcing current, and the larger value is used.</li>' +
      '<li>Pick the configuration that matches the equipment. Horizontal busbars in a compartment are HCB. Vertical busbars are VCB, or VCBB if a barrier ends the electrodes. If unsure, compare them in the table and use the highest.</li>' +
      '<li>The arcing time is the clearing time of the protective device on the supply side of the fault, including its opening time. Instantaneous trips and arc-flash relays shorten it most. The minimum-current case often has a longer time.</li>' +
      '<li>The PPE bands (1.2, 4, 8, 25 and 40 cal/cm²) are those of NFPA 70E. Above 40 cal/cm² no PPE category applies. The result does not replace a site study, protection coordination or the labelling rules.</li></ul>';
    return '<details class="card panel" open><summary><span>Arc flash incident energy (IEEE 1584-2018)</span>' + ppeBadge(m.ppe) + '</summary>' +
      (a.warnings.length ? '<ul class="notes">' + a.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="grid-2"><div>' + left + tt + '</div><div>' + right + '</div></div>' + cmp + notes + '</details>';
  }

  function kpi(label, ok, value, sub, frac) {
    return '<div class="card kpi"><div class="label"><span>' + esc(label) + '</span>' + (ok === null ? '' : badge(ok)) + '</div>' +
      '<div class="value">' + value + '</div><div class="sub">' + sub + '</div>' + (frac === null ? '' : meter(frac)) + '</div>';
  }

  function describeSection(inp) {
    return (inp.nBars > 1 ? inp.nBars + ' × ' : '') + fmt(inp.width) + ' × ' + fmt(inp.thick) + ' mm ' + (inp.material === 'Cu' ? 'Cu' : 'Al');
  }

  // ---- cross-section drawing
  function rampColor(f) {
    f = Math.max(0, Math.min(1, f));
    var h = 45 - 33 * f, s = 92 - 8 * f, l = 82 - 44 * f;
    return 'hsl(' + h.toFixed(1) + ',' + s.toFixed(1) + '%,' + l.toFixed(1) + '%)';
  }

  function drawSection(r) {
    var g = r.geometry, inp = r.inputs, em = r.em;
    var flat = inp.mounting === 'flat';
    function toScreen(x, y) { return flat ? [y, x] : [x, -y]; }
    function rectScreen(cx, cy, wx, wy) { var c = toScreen(cx, cy); return flat ? { x: c[0] - wy / 2, y: c[1] - wx / 2, w: wy, h: wx } : { x: c[0] - wx / 2, y: c[1] - wy / 2, w: wx, h: wy }; }
    var bars = [];
    for (var p = 0; p < 3; p++) {
      var pc = (p - 1) * g.a;
      for (var i = 0; i < g.n; i++) {
        var u = -g.D / 2 + g.t / 2 + i * (g.t + g.s);
        var cx = g.arr === 'face' ? pc + u : u, cy = g.arr === 'face' ? 0 : pc;
        bars.push({ p: p, i: i, r: rectScreen(cx, cy, g.t, g.h) });
      }
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    bars.forEach(function (b) { minX = Math.min(minX, b.r.x); minY = Math.min(minY, b.r.y); maxX = Math.max(maxX, b.r.x + b.r.w); maxY = Math.max(maxY, b.r.y + b.r.h); });
    var W = 620, P = 46, bw = maxX - minX, bh = maxY - minY;
    var scale = Math.min((W - 2 * P) / bw, (360 - 2 * P) / bh);
    var H = bh * scale + 2 * P + 10;
    var ox = (W - bw * scale) / 2 - minX * scale, oy = P - minY * scale;
    function X(v) { return (ox + v * scale).toFixed(2); }
    function Y(v) { return (oy + v * scale).toFixed(2); }

    var jmin = Infinity, jmax = -Infinity;
    (em.filaments || []).forEach(function (f) { jmin = Math.min(jmin, f.jrel); jmax = Math.max(jmax, f.jrel); });
    var span = jmax - jmin || 1;

    var svg = '<svg class="xsec" viewBox="0 0 ' + W + ' ' + H.toFixed(0) + '" role="img" aria-label="Busbar cross-section with current density">';
    if (em.filaments && em.filaments.length) {
      em.filaments.forEach(function (f) {
        var rr = rectScreen(f.x, f.y, em.du, em.dv);
        svg += '<rect x="' + X(rr.x) + '" y="' + Y(rr.y) + '" width="' + (rr.w * scale + 0.3).toFixed(2) + '" height="' + (rr.h * scale + 0.3).toFixed(2) + '" fill="' + rampColor((f.jrel - jmin) / span) + '"/>';
      });
    } else {
      bars.forEach(function (b) { svg += '<rect x="' + X(b.r.x) + '" y="' + Y(b.r.y) + '" width="' + (b.r.w * scale).toFixed(2) + '" height="' + (b.r.h * scale).toFixed(2) + '" fill="' + rampColor(0.5) + '"/>'; });
    }
    bars.forEach(function (b) { svg += '<rect x="' + X(b.r.x) + '" y="' + Y(b.r.y) + '" width="' + (b.r.w * scale).toFixed(2) + '" height="' + (b.r.h * scale).toFixed(2) + '" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1"/>'; });

    // phase labels + spacing dimension
    var centres = [0, 1, 2].map(function (p) { return toScreen(g.arr === 'face' ? (p - 1) * g.a : 0, g.arr === 'face' ? 0 : (p - 1) * g.a); });
    var horizontal = Math.abs(centres[2][0] - centres[0][0]) > Math.abs(centres[2][1] - centres[0][1]);
    centres.forEach(function (c, p) {
      if (horizontal) svg += '<text x="' + X(c[0]) + '" y="' + (Number(Y(maxY)) + 18).toFixed(1) + '" text-anchor="middle" font-weight="600">' + PHASE[p] + '</text>';
      else svg += '<text x="' + (Number(X(minX)) - 10).toFixed(1) + '" y="' + (Number(Y(c[1])) + 4).toFixed(1) + '" text-anchor="end" font-weight="600">' + PHASE[p] + '</text>';
    });
    if (horizontal) {
      var yd = Number(Y(minY)) - 16, x1 = Number(X(centres[0][0])), x2 = Number(X(centres[1][0]));
      svg += '<path class="dim" d="M' + x1 + ' ' + yd + 'H' + x2 + 'M' + x1 + ' ' + (yd - 5) + 'v10M' + x2 + ' ' + (yd - 5) + 'v10"/>' +
        '<text class="dimtext" x="' + ((x1 + x2) / 2) + '" y="' + (yd - 6) + '" text-anchor="middle">a = ' + fmt(inp.phaseSpacing) + ' mm</text>';
    } else {
      var xd = Number(X(maxX)) + 16, y1 = Number(Y(centres[0][1])), y2 = Number(Y(centres[1][1]));
      svg += '<path class="dim" d="M' + xd + ' ' + y1 + 'V' + y2 + 'M' + (xd - 5) + ' ' + y1 + 'h10M' + (xd - 5) + ' ' + y2 + 'h10"/>' +
        '<text class="dimtext" x="' + (xd + 6) + '" y="' + ((y1 + y2) / 2 + 4) + '">a = ' + fmt(inp.phaseSpacing) + ' mm</text>';
    }
    svg += '</svg>';
    var legend = em.filaments && em.filaments.length
      ? '<div class="legend"><span class="num">' + fmt(jmin, 2) + '×</span><span class="ramp" style="background:linear-gradient(90deg,' + rampColor(0) + ',' + rampColor(0.5) + ',' + rampColor(1) + ')"></span><span class="num">' + fmt(jmax, 2) + '×</span><span>J / J<sub>DC</sub></span></div>'
      : '';
    return svg + legend;
  }

  function sharingTable(r) {
    var th = r.thermal, n = r.inputs.nBars;
    var head = '<tr><th>Phase</th><th class="r">R<sub>ac</sub>/R<sub>dc</sub></th>' + (n > 1 ? '<th class="r">Current share per bar</th>' : '') + '<th class="r">Loss at Iₙ</th><th class="r">Temp. at Iₙ</th></tr>';
    var rows = th.phases.map(function (ph) {
      var shares = r.em.shares[ph.idx].map(function (s) { return fmt(s * 100) + '%'; }).join(' / ');
      return '<tr' + (ph.idx === th.limiting.idx ? ' class="highlight"' : '') + '><td>' + PHASE[ph.idx] + (ph.idx === th.limiting.idx ? ' <span class="muted">(limiting)</span>' : '') + '</td>' +
        '<td class="num">' + fmt(ph.kac, 3) + '</td>' + (n > 1 ? '<td class="num">' + shares + '</td>' : '') +
        '<td class="num">' + (ph.Pop === null ? '–' : fmt(ph.Pop, 1) + ' W/m') + '</td><td class="num">' + (isFinite(ph.Top) ? fmt(ph.Top, 1) + ' °C' : 'runaway') + '</td></tr>';
    }).join('');
    var z = r.em.Z[1];
    return '<div class="table-scroll"><table class="data">' + head + rows + '</table></div>' +
      '<table class="data" style="margin-top:12px">' +
      '<tr><td>Total loss, 3 phases at Iₙ</td><td class="num">' + fmt(th.lossPerMetre3ph, 1) + ' W/m</td></tr>' +
      '<tr><td>Current density at Iₙ</td><td class="num">' + fmt(th.currentDensity, 2) + ' A/mm²</td></tr>' +
      '<tr><td>Impedance per phase (L2, at ' + fmt(r.inputs.Tmax) + ' °C)</td><td class="num">' + fmt(z.R * 1e6, 1) + ' + j' + fmt(z.X * 1e6, 1) + ' µΩ/m</td></tr>' +
      '<tr><td>R<sub>dc</sub> per phase at ' + fmt(r.inputs.Tmax) + ' °C</td><td class="num">' + fmt(r.em.Rdc * 1e6, 2) + ' µΩ/m</td></tr>' +
      '</table>' +
      (n > 1 ? '<p class="muted" style="font-size:12px;margin:8px 0 0">Bar shares are current magnitudes and can add up to more than 100 % because the bar currents are not exactly in phase. Proximity to the neighbouring phases makes the sharing uneven, which is why each extra bar adds less capacity.</p>' : '');
  }

  // ---- thermal panel
  function thermalPanel(r) {
    var inp = r.inputs, th = r.thermal, L = th.limiting, Q = L.Qmax;
    var tint = r.TintParts
      ? fmt(r.TintParts.room) + ' °C room + ' + fmt(r.TintParts.ipTop) + ' K (' + esc(inp.ip) + ')' + (r.TintParts.loc !== 1 ? ' × ' + r.TintParts.loc + ' (' + esc(inp.location) + ')' : '') + ' + ' + fmt(r.TintParts.form) + ' K (Form ' + esc(inp.form) + ')'
      : 'specified';
    var dT = inp.Tmax - r.Tint;
    var rows = Q.items.map(function (it) {
      var q = it.h * it.area * dT * r.convFactor;
      return '<tr><td>' + esc(it.label) + '</td><td class="num">' + fmt(it.area * 1000) + ' mm</td><td class="num">' + fmt(it.h, 2) + '</td><td class="num">' + fmt(q, 1) + '</td></tr>';
    }).join('');
    return '<details class="card panel" open><summary><span>Continuous rating — temperature rise</span>' + badge(th.ok) + '</summary>' +
      '<div class="grid-2"><div><table class="data">' +
      '<tr><td>Internal air temperature at busbars</td><td class="num">' + fmt(r.Tint, 1) + ' °C</td></tr><tr class="sub"><td colspan="2">' + tint + '</td></tr>' +
      '<tr><td>Max. busbar temperature / permitted rise over air</td><td class="num">' + fmt(inp.Tmax) + ' °C / ' + fmt(dT, 1) + ' K</td></tr>' +
      '<tr><td>Air pressure at ' + fmt(inp.altitude) + ' m</td><td class="num">' + fmt(r.pressure / 1000, 1) + ' kPa</td></tr>' +
      '<tr><td>Convection factor (Form ' + esc(inp.form) + ')</td><td class="num">' + fmt(r.convFactor, 2) + '</td></tr>' +
      '<tr><td>Emissivity ε · radiating perimeter (' + PHASE[L.idx] + ')</td><td class="num">' + fmt(inp.eps, 2) + ' · ' + fmt(L.rad.perimeter * 1000) + ' mm</td></tr>' +
      '<tr class="sub"><td colspan="2">Envelope ' + fmt(L.rad.envelope * 1000) + ' mm less ' + L.rad.neighbours + ' face(s) × view factor ' + fmt(L.rad.viewFactor, 2) + ' to the adjacent phase</td></tr>' +
      '<tr><td>Heat dissipated at ' + fmt(inp.Tmax) + ' °C — convection / radiation</td><td class="num">' + fmt(Q.conv, 1) + ' / ' + fmt(Q.rad, 1) + ' W/m</td></tr>' +
      '<tr><td>R<sub>ac</sub>/R<sub>dc</sub> (' + PHASE[L.idx] + ')</td><td class="num">' + fmt(L.kac, 3) + '</td></tr>' +
      '<tr><td>Thermal limit current I = √(Q / k·R<sub>dc</sub>)</td><td class="num">' + fmt(th.Iphys) + ' A</td></tr>' +
      '<tr><td>× additional derating factor</td><td class="num">' + fmt(inp.derate, 2) + '</td></tr>' +
      '<tr class="highlight"><td><strong>Permissible current</strong></td><td class="num"><strong>' + fmt(th.Iperm) + ' A</strong></td></tr>' +
      '</table></div><div><table class="data"><tr><th>Surface (per phase)</th><th class="r">Perimeter</th><th class="r">h W/m²K</th><th class="r">Q W/m</th></tr>' + rows +
      '<tr><td>Radiation</td><td class="num">' + fmt(L.rad.perimeter * 1000) + ' mm</td><td class="num">–</td><td class="num">' + fmt(Q.rad, 1) + '</td></tr>' +
      '<tr class="highlight"><td><strong>Total</strong></td><td></td><td></td><td class="num"><strong>' + fmt(Q.total, 1) + '</strong></td></tr></table>' +
      '<p class="muted" style="font-size:12px">Values at the limiting temperature ' + fmt(inp.Tmax) + ' °C for phase ' + PHASE[L.idx] + '. Convection coefficients include air properties at film temperature and site pressure; Q includes the form convection factor.</p></div></div></details>';
  }

  function scPanel(r) {
    var sc = r.sc, inp = r.inputs;
    return '<details class="card panel" open><summary><span>Short-circuit thermal withstand</span>' + badge(sc.ok) + '</summary>' +
      '<table class="data">' +
      '<tr><td>Short-time current / duration</td><td class="num">' + fmt(inp.Icw) + ' kA / ' + fmt(inp.tk, 2) + ' s</td></tr>' +
      '<tr><td>Initial temperature θᵢ (operating temp. at Iₙ)</td><td class="num">' + fmt(sc.thetaI, 1) + ' °C</td></tr>' +
      '<tr><td>Maximum temperature during fault θ<sub>f</sub></td><td class="num">' + fmt(sc.thetaF) + ' °C</td></tr>' +
      '<tr><td>Material constant K = √(Q<sub>c</sub>(β+20)/ρ<sub>20</sub>)</td><td class="num">' + fmt(sc.K, 1) + ' A·√s/mm²</td></tr>' +
      '<tr><td>k = K·√ln((θ<sub>f</sub>+β)/(θᵢ+β))</td><td class="num">' + fmt(sc.k, 1) + ' A·√s/mm²</td></tr>' +
      '<tr><td>Minimum cross-section S<sub>min</sub> = I·√t / k</td><td class="num">' + fmt(sc.Smin) + ' mm²</td></tr>' +
      '<tr class="highlight"><td><strong>Cross-section per phase</strong></td><td class="num"><strong>' + fmt(sc.S) + ' mm²</strong></td></tr>' +
      '<tr><td>Conductor temperature at end of fault</td><td class="num">' + fmt(sc.thetaEnd) + ' °C</td></tr>' +
      '<tr><td>Withstand current of this section for ' + fmt(inp.tk, 2) + ' s</td><td class="num">' + fmt(sc.Iwithstand, 1) + ' kA</td></tr>' +
      '</table><p class="muted" style="font-size:12px">Adiabatic heating (IEC 60949 / IEC 60865-1). Droppers and tap-offs fed from these busbars must also satisfy S ≥ S<sub>min</sub> unless protected by a current-limiting device.</p></details>';
  }

  function mechPanel(r) {
    var m = r.mech, inp = r.inputs;
    var n = inp.nBars;
    return '<details class="card panel" open><summary><span>Short-circuit electromagnetic forces (IEC 60865-1)</span>' + badge(m.ok) + '</summary>' +
      '<div class="grid-2"><div><table class="data">' +
      '<tr><td>Peak factor n' + (m.peak.cos ? ' (cos φ ' + m.peak.cos + ')' : '') + '</td><td class="num">' + fmt(m.peak.n, 2) + '</td></tr>' +
      '<tr class="highlight"><td><strong>Peak short-circuit current i<sub>p</sub></strong></td><td class="num"><strong>' + fmt(m.ip / 1000, 1) + ' kA</strong></td></tr>' +
      '<tr><td>Phase spacing a / effective a<sub>m</sub></td><td class="num">' + fmt(inp.phaseSpacing) + ' / ' + fmt(m.am * 1000, 1) + ' mm</td></tr>' +
      '<tr><td>Two-conductor force 0.2·i<sub>p</sub>²·l/a</td><td class="num">' + fmt(m.F2simple) + ' N</td></tr>' +
      '<tr class="highlight"><td><strong>Force on centre phase F<sub>m3</sub></strong> = (μ₀/2π)(√3/2)i<sub>p</sub>²·l/a<sub>m</sub></td><td class="num"><strong>' + fmt(m.Fm3) + ' N</strong></td></tr>' +
      '<tr class="sub"><td colspan="2">= ' + fmt(m.Fm3pm / 1000, 2) + ' kN per metre over span l = ' + fmt(inp.span) + ' mm</td></tr>' +
      (n > 1 ? '<tr><td>Force between sub-conductors F<sub>s</sub> (a<sub>s</sub> = ' + fmt(m.as * 1000, 1) + ' mm)</td><td class="num">' + fmt(m.Fs) + ' N</td></tr>' +
        '<tr class="sub"><td colspan="2">= ' + fmt(m.Fspm / 1000, 2) + ' kN/m over spacer interval lₛ = ' + fmt(m.ls) + ' mm</td></tr>' : '') +
      '<tr><td>Section modulus Z<sub>m</sub>' + (n > 1 ? ' / Z<sub>s</sub>' : '') + '</td><td class="num">' + fmt(m.Zm * 1e6, 2) + (n > 1 ? ' / ' + fmt(m.Zs * 1e6, 2) : '') + ' cm³</td></tr>' +
      '<tr><td>Support type (β = ' + m.support.beta + ')</td><td>' + esc(m.support.label) + '</td></tr>' +
      '</table></div><div><table class="data">' +
      '<tr><th>Stress</th><th class="r">Value</th><th class="r">Limit</th><th></th></tr>' +
      '<tr><td>σ<sub>m</sub> main conductor</td><td class="num">' + fmt(m.sigM, 1) + '</td><td></td><td></td></tr>' +
      (n > 1 ? '<tr><td>σ<sub>s</sub> sub-conductor</td><td class="num">' + fmt(m.sigS, 1) + '</td><td class="num">' + fmt(m.limS) + '</td><td>' + badge(m.sigS <= m.limS) + '</td></tr>' : '') +
      '<tr class="highlight"><td><strong>σ<sub>tot</sub></strong> (MPa)</td><td class="num"><strong>' + fmt(m.sigTot, 1) + '</strong></td><td class="num">q·R<sub>p0.2</sub> = ' + fmt(m.limTot) + '</td><td>' + badge(m.sigTot <= m.limTot) + '</td></tr>' +
      '</table><table class="data" style="margin-top:12px">' +
      '<tr class="highlight"><td><strong>Maximum support span</strong></td><td class="num"><strong>' + fmt(m.lmax) + ' mm</strong></td></tr>' +
      (n > 1 ? '<tr><td>Maximum spacer interval (at this span)</td><td class="num">' + (m.lsmax > 0 ? fmt(m.lsmax) + ' mm' : 'reduce span') + '</td></tr>' : '') +
      '<tr><td>Force on end supports F<sub>d,A</sub> (α ' + m.support.alphaA + ')</td><td class="num">' + fmt(m.FdA / 1000, 2) + ' kN</td></tr>' +
      '<tr><td>Force on inner supports F<sub>d,B</sub> (α ' + m.support.alphaB + ')</td><td class="num">' + fmt(m.FdB / 1000, 2) + ' kN</td></tr>' +
      '</table><p class="muted" style="font-size:12px">Busbar supports must have a rated cantilever / tensile strength above F<sub>d</sub> (with V<sub>F</sub>·V<sub>r</sub> = ' + fmt(inp.vfvr, 1) + '). Sub-conductors are assumed to act independently (no stiffening spacers), which is conservative.</p></div></div></details>';
  }

  function insulFails(s) {
    var m = [];
    if (!s.okClearPP) m.push('phase-to-phase clearance ' + fmt(s.clearPP, 1) + ' mm below ' + fmt(s.clearMin, 1) + ' mm');
    if (!s.okClearEncl) m.push('distance to enclosure ' + fmt(s.clearEncl, 1) + ' mm below ' + fmt(s.clearMin, 1) + ' mm');
    if (!s.elastic && s.okClearPP && !s.okFaultPP) m.push('phase-to-phase clearance may fall to ' + fmt(s.clearPPfault, 1) + ' mm after the fault');
    if (!s.elastic && s.okClearEncl && !s.okFaultEncl) m.push('distance to enclosure may fall to ' + fmt(s.clearEnclFault, 1) + ' mm after the fault');
    if (s.okCreepPP === false) m.push('phase-to-phase creepage ' + fmt(s.creepPP, 1) + ' mm below ' + fmt(s.creepNeed, 1) + ' mm');
    if (s.okCreepPE === false) m.push('phase-to-earth creepage ' + fmt(s.creepPE, 1) + ' mm below ' + fmt(s.creepNeed, 1) + ' mm');
    return m.join('; ');
  }

  function insulRow(label, provided, required, ok, advisory) {
    var b = ok === null ? '<span class="badge warn">ENTER VALUE</span>' : (!ok && advisory ? '<span class="badge warn">ADVISORY</span>' : badge(ok));
    return '<tr><td>' + label + '</td><td class="num">' + fmt(provided, 1) + ' mm</td><td class="num">≥ ' + fmt(required, 1) + ' mm</td><td>' + b + '</td></tr>';
  }

  function insulPanel(r) {
    var s = r.insul, inp = r.inputs;
    var head = !s.ok ? badge(false) : (s.okCreepPP === null || s.okCreepPE === null) ? '<span class="badge warn">CHECK CREEPAGE</span>' : !(s.okFaultPP && s.okFaultEncl) ? '<span class="badge warn">ADVISORY</span>' : badge(true);
    var src = s.creepSource === 'user' ? 'override entered by you' : s.creepSource === 'table' ? 'IEC 61439-1 Table 2 (Uᵢ row ' + s.creepRow + ' V, pollution degree ' + s.pollution + ', group ' + esc(s.matGroup) + ')' : 'Table 2 has no value for this combination';
    return '<details class="card panel" open><summary><span>Clearances and creepage (IEC 61439-1 clause 8.3)</span>' + head + '</summary>' +
      '<div class="grid-2"><div><table class="data"><tr><th>Check</th><th class="r">Provided</th><th class="r">Required</th><th></th></tr>' +
      insulRow('Clearance phase–phase, at rest', s.clearPP, s.clearMin, s.okClearPP) +
      insulRow('Clearance live part–enclosure, at rest', s.clearEncl, s.clearMin, s.okClearEncl) +
      insulRow('Clearance phase–phase, during fault', s.clearPPfault, s.clearMin, s.okFaultPP, s.elastic) +
      insulRow('Clearance live part–enclosure, during fault', s.clearEnclFault, s.clearMin, s.okFaultEncl, s.elastic) +
      insulRow('Creepage phase–phase (across supports)', s.creepPP, s.creepNeed, s.okCreepPP) +
      insulRow('Creepage phase–earth', s.creepPE, s.creepNeed, s.okCreepPE) +
      '</table></div><div><table class="data">' +
      '<tr><td>Rated impulse withstand voltage Uimp</td><td class="num">' + fmt(inp.Uimp) + ' kV</td></tr>' +
      '<tr><td>Table 1 clearance (inhomogeneous field, PD3)</td><td class="num">' + fmt(s.clearBase, 1) + ' mm</td></tr>' +
      '<tr><td>Altitude factor (' + fmt(inp.altitude) + ' m)</td><td class="num">× ' + fmt(s.altFactor, 2) + '</td></tr>' +
      '<tr class="highlight"><td><strong>Minimum clearance</strong></td><td class="num"><strong>' + fmt(s.clearMin, 1) + ' mm</strong></td></tr>' +
      '<tr><td>Rated insulation voltage Uᵢ · pollution degree · material group</td><td class="num">' + fmt(s.Ui) + ' V · ' + s.pollution + ' · ' + esc(s.matGroup) + '</td></tr>' +
      '<tr><td>Table 2 creepage</td><td class="num">' + (s.creepReq === null ? 'no value' : fmt(s.creepReq, 1) + ' mm') + '</td></tr>' +
      '<tr class="sub"><td colspan="2">Source: ' + src + '. Creepage must also be at least the minimum clearance.</td></tr>' +
      '<tr><td>Main-conductor deflection under peak force</td><td class="num">' + fmt(s.deflection, 2) + ' mm</td></tr>' +
      '<tr class="sub"><td colspan="2">' + (s.elastic ? 'Stress within Rp0.2: the bars spring back, so clearances are restored after the fault.' : 'Stress exceeds Rp0.2: permanent deformation is possible, so the clearance after the fault is checked against the estimated movement.') + '</td></tr>' +
      '</table></div></div>' +
      '<ul class="notes muted"><li>Clause 8.3.1: the same clearances and creepage apply phase to phase and from live parts to earth (enclosure, earthed barriers). Bare conductors must be at least equal to the equipment they connect to.</li>' +
      '<li>Clauses 8.3.1 and 10.11.5.5: a short circuit must not <em>permanently</em> reduce clearances or creepage. Bars that stay elastic recover, so transient movement is shown as advisory. If the bars yield, the estimated movement must still leave the minimum clearance.</li>' +
      '<li>Fault clearance: phase-to-phase is reduced by twice the main-conductor deflection (both neighbours may move toward each other); the enclosure distance by one deflection. The deflection is a static elastic estimate under the peak force, scaled by Vσ·Vr – a screening value. Enclosure or barrier deformation is not modelled.</li>' +
      '<li>The altitude factor is from IEC 60664-1 Table A.2; IEC 61439-1 clause 7.1.4 only says that altitude above 2000 m must be taken into account. Clearances and creepage are verified by measurement (clause 10.4, Annex F) or the clause 10.9.3 impulse test.</li></ul></details>';
  }

  function supFails(s) {
    var m = [];
    if (!s.spanOk) m.push('span above the recommended maximum of ' + fmt(s.lmaxEff) + ' mm');
    if (s.comb && !s.okWall) m.push('slot walls overstressed');
    if (s.comb && !s.okBlock) m.push('support body overstressed');
    if (!s.comb && !s.okHold) m.push('flat clamps cannot hold the short-circuit load');
    if (!s.okFix) m.push('fixings overloaded');
    if (s.okRating === false) m.push('support rating below the short-circuit load');
    if (s.nRibs > 0 && !s.ribFit) m.push('ribs do not fit between the phases');
    return m.join('; ');
  }

  function supRow(label, value, limit, ok) {
    var b = ok === null ? '<span class="badge warn">ENTER VALUE</span>' : badge(ok);
    return '<tr><td>' + label + '</td><td class="num">' + value + '</td><td class="num">' + limit + '</td><td>' + b + '</td></tr>';
  }

  function supportPanel(r) {
    var s = r.sup, inp = r.inputs;
    var left = '<table class="data">' +
      '<tr><td>Bars on the supports</td><td class="num">' + s.nBarsTot + ' × ' + fmt(inp.width) + ' × ' + fmt(inp.thick) + ' mm</td></tr>' +
      '<tr><td>Mass of the bars</td><td class="num">' + fmt(s.kgPerM, 1) + ' kg/m · ' + fmt(s.mass) + ' kg</td></tr>' +
      '<tr class="sub"><td colspan="2">Over a run of ' + fmt(inp.runLen) + ' mm, all poles</td></tr>' +
      '<tr><td>Weight carried per support</td><td class="num">' + fmt(s.weightPerSupport) + ' N</td></tr>' +
      '<tr><td>Sag of a bar between supports</td><td class="num">' + fmt(s.sag, 2) + ' mm</td></tr>' +
      '<tr class="highlight"><td><strong>Short-circuit load per support F<sub>d</sub></strong></td><td class="num"><strong>' + fmt(s.Fd / 1000, 1) + ' kN</strong></td></tr>' +
      '<tr><td>Resultant on the fixings (short circuit + weight)</td><td class="num">' + fmt(s.fixResultant / 1000, 1) + ' kN</td></tr>' +
      '<tr><td>Supports needed at your span of ' + fmt(inp.span) + ' mm</td><td class="num">' + s.nSel + '</td></tr>' +
      '<tr class="highlight"><td><strong>Supports needed at the recommended span</strong></td><td class="num"><strong>' + (isFinite(s.nRec) ? s.nRec + ' at ' + fmt(s.spacingRec) + ' mm' : 'span too long') + '</strong></td></tr>' +
      '<tr class="sub"><td colspan="2">Recommended span = ' + fmt(inp.spanMargin, 2) + ' × permissible ' + fmt(r.mech.lmax) + ' mm = ' + fmt(s.lmaxEff) + ' mm</td></tr></table>';
    var chk = '<table class="data"><tr><th>Check</th><th class="r">Value</th><th class="r">Limit</th><th></th></tr>' +
      supRow('Support span', fmt(inp.span) + ' mm', '≤ ' + fmt(s.lmaxEff) + ' mm', s.spanOk);
    if (s.comb) {
      chk += supRow('Slot wall bending', fmt(s.sigWall, 1) + ' MPa', '≤ ' + fmt(s.allowFlex, 1) + ' MPa', s.sigWall <= s.allowFlex) +
        supRow('Slot wall shear', fmt(s.tauWall, 1) + ' MPa', '≤ ' + fmt(s.allowShear, 1) + ' MPa', s.tauWall <= s.allowShear) +
        supRow('Body between phase slots', fmt(s.sigBlock, 1) + ' MPa', '≤ ' + fmt(s.allowTens, 1) + ' MPa', s.okBlock);
    } else {
      chk += supRow('Clamp force per bar (friction)', fmt(s.clampPerBar / 1000, 1) + ' kN', '≤ ' + fmt(s.clampLimit / 1000, 1) + ' kN', s.okHold);
    }
    chk += supRow('Fixing bolts (' + fmt(inp.fixN) + ' × ' + esc(inp.fixSize) + ' ' + esc(inp.fixGrade) + ')', fmt(s.fixLoad / 1000, 1) + ' kN each', '≤ ' + fmt(s.fixShearCap / 1000, 1) + ' kN', s.okFix) +
      supRow('Manufacturer rating', fmt(s.Fd / 1000, 1) + ' kN needed', s.rating === null ? 'not entered' : fmt(s.rating / 1000, 1) + ' kN', s.okRating) + '</table>';
    var ex = '<table class="data">' +
      '<tr><td>Temperature rise from installation (' + fmt(inp.Tinstall) + ' °C)</td><td class="num">' + fmt(s.dTheta, 1) + ' K</td></tr>' +
      '<tr><td>Free expansion of the run</td><td class="num">' + fmt(s.dL, 2) + ' mm</td></tr>' +
      '<tr><td>Movement at the furthest support (' + (inp.fixedPoint === 'end' ? 'fixed at one end' : 'fixed at the centre') + ')</td><td class="num">' + fmt(s.move, 2) + ' mm</td></tr>' +
      '<tr class="highlight"><td><strong>Sliding allowance in clamps and fixings</strong></td><td class="num"><strong>≥ ' + fmt(s.move + 2, 1) + ' mm</strong></td></tr>' +
      '<tr><td>Force if the bars were fully restrained</td><td class="num">' + fmt(s.fConstr / 1000) + ' kN per bar</td></tr></table>';
    var rib = '<table class="data">' +
      '<tr><td>Air gap between phases</td><td class="num">' + fmt(s.gap, 1) + ' mm</td></tr>' +
      '<tr><td>Ribs between phases</td><td class="num">' + s.nRibs + (s.nRibs > 0 ? ' × ' + fmt(inp.ribH) + ' high, ' + fmt(inp.ribT) + ' thick' : '') + '</td></tr>' +
      '<tr><td>Groove width (minimum ' + fmt(s.grooveMin, 2) + ' mm, Table F.1)</td><td class="num">' + (s.nRibs === 0 ? '–' : s.ribFit ? fmt(s.grooveW, 1) + ' mm' : 'ribs do not fit') + '</td></tr>' +
      '<tr class="highlight"><td><strong>Creepage path phase to phase</strong></td><td class="num"><strong>' + fmt(s.creepPath, 1) + ' mm</strong></td></tr>' +
      '<tr class="sub"><td colspan="2">' + (s.nRibs === 0 ? 'No ribs: the path equals the air gap.' : s.ribsCounted ? 'Ribs counted: rib height at least 2 mm and grooves wide enough.' : 'Ribs not counted for creepage.') +
      (r.insul.creepReq !== null ? ' Table 2 requires ' + fmt(r.insul.creepReq, 1) + ' mm. With ribs of at least 2 mm it may be reduced to ' + fmt(0.8 * r.insul.creepReq, 1) + ' mm, never below the clearance (not applied here).' : '') + '</td></tr></table>';
    return '<details class="card panel" open><summary><span>Busbar support system</span>' + badge(s.ok) + '</summary>' +
      '<div class="grid-2"><div>' + left + '</div><div>' + chk + '</div></div>' +
      '<div class="grid-2" style="margin-top:16px"><div><h4 style="margin:0 0 6px;font-size:13px">Thermal expansion of the run</h4>' + ex + '</div><div><h4 style="margin:0 0 6px;font-size:13px">Creepage over the ribs</h4>' + rib + '</div></div>' +
      '<ul class="notes muted"><li>The short-circuit force acts sideways between the phases and the weight of the bars acts downwards. The fixings carry the vector sum, and the supports must be rated for both.</li>' +
      '<li>The bars expand when hot. Fix them at one support only, let the others slide (slotted fixings or clamps), and connect the ends with flexible links. Rigid clamping at every support would build up the restraint force shown above.</li>' +
      '<li>' + (s.comb ? 'Slotted supports hold each bar edge positively.' : 'Flat clamp blocks hold the bars only by friction, which is not a reliable way to resist the short-circuit force.') + ' The material strengths, the safety factor, the fixing shear capacity (0.6 · Rp · As / 1.25) and the bar load factor are assumptions: replace them with the support manufacturer test data. Clause 10.11.5.5 requires that a support does not break into pieces or crack through its section in the short-circuit test.</li></ul></details>';
  }

  function jointPanel(r) {
    var j = r.joint, inp = r.inputs;
    var rows = j.table.map(function (t) {
      return '<tr' + (t.size === j.size ? ' class="highlight"' : '') + '><td>' + t.size + '</td><td class="num">' + fmt(t.F / 1000, 1) + ' kN</td><td class="num">' + fmt(t.torque, t.torque < 20 ? 1 : 0) + ' N·m</td></tr>';
    }).join('');
    var bearOk = j.pBear <= j.rpBar;
    return '<details class="card panel" open><summary><span>Bolted joints — bolt size and tightening torque</span>' + (j.notes.length ? '<span class="badge warn">CHECK</span>' : '<span class="badge ok">OK</span>') + '</summary>' +
      '<div class="grid-2"><div><table class="data">' +
      '<tr><td>Recommended for ' + fmt(inp.width) + ' mm bar</td><td class="num">' + j.rec.count + ' × ' + j.rec.size + '</td></tr>' +
      '<tr class="sub"><td colspan="2">' + esc(j.rec.pattern) + ', hole Ø' + fmt(BC.BOLTS[j.rec.size].hole, 1) + ' mm</td></tr>' +
      '<tr class="highlight"><td><strong>Selected</strong></td><td class="num"><strong>' + j.count + ' × ' + j.size + ' ' + esc(inp.grade) + '</strong></td></tr>' +
      '<tr><td>Proof load per bolt (A<sub>s</sub> ' + fmt(j.bolt.As, 1) + ' mm² × ' + j.preload.proof + ' MPa)</td><td class="num">' + fmt(j.preload.Fproof / 1000, 1) + ' kN</td></tr>' +
      '<tr><td>Target preload (' + fmt(inp.preloadPct) + ' % of proof)</td><td class="num">' + fmt(j.preload.F / 1000, 1) + ' kN</td></tr>' +
      '<tr><td>Nut factor K</td><td class="num">' + fmt(j.K, 2) + '</td></tr>' +
      '<tr class="highlight"><td><strong>Tightening torque T = K·F·d</strong></td><td class="num"><strong>' + fmt(j.torque, j.torque < 20 ? 1 : 0) + ' N·m</strong></td></tr>' +
      '<tr><td>Overlap ' + fmt(inp.width) + ' × ' + fmt(j.overlap) + ' mm — mean contact pressure</td><td class="num">' + fmt(j.pContact, 1) + ' N/mm²</td></tr>' +
      '<tr><td>Washer bearing pressure (' + esc(j.washer.label.split(' + ').pop()) + ', Ø' + j.washerOD + ')</td><td class="num">' + fmt(j.pBear) + ' MPa ' + badge(bearOk, '≤ Rp', '> Rp') + '</td></tr>' +
      '</table>' +
      (j.notes.length ? '<ul class="notes">' + j.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
      '</div><div><table class="data"><tr><th>Size</th><th class="r">Preload</th><th class="r">Torque</th></tr>' + rows + '</table>' +
      '<p class="muted" style="font-size:12px">Torques for ' + esc(BC.GRADES[inp.grade].label) + ', ' + esc(BC.LUBRICATION[inp.lube].label.toLowerCase()) + ', ' + fmt(inp.preloadPct) + ' % proof load. Always follow the joint/bolt manufacturer\'s values where given; use a calibrated torque wrench and mark bolts after tightening.</p></div></div>' +
      '<ul class="notes muted"><li>Contact surfaces: clean, flat, free of oxide; tin- or silver-plate for operating temperatures above ~90 °C. For Cu–Al joints use bimetallic plates or plated aluminium.</li>' +
      '<li>Lap overlap should be at least the bar width (or 5–6 × thickness for narrow bars) for joint resistance ≤ that of the same length of bar.</li>' +
      '<li>Re-check torque after the first thermal cycles (or use conical spring washers sized for the bolt preload).</li></ul></details>';
  }

  function autosizePanel() {
    return '<details class="card panel" id="autosize-panel" open><summary><span>Section finder</span></summary>' +
      '<p class="lead">Searches standard bar sizes (1–4 bars per phase) with the current enclosure, short-circuit and support settings and lists the lightest sections that pass every check. Click a row to apply it.</p>' +
      '<button type="button" class="btn btn-primary" data-action="autosize">Find suitable standard sections</button>' +
      '<div id="autosize-out" style="margin-top:12px">' + (autosizeStale ? '' : autosizeHTML) + '</div></details>';
  }

  function methodPanel() {
    return '<details class="card panel method"><summary><span>Method, assumptions and references</span></summary>' +
      '<h4>1. Internal air temperature</h4><p>θ<sub>air</sub> = θ<sub>room</sub> + ΔT<sub>IP</sub> × position factor + ΔT<sub>form</sub>, or a specified/measured value. ΔT values are editable engineering defaults; for a formal design use IEC TR 60890 or test data.</p>' +
      '<h4>2. Continuous rating</h4><p>Steady-state heat balance per metre of phase conductor: <span class="formula">k<sub>ac</sub>·R<sub>dc</sub>(θ)·I² = Σ h<sub>i</sub>A<sub>i</sub>(θ−θ<sub>air</sub>)·f<sub>form</sub> + εσ(T⁴−T<sub>air</sub>⁴)·P<sub>rad</sub></span>. Natural convection: Churchill–Chu (vertical faces), McAdams (horizontal faces), Bar-Cohen–Rohsenow (vertical channels between parallel bars); air properties at film temperature and at site pressure (altitude). Radiation from the outer envelope of each phase pack, less the view factor to adjacent phases. Resistance uses ρ<sub>20</sub> from %IACS and the temperature coefficient α<sub>20</sub>.</p>' +
      '<h4>3. AC resistance and current sharing</h4><p>Each bar is divided into filaments; a 2-D partial-inductance (PEEC) model of all three phases is solved with balanced phase currents. This yields skin and proximity effect (R<sub>ac</sub>/R<sub>dc</sub>), the current share of each parallel bar and the phase impedance.</p>' +
      '<h4>4. Short-circuit thermal</h4><p>Adiabatic heating from the operating temperature θᵢ to θ<sub>f</sub>: <span class="formula">S<sub>min</sub> = I<sub>cw</sub>√t / k</span> with k = K·√ln((θ<sub>f</sub>+β)/(θᵢ+β)), K = √(Q<sub>c</sub>(β+20)/ρ<sub>20</sub>) (IEC 60949). Recommended θ<sub>f</sub>: 200 °C copper, 180 °C aluminium (IEC 60865-1).</p>' +
      '<h4>5. Short-circuit forces (IEC 60865-1 simplified method)</h4><p>i<sub>p</sub> = n·I<sub>cw</sub> with n from IEC 61439-1 Table 7. Centre-phase force F<sub>m3</sub> = (μ₀/2π)(√3/2)i<sub>p</sub>²l/a<sub>m</sub>; sub-conductor force F<sub>s</sub> = (μ₀/2π)(i<sub>p</sub>/n)²lₛ/aₛ. Effective distances a<sub>m</sub>, aₛ are integrated numerically for the actual rectangular sections. Stresses σ<sub>m</sub> = V<sub>σ</sub>V<sub>r</sub>βF<sub>m3</sub>l/(8Z<sub>m</sub>), σₛ = V<sub>σ</sub>V<sub>r</sub>Fₛlₛ/(16Zₛ); require σ<sub>tot</sub> ≤ q·R<sub>p0.2</sub> and σₛ ≤ R<sub>p0.2</sub>. Support force F<sub>d</sub> = V<sub>F</sub>V<sub>r</sub>·α·F<sub>m3</sub>. Natural-frequency (dynamic) reduction factors are not applied (conservative).</p>' +
      '<h4>6. Bolted joints</h4><p>Preload F = (% of proof)·A<sub>s</sub>·R<sub>p</sub> (ISO 898-1 / ISO 3506-1); torque <span class="formula">T = K·F·d</span>. Bolt patterns follow common practice (cf. DIN 43673 / CDA Pub. 22). Checks: mean contact pressure over the overlap and washer bearing pressure vs. the bar\'s 0.2 % proof stress.</p>' +
      '<h4>7. Clearances, creepage and deflection</h4><p>Minimum clearance = IEC 61439-1 Table 1 value for Uimp × altitude factor (IEC 60664-1 Table A.2, 1.00 up to 2000 m). Creepage follows Table 2 (Uᵢ, pollution degree, material group; 660/690 V use the 630 V row) and is never less than the clearance (clause 8.3.3). Per clauses 8.3.1 and 10.11.5.5 a fault must not permanently reduce these distances. The main conductor deflects elastically: δ = Vσ·Vr·k·F<sub>m3</sub>/l·l⁴/(E·I), with k = 5/384 simply supported, 1/384 fixed, 0.00677 for a continuous beam of 3 or more spans. Phase-to-phase clearance is reduced by 2δ, the enclosure distance by δ.</p><h4>8. Busbar support system</h4><p>Bar mass = density × section × number of bars (all poles). The weight per support follows beam theory (m·g·l·α) and the sag is δ = k·w·l⁴/(E·I). The short-circuit load per support F<sub>d</sub> comes from section 5. In a slotted support each bar edge sits in a slot of depth d: the slot wall is a cantilever (bending M = F·d/2 with Z = w·t²/6, shear F/(t·w)) and the body between the phase slots carries F<sub>d</sub>/2 in tension over its remaining thickness. Flat clamp blocks rely on friction: clamp force per bar = F<sub>d</sub>/(2·μ·n). Fixing bolts carry the vector sum of short-circuit force and weight in shear. Thermal movement ΔL = α·L·Δθ. Creepage over ribs follows IEC 61439-1 Annex F (grooves at least X wide, Table F.1; ribs at least 2 mm high).</p><h4>9. Arc flash (IEEE 1584-2018)</h4><p>Empirical model for three-phase AC at 208 V to 15 kV. The intermediate arcing current comes from equation 1 for the electrode configuration (VCB, VCBB, HCB, VOA, HOA), gap and bolted fault current; below 600 V the final arcing current follows from equation 25. The minimum arcing current applies the variation factor of Table 2 (equation 2). Incident energy at the working distance uses equations 3 to 6 and the enclosure size correction factor of Tables 6 and 7 (equations 11 to 15). Between 600 V and 14.3 kV the results are interpolated (equations 16 to 24). The arc flash boundary is the distance at which the energy reaches 1.2 cal/cm². The energy is worked out at maximum and minimum arcing current, and the larger value is reported. The model is valid for arcing times the protection can actually deliver and for the ranges listed in the standard; inputs outside those ranges are refused.</p><h4>Not covered</h4><ul><li>Formal IEC 61439-1 design verification (Clause 10.10 temperature rise, 10.11 short-circuit) — this tool supports, but does not replace, it.</li><li>Heat from adjacent devices, solar gain, forced ventilation, harmonic content (use the derating factor), DC systems, neutral/PE sizing, arc-fault containment testing (IEC TR 61641), deformation of the enclosure or barriers, vibration and seismic loads on the supports.</li><li>Plume interaction between phases stacked vertically.</li><li>Each phase pack is treated as one isothermal body: uneven current sharing is included in the phase loss, but the bar carrying the largest share may run a few kelvin hotter than reported.</li></ul>' +
      '<h4>References</h4><ul><li>IEC 61439-1/-2 — Low-voltage switchgear and controlgear assemblies.</li><li>IEC 60865-1 — Short-circuit currents: calculation of effects.</li><li>IEC 60949 — Thermally permissible short-circuit currents.</li><li>IEEE 1584-2018 — Guide for performing arc-flash hazard calculations. Coefficients checked against the open-source implementation github.com/LiaungYip/arcflash (MIT) and the Annex D examples.</li><li>NFPA 70E — Standard for electrical safety in the workplace (PPE categories).</li><li>IEC TR 60890 — Temperature-rise verification by calculation.</li><li>Copper Development Association Publication 22 — Copper for busbars.</li><li>DIN 43671 (ampacity tables), DIN 43673 (busbar drillings).</li></ul></details>';
  }

  function inputsSummary(r) {
    var rows = SECTIONS.filter(function (s) { return !s.custom; }).map(function (sec) {
      return sec.fields.filter(function (f) { return !f.show || f.show(state); }).map(function (f) {
        var v = state[f.id];
        if (f.type === 'select') { var o = optionsFor(f).filter(function (x) { return String(x[0]) === String(v); })[0]; v = o ? o[1] : v; }
        return '<tr><td>' + esc(sec.title) + '</td><td>' + esc(f.label) + '</td><td>' + esc(v) + (f.unit ? ' ' + esc(f.unit) : '') + '</td></tr>';
      }).join('');
    }).join('');
    return '<details class="card panel"><summary><span>Input summary</span></summary><div class="table-scroll"><table class="data">' + rows + '</table></div></details>';
  }

  // ------------------------------------------------------------ auto-size
  function runAutosize() {
    var out = $('#autosize-out');
    out.innerHTML = '<p class="muted">Searching ' + (BC.STANDARD_SIZES.length * 4) + ' combinations…</p>';
    setTimeout(function () {
      var res = BC.autoSize(toInputs(state), 8);
      if (!res.candidates.length) {
        autosizeHTML = '<div class="banner bad"><span class="icon">✕</span><div><h2>No standard section passes</h2><p>Try a larger phase spacing, shorter support span, intermediate spacers, a higher temperature limit, better ventilation (IP / form) or busbar trunking.</p></div></div>';
      } else {
        autosizeHTML = '<div class="table-scroll"><table class="data"><tr><th>Section</th><th class="r">Area</th><th class="r">I<sub>perm</sub></th><th class="r">Utilisation</th><th class="r">Temp. at Iₙ</th><th class="r">σ/limit</th><th class="r">Max span</th></tr>' +
          res.candidates.map(function (c, i) {
            return '<tr class="click' + (i === 0 ? ' highlight' : '') + '" data-apply="' + c.width + ',' + c.thick + ',' + c.n + ',' + c.gap + '" title="Apply this section">' +
              '<td>' + (c.n > 1 ? c.n + ' × ' : '') + c.width + ' × ' + c.thick + (i === 0 ? ' <span class="badge ok">lightest</span>' : '') + '</td>' +
              '<td class="num">' + fmt(c.n * c.width * c.thick) + ' mm²</td><td class="num">' + fmt(c.Iperm) + ' A</td><td class="num">' + fmt(c.util * 100) + ' %</td>' +
              '<td class="num">' + fmt(c.Top, 1) + ' °C</td><td class="num">' + fmt(c.mechUtil * 100) + ' %</td><td class="num">' + fmt(c.lmax) + ' mm</td></tr>';
          }).join('') + '</table></div><p class="muted" style="font-size:12px">Screening uses a coarser current-distribution mesh; the full result is recalculated when you apply a row. Gap between bars = max(thickness, current gap setting).</p>';
      }
      autosizeStale = false;
      out.innerHTML = autosizeHTML;
    }, 20);
  }

  function bindResults() {
    var host = $('#results');
    host.onclick = function (e) {
      var a = e.target.closest('[data-action]');
      if (a && a.dataset.action === 'autosize') { runAutosize(); return; }
      if (a && a.dataset.action === 'autosize-jump') { var p = $('#autosize-panel'); p.open = true; p.scrollIntoView({ behavior: 'smooth', block: 'start' }); runAutosize(); return; }
      var row = e.target.closest('[data-apply]');
      if (row) {
        var v = row.dataset.apply.split(',');
        setField('width', v[0]); setField('thick', v[1]); setField('nBars', v[2]); setField('gap', v[3]);
        refreshVisibility(); writeHash(); run();
        toast('Applied ' + (v[2] > 1 ? v[2] + ' × ' : '') + v[0] + ' × ' + v[1] + ' mm');
      }
    };
  }

  // ------------------------------------------------------------ chrome
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function bindChrome() {
    $('#btn-share').addEventListener('click', function () {
      writeHash();
      var url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast('Link with your inputs copied'); }, function () { prompt('Copy this link:', url); });
      } else { prompt('Copy this link:', url); }
    });
    $('#btn-print').addEventListener('click', function () { window.print(); });
    $('#btn-reset').addEventListener('click', function () {
      state = defaultState(); autosizeStale = true;
      history.replaceState(null, '', location.pathname + location.search);
      renderForm(); run(); toast('Inputs reset to defaults');
    });
    var opened = [];
    window.addEventListener('beforeprint', function () {
      opened = [];
      document.querySelectorAll('#results details:not([open])').forEach(function (d) { opened.push(d); d.open = true; });
    });
    window.addEventListener('afterprint', function () { opened.forEach(function (d) { d.open = false; }); });
    window.addEventListener('hashchange', function () {
      state = defaultState(); readHash(); autosizeStale = true;
      renderForm(); run();
    });
    $('#version').textContent = 'Engine v' + BC.version + '.';
  }

  // ------------------------------------------------------------ boot
  readHash();
  renderForm();
  bindForm();
  bindChrome();
  run();
})();
