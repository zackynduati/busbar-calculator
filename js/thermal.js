/*!
 * Board cooling and fan sizing module
 * --------------------------------------------------------------------------
 * Ported from the Switchboard Thermal Calculator (github.com/zackynduati/switchboard-thermal-calculator).
 * Whole-board heat balance: heat losses of the devices, conductors and other equipment, effective cooling
 * surface of the enclosure (IEC 60890 surface factors), average air temperature rise, and the filter-fan
 * airflow needed to hold a chosen inside temperature.
 *
 * Link to the busbar calculation: the main busbar loss comes from the busbar calculation itself, and the
 * air temperature it calculates can be used as the internal air temperature around the busbars
 * (internal air temperature mode "board"). The two are solved together by a short fixed-point iteration.
 *
 * Adds BusbarCalc.boardThermal(), BusbarCalc.resolveBoard() and the defaults to BusbarCalc.DEFAULT_INPUTS.
 */
(function (root, factory) {
  var BC = (typeof module === 'object' && module.exports) ? require('./busbar-engine.js') : root.BusbarCalc;
  factory(BC);
})(typeof self !== 'undefined' ? self : this, function (BC) {
  'use strict';

  var DEFAULT_SIZES = '20, 55, 105, 160, 230, 370, 550, 700, 900';
  var FACE = { exposed: 0.9, wall: 0.5, adjoining: 0.5 };

  // Default heat-loss rows for the Phase II MDB (typical figures: replace with manufacturer data)
  var DEFAULT_ROWS = {
    dev: [
      { desc: 'ACB 2500 A 4-pole drawout, incomer (IZMX40)', qty: 1, In: 2500, I: 2062, loss: 600 },
      { desc: 'MCCB 630 A, Q1 PF plant', qty: 1, In: 630, I: 481, loss: 110 },
      { desc: 'MCCB 250 A, Q6 and Q7', qty: 2, In: 250, I: 200, loss: 55 }
    ],
    cond: [
      { desc: 'ACB links to main bus, 2 × 80×10 Cu', sets: 1, I: 2062, L: 1.2, n: 2, S: 800, mat: 'Cu', kac: 1.2 },
      { desc: 'Q1 tap-off, 40×10 Cu', sets: 1, I: 481, L: 1.5, n: 1, S: 400, mat: 'Cu', kac: 1.05 },
      { desc: 'Q6 and Q7 tap-offs, 30×5 Cu', sets: 2, I: 200, L: 1.5, n: 1, S: 150, mat: 'Cu', kac: 1 },
      { desc: 'Incomer cable tails inside, 4 × 630 mm² Al', sets: 1, I: 2062, L: 0.4, n: 4, S: 630, mat: 'Al', kac: 1.1 }
    ],
    fix: [
      { desc: 'Power meters, Rish LM1340', qty: 7, w: 5 },
      { desc: 'Power factor controller', qty: 1, w: 10 },
      { desc: 'Indicator lamps', qty: 21, w: 1 },
      { desc: 'Control MCBs, PLC and relays', qty: 1, w: 50 },
      { desc: 'Capacitors, 350 kvar at 0.5 W per kvar', qty: 1, w: 175 },
      { desc: 'Capacitor contactors and fuses, 12 steps', qty: 12, w: 10 }
    ]
  };

  var THERM_DEFAULTS = {
    thermW: 3940, thermH: 2200, thermD: 800, thermK: '5.5', thermTop: 'exposed', thermRear: 'exposed', thermLeft: 'exposed', thermRight: 'exposed',
    thermTi: 50, thermMargin: 25, thermTbar: 85, thermSizes: DEFAULT_SIZES, thermBusI: 1450, thermFans: 'yes',
    thermRows: JSON.stringify(DEFAULT_ROWS)
  };
  Object.assign(BC.DEFAULT_INPUTS, THERM_DEFAULTS);

  function num(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function resistivity(mat, T) { return mat === 'Al' ? 0.0282 * (1 + 0.00403 * (T - 20)) : 0.017241 * (1 + 0.00393 * (T - 20)); }   // ohm mm²/m
  function devLoss(r) { var In = num(r.In); return In > 0 ? num(r.qty) * num(r.loss) * Math.pow(num(r.I) / In, 2) : 0; }
  function condLoss(r, T) { var a = num(r.n) * num(r.S); return a > 0 ? num(r.sets) * 3 * Math.pow(num(r.I), 2) * resistivity(r.mat, T) * num(r.L) / a * (num(r.kac) || 1) : 0; }
  function fixLoss(r) { return num(r.qty) * num(r.w); }

  function parseRows(s) {
    var o;
    try { o = typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { o = null; }
    if (!o || typeof o !== 'object') o = DEFAULT_ROWS;
    return { dev: Array.isArray(o.dev) ? o.dev : [], cond: Array.isArray(o.cond) ? o.cond : [], fix: Array.isArray(o.fix) ? o.fix : [] };
  }

  // b: board data (same field names as the original calculator) plus busW, the main busbar loss in watts
  function boardThermal(b) {
    var W = num(b.W) / 1000, H = num(b.H) / 1000, D = num(b.D) / 1000, k = num(b.k), T = num(b.Tbar);
    var faces = [
      { n: 'Top', a: W * D, f: b.top === 'covered' ? 0.7 : 1.4 }, { n: 'Front', a: W * H, f: 0.9 }, { n: 'Rear', a: W * H, f: FACE[b.rear] },
      { n: 'Left', a: D * H, f: FACE[b.left] }, { n: 'Right', a: D * H, f: FACE[b.right] }];
    var Ae = faces.reduce(function (s, x) { return s + x.a * x.f; }, 0);
    var Pd = b.dev.reduce(function (s, r) { return s + devLoss(r); }, 0);
    var Pc = b.cond.reduce(function (s, r) { return s + condLoss(r, T); }, 0);
    var Pb = num(b.busW);
    var Pf = b.fix.reduce(function (s, r) { return s + fixLoss(r); }, 0);
    var Pv = Pd + Pc + Pb + Pf, UA = k * Ae, Ta = num(b.Ta), Ti = num(b.Ti), dTmax = Ti - Ta;
    var p = 101325 * Math.pow(1 - 2.25577e-5 * num(b.alt), 5.25588), rho = p / (287.05 * (Ta + 273.15)), cp = 1005;
    var riseNoFan = UA > 0 ? Pv / UA : NaN, Qpassive = UA * Math.max(dTmax, 0), Qfan = Pv - Qpassive;
    var m = num(b.margin) / 100, Vreq = (dTmax > 0 && Qfan > 0) ? Qfan * 3600 / (rho * cp * dTmax) : 0, Vd = Vreq * (1 + m);
    var sizes = String(b.sizes).split(/[,;\s]+/).map(parseFloat).filter(function (x) { return x > 0; }).sort(function (a, c) { return a - c; });
    var opts = [];
    if (Vd > 0) for (var n = 1; n <= 8; n++) {
      for (var i = 0; i < sizes.length; i++) {
        if (n * sizes[i] >= Vd) {
          if (!opts.some(function (o) { return o.s === sizes[i] && o.n <= n; })) opts.push({ n: n, s: sizes[i], tot: n * sizes[i] });
          break;
        }
      }
    }
    var rec = opts[0] || null, riseFan = NaN;
    if (rec) { var Veff = rec.tot / (1 + m); riseFan = Pv / (UA + Veff * rho * cp / 3600); }
    var maxIn = b.dev.reduce(function (s, r) { return Math.max(s, num(r.In)); }, 0);
    return { W: W, H: H, D: D, k: k, faces: faces, Ae: Ae, Pd: Pd, Pc: Pc, Pb: Pb, Pf: Pf, Pv: Pv, UA: UA, Ta: Ta, Ti: Ti, dTmax: dTmax, p: p, rho: rho, cp: cp,
             riseNoFan: riseNoFan, Qpassive: Qpassive, Qfan: Qfan, m: m, Vreq: Vreq, Vd: Vd, opts: opts.slice(0, 4), rec: rec, riseFan: riseFan, maxIn: maxIn, sizes: sizes };
  }

  // the board data of the busbar calculator's inputs
  function boardFromInputs(inp, busW) {
    var rows = parseRows(inp.thermRows);
    return { W: inp.thermW, H: inp.thermH, D: inp.thermD, k: inp.thermK, top: inp.thermTop, rear: inp.thermRear, left: inp.thermLeft, right: inp.thermRight,
             Ta: inp.Troom, Ti: inp.thermTi, alt: inp.altitude, margin: inp.thermMargin, Tbar: inp.thermTbar, sizes: inp.thermSizes,
             dev: rows.dev, cond: rows.cond, fix: rows.fix, busW: busW };
  }
  // main busbar loss for the board model: loss per metre at In, scaled to the average current on the run, times the run length
  function busLossW(inp, res) {
    if (!res || !res.thermal || !res.thermal.lossPerMetre3ph) return 0;
    var In = Number(inp.In), I = Number(inp.thermBusI);
    var scale = In > 0 && I > 0 ? Math.pow(I / In, 2) : 1;
    return res.thermal.lossPerMetre3ph * scale * Number(inp.runLen) / 1000;
  }
  // air temperature around the busbars from the average rise: the position factors of the estimate (top 1.0, middle 0.75, bottom 0.5) are
  // relative to the top of the board, and the average air of the board is taken as mid-height
  function airAtBusbars(inp, board) {
    var rise = (board.rec && inp.thermFans !== 'no') ? board.riseFan : board.riseNoFan;
    if (!isFinite(rise)) rise = board.riseNoFan;
    var loc = BC.LOCATION_FACTOR[inp.location] || 1;
    return { rise: rise, T: board.Ta + rise * loc / 0.75, locFactor: loc / 0.75, withFans: !!(board.rec && inp.thermFans !== 'no') };
  }

  // Fixed-point solution: busbar temperature -> loss -> board air temperature -> busbar temperature.
  // Returns the inputs to pass to calculate() (internal air temperature specified) and the board result.
  function resolveBoard(rawInp) {
    var inp = Object.assign({}, BC.DEFAULT_INPUTS, rawInp || {});
    if (inp.internalMode !== 'board') return { inp: inp, board: null };
    var Tint = Number(inp.Troom) + 10, board = null, air = null, bw = 0, it, converged = false;
    for (it = 0; it < 8; it++) {
      var r = BC.calculate(Object.assign({}, inp, { internalMode: 'specify', Tinternal: Tint }), { coarse: true });
      if (r.errors && r.errors.length && !r.thermal) break;
      bw = busLossW(inp, r);
      board = boardThermal(boardFromInputs(inp, bw));
      air = airAtBusbars(inp, board);
      if (!isFinite(air.T)) break;
      if (Math.abs(air.T - Tint) < 0.05) { Tint = air.T; converged = true; break; }
      Tint = air.T;
    }
    if (!board || !air || !isFinite(Tint)) return { inp: Object.assign({}, inp, { internalMode: 'estimate' }), board: null, failed: true };
    return { inp: Object.assign({}, inp, { internalMode: 'specify', Tinternal: Tint }), board: board, air: air, busW: bw, Tint: Tint, iterations: it + 1, converged: converged };
  }

  BC.boardThermal = boardThermal;
  BC.boardFromInputs = boardFromInputs;
  BC.busLossW = busLossW;
  BC.airAtBusbars = airAtBusbars;
  BC.resolveBoard = resolveBoard;
  BC.parseBoardRows = parseRows;
  BC.THERM_DEFAULT_ROWS = DEFAULT_ROWS;
  return BC;
});
