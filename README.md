# Busbar Sizing Calculator

A browser-based calculator for low-voltage switchboard busbars. It sizes copper or aluminium bars for **continuous current with temperature rise**, checks **short-circuit thermal and mechanical withstand**, and gives **bolt size and tightening torque** for the bolted joints.

It's a static site (HTML/CSS/JavaScript, no build step), so you can host it on GitHub Pages or open `index.html` directly.

## What it calculates

| Area | Inputs | Outputs |
|---|---|---|
| **Enclosure & environment** | Room ambient, altitude, **IP rating**, **form of separation**, busbar position, or a specified/measured **internal air temperature** | Internal air temperature at the busbars, convection derating |
| **Continuous rating** | Material/temper, %IACS, bar size, bars per phase, gap, finish (emissivity), mounting, phase arrangement and spacing, max. bar temperature | Permissible current, hottest-bar temperature at Iₙ, heat-balance breakdown, losses (W/m), impedance (µΩ/m) |
| **AC effects** | Frequency | R<sub>ac</sub>/R<sub>dc</sub> (skin + proximity), current sharing between parallel bars, current-density map |
| **Short-circuit thermal** | I<sub>cw</sub>, duration, max. fault temperature | S<sub>min</sub>, end-of-fault temperature, withstand current of the section |
| **Short-circuit mechanical** (IEC 60865-1) | Peak factor (IEC 61439-1 Table 7), support type, span, spacer interval | Peak current, **peak force** on the centre phase and between sub-conductors, stresses vs. q·R<sub>p0.2</sub>, **maximum support span**, support (insulator) forces |
| **Bolted joints** | Bolt size/count (auto from bar width), grade, thread condition (nut factor), preload %, washers, overlap | Preload, **tightening torque**, contact pressure, washer bearing pressure, torque table M6–M20 |
| **Section finder** | All of the above | The lightest standard sections (1–4 bars per phase) that pass every check |

To share a calculation, click **Copy share link**. Your inputs are stored in the URL. To produce a report, use **Print report** (or print to PDF).

## Method (summary)

* **Internal air temperature:** θ<sub>air</sub> = θ<sub>room</sub> + ΔT<sub>IP</sub> × position factor + ΔT<sub>form</sub>. The defaults are editable under *Enclosure assumptions*. You can also enter a measured value or one from IEC TR 60890.
* **Heat balance per metre:** k<sub>ac</sub>·R<sub>dc</sub>(θ)·I² = Σ h·A·Δθ·f<sub>form</sub> + εσ(T⁴ − T<sub>air</sub>⁴)·P<sub>rad</sub>
  * Natural convection uses Churchill–Chu for vertical faces, McAdams for horizontal faces and Bar-Cohen–Rohsenow for the channels between parallel bars.
  * Air properties are taken at the film temperature and at the site pressure, so altitude is included.
  * Radiation leaves the envelope of each phase pack, reduced by the view factor to the adjacent phases.
* **AC resistance:** a 2-D filament (PEEC) model of all three phases. It reproduces the IEC 60287 skin-effect result for a round conductor to within 0.5 % (see the tests).
* **Short-circuit thermal:** adiabatic heating per IEC 60949, S<sub>min</sub> = I·√t / k, starting from the operating temperature.
* **Short-circuit forces:** IEC 60865-1 simplified method.
  * F<sub>m3</sub> = (μ₀/2π)(√3/2)i<sub>p</sub>²·l/a<sub>m</sub>
  * σ<sub>m</sub> = V<sub>σ</sub>V<sub>r</sub>·β·F<sub>m3</sub>·l/(8Z)
  * The effective distances a<sub>m</sub> and a<sub>s</sub> are integrated numerically for the actual rectangular sections.
* **Joints:** preload = % × proof stress × A<sub>s</sub> (ISO 898-1 / ISO 3506-1), torque T = K·F·d. Bolt patterns follow common practice (cf. DIN 43673 / CDA Pub. 22).

All formulas, assumptions and references are also listed on the page under *Method, assumptions and references*.

## Limitations

This tool is an **engineering aid**. It does not replace the IEC 61439-1 Clause 10 design verification (by test, by comparison with a tested reference design, or by assessment), and it does not replace the support or insulator manufacturer's data. It does not cover:

* Heat from adjacent devices, forced ventilation or solar gain
* Harmonics (apply them through the derating factor) and DC systems
* Neutral/PE sizing
* Dielectric correction above 2000 m
* Dynamic (natural-frequency) reduction of the short-circuit forces. Leaving this out is conservative.

## Project layout

```
index.html              page shell
css/styles.css          styles (light/dark, responsive, print)
js/busbar-engine.js     calculation engine (no DOM; also usable from Node)
js/app.js               form, results rendering, share link, section finder
tests/index.html        verification checks – open in a browser
```

### Running locally

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8765
```

Then go to http://localhost:8765. The verification checks are at http://localhost:8765/tests/.

### Using the engine from Node

```js
const BC = require('./js/busbar-engine.js');
const r = BC.calculate({ In: 2500, Icw: 55, width: 100, thick: 10, nBars: 2, ip: 'IP54', form: '4b' });
console.log(r.thermal.Iperm, r.sc.Smin, r.mech.lmax, r.joint.torque);
```

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository (for example `busbar-calculator`).
2. In the repository, open **Settings → Pages**, set **Source** to *Deploy from a branch*, and choose *main* with the */ (root)* folder.
3. The site is published at `https://<your-user>.github.io/busbar-calculator/`.

## License

MIT. See [LICENSE](LICENSE).
