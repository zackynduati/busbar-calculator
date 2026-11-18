/*!
 * Busbar sizing engine
 * --------------------------------------------------------------------------
 *  - Continuous rating from a steady-state heat balance (natural convection +
 *    radiation) at the busbar's internal air temperature, with enclosure
 *    (IP rating / form of separation / altitude) effects.
 *  - AC resistance (skin + proximity effect) and current sharing between
 *    parallel bars from a 2-D filament (PEEC) solution of the 3-phase system.
 *  - Short-circuit thermal withstand (adiabatic, IEC 60949 / IEC 60865-1).
 *  - Short-circuit electromagnetic forces, conductor stresses, support forces
 *    and maximum support span (IEC 60865-1 simplified method).
 *  - Bolted joint: bolt pattern, preload, tightening torque, contact and
 *    washer bearing pressure.
 *
 * Internally everything is SI (m, A, W, N, Pa, K). The public calculate()
 * function takes "engineering" units (mm, kA, °C, MPa) – see DEFAULT_INPUTS.
 *
 * Works in the browser (window.BusbarCalc) and in Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.BusbarCalc = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  var KMU = 2e-7;                    // μ0 / 2π  [H/m]
  var SIGMA_SB = 5.670374419e-8;     // Stefan–Boltzmann [W/m²K⁴]
  var G0 = 9.80665;                  // gravity [m/s²]
  var RHO_IACS = 1.7241e-8;          // resistivity of 100 % IACS copper at 20 °C [Ω·m]

  var MATERIALS = {
    Cu: {
      label: 'Copper',
      iacs: 100, alpha20: 0.00393,           // conductivity %IACS, temp. coeff. at 20 °C [1/K]
      Qc: 3.45e6, B: 234.5,                  // vol. heat capacity [J/(K·m³)], reciprocal temp. coeff. [K] (IEC 60949)
      thetaSC: 200,                          // recommended max. temperature during short circuit [°C]
      tempers: [
        { id: 'R200', label: 'Cu-ETP R200 (soft / annealed)', rp: 70, iacs: 100 },
        { id: 'R240', label: 'Cu-ETP R240 (half-hard)', rp: 180, iacs: 100 },
        { id: 'R290', label: 'Cu-ETP R290 (hard)', rp: 250, iacs: 100 }
      ]
    },
    Al: {
      label: 'Aluminium',
      iacs: 61, alpha20: 0.00403,
      Qc: 2.5e6, B: 228,
      thetaSC: 180,
      tempers: [
        { id: '1350', label: 'EN AW-1350 (H12/H22)', rp: 50, iacs: 61 },
        { id: '6101T6', label: 'EN AW-6101 T6', rp: 160, iacs: 55 }
      ]
    }
  };

  var STANDARD_SIZES = [
    [20, 5], [25, 5], [30, 5], [40, 5], [50, 5], [60, 5], [80, 5], [100, 5],
    [20, 10], [30, 10], [40, 10], [50, 10], [60, 10], [80, 10], [100, 10], [120, 10], [160, 10], [200, 10]
  ];

  var FINISHES = {
    bright:   { label: 'Bare or tin-plated – bright / new', eps: 0.10 },
    oxidised: { label: 'Bare – normally oxidised (aged)', eps: 0.40 },
    painted:  { label: 'Painted matt / heat-shrink sleeved', eps: 0.90 },
    custom:   { label: 'Custom emissivity', eps: null }
  };

  // Enclosure defaults – engineering assumptions, editable in the UI.
  var IP_CLASSES = ['IP20', 'IP31', 'IP41', 'IP42', 'IP43', 'IP54', 'IP55', 'IP65', 'IP66'];
  // Typical air-temperature rise at the TOP of a fully loaded enclosure above room ambient [K]
  var IP_RISE_DEFAULT = { IP20: 8, IP31: 10, IP41: 12, IP42: 15, IP43: 17, IP54: 20, IP55: 22, IP65: 25, IP66: 25 };
  var FORMS = ['1', '2a', '2b', '3a', '3b', '4a', '4b'];
  // Extra air-temperature rise inside the busbar compartment [K]
  var FORM_RISE_DEFAULT = { '1': 0, '2a': 1, '2b': 2, '3a': 3, '3b': 4, '4a': 5, '4b': 6 };
  // Multiplier on the natural-convection coefficient (confined compartment, restricted air flow)
  var FORM_CONV_DEFAULT = { '1': 1.00, '2a': 0.97, '2b': 0.95, '3a': 0.92, '3b': 0.88, '4a': 0.85, '4b': 0.82 };
  // Fraction of the top-of-enclosure rise seen at the busbar location (cf. IEC TR 60890 temperature profile)
  var LOCATION_FACTOR = { top: 1.0, middle: 0.75, bottom: 0.5 };

  // IEC 61439-1 Table 7 – ratio n = peak / r.m.s. short-circuit current
  var PEAK_TABLE = [
    { maxkA: 5, cos: 0.7, n: 1.5 },
    { maxkA: 10, cos: 0.5, n: 1.7 },
    { maxkA: 20, cos: 0.3, n: 2.0 },
    { maxkA: 50, cos: 0.25, n: 2.1 },
    { maxkA: Infinity, cos: 0.2, n: 2.2 }
  ];

  // IEC 61439-1 Table 1 – minimum clearance in air (case A, pollution degree 3) [mm]
  var CLEARANCE_TABLE = { 2.5: 1.5, 4: 3, 6: 5.5, 8: 8, 12: 14 };

  // IEC 60865-1 Table 3 – factors β (stress) and α (support force)
  var SUPPORTS = {
    ss:    { label: 'Single span, both ends simply supported', beta: 1.0, alphaA: 0.5, alphaB: 0.5 },
    fs:    { label: 'Single span, one end fixed / one simply supported', beta: 0.73, alphaA: 0.625, alphaB: 0.375 },
    ff:    { label: 'Single span, both ends fixed', beta: 0.5, alphaA: 0.5, alphaB: 0.5 },
    cont2: { label: 'Continuous beam, 2 spans', beta: 0.73, alphaA: 0.375, alphaB: 1.25 },
    cont3: { label: 'Continuous beam, 3 or more spans', beta: 0.73, alphaA: 0.4, alphaB: 1.1 }
  };

  // Metric coarse bolts: nominal d, tensile stress area As [mm²], clearance hole (medium) and washer ODs [mm]
  var BOLTS = {
    M6:  { d: 6,  As: 20.1, hole: 6.6,  iso7089: 12, iso7093: 18, din6796: 14 },
    M8:  { d: 8,  As: 36.6, hole: 9,    iso7089: 16, iso7093: 24, din6796: 18 },
    M10: { d: 10, As: 58.0, hole: 11,   iso7089: 20, iso7093: 30, din6796: 23 },
    M12: { d: 12, As: 84.3, hole: 13.5, iso7089: 24, iso7093: 37, din6796: 29 },
    M16: { d: 16, As: 157,  hole: 17.5, iso7089: 30, iso7093: 50, din6796: 39 },
    M20: { d: 20, As: 245,  hole: 22,   iso7089: 37, iso7093: 60, din6796: 45 }
  };

  // Proof / 0.2 % proof stress [MPa] (ISO 898-1, ISO 3506-1)
  var GRADES = {
    '8.8':   { label: 'Steel 8.8', proof: function (d) { return d <= 16 ? 580 : 600; } },
    '10.9':  { label: 'Steel 10.9', proof: function () { return 830; } },
    'A2-70': { label: 'Stainless A2-70', proof: function () { return 450; } },
    'A4-70': { label: 'Stainless A4-70', proof: function () { return 450; } },
    'A4-80': { label: 'Stainless A4-80', proof: function () { return 600; } }
  };

  // Nut factor K in T = K·F·d
  var LUBRICATION = {
    mos2:  { label: 'MoS₂ paste / wax lubricated', K: 0.12 },
    oiled: { label: 'Lightly oiled', K: 0.15 },
    zinc:  { label: 'Zinc plated, as received', K: 0.17 },
    dry:   { label: 'Dry, plain / black oxide', K: 0.20 },
    ssdry: { label: 'Stainless, dry (use anti-seize!)', K: 0.25 }
  };

  var WASHERS = {
    iso7089:      { label: 'ISO 7089 flat washer', bearing: 'iso7089', spring: false },
    iso7093:      { label: 'ISO 7093 large flat washer', bearing: 'iso7093', spring: false },
    din6796:      { label: 'DIN 6796 conical spring + ISO 7089 flat', bearing: 'iso7089', spring: true },
    din6796large: { label: 'DIN 6796 conical spring + ISO 7093 large flat', bearing: 'iso7093', spring: true }
  };

  var DEFAULT_INPUTS = {
    // system
    In: 2500, freq: 50, Icw: 55, tk: 1, peakMode: 'auto', peakFactor: 2.2, Uimp: 8,
    // conductor
    material: 'Cu', temper: 'R240', rp: 180, iacs: 100,
    width: 100, thick: 10, nBars: 2, gap: 10, finish: 'bright', eps: 0.1,
    // arrangement
    mounting: 'edgewise', runLength: 1000, arrangement: 'face', phaseSpacing: 150,
    // enclosure & environment
    Troom: 35, altitude: 0, ip: 'IP42', form: '3b', location: 'top',
    internalMode: 'estimate', Tinternal: 50, Tmax: 100, derate: 1.0,
    // short-circuit mechanics
    support: 'cont3', span: 400, spacer: 400, vsvr: 1.0, vfvr: 2.7, q: 1.5,
    // short-circuit thermal
    thetaSC: 200,
    // bolted joint
    boltSize: 'auto', boltCount: 'auto', grade: '8.8', lube: 'zinc', preloadPct: 70,
    washer: 'din6796', overlap: 0,
    // enclosure assumption tables
    ipRise: Object.assign({}, IP_RISE_DEFAULT),
    formRise: Object.assign({}, FORM_RISE_DEFAULT),
    formConv: Object.assign({}, FORM_CONV_DEFAULT)
  };

  // ------------------------------------------------------------- utilities
  function peakFactor(IkA) {
    for (var i = 0; i < PEAK_TABLE.length; i++) {
      if (IkA <= PEAK_TABLE[i].maxkA) return PEAK_TABLE[i];
    }
    return PEAK_TABLE[PEAK_TABLE.length - 1];
  }

  function minClearance(UimpkV) {
    var keys = Object.keys(CLEARANCE_TABLE).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < keys.length; i++) if (UimpkV <= keys[i]) return CLEARANCE_TABLE[keys[i]];
    return CLEARANCE_TABLE[keys[keys.length - 1]];
  }

  function airPressure(altitude) {
    return 101325 * Math.pow(1 - 2.25577e-5 * Math.max(0, altitude), 5.25588);
  }

  // Dry-air properties at film temperature TK [K] and pressure p [Pa]
  function airProps(TK, p) {
    var T15 = Math.pow(TK, 1.5);
    var mu = 1.458e-6 * T15 / (TK + 110.4);       // Sutherland
    var k = 2.334e-3 * T15 / (TK + 164.54);       // thermal conductivity
    var rho = p / (287.05 * TK);
    var Pr = 0.71;
    var nu = mu / rho;
    return { mu: mu, k: k, rho: rho, Pr: Pr, nu: nu, alpha: nu / Pr, beta: 1 / TK };
  }

  function rayleigh(air, dT, L) {
    return G0 * air.beta * dT * L * L * L / (air.nu * air.alpha);
  }

  // Vertical isothermal plate – Churchill & Chu
  function hVertical(air, dT, L) {
    var Ra = rayleigh(air, dT, L);
    var f = 1 + Math.pow(0.492 / air.Pr, 9 / 16);
    var Nu = Ra < 1e9
      ? 0.68 + 0.670 * Math.pow(Ra, 0.25) / Math.pow(f, 4 / 9)
      : Math.pow(0.825 + 0.387 * Math.pow(Ra, 1 / 6) / Math.pow(f, 8 / 27), 2);
    return Nu * air.k / L;
  }

  // Horizontal hot surface facing up (L = area / perimeter)
  function hUpward(air, dT, L) {
    var Ra = rayleigh(air, dT, L);
    var Nu = Ra <= 1e7 ? 0.54 * Math.pow(Ra, 0.25) : 0.15 * Math.pow(Ra, 1 / 3);
    return Nu * air.k / L;
  }

  // Horizontal hot surface facing down
  function hDownward(air, dT, L) {
    var Ra = rayleigh(air, dT, L);
    return 0.27 * Math.pow(Ra, 0.25) * air.k / L;
  }

  // Vertical channel between two isothermal plates (Bar-Cohen & Rohsenow), spacing s, height L
  function hChannel(air, dT, s, L) {
    var El = rayleigh(air, dT, s) * s / L;
    var Nu = Math.pow(576 / (El * El) + 2.873 / Math.sqrt(El), -0.5);
    return Nu * air.k / s;
  }

  // ------------------------------------------------------- heat dissipation
  // Convective surfaces of one phase pack per metre run. g in metres.
  function convectionSurfaces(g, mounting, runLength, air, dT) {
    var h = g.h, t = g.t, n = g.n, s = g.s, items = [];
    if (mounting === 'edgewise') {
      items.push({ key: 'outer', label: 'Outer wide faces (vertical)', h: hVertical(air, dT, h), area: 2 * h });
      if (n > 1) items.push({ key: 'inner', label: 'Inner faces (vertical channels)', h: hChannel(air, dT, s, h), area: 2 * (n - 1) * h });
      items.push({ key: 'top', label: 'Top edges', h: hUpward(air, dT, t / 2), area: n * t });
      items.push({ key: 'bottom', label: 'Bottom edges', h: hDownward(air, dT, t / 2), area: n * t });
    } else if (mounting === 'flat') {
      items.push({ key: 'top', label: 'Top wide face (facing up)', h: hUpward(air, dT, h / 2), area: h });
      items.push({ key: 'bottom', label: 'Bottom wide face (facing down)', h: hDownward(air, dT, h / 2), area: h });
      if (n > 1) items.push({ key: 'inner', label: 'Inner faces (horizontal gaps, ×0.5)', h: 0.5 * hDownward(air, dT, h / 2), area: 2 * (n - 1) * h });
      items.push({ key: 'edges', label: 'Side edges (vertical)', h: hVertical(air, dT, t), area: 2 * n * t });
    } else { // vertical run (riser / dropper)
      var hv = hVertical(air, dT, runLength);
      items.push({ key: 'outer', label: 'Outer wide faces (vertical run)', h: hv, area: 2 * h });
      if (n > 1) items.push({ key: 'inner', label: 'Inner faces (vertical channels)', h: hChannel(air, dT, s, runLength), area: 2 * (n - 1) * h });
      items.push({ key: 'edges', label: 'Edges (vertical run)', h: hv, area: 2 * n * t });
    }
    return items;
  }

  // Effective radiating perimeter of a phase pack [m], allowing for the
  // neighbouring phase(s) (assumed at the same temperature) blocking part of the view.
  function radiationPerimeter(g, phaseIdx) {
    var neighbours = phaseIdx === 1 ? 2 : 1;
    var envelope = 2 * g.h + 2 * g.D;
    var facing, c;
    if (g.arr === 'face') { facing = g.h; c = Math.max(g.a - g.D, 1e-4); }
    else { facing = g.D; c = Math.max(g.a - g.h, 1e-4); }
    var F = Math.sqrt(1 + (c / facing) * (c / facing)) - c / facing; // parallel strips view factor
    return { perimeter: envelope - neighbours * F * facing, envelope: envelope, viewFactor: F, neighbours: neighbours };
  }

  function heatLoss(Tb, Ta, g, env, radPerimeter) {
    var dT = Math.max(Tb - Ta, 1e-3);
    var film = (Tb + Ta) / 2 + 273.15;
    var air = airProps(film, env.p);
    var items = convectionSurfaces(g, env.mounting, env.runLength, air, dT);
    var G = 0;
    items.forEach(function (it) { G += it.h * it.area; });
    var conv = G * dT * env.convFactor;
    var TbK = Tb + 273.15, TaK = Ta + 273.15;
    var rad = env.eps * SIGMA_SB * (Math.pow(TbK, 4) - Math.pow(TaK, 4)) * radPerimeter;
    return { conv: conv, rad: rad, total: conv + rad, items: items, air: air };
  }

  // ---------------------------------------------------- complex linear solve
  function solveComplex(M, Are, Aim, bre, bim) {
    var r, c, k, i;
    for (c = 0; c < M; c++) {
      var piv = c, best = -1;
      for (r = c; r < M; r++) {
        i = r * M + c;
        var mag = Are[i] * Are[i] + Aim[i] * Aim[i];
        if (mag > best) { best = mag; piv = r; }
      }
      if (!(best > 0)) throw new Error('Singular matrix in current-distribution solve');
      if (piv !== c) {
        for (k = c; k < M; k++) {
          var a1 = c * M + k, a2 = piv * M + k, tr = Are[a1], ti = Aim[a1];
          Are[a1] = Are[a2]; Aim[a1] = Aim[a2]; Are[a2] = tr; Aim[a2] = ti;
        }
        var t1 = bre[c]; bre[c] = bre[piv]; bre[piv] = t1;
        t1 = bim[c]; bim[c] = bim[piv]; bim[piv] = t1;
      }
      var pr = Are[c * M + c], pi = Aim[c * M + c], den = pr * pr + pi * pi;
      var ir = pr / den, ii = -pi / den;
      var rowC = c * M;
      for (r = c + 1; r < M; r++) {
        var rowR = r * M, ar = Are[rowR + c], ai = Aim[rowR + c];
        if (ar === 0 && ai === 0) continue;
        var fr = ar * ir - ai * ii, fi = ar * ii + ai * ir;
        for (k = c; k < M; k++) {
          var cr = Are[rowC + k], ci = Aim[rowC + k];
          if (cr === 0 && ci === 0) continue;
          Are[rowR + k] -= fr * cr - fi * ci;
          Aim[rowR + k] -= fr * ci + fi * cr;
        }
        bre[r] -= fr * bre[c] - fi * bim[c];
        bim[r] -= fr * bim[c] + fi * bre[c];
      }
    }
    var xr = new Float64Array(M), xi = new Float64Array(M);
    for (r = M - 1; r >= 0; r--) {
      var sr = bre[r], si = bim[r], row = r * M;
      for (k = r + 1; k < M; k++) {
        var mr = Are[row + k], mi = Aim[row + k];
        sr -= mr * xr[k] - mi * xi[k];
        si -= mr * xi[k] + mi * xr[k];
      }
      var dr = Are[row + r], di = Aim[row + r], dd = dr * dr + di * di;
      xr[r] = (sr * dr + si * di) / dd;
      xi[r] = (si * dr - sr * di) / dd;
    }
    return { re: xr, im: xi };
  }

  // -------------------------------------- AC current distribution (PEEC 2-D)
  function emMesh(n, tmm, coarse) {
    if (coarse) return { nu: 2, nv: 8 };
    var budget = Math.floor(420 / (3 * n));
    var nu = Math.min(4, Math.max(2, Math.round(tmm / 3)));
    var nv = Math.min(24, Math.max(6, Math.floor(budget / nu)));
    return { nu: nu, nv: nv };
  }

  // Bar centre position along the stacking (thickness) direction within a pack
  function barOffset(g, i) { return -g.D / 2 + g.t / 2 + i * (g.t + g.s); }

  function solveCurrentDistribution(g, rho, freq, mesh) {
    var n = g.n, h = g.h, t = g.t;
    var du = t / mesh.nu, dv = h / mesh.nv;
    var X = [], Y = [], PH = [], BAR = [];
    var p, i, iu, iv, k, m;
    for (p = 0; p < 3; p++) {
      var pc = (p - 1) * g.a;
      for (i = 0; i < n; i++) {
        var uc = barOffset(g, i);
        for (iu = 0; iu < mesh.nu; iu++) {
          for (iv = 0; iv < mesh.nv; iv++) {
            var u = uc - t / 2 + (iu + 0.5) * du, v = -h / 2 + (iv + 0.5) * dv;
            if (g.arr === 'face') { X.push(pc + u); Y.push(v); } else { X.push(u); Y.push(pc + v); }
            PH.push(p); BAR.push(i);
          }
        }
      }
    }
    var N = X.length, M = N + 3;
    var Are = new Float64Array(M * M), Aim = new Float64Array(M * M);
    var bre = new Float64Array(M), bim = new Float64Array(M);
    var w = 2 * Math.PI * freq, Rf = rho / (du * dv), gmd = 0.2235 * (du + dv);
    var wk = w * KMU;
    for (k = 0; k < N; k++) {
      var rowK = k * M;
      Aim[rowK + k] = -wk * Math.log(gmd);
      Are[rowK + k] = Rf;
      for (m = k + 1; m < N; m++) {
        var dx = X[k] - X[m], dy = Y[k] - Y[m];
        var val = -wk * 0.5 * Math.log(dx * dx + dy * dy);
        Aim[rowK + m] = val;
        Aim[m * M + k] = val;
      }
      Are[rowK + N + PH[k]] = -1;
      Are[(N + PH[k]) * M + k] = 1;
    }
    var ang = [0, -2 * Math.PI / 3, 2 * Math.PI / 3];
    for (p = 0; p < 3; p++) { bre[N + p] = Math.cos(ang[p]); bim[N + p] = Math.sin(ang[p]); }
    var sol = solveComplex(M, Are, Aim, bre, bim);

    var Rdc = rho / (n * h * t);
    var kac = [0, 0, 0], shares = [], Z = [];
    for (p = 0; p < 3; p++) { shares.push(new Array(n).fill(0).map(function () { return { re: 0, im: 0 }; })); }
    var fil = [];
    var areaRef = n * h * t;
    for (k = 0; k < N; k++) {
      var ire = sol.re[k], iim = sol.im[k], mag2 = ire * ire + iim * iim;
      kac[PH[k]] += Rf * mag2;
      shares[PH[k]][BAR[k]].re += ire;
      shares[PH[k]][BAR[k]].im += iim;
      fil.push({ x: X[k], y: Y[k], p: PH[k], bar: BAR[k], jrel: Math.sqrt(mag2) / (du * dv) * areaRef });
    }
    for (p = 0; p < 3; p++) {
      kac[p] /= Rdc;
      shares[p] = shares[p].map(function (c) { return Math.sqrt(c.re * c.re + c.im * c.im); });
      // Z = V / I with |I| = 1  ->  V · conj(I)
      var vr = sol.re[N + p], vi = sol.im[N + p], cr = Math.cos(ang[p]), ci = Math.sin(ang[p]);
      Z.push({ R: vr * cr + vi * ci, X: vi * cr - vr * ci });
    }
    return { kac: kac, shares: shares, Z: Z, filaments: fil, du: du, dv: dv, Rdc: Rdc, mesh: mesh };
  }

  function dcDistribution(g, rho) {
    var Rdc = rho / (g.n * g.h * g.t);
    var shares = [0, 1, 2].map(function () { return new Array(g.n).fill(1 / g.n); });
    return { kac: [1, 1, 1], shares: shares, Z: [0, 1, 2].map(function () { return { R: Rdc, X: 0 }; }), filaments: [], Rdc: Rdc, mesh: null };
  }

  // ---------------------------------------- electromagnetic force geometry
  function rectPoints(cx, cy, wx, wy, nx, ny) {
    var pts = [];
    for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
      pts.push([cx - wx / 2 + (i + 0.5) * wx / nx, cy - wy / 2 + (j + 0.5) * wy / ny]);
    }
    return pts;
  }

  // Mean of (r·e)/|r|² over all point pairs  ->  force per metre = (μ0/2π)·I_A·I_B·factor
  function pairFactor(A, B, ex, ey) {
    var s = 0;
    for (var i = 0; i < A.length; i++) {
      var ax = A[i][0], ay = A[i][1];
      for (var j = 0; j < B.length; j++) {
        var dx = B[j][0] - ax, dy = B[j][1] - ay;
        s += (dx * ex + dy * ey) / (dx * dx + dy * dy);
      }
    }
    return s / (A.length * B.length);
  }

  function packPoints(g, centre, nx, ny) {
    var pts = [];
    for (var i = 0; i < g.n; i++) {
      var u = barOffset(g, i);
      var c = g.arr === 'face' ? [centre + u, 0] : [u, centre];
      pts = pts.concat(rectPoints(c[0], c[1], g.t, g.h, nx, ny));
    }
    return pts;
  }

  function mechanical(g, inp, rp, coarse) {
    var res = {};
    var pk = inp.peakMode === 'manual' ? { n: inp.peakFactor, cos: null } : peakFactor(inp.Icw);
    var ip = pk.n * inp.Icw * 1000;             // A
    var l = inp.span / 1000, ls = (g.n > 1 ? Math.min(inp.spacer, inp.span) : inp.span) / 1000;
    var sup = SUPPORTS[inp.support] || SUPPORTS.cont3;
    var nx = coarse ? 3 : 4, ny = coarse ? 12 : 24;

    // main conductors (phase packs) – effective distance a_m
    var ex = g.arr === 'face' ? 1 : 0, ey = g.arr === 'face' ? 0 : 1;
    var GA = packPoints(g, 0, nx, ny), GB = packPoints(g, g.a, nx, ny);
    var Gm = pairFactor(GA, GB, ex, ey);
    var am = 1 / Gm;
    var Fm3pm = KMU * (Math.sqrt(3) / 2) * ip * ip / am;     // N/m
    var Fm3 = Fm3pm * l;
    var F2simple = 0.2 * Math.pow(ip / 1000, 2) * l / g.a;  // N, two point conductors

    // sub-conductors – force on an outer bar from the other bars of the same phase
    var Fspm = 0, as = null;
    if (g.n > 1) {
      var sx = coarse ? 4 : 6, sy = coarse ? 12 : 24;
      var outer = rectPoints(barOffset(g, 0), 0, g.t, g.h, sx, sy);
      var Gs = 0;
      for (var j = 1; j < g.n; j++) {
        Gs += pairFactor(outer, rectPoints(barOffset(g, j), 0, g.t, g.h, sx, sy), 1, 0);
      }
      as = 1 / Gs;
      Fspm = KMU * Math.pow(ip / g.n, 2) * Gs;
    }
    var Fs = Fspm * ls;

    // section moduli [m³] – sub-conductors assumed without stiffening elements (conservative)
    var Zs = g.h * g.t * g.t / 6;                                          // bending ⊥ wide face
    var Zm = g.arr === 'face' ? g.n * Zs : g.n * g.t * g.h * g.h / 6;     // force ⊥ / ∥ wide face

    var sigM = inp.vsvr * sup.beta * Fm3 * l / (8 * Zm) / 1e6;   // MPa
    var sigS = g.n > 1 ? inp.vsvr * Fs * ls / (16 * Zs) / 1e6 : 0;
    var sigTot = sigM + sigS;
    var limTot = inp.q * rp, limS = rp;

    var lmax = limTot > sigS ? Math.sqrt(8 * Zm * (limTot - sigS) * 1e6 / (inp.vsvr * sup.beta * Fm3pm)) : 0;
    var lsmax = null;
    if (g.n > 1) {
      var allowS = Math.min(limS, limTot - sigM);
      lsmax = allowS > 0 ? Math.sqrt(16 * Zs * allowS * 1e6 / (inp.vsvr * Fspm)) : 0;
    }

    res.peak = pk; res.ip = ip; res.am = am; res.as = as;
    res.Fm3pm = Fm3pm; res.Fm3 = Fm3; res.F2simple = F2simple; res.Fspm = Fspm; res.Fs = Fs;
    res.Zm = Zm; res.Zs = Zs; res.sigM = sigM; res.sigS = sigS; res.sigTot = sigTot;
    res.limTot = limTot; res.limS = limS; res.support = sup;
    res.FdA = inp.vfvr * sup.alphaA * Fm3; res.FdB = inp.vfvr * sup.alphaB * Fm3;
    res.lmax = lmax * 1000; res.lsmax = lsmax === null ? null : lsmax * 1000; res.ls = ls * 1000;
    res.ok = sigTot <= limTot && sigS <= limS;
    return res;
  }

  // ------------------------------------------------- thermal short circuit
  function thermalShortCircuit(mat, rho20, IkA, tk, Smm2, thetaI, thetaF) {
    var K = Math.sqrt(mat.Qc * (mat.B + 20) / rho20) / 1e6;   // A·s^0.5/mm²
    var lnr = Math.log((thetaF + mat.B) / (thetaI + mat.B));
    var k = lnr > 0 ? K * Math.sqrt(lnr) : 0;
    var I = IkA * 1000;
    var Smin = k > 0 ? I * Math.sqrt(tk) / k : Infinity;
    var thetaEnd = (mat.B + thetaI) * Math.exp(I * I * tk / (K * K * Smm2 * Smm2)) - mat.B;
    var Iwithstand = k * Smm2 / Math.sqrt(tk) / 1000;          // kA for duration tk
    return { K: K, k: k, Smin: Smin, S: Smm2, thetaI: thetaI, thetaF: thetaF, thetaEnd: thetaEnd,
             Iwithstand: Iwithstand, ok: Smm2 >= Smin };
  }

  // ------------------------------------------------------------ bolted joint
  function recommendBolts(width) {
    if (width <= 16) return { size: 'M6', count: 1, pattern: '1 bolt' };
    if (width <= 20) return { size: 'M8', count: 1, pattern: '1 bolt' };
    if (width <= 30) return { size: 'M10', count: 1, pattern: '1 bolt' };
    if (width <= 40) return { size: 'M12', count: 1, pattern: '1 bolt' };
    if (width <= 60) return { size: 'M12', count: 2, pattern: '2 bolts in line along the bar' };
    if (width <= 100) return { size: 'M12', count: 4, pattern: '2 × 2 square pattern' };
    if (width <= 120) return { size: 'M16', count: 4, pattern: '2 × 2 square pattern' };
    if (width <= 160) return { size: 'M16', count: 6, pattern: '2 rows × 3' };
    return { size: 'M16', count: 8, pattern: '2 rows × 4' };
  }

  function boltPreload(size, grade, pct) {
    var b = BOLTS[size], gr = GRADES[grade];
    var proof = gr.proof(b.d);
    return { proof: proof, Fproof: proof * b.As, F: pct / 100 * proof * b.As };
  }

  function boltedJoint(inp, rpBar) {
    var rec = recommendBolts(inp.width);
    var size = inp.boltSize === 'auto' ? rec.size : inp.boltSize;
    var count = inp.boltCount === 'auto' ? (inp.boltSize === 'auto' ? rec.count : rec.count) : Number(inp.boltCount);
    var b = BOLTS[size];
    var K = (LUBRICATION[inp.lube] || LUBRICATION.zinc).K;
    var pl = boltPreload(size, inp.grade, inp.preloadPct);
    var torque = K * pl.F * b.d / 1000;                         // N·m
    var overlap = inp.overlap > 0 ? inp.overlap : inp.width;
    var area = inp.width * overlap;                              // mm²
    var holesArea = count * Math.PI / 4 * b.hole * b.hole;
    var pContact = count * pl.F / (area - holesArea);           // MPa (N/mm²)
    var w = WASHERS[inp.washer] || WASHERS.iso7089;
    var od = b[w.bearing];
    var bearArea = Math.PI / 4 * (od * od - b.hole * b.hole);
    var pBear = pl.F / bearArea;
    var holeFrac = (b.hole) / inp.width;

    var table = Object.keys(BOLTS).map(function (sz) {
      var p = boltPreload(sz, inp.grade, inp.preloadPct);
      return { size: sz, F: p.F, torque: K * p.F * BOLTS[sz].d / 1000 };
    });

    var notes = [];
    if (overlap < inp.width) notes.push('Overlap shorter than the bar width – joint resistance will exceed that of an equal length of bar.');
    if (pContact < 7) notes.push('Mean contact pressure is low (< 7 N/mm²); consider more / larger bolts.');
    if (pBear > rpBar) notes.push('Washer bearing pressure exceeds the busbar 0.2 % proof stress – use larger washers to avoid creep / loss of preload.');
    if (!w.spring) notes.push('Use conical spring washers (DIN 6796) or Belleville washers to maintain contact pressure through thermal cycling.');
    if (count > 1 && size === 'M16' && inp.thick < 8) notes.push('M16 bolts on thin bars: check bearing pressure and edge distance.');
    if (b.hole * 2 > inp.width) notes.push('Bolt hole larger than half the bar width – choose a smaller bolt.');

    return { rec: rec, size: size, count: count, bolt: b, K: K, preload: pl, torque: torque, overlap: overlap, area: area,
             pContact: pContact, washer: w, washerOD: od, bearArea: bearArea, pBear: pBear, rpBar: rpBar,
             holeFrac: holeFrac, table: table, notes: notes };
  }

  // ---------------------------------------------------------------- main
  function normalise(inp) {
    var o = Object.assign({}, DEFAULT_INPUTS, inp || {});
    o.ipRise = Object.assign({}, IP_RISE_DEFAULT, (inp && inp.ipRise) || {});
    o.formRise = Object.assign({}, FORM_RISE_DEFAULT, (inp && inp.formRise) || {});
    o.formConv = Object.assign({}, FORM_CONV_DEFAULT, (inp && inp.formConv) || {});
    ['In', 'freq', 'Icw', 'tk', 'peakFactor', 'Uimp', 'rp', 'iacs', 'width', 'thick', 'nBars', 'gap', 'eps', 'runLength',
     'phaseSpacing', 'Troom', 'altitude', 'Tinternal', 'Tmax', 'derate', 'span', 'spacer', 'vsvr', 'vfvr', 'q',
     'thetaSC', 'preloadPct', 'overlap'].forEach(function (k) { o[k] = Number(o[k]); });
    o.nBars = Math.max(1, Math.round(o.nBars));
    if (o.finish !== 'custom' && FINISHES[o.finish]) o.eps = FINISHES[o.finish].eps;
    return o;
  }

  function calculate(rawInp, opts) {
    opts = opts || {};
    var inp = normalise(rawInp);
    var mat = MATERIALS[inp.material] || MATERIALS.Cu;
    var errors = [], warnings = [];

    var rho20 = RHO_IACS / (inp.iacs / 100);
    var alpha = mat.alpha20 * (inp.iacs / mat.iacs);           // Matthiessen: α·ρ ≈ const
    var rhoAt = function (T) { return rho20 * (1 + alpha * (T - 20)); };

    var g = {
      h: inp.width / 1000, t: inp.thick / 1000, n: inp.nBars,
      s: inp.nBars > 1 ? inp.gap / 1000 : 0, a: inp.phaseSpacing / 1000, arr: inp.arrangement
    };
    g.D = g.n * g.t + (g.n - 1) * g.s;
    var Smm2 = inp.nBars * inp.width * inp.thick;

    if (inp.thick > inp.width) warnings.push('Thickness is larger than width – width is taken as the larger, "wide face" dimension.');
    if (inp.nBars > 1 && inp.gap < inp.thick) warnings.push('Gap between parallel bars is smaller than the bar thickness – cooling between bars is impaired.');

    var clearance = (g.arr === 'face' ? g.a - g.D : g.a - g.h) * 1000;
    var clearanceMin = minClearance(inp.Uimp);
    if (clearance <= 0) errors.push('Phase centre spacing is too small – the phase packs overlap.');
    else if (clearance < clearanceMin) warnings.push('Phase-to-phase clearance ' + clearance.toFixed(1) + ' mm is below the IEC 61439-1 minimum of ' + clearanceMin + ' mm for Uimp = ' + inp.Uimp + ' kV.');

    // environment
    var p = airPressure(inp.altitude);
    var Tint, TintParts = null;
    if (inp.internalMode === 'specify') {
      Tint = inp.Tinternal;
    } else {
      var ipR = Number(inp.ipRise[inp.ip]) || 0, lf = LOCATION_FACTOR[inp.location] || 1, fr = Number(inp.formRise[inp.form]) || 0;
      Tint = inp.Troom + ipR * lf + fr;
      TintParts = { room: inp.Troom, ip: ipR * lf, ipTop: ipR, loc: lf, form: fr };
    }
    var convFactor = Number(inp.formConv[inp.form]) || 1;
    var env = { p: p, mounting: inp.mounting, runLength: inp.runLength / 1000, convFactor: convFactor, eps: inp.eps };
    if (inp.altitude > 2000) warnings.push('Altitude above 2000 m: IEC 61439-1 also requires dielectric (clearance) correction – not included here.');
    if (inp.Tmax <= Tint) errors.push('Maximum busbar temperature must be higher than the internal air temperature (' + Tint.toFixed(1) + ' °C).');

    var result = { inputs: inp, errors: errors, warnings: warnings, geometry: g, S: Smm2, clearance: clearance, clearanceMin: clearanceMin,
                   Tint: Tint, TintParts: TintParts, pressure: p, convFactor: convFactor, material: mat, rho20: rho20, alpha: alpha };
    if (errors.length) return result;

    // AC current distribution (evaluated at the limiting temperature)
    var em;
    try {
      em = inp.freq > 0 ? solveCurrentDistribution(g, rhoAt(inp.Tmax), inp.freq, emMesh(g.n, inp.thick, opts.coarse))
                        : dcDistribution(g, rhoAt(inp.Tmax));
    } catch (e) {
      errors.push(e.message);
      return result;
    }
    result.em = em;

    // thermal per phase
    var A = g.n * g.h * g.t;
    var phases = [0, 1, 2].map(function (ph) {
      var rad = radiationPerimeter(g, ph);
      var Q = function (T) { return heatLoss(T, Tint, g, env, rad.perimeter); };
      var RT = function (T) { return rhoAt(T) / A; };
      var Qmax = Q(inp.Tmax);
      var Imax = Math.sqrt(Qmax.total / (em.kac[ph] * RT(inp.Tmax)));
      // operating temperature at In
      var lo = Tint, hi = Tint + 400, Top, converged = true;
      var f = function (T) { return em.kac[ph] * RT(T) * inp.In * inp.In - Q(T).total; };
      if (f(hi) > 0) { Top = Infinity; converged = false; }
      else {
        for (var it = 0; it < 80; it++) { var mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
        Top = (lo + hi) / 2;
      }
      var Qop = isFinite(Top) ? Q(Top) : null;
      var Pop = isFinite(Top) ? em.kac[ph] * RT(Top) * inp.In * inp.In : null;
      return { idx: ph, rad: rad, Qmax: Qmax, Imax: Imax, Top: Top, converged: converged, Qop: Qop, Pop: Pop, kac: em.kac[ph] };
    });
    var limiting = phases.reduce(function (a, b) { return b.Imax < a.Imax ? b : a; });
    var hottest = phases.reduce(function (a, b) { return b.Top > a.Top ? b : a; });
    var Iperm = limiting.Imax * inp.derate;
    var totalLoss = phases.reduce(function (s, ph) { return s + (ph.Pop || 0); }, 0);
    result.thermal = {
      phases: phases, limiting: limiting, hottest: hottest, Iperm: Iperm, Iphys: limiting.Imax,
      utilisation: inp.In / Iperm, Top: hottest.Top, riseAboveRoom: hottest.Top - inp.Troom,
      lossPerMetre3ph: totalLoss, ok: inp.In <= Iperm && isFinite(hottest.Top) && hottest.Top <= inp.Tmax + 1e-6,
      currentDensity: inp.In / Smm2
    };

    // short-circuit thermal (initial temperature = operating temperature at In, capped at Tmax if runaway)
    var thetaI = isFinite(hottest.Top) ? hottest.Top : inp.Tmax;
    result.sc = thermalShortCircuit(mat, rho20, inp.Icw, inp.tk, Smm2, thetaI, inp.thetaSC);
    if (result.sc.thetaF <= thetaI) { result.sc.ok = false; warnings.push('Initial (operating) temperature is above the permitted short-circuit temperature.'); }

    // short-circuit mechanical
    result.mech = mechanical(g, inp, inp.rp, opts.coarse);
    if (inp.span > result.mech.lmax) warnings.push('Support span exceeds the maximum permissible span for the short-circuit stress.');

    // bolted joint
    if (!opts.skipJoint) result.joint = boltedJoint(inp, inp.rp);

    result.ok = result.thermal.ok && result.sc.ok && result.mech.ok && clearance >= clearanceMin;
    return result;
  }

  // Search standard sections that satisfy all checks; returns lightest options first.
  function autoSize(rawInp, limit) {
    var base = normalise(rawInp);
    var out = [];
    var sizes = STANDARD_SIZES;
    for (var n = 1; n <= 4; n++) {
      for (var i = 0; i < sizes.length; i++) {
        var w = sizes[i][0], t = sizes[i][1];
        var cand = Object.assign({}, base, { width: w, thick: t, nBars: n, gap: Math.max(t, n > 1 ? base.gap : t) });
        var r;
        try { r = calculate(cand, { coarse: true, skipJoint: true }); } catch (e) { continue; }
        if (r.errors.length || !r.thermal) continue;
        var clearOk = r.clearance >= r.clearanceMin;
        out.push({
          width: w, thick: t, n: n, gap: cand.gap, S: r.S, Iperm: r.thermal.Iperm, Top: r.thermal.Top,
          util: r.thermal.utilisation, scOk: r.sc.ok, mechUtil: r.mech.sigTot / r.mech.limTot, mechOk: r.mech.ok,
          lmax: r.mech.lmax, clearOk: clearOk, ok: r.thermal.ok && r.sc.ok && r.mech.ok && clearOk
        });
      }
    }
    var passing = out.filter(function (c) { return c.ok; });
    passing.sort(function (a, b) { return a.S - b.S || a.n - b.n || b.Iperm - a.Iperm; });
    return { candidates: passing.slice(0, limit || 8), tested: out.length };
  }

  return {
    version: '1.0.0',
    MATERIALS: MATERIALS, STANDARD_SIZES: STANDARD_SIZES, FINISHES: FINISHES, IP_CLASSES: IP_CLASSES,
    IP_RISE_DEFAULT: IP_RISE_DEFAULT, FORMS: FORMS, FORM_RISE_DEFAULT: FORM_RISE_DEFAULT, FORM_CONV_DEFAULT: FORM_CONV_DEFAULT,
    LOCATION_FACTOR: LOCATION_FACTOR, PEAK_TABLE: PEAK_TABLE, CLEARANCE_TABLE: CLEARANCE_TABLE, SUPPORTS: SUPPORTS,
    BOLTS: BOLTS, GRADES: GRADES, LUBRICATION: LUBRICATION, WASHERS: WASHERS, DEFAULT_INPUTS: DEFAULT_INPUTS,
    calculate: calculate, autoSize: autoSize, peakFactor: peakFactor, minClearance: minClearance,
    airProps: airProps, airPressure: airPressure, hVertical: hVertical, hChannel: hChannel,
    solveCurrentDistribution: solveCurrentDistribution, thermalShortCircuit: thermalShortCircuit,
    recommendBolts: recommendBolts, boltPreload: boltPreload, pairFactor: pairFactor, rectPoints: rectPoints
  };
});
