/*!
 * Arc flash module — IEEE 1584-2018
 * --------------------------------------------------------------------------
 * Empirical model for three-phase AC systems, 208 V – 15 kV, bolted fault
 * current 0.5 – 106 kA (to 600 V) or 0.2 – 65 kA (above 600 V), conductor gap
 * 6.35 – 76.2 mm (LV) or 19.05 – 254 mm (MV), working distance 305 mm or more.
 *
 * Coefficient tables 1 – 7 are the ones printed in IEEE 1584-2018. They were
 * checked against the open-source implementation github.com/LiaungYip/arcflash
 * (MIT licence) and against the worked examples in Annex D of the standard
 * (see tests/index.html). Adds BusbarCalc.arcFlash() and the arc flash input
 * defaults to BusbarCalc.DEFAULT_INPUTS.
 *
 * Units: V, kA, mm, ms in; incident energy in J/cm² (and cal/cm²), boundary in mm.
 */
(function (root, factory) {
  var BC = (typeof module === 'object' && module.exports) ? require('./busbar-engine.js') : root.BusbarCalc;
  factory(BC);
})(typeof self !== 'undefined' ? self : this, function (BC) {
  'use strict';

  var ARC_DEFAULTS = {
    arcVoc: 415, arcIbf: 50, arcEC: 'HCB', arcClass: 'lvsg',
    arcGap: 32, arcDist: 609.6, arcH: 508, arcW: 508, arcDepth: 508,
    arcTmax: 100, arcTmin: 150
  };
  Object.assign(BC.DEFAULT_INPUTS, ARC_DEFAULTS);

  var ARC_EC = {
    VCB:  'VCB – vertical conductors in a box',
    VCBB: 'VCBB – vertical conductors, insulating barrier, in a box',
    HCB:  'HCB – horizontal conductors in a box',
    VOA:  'VOA – vertical conductors in open air',
    HOA:  'HOA – horizontal conductors in open air'
  };

  // Table 1: arcing-current coefficients k1..k10 by configuration and open-circuit voltage (kV)
  var T1 = {
    VCB:  { 0.6: [-0.04287, 1.035, -0.083, 0, 0, -4.783E-09, 1.962E-06, -0.000229, 0.003141, 1.092],
            2.7: [0.0065, 1.001, -0.024, -1.557E-12, 4.556E-10, -4.186E-08, 8.346E-07, 5.482E-05, -0.003191, 0.9729],
            14.3: [0.005795, 1.015, -0.011, -1.557E-12, 4.556E-10, -4.186E-08, 8.346E-07, 5.482E-05, -0.003191, 0.9729] },
    VCBB: { 0.6: [-0.017432, 0.98, -0.05, 0, 0, -5.767E-09, 2.524E-06, -0.00034, 0.01187, 1.013],
            2.7: [0.002823, 0.995, -0.0125, 0, -9.204E-11, 2.901E-08, -3.262E-06, 0.0001569, -0.004003, 0.9825],
            14.3: [0.014827, 1.01, -0.01, 0, -9.204E-11, 2.901E-08, -3.262E-06, 0.0001569, -0.004003, 0.9825] },
    HCB:  { 0.6: [0.054922, 0.988, -0.11, 0, 0, -5.382E-09, 2.316E-06, -0.000302, 0.0091, 0.9725],
            2.7: [0.001011, 1.003, -0.0249, 0, 0, 4.859E-10, -1.814E-07, -9.128E-06, -0.0007, 0.9881],
            14.3: [0.008693, 0.999, -0.02, 0, -5.043E-11, 2.233E-08, -3.046E-06, 0.000116, -0.001145, 0.9839] },
    VOA:  { 0.6: [0.043785, 1.04, -0.18, 0, 0, -4.783E-09, 1.962E-06, -0.000229, 0.003141, 1.092],
            2.7: [-0.02395, 1.006, -0.0188, -1.557E-12, 4.556E-10, -4.186E-08, 8.346E-07, 5.482E-05, -0.003191, 0.9729],
            14.3: [0.005371, 1.0102, -0.029, -1.557E-12, 4.556E-10, -4.186E-08, 8.346E-07, 5.482E-05, -0.003191, 0.9729] },
    HOA:  { 0.6: [0.111147, 1.008, -0.24, 0, 0, -3.895E-09, 1.641E-06, -0.000197, 0.002615, 1.1],
            2.7: [0.000435, 1.006, -0.038, 0, 0, 7.859E-10, -1.914E-07, -9.128E-06, -0.0007, 0.9981],
            14.3: [0.000904, 0.999, -0.02, 0, 0, 7.859E-10, -1.914E-07, -9.128E-06, -0.0007, 0.9981] }
  };
  // Table 2: arcing-current variation factor, polynomial in V (kV), V^6 … V^0
  var T2 = {
    VCB:  [0, -0.0000014269, 0.000083137, -0.0019382, 0.022366, -0.12645, 0.30226],
    VCBB: [1.138e-06, -6.0287e-05, 0.0012758, -0.013778, 0.080217, -0.24066, 0.33524],
    HCB:  [0, -3.097e-06, 0.00016405, -0.0033609, 0.033308, -0.16182, 0.34627],
    VOA:  [9.5606E-07, -5.1543E-05, 0.0011161, -0.01242, 0.075125, -0.23584, 0.33696],
    HOA:  [0, -3.1555e-06, 0.0001682, -0.0034607, 0.034124, -0.1599, 0.34629]
  };
  // Tables 3 – 5: incident-energy coefficients k1..k13 at 0.6, 2.7 and 14.3 kV
  var TE = {
    0.6: {
      VCB:  [0.753364, 0.566, 1.752636, 0, 0, -4.783E-09, 0.000001962, -0.000229, 0.003141, 1.092, 0, -1.598, 0.957],
      VCBB: [3.068459, 0.26, -0.098107, 0, 0, -5.767E-09, 0.000002524, -0.00034, 0.01187, 1.013, -0.06, -1.809, 1.19],
      HCB:  [4.073745, 0.344, -0.370259, 0, 0, -5.382E-09, 0.000002316, -0.000302, 0.0091, 0.9725, 0, -2.03, 1.036],
      VOA:  [0.679294, 0.746, 1.222636, 0, 0, -4.783E-09, 0.000001962, -0.000229, 0.003141, 1.092, 0, -1.598, 0.997],
      HOA:  [3.470417, 0.465, -0.261863, 0, 0, -3.895E-09, 0.000001641, -0.000197, 0.002615, 1.1, 0, -1.99, 1.04]
    },
    2.7: {
      VCB:  [2.40021, 0.165, 0.354202, -1.557E-12, 4.556E-10, -4.186E-08, 8.346E-07, 5.482E-05, -0.003191, 0.9729, 0, -1.569, 0.9778],
      VCBB: [3.870592, 0.185, -0.736618, 0, -9.204E-11, 2.901E-08, -3.262E-06, 0.0001569, -0.004003, 0.9825, 0, -1.742, 1.09],
      HCB:  [3.486391, 0.177, -0.193101, 0, 0, 4.859E-10, -1.814E-07, -9.128E-06, -0.0007, 0.9881, 0.027, -1.723, 1.055],
      VOA:  [3.880724, 0.105, -1.906033, -1.557E-12, 4.556E-10, -4.186E-08, 8.346E-07, 5.482E-05, -0.003191, 0.9729, 0, -1.515, 1.115],
      HOA:  [3.616266, 0.149, -0.761561, 0, 0, 7.859E-10, -1.914E-07, -9.128E-06, -0.0007, 0.9981, 0, -1.639, 1.078]
    },
    14.3: {
      VCB:  [3.825917, 0.11, -0.999749, -1.557E-12, 4.556E-10, -4.186E-08, 8.346E-07, 5.482E-05, -0.003191, 0.9729, 0, -1.568, 0.99],
      VCBB: [3.644309, 0.215, -0.585522, 0, -9.204E-11, 2.901E-08, -3.262E-06, 0.0001569, -0.004003, 0.9825, 0, -1.677, 1.06],
      HCB:  [3.044516, 0.125, 0.245106, 0, -5.043E-11, 2.233E-08, -3.046E-06, 0.000116, -0.001145, 0.9839, 0, -1.655, 1.084],
      VOA:  [3.405454, 0.12, -0.93245, -1.557E-12, 4.556E-10, -4.186E-08, 8.346E-07, 5.482E-05, -0.003191, 0.9729, 0, -1.534, 0.979],
      HOA:  [2.04049, 0.177, 1.005092, 0, 0, 7.859E-10, -1.914E-07, -9.128E-06, -0.0007, 0.9981, -0.05, -1.633, 1.151]
    }
  };
  // Table 7: enclosure size correction factor b1..b3 on the equivalent enclosure size (inches)
  var T7 = {
    Typical: { VCB: [-0.000302, 0.03441, 0.4325], VCBB: [-0.0002976, 0.032, 0.479], HCB: [-0.0001923, 0.01935, 0.6899] },
    Shallow: { VCB: [0.002222, -0.02556, 0.6222], VCBB: [-0.002778, 0.1194, -0.2778], HCB: [-0.0005556, 0.03722, 0.4778] }
  };
  // Typical equipment (Tables 8 and 10): gap G, enclosure height H / width W / depth Dp, working distance D — all mm
  var ARC_CLASSES = {
    lvsg:   { label: 'LV switchgear / switchboard', G: 32, H: 508, W: 508, Dp: 508, D: 609.6 },
    lvmcc:  { label: 'LV MCC or panelboard (deep)', G: 25, H: 355.6, W: 304.8, Dp: 250, D: 457.2 },
    lvmccs: { label: 'LV MCC or panelboard (shallow)', G: 25, H: 355.6, W: 304.8, Dp: 100, D: 457.2 },
    junc:   { label: 'LV cable junction box', G: 13, H: 355.6, W: 304.8, Dp: 250, D: 457.2 },
    mv5:    { label: '5 kV switchgear', G: 104, H: 914.4, W: 914.4, Dp: 914.4, D: 914.4 },
    mv15:   { label: '15 kV switchgear', G: 152, H: 1143, W: 762, Dp: 762, D: 914.4 },
    custom: { label: 'Custom dimensions' }
  };
  var MM_TO_IN = 0.03937;        // the truncated factor printed in IEEE 1584-2018; kept so that Annex D results reproduce

  function poly(c, x) { var s = 0; for (var i = 0; i < c.length; i++) s = s * x + c[i]; return s; }   // Horner, highest power first
  var log10 = Math.log10;

  function varCF(ec, Vkv) { return poly(T2[ec], Vkv); }

  function sizeCF(ec, Vkv, H, W, Dp) {
    if (ec === 'VOA' || ec === 'HOA') return { CF: 1, type: 'open air', EES: null, h1: null, w1: null };
    var type = (Vkv < 0.6 && H < 508 && W < 508 && Dp <= 203.2) ? 'Shallow' : 'Typical';
    var AB = { VCB: [4, 20], VCBB: [10, 24], HCB: [10, 22] }[ec];
    var eq = function (dim) { return (660.4 + (dim - 660.4) * ((Vkv + AB[0]) / AB[1])) / 25.4; };      // equations 11 / 12
    var w1, h1;
    if (W < 508) w1 = type === 'Typical' ? 20 : MM_TO_IN * W;
    else if (W <= 660.4) w1 = MM_TO_IN * W;
    else if (W <= 1244.6) w1 = eq(W);
    else w1 = eq(1244.6);
    if (H < 508) h1 = type === 'Typical' ? 20 : MM_TO_IN * H;
    else if (H <= 660.4) h1 = MM_TO_IN * H;
    else if (H <= 1244.6) h1 = ec === 'VCB' ? MM_TO_IN * H : eq(H);
    else h1 = ec === 'VCB' ? 49 : eq(1244.6);
    var EES = (h1 + w1) / 2;                                                                            // equation 13
    var b = T7[type][ec];
    var x = b[0] * EES * EES + b[1] * EES + b[2];                                                       // equations 14 / 15
    return { CF: type === 'Typical' ? x : 1 / x, type: type, EES: EES, h1: h1, w1: w1 };
  }

  function iarcIntermediate(ec, Vkv, Ibf, G) {                                                          // equation 1
    var k = T1[ec][Vkv];
    var x1 = k[0] + k[1] * log10(Ibf) + k[2] * log10(G);
    var x2 = k[3] * Math.pow(Ibf, 6) + k[4] * Math.pow(Ibf, 5) + k[5] * Math.pow(Ibf, 4) + k[6] * Math.pow(Ibf, 3) +
             k[7] * Ibf * Ibf + k[8] * Ibf + k[9];
    return Math.pow(10, x1) * x2;
  }

  // Incident energy [J/cm²] at one reference voltage (equations 3 – 6). Iarc600 is given for the low-voltage form.
  function energyIntermediate(ec, Vref, Iarc, Ibf, T, G, D, CF, Iarc600) {
    var k = TE[Vref][ec];
    var x1 = 12.552 / 50 * T;
    var x2 = k[0] + k[1] * log10(G);
    var x3 = k[2] * (Iarc600 === undefined ? Iarc : Iarc600) /
             (k[3] * Math.pow(Ibf, 7) + k[4] * Math.pow(Ibf, 6) + k[5] * Math.pow(Ibf, 5) + k[6] * Math.pow(Ibf, 4) +
              k[7] * Math.pow(Ibf, 3) + k[8] * Ibf * Ibf + k[9] * Ibf);
    var x4 = k[10] * log10(Ibf) + k[12] * log10(Iarc) + log10(1 / CF);
    var x5 = k[11] * log10(D);
    return x1 * Math.pow(10, x2 + x3 + x4 + x5);
  }
  // Arc flash boundary [mm]: distance at which the energy has fallen to 1.2 cal/cm² (5.0208 J/cm²), using E ∝ D^k12
  function boundary(ec, Vref, E, D) {
    var k12 = TE[Vref][ec][11];
    return Math.pow(5.0208 / (E / Math.pow(D, k12)), 1 / k12);
  }
  function interp(Vkv, x600, x2700, x14300) {                                                           // equations 16 – 24
    var x1 = ((x2700 - x600) / 2.1) * (Vkv - 2.7) + x2700;
    var x2 = ((x14300 - x2700) / 11.6) * (Vkv - 14.3) + x14300;
    var x3 = (x1 * (2.7 - Vkv)) / 2.1 + (x2 * (Vkv - 0.6)) / 2.1;
    return Vkv <= 2.7 ? x3 : x2;
  }

  // One scenario. reduced = false: maximum arcing current. reduced = true: minimum, with the variation factor applied.
  function scenario(ec, Vkv, Ibf, G, D, CF, VarCF, T, reduced) {
    var out = { T: T, reduced: reduced };
    if (Vkv > 0.6) {
      var refs = [0.6, 2.7, 14.3], I = {}, E = {}, B = {};
      refs.forEach(function (v) {
        var full = iarcIntermediate(ec, v, Ibf, G);
        I[v] = reduced ? full * (1 - 0.5 * VarCF) : full;                                               // equation 2
      });
      refs.forEach(function (v) {
        E[v] = energyIntermediate(ec, v, I[v], Ibf, T, G, D, CF);
        B[v] = boundary(ec, v, E[v], D);
      });
      out.Iarc600 = I[0.6]; out.Iarc2700 = I[2.7]; out.Iarc14300 = I[14.3];
      out.E600 = E[0.6]; out.E2700 = E[2.7]; out.E14300 = E[14.3];
      out.Iarc = interp(Vkv, I[0.6], I[2.7], I[14.3]);
      out.E = interp(Vkv, E[0.6], E[2.7], E[14.3]);
      out.AFB = interp(Vkv, B[0.6], B[2.7], B[14.3]);
    } else {
      var I600 = iarcIntermediate(ec, 0.6, Ibf, G);            // always the maximum value, also for the minimum scenario
      var a = Math.pow(0.6 / Vkv, 2), b = 1 / (I600 * I600), c = (0.36 - Vkv * Vkv) / (0.36 * Ibf * Ibf);
      var Ifull = 1 / Math.sqrt(a * (b - c));                                                           // equation 25
      var Ia = reduced ? Ifull * (1 - 0.5 * VarCF) : Ifull;
      out.Iarc600 = I600; out.Iarc = Ia;
      out.E = energyIntermediate(ec, 0.6, Ia, Ibf, T, G, D, CF, I600);
      out.AFB = boundary(ec, 0.6, out.E, D);
    }
    return out;
  }

  // PPE arc-rating bands (incident-energy method, cal/cm²) as used for NFPA 70E PPE categories
  var ARC_PPE = [
    { max: 1.2, cat: 0, label: 'Below 1.2 cal/cm² – no arc-rated PPE category needed' },
    { max: 4, cat: 1, label: 'Category 1 – arc rating 4 cal/cm²' },
    { max: 8, cat: 2, label: 'Category 2 – arc rating 8 cal/cm²' },
    { max: 25, cat: 3, label: 'Category 3 – arc rating 25 cal/cm²' },
    { max: 40, cat: 4, label: 'Category 4 – arc rating 40 cal/cm²' },
    { max: Infinity, cat: 5, label: 'Above 40 cal/cm² – no PPE category covers this' }
  ];
  function ppe(cal) { for (var i = 0; i < ARC_PPE.length; i++) if (cal <= ARC_PPE[i].max) return ARC_PPE[i]; return ARC_PPE[ARC_PPE.length - 1]; }

  function one(p, ec) {
    var Vkv = p.Voc / 1000;
    var vc = varCF(ec, Vkv), cf = sizeCF(ec, Vkv, p.H, p.W, p.Dp);
    var mx = scenario(ec, Vkv, p.Ibf, p.G, p.D, cf.CF, vc, p.Tmax, false);
    var mn = scenario(ec, Vkv, p.Ibf, p.G, p.D, cf.CF, vc, p.Tmin, true);
    var E = Math.max(mx.E, mn.E), cal = E / 4.184;
    // E is proportional to the arcing time, so the clearing time that holds a target energy follows directly
    var tFor = function (calT) { return Math.min(mx.T * calT * 4.184 / mx.E, mn.T * calT * 4.184 / mn.E); };
    return { ec: ec, varCF: vc, CF: cf.CF, enclosure: cf, max: mx, min: mn, worst: mx.E >= mn.E ? 'max' : 'min',
             E: E, cal: cal, AFB: Math.max(mx.AFB, mn.AFB), ppe: ppe(cal), tFor1_2: tFor(1.2), tFor4: tFor(4), tFor8: tFor(8) };
  }

  function arcFlash(rawInp) {
    var i = Object.assign({}, BC.DEFAULT_INPUTS, rawInp || {});
    var p = { Voc: Number(i.arcVoc), Ibf: Number(i.arcIbf), G: Number(i.arcGap), D: Number(i.arcDist), H: Number(i.arcH), W: Number(i.arcW),
              Dp: Number(i.arcDepth), Tmax: Number(i.arcTmax), Tmin: Number(i.arcTmin) };
    var ec = String(i.arcEC), errors = [], warnings = [];
    var lv = p.Voc <= 600;
    if (!(p.Voc >= 208 && p.Voc <= 15000)) errors.push('System voltage must be between 208 V and 15 kV (IEEE 1584-2018 range).');
    if (!T1[ec]) errors.push('Choose an electrode configuration.');
    if (lv && !(p.Ibf >= 0.5 && p.Ibf <= 106)) errors.push('Bolted fault current must be 0.5 – 106 kA at 208 – 600 V.');
    if (!lv && !(p.Ibf >= 0.2 && p.Ibf <= 65)) errors.push('Bolted fault current must be 0.2 – 65 kA above 600 V.');
    if (lv && !(p.G >= 6.35 && p.G <= 76.2)) errors.push('Conductor gap must be 6.35 – 76.2 mm at 600 V and below.');
    if (!lv && !(p.G >= 19.05 && p.G <= 254)) errors.push('Conductor gap must be 19.05 – 254 mm above 600 V.');
    if (!(p.D >= 305)) errors.push('Working distance must be at least 305 mm.');
    if (!(p.Tmax > 0) || !(p.Tmin > 0)) errors.push('Arcing time must be greater than zero.');
    if (!(p.H > 0 && p.W > 0 && p.Dp > 0)) errors.push('Enclosure height, width and depth must be greater than zero.');
    else if (!(p.W >= 4 * p.G)) errors.push('Enclosure width must be at least four times the conductor gap.');
    if (errors.length) return { errors: errors, warnings: warnings, inputs: p, ec: ec };

    var main = one(p, ec);
    if (!(main.CF >= 0 && main.CF <= 3)) errors.push('The enclosure size correction factor (' + main.CF.toFixed(2) + ') is outside the model range 0 – 3.');
    if (errors.length) return { errors: errors, warnings: warnings, inputs: p, ec: ec };

    var all = Object.keys(T1).map(function (k) { return one(p, k); });
    var worstEC = all.reduce(function (a, b) { return b.E > a.E ? b : a; });
    if (worstEC.ec !== ec && worstEC.E > main.E * 1.05) warnings.push('The ' + worstEC.ec + ' configuration gives a higher incident energy (' + worstEC.cal.toFixed(1) + ' cal/cm² against ' + main.cal.toFixed(1) + ') than the ' + ec + ' you selected.');
    if (p.Tmax > 2000 || p.Tmin > 2000) warnings.push('Arcing times above 2 s are normally capped at the time a person needs to leave the area (IEEE 1584 clause 6.9).');
    if (Number(i.Icw) > 0 && p.Ibf > Number(i.Icw)) warnings.push('The bolted fault current (' + p.Ibf + ' kA) is higher than the short-time withstand of the busbars (' + i.Icw + ' kA).');
    if (main.cal > 40) warnings.push('The incident energy is above 40 cal/cm². Shorten the clearing time, use arc-flash relaying or a maintenance mode, or work only de-energised.');
    return { errors: errors, warnings: warnings, inputs: p, ec: ec, main: main, all: all, worstEC: worstEC };
  }

  BC.arcFlash = arcFlash;
  BC.ARC_EC = ARC_EC;
  BC.ARC_CLASSES = ARC_CLASSES;
  BC.ARC_PPE = ARC_PPE;
  BC.arcInternals = { varCF: varCF, sizeCF: sizeCF, scenario: scenario, iarcIntermediate: iarcIntermediate };
  return BC;
});
