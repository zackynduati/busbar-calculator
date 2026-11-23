/*!
 * Protection and fault-level module
 * --------------------------------------------------------------------------
 * Short-circuit level from the transformer and the source fault level, trip times
 * of the ACB (Eaton PXR 20 style long / short / instantaneous characteristic) and
 * of the 11 kV relays (IEC 60255-151 inverse-time curves), grading margins, and
 * the link to the arc flash module: the arcing time is read off the trip curve at
 * the arcing current instead of being typed in.
 *
 * Ported from the Transformer protection calculator (VIP 410). The ACB model is the
 * Eaton PXR 20 trip unit of the IZMX16-40 breakers, from the instruction manual
 * MN013003EN (July 2021): long delay pickup 105 - 115 % of Ir (110 % used), long
 * delay time defined as the total clearing time at 6 x Ir with I2t, I4t, I0.5t or It
 * slope, short delay flat or I2t (I2t below 8 x Ir, flat above), instantaneous Ii
 * as a multiple of In, the frame's high instantaneous, and the maintenance mode
 * (ARMS). The manual gives no opening time for the short delay and instantaneous
 * trips, so that stays an input to be taken from the breaker data sheet / curves.
 *
 * Adds BusbarCalc.protection() and the defaults to BusbarCalc.DEFAULT_INPUTS.
 */
(function (root, factory) {
  var BC = (typeof module === 'object' && module.exports) ? require('./busbar-engine.js') : root.BusbarCalc;
  if (typeof module === 'object' && module.exports) require('./arcflash.js');
  factory(BC);
})(typeof self !== 'undefined' ? self : this, function (BC) {
  'use strict';

  var CAP = 1000;                       // "no trip" stand-in time [s]
  var ARC_CAP_MS = 2000;                // IEEE 1584: the arcing time is capped at 2 s
  var CURVES = { SI: [0.14, 0.02], VI: [13.5, 1], EI: [80, 2], LTI: [120, 1] };   // IEC 60255-151 k, alpha

  var PROT_DEFAULTS = {
    arcSource: 'protection',
    // transformer and source (KenGen: placeholders until the utility confirms)
    protKva: 1500, protKvHV: 11, protZ: 6, protMVAmax: 250, protMVAmin: 100,
    // ACB, PXR 20 trip unit
    acbIn: 2500, acbIr: 1.0, acbLtSlope: 'i2t', acbTr: 12, acbIsd: 5, acbSlope: 'flat', acbTsd: 0.2, acbIi: 10, acbArms: 'off', acbArmsPu: 2.5, acbTopen: 0.05,
    // 11 kV transformer protection (VIP 410) and utility upstream relay: generic until confirmed
    vCurve: 'SI', vIs: 95, vTms: 0.2, vDt: 0.5, vInst: 1600, vTinst: 0.05,
    uCurve: 'SI', uIs: 300, uTms: 0.3, uDt: 0.5, uInst: 0, uTinst: 0.05,
    protGm: 0.35
  };
  Object.assign(BC.DEFAULT_INPUTS, PROT_DEFAULTS);

  // ---- trip characteristics (current in A, time in s)
  function relayTime(I, r) {
    if (r.inst > 0 && I >= r.inst) return r.tinst;
    if (I > r.is) {
      if (r.curve === 'DT') return r.dt;
      var k = CURVES[r.curve], den = Math.pow(I / r.is, k[1]) - 1;
      return den <= 0 ? CAP : Math.min(CAP, r.tms * k[0] / den);
    }
    return CAP;
  }
  // ACB (PXR 20): maintenance mode / instantaneous / high instantaneous, then short delay, then long delay.
  // Long delay times are total clearing times at 6 x Ir. Short delay and instantaneous times get the opening time added.
  var LT_EXP = { i2t: 2, i4t: 4, i05t: 0.5, it: 1 };
  function acbTime(I, a) {
    var Ir = a.ir * a.inn, pivot = a.pivot || 8;
    var inst = [];
    if (a.ii > 0) inst.push(a.ii * a.inn);
    if (a.arms && a.armsPu > 0) inst.push(a.armsPu * a.inn);
    if (a.hi > 0) inst.push(a.hi);
    if (inst.length && I >= Math.min.apply(null, inst)) return a.topen;
    if (I >= a.isd * Ir) {
      var t = a.tsd;
      if (a.slope === 'i2t' && I < pivot * Ir) t = a.tsd * Math.pow(pivot * Ir / I, 2);
      return t + a.topen;
    }
    if (I > 1.1 * Ir) {
      var n = LT_EXP[a.ltSlope || 'i2t'] || 2, tr = a.tr;
      if (n === 4 && tr > 7) tr = 7;                       // manual 4.1: with I4t a time above 7 s is replaced by 7 s
      return Math.min(CAP, tr * Math.pow(6 * Ir / I, n));
    }
    return CAP;
  }

  function faultLevels(p) {
    var S3 = Math.sqrt(3), kvlv = p.Vlv / 1000, zt = p.z / 100;
    var f = { ratio: p.kvhv / kvlv, flcHV: p.kva / (S3 * p.kvhv), flcLV: p.kva / (S3 * kvlv) };
    f.zsMax = p.kva / 1000 / p.mvaMax; f.zsMin = p.kva / 1000 / p.mvaMin;
    f.IkMax = f.flcLV / (zt + f.zsMax);        // bolted three-phase fault at the LV terminals [A]
    f.IkMin = f.flcLV / (zt + f.zsMin);
    f.ihvMax = p.mvaMax * 1000 / (S3 * p.kvhv); // bolted three-phase fault on the 11 kV bus [A]
    f.idamHV = f.flcHV / zt;                    // through-fault current used for the damage curve [A, 11 kV side]
    return f;
  }

  function protection(rawInp) {
    var i = Object.assign({}, BC.DEFAULT_INPUTS, rawInp || {}), errors = [], warnings = [];
    var n = function (k) { return Number(i[k]); };
    var p = { kva: n('protKva'), kvhv: n('protKvHV'), z: n('protZ'), mvaMax: n('protMVAmax'), mvaMin: n('protMVAmin'), Vlv: n('arcVoc') };
    ['kva', 'kvhv', 'z', 'mvaMax', 'mvaMin', 'Vlv'].forEach(function (k) { if (!(p[k] > 0)) errors.push('Protection: enter a value above zero for the transformer and source data.'); });
    var acb = { inn: n('acbIn'), ir: n('acbIr'), ltSlope: i.acbLtSlope, tr: n('acbTr'), isd: n('acbIsd'), tsd: n('acbTsd'), slope: i.acbSlope, pivot: 8, ii: n('acbIi'),
                arms: i.acbArms === 'on', armsPu: n('acbArmsPu'), hi: Number(i.Icw) * 1000, topen: n('acbTopen') };
    if (!(acb.inn > 0 && acb.ir > 0 && acb.tr > 0 && acb.isd > 0 && acb.tsd >= 0 && acb.topen >= 0 && acb.ii >= 0 && acb.armsPu > 0)) errors.push('Protection: check the ACB settings (rating, pickups and delays must be positive).');
    var mk = function (a, b) { return { curve: i[a + 'Curve'], is: n(a + 'Is'), tms: n(a + 'Tms'), dt: n(a + 'Dt'), inst: n(a + 'Inst'), tinst: n(a + 'Tinst') }; };
    var vip = mk('v'), up = mk('u');
    if (!(vip.is > 0 && up.is > 0)) errors.push('Protection: relay pickups must be above zero.');
    if (!CURVES[vip.curve] && vip.curve !== 'DT') errors.push('Protection: unknown relay curve.');
    if (!CURVES[up.curve] && up.curve !== 'DT') errors.push('Protection: unknown relay curve.');
    if (errors.length) return { errors: errors, warnings: warnings };

    var fl = faultLevels(p), ratio = fl.ratio, gm = n('protGm');
    var tACB = function (I) { return acbTime(I, acb); };
    var tVIP = function (I) { return relayTime(I / ratio, vip); };                // I referred to the LV side
    var tUP = function (I) { return relayTime(I / ratio, up); };
    var tDAM = function (I) { return Math.min(CAP, Math.max(0.01, 2 * Math.pow(fl.idamHV * ratio / I, 2))); };
    // the faster of the transformer relay and the utility relay clears a fault on the transformer side of the ACB
    var tLine = function (I) { return Math.min(tVIP(I), tUP(I)); };

    var locations = [
      { id: 'bus', name: 'Busbars downstream of the ACB', clearedBy: 'ACB', clr: tACB },
      { id: 'line', name: 'ACB line-side terminals', clearedBy: '11 kV relay', clr: tLine }
    ];
    var cases = [
      { id: 'max', name: 'Maximum source', Ibf: fl.IkMax / 1000 },
      { id: 'min', name: 'Minimum source', Ibf: fl.IkMin / 1000 }
    ];
    var results = [];
    locations.forEach(function (loc) {
      cases.forEach(function (cs) {
        var base = Object.assign({}, i, { arcIbf: cs.Ibf, arcTmax: 100, arcTmin: 100 });
        var a0 = BC.arcFlash(base);
        if (a0.errors.length) { results.push({ loc: loc, cs: cs, errors: a0.errors }); return; }
        var Imax = a0.main.max.Iarc * 1000, Imin = a0.main.min.Iarc * 1000;
        var tmaxS = loc.clr(Imax), tminS = loc.clr(Imin), noTrip = tmaxS >= CAP || tminS >= CAP;
        var tmax = Math.min(ARC_CAP_MS, tmaxS * 1000), tmin = Math.min(ARC_CAP_MS, tminS * 1000);
        var a = BC.arcFlash(Object.assign({}, base, { arcTmax: tmax, arcTmin: tmin }));
        results.push({ loc: loc, cs: cs, arc: a, errors: a.errors, tmax: tmax, tmin: tmin, Imax: Imax, Imin: Imin, noTrip: noTrip,
                       capped: tmaxS * 1000 > ARC_CAP_MS || tminS * 1000 > ARC_CAP_MS });
      });
    });
    var ok = results.filter(function (r) { return !r.errors.length; });
    var worst = ok.reduce(function (a, b) { return !a || b.arc.main.E > a.arc.main.E ? b : a; }, null);
    ok.forEach(function (r) {
      if (r.noTrip) warnings.push(r.loc.name + ', ' + r.cs.name.toLowerCase() + ': the protection does not trip at the arcing current. The arcing time is taken as 2 s.');
    });

    // grading at the maximum-source LV fault, and between the 11 kV relays at the 11 kV bolted fault
    var Ik = fl.IkMax, ihvLV = fl.ihvMax * ratio;
    var grade = [
      { n: 'LV bolted fault, maximum source', I: Ik, ta: tACB(Ik), tv: tVIP(Ik), tu: tUP(Ik) },
      { n: 'LV bolted fault, minimum source', I: fl.IkMin, ta: tACB(fl.IkMin), tv: tVIP(fl.IkMin), tu: tUP(fl.IkMin) },
      { n: '11 kV bolted fault, maximum source', I: ihvLV, ta: null, tv: tVIP(ihvLV), tu: tUP(ihvLV) }
    ].map(function (g) {
      g.mv = g.ta === null ? null : g.tv - g.ta; g.mu = g.tu - g.tv;
      g.ok = (g.mv === null || g.mv >= gm) && g.mu >= gm;
      return g;
    });
    var tAtIk = tACB(Ik);
    return { errors: errors, warnings: warnings, inputs: p, acb: acb, vip: vip, up: up, fl: fl, gm: gm, results: results, worst: worst,
             grade: grade, tACB: tACB, tVIP: tVIP, tUP: tUP, tDAM: tDAM, tLine: tLine, tAtIk: tAtIk, CAP: CAP };
  }

  BC.protection = protection;
  BC.relayTime = relayTime;
  BC.acbTime = acbTime;
  BC.ACB_LT_SLOPES = { i2t: 'I²t', i4t: 'I⁴t', i05t: 'I⁰·⁵t', it: 'It' };
  BC.protFaultLevels = faultLevels;
  BC.RELAY_CURVES = Object.keys(CURVES).concat(['DT']);
  return BC;
});
