/* Oran Analizi — analiz motoru (Android sürümündeki Kotlin motorunun birebir karşılığı) */
(function (root) {
  'use strict';

  const GROUPS = {
    MS: { labels: ['MS1', 'MSX', 'MS2'], codes: ['1', 'X', '2'], title: 'Maç Sonucu' },
    AU: { labels: ['2.5 Üst', '2.5 Alt'], codes: ['U', 'A'], title: '2.5 Alt/Üst' },
    KG: { labels: ['KG Var', 'KG Yok'], codes: ['KGV', 'KGY'], title: 'Karşılıklı Gol' },
  };
  const GKEYS = ['MS', 'AU', 'KG'];
  const OUTCOMES = [];
  GKEYS.forEach(g => GROUPS[g].labels.forEach((l, i) => OUTCOMES.push({ g, i, label: l, code: GROUPS[g].codes[i] })));

  const METHODS = {
    PIYASA: { title: 'Piyasa', desc: 'Bahis şirketlerinin ortalama oranından, şirket payı düşülerek hesaplanan ihtimal.' },
    KALIBRASYON: { title: 'Oran bandı istatistiği', desc: 'Geçmişte benzer oran bandındaki sonuçların gerçekte ne sıklıkla tuttuğu.' },
    BENZER: { title: 'Benzer oran eşleştirme', desc: 'Oran profili bu maça en çok benzeyen 150 geçmiş maçın nasıl bittiği.' },
    POISSON: { title: 'Takım gücü (Poisson)', desc: 'Takımların attığı/yediği gollerden hücum-savunma gücü ve beklenen gol.' },
    KESKIN: { title: 'Keskin piyasa', desc: 'Düşük paylı Pinnacle / Betfair borsası oranlarından hesaplanan ihtimal.' },
    HAREKET: { title: 'Oran hareketi', desc: 'Uygulamanın kaydettiği ilk ve son oran arasındaki değişimin yönü.' },
  };
  const MKEYS = Object.keys(METHODS);

  const LEAGUES = { T1: 'Süper Lig', E0: 'Premier Lig', D1: 'Bundesliga', SP1: 'La Liga', I1: 'Serie A' };

  // ---------- yardımcılar ----------
  function devig(odds) {
    if (!odds || odds.some(o => !(o > 1))) return null;
    const inv = odds.map(o => 1 / o);
    const s = inv.reduce((a, b) => a + b, 0);
    return inv.map(x => x / s);
  }
  const dayNum = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);

  // ---------- CSV ----------
  function splitLine(line) {
    if (line.indexOf('"') < 0) return line.split(',');
    const out = []; let cur = ''; let q = false;
    for (const c of line) {
      if (c === '"') q = !q;
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  function parseDate(s) {
    const p = s.trim().split('/');
    if (p.length !== 3) return null;
    let y = parseInt(p[2], 10); if (y < 100) y += 2000;
    const m = parseInt(p[1], 10), d = parseInt(p[0], 10);
    if (!y || !m || !d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function parseCsv(text, leagues) {
    const lines = text.replace(/^﻿/, '').split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
    if (!lines.length) return [];
    const head = splitLine(lines[0]).map(h => h.trim().replace(/^﻿/, ''));
    const idx = {};
    head.forEach((h, i) => { if (h && !(h in idx)) idx[h] = i; });
    const out = [];
    for (let li = 1; li < lines.length; li++) {
      const c = splitLine(lines[li]);
      const s = k => { const i = idx[k]; if (i === undefined) return null; const v = (c[i] || '').trim(); return v || null; };
      const d = (...ks) => { for (const k of ks) { const v = parseFloat(s(k)); if (v > 1) return v; } return null; };
      const arr = (...xs) => xs.every(x => x != null) ? xs : null;
      const lg = s('Div'); if (!lg) continue;
      if (leagues && !leagues.includes(lg)) continue;
      const ds = s('Date'); const date = ds && parseDate(ds); if (!date) continue;
      const home = s('HomeTeam') || s('HT'); const away = s('AwayTeam') || s('AT');
      if (!home || !away) continue;
      const hgS = s('FTHG') ?? s('HG'), agS = s('FTAG') ?? s('AG');
      const hg = hgS != null && /^\d+$/.test(hgS) ? parseInt(hgS, 10) : null;
      const ag = agS != null && /^\d+$/.test(agS) ? parseInt(agS, 10) : null;
      out.push({
        lg, date, day: dayNum(date), time: s('Time'), home, away, hg, ag,
        avg: arr(d('AvgH', 'BbAvH', 'B365H'), d('AvgD', 'BbAvD', 'B365D'), d('AvgA', 'BbAvA', 'B365A')),
        avgOU: arr(d('Avg>2.5', 'BbAv>2.5', 'B365>2.5'), d('Avg<2.5', 'BbAv<2.5', 'B365<2.5')),
        sharp: arr(d('PSH', 'BFEH'), d('PSD', 'BFED'), d('PSA', 'BFEA')),
        sharpOU: arr(d('P>2.5', 'BFE>2.5'), d('P<2.5', 'BFE<2.5')),
        max: arr(d('MaxH', 'BbMxH'), d('MaxD', 'BbMxD'), d('MaxA', 'BbMxA')),
        maxOU: arr(d('Max>2.5', 'BbMx>2.5'), d('Max<2.5', 'BbMx<2.5')),
        key: `${lg}|${date}|${home}|${away}`,
      });
    }
    return out;
  }
  const played = m => m.hg != null && m.ag != null;
  function result(m) {
    const h = m.hg, a = m.ag;
    return { MS: h > a ? 0 : h === a ? 1 : 2, AU: h + a > 2 ? 0 : 1, KG: h > 0 && a > 0 ? 0 : 1 };
  }
  function avgOdds(m, o) {
    if (o.g === 'MS') return m.avg ? m.avg[o.i] : null;
    if (o.g === 'AU') return m.avgOU ? m.avgOU[o.i] : null;
    return null;
  }

  // ---------- 1) Piyasa ve 5) Keskin piyasa ----------
  const Market = () => ({
    id: 'PIYASA',
    predict(m) { const o = {}; const p = devig(m.avg), q = devig(m.avgOU); if (p) o.MS = p; if (q) o.AU = q; return o; },
    update() {},
  });
  const Sharp = () => ({
    id: 'KESKIN',
    predict(m) { const o = {}; const p = devig(m.sharp), q = devig(m.sharpOU); if (p) o.MS = p; if (q) o.AU = q; return o; },
    update() {},
  });

  // ---------- 2) Oran bandı istatistiği ----------
  function Calibration() {
    const BIN = 0.05, NB = 20, PRIOR = 20;
    const t = new Map();
    const b = p => Math.min(Math.floor(p / BIN), NB - 1);
    const cal = (k, p) => { const c = t.get(k); return c ? (c[1] + PRIOR * p) / (c[0] + PRIOR) : p; };
    const add = (k, hit) => { let c = t.get(k); if (!c) { c = [0, 0]; t.set(k, c); } c[0]++; if (hit) c[1]++; };
    return {
      id: 'KALIBRASYON',
      predict(m) {
        const out = {};
        const p = devig(m.avg);
        if (p) { const q = [0, 1, 2].map(i => cal(`MS${i}:${b(p[i])}`, p[i])); const s = q[0] + q[1] + q[2]; out.MS = q.map(x => x / s); }
        const po = devig(m.avgOU);
        if (po) {
          const q = [0, 1].map(i => cal(`AU${i}:${b(po[i])}`, po[i])); const s = q[0] + q[1]; out.AU = q.map(x => x / s);
          const y = cal(`KG:${b(po[0])}`, 0.5); out.KG = [y, 1 - y];
        }
        return out;
      },
      update(m, oc) {
        const p = devig(m.avg); if (p) for (let i = 0; i < 3; i++) add(`MS${i}:${b(p[i])}`, oc.MS === i);
        const po = devig(m.avgOU);
        if (po) { for (let i = 0; i < 2; i++) add(`AU${i}:${b(po[i])}`, oc.AU === i); add(`KG:${b(po[0])}`, oc.KG === 0); }
      },
    };
  }

  // ---------- 3) Benzer oran eşleştirme ----------
  function Similar(K = 150) {
    const PRIOR = 10;
    let fH = new Float64Array(4096), fA = new Float64Array(4096), fO = new Float64Array(4096), ocs = new Int8Array(4096);
    let size = 0;
    let dist = new Float64Array(4096);
    const heap = new Int32Array(K); // k en yakın (max-heap, dist'e göre)
    return {
      id: 'BENZER',
      predict(m) {
        const p = devig(m.avg), po = devig(m.avgOU);
        if (!p || !po || size < K) return {};
        if (dist.length < size) dist = new Float64Array(fH.length);
        for (let i = 0; i < size; i++) { const a = fH[i] - p[0], b = fA[i] - p[2], c = fO[i] - po[0]; dist[i] = a * a + b * b + c * c; }
        // max-heap ile k en küçük
        let n = 0;
        const up = j => { while (j > 0) { const pa = (j - 1) >> 1; if (dist[heap[pa]] >= dist[heap[j]]) break; const t = heap[pa]; heap[pa] = heap[j]; heap[j] = t; j = pa; } };
        const down = j => { for (;;) { const l = 2 * j + 1, r = l + 1; let mx = j; if (l < n && dist[heap[l]] > dist[heap[mx]]) mx = l; if (r < n && dist[heap[r]] > dist[heap[mx]]) mx = r; if (mx === j) break; const t = heap[mx]; heap[mx] = heap[j]; heap[j] = t; j = mx; } };
        for (let i = 0; i < size; i++) {
          if (n < K) { heap[n] = i; up(n); n++; }
          else if (dist[i] < dist[heap[0]]) { heap[0] = i; down(0); }
        }
        const ms = [0, 0, 0], au = [0, 0], kg = [0, 0];
        for (let j = 0; j < n; j++) { const o = ocs[heap[j]]; ms[(o / 4) | 0]++; au[((o / 2) | 0) % 2]++; kg[o % 2]++; }
        return {
          MS: ms.map((c, i) => (c + PRIOR * p[i]) / (K + PRIOR)),
          AU: au.map((c, i) => (c + PRIOR * po[i]) / (K + PRIOR)),
          KG: kg.map(c => (c + PRIOR * 0.5) / (K + PRIOR)),
        };
      },
      update(m, oc) {
        const p = devig(m.avg), po = devig(m.avgOU);
        if (!p || !po) return;
        if (size === fH.length) {
          const g = a => { const b = new a.constructor(a.length * 2); b.set(a); return b; };
          fH = g(fH); fA = g(fA); fO = g(fO); ocs = g(ocs);
        }
        fH[size] = p[0]; fA[size] = p[2]; fO[size] = po[0]; ocs[size] = oc.MS * 4 + oc.AU * 2 + oc.KG; size++;
      },
    };
  }

  // ---------- 4) Takım gücü (Poisson) ----------
  const FACT = [1]; for (let i = 1; i <= 10; i++) FACT[i] = FACT[i - 1] * i;
  function scoreProbs(lh, la, rho) {
    const ph = [], pa = [];
    for (let i = 0; i <= 10; i++) { ph[i] = Math.exp(-lh) * Math.pow(lh, i) / FACT[i]; pa[i] = Math.exp(-la) * Math.pow(la, i) / FACT[i]; }
    let h = 0, d = 0, a = 0, o = 0, by = 0, tot = 0;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      let p = ph[i] * pa[j];
      if (i === 0 && j === 0) p *= 1 - lh * la * rho;
      else if (i === 0 && j === 1) p *= 1 + lh * rho;
      else if (i === 1 && j === 0) p *= 1 + la * rho;
      else if (i === 1 && j === 1) p *= 1 - rho;
      tot += p;
      if (i > j) h += p; else if (i === j) d += p; else a += p;
      if (i + j > 2) o += p;
      if (i > 0 && j > 0) by += p;
    }
    return { MS: [h / tot, d / tot, a / tot], AU: [o / tot, 1 - o / tot], KG: [by / tot, 1 - by / tot] };
  }
  function Poisson() {
    const HALF = 240, PRIOR = 5, RHO = -0.08;
    const team = new Map(), league = new Map();
    const factor = (r, day) => r.last == null ? 1 : Math.pow(0.5, (day - r.last) / HALF);
    const decay = (r, day) => { const f = factor(r, day); r.a *= f; r.b *= f; r.n *= f; r.last = day; };
    function lambdas(m) {
      const L = league.get(m.lg); if (!L) return null;
      if (L.n * factor(L, m.day) < 30) return null;
      const avgH = L.a / L.n, avgA = L.b / L.n, mu = (avgH + avgA) / 2;
      const st = t => {
        const r = team.get(m.lg + '|' + t); if (!r) return [0.85, 1.15];
        const f = factor(r, m.day); const gf = r.a * f, ga = r.b * f, n = r.n * f;
        return [(gf + PRIOR * mu * 0.95) / (n * mu + PRIOR * mu), (ga + PRIOR * mu * 1.05) / (n * mu + PRIOR * mu)];
      };
      const [ah, dh] = st(m.home), [aa, da] = st(m.away);
      return [avgH * ah * da, avgA * aa * dh];
    }
    return {
      id: 'POISSON', lambdas,
      predict(m) { const l = lambdas(m); return l ? scoreProbs(l[0], l[1], RHO) : {}; },
      update(m) {
        let L = league.get(m.lg); if (!L) { L = { a: 0, b: 0, n: 0, last: null }; league.set(m.lg, L); }
        decay(L, m.day); L.a += m.hg; L.b += m.ag; L.n += 1;
        for (const [t, gf, ga] of [[m.home, m.hg, m.ag], [m.away, m.ag, m.hg]]) {
          const k = m.lg + '|' + t; let r = team.get(k); if (!r) { r = { a: 0, b: 0, n: 0, last: null }; team.set(k, r); }
          decay(r, m.day); r.a += gf; r.b += ga; r.n += 1;
        }
      },
    };
  }

  // ---------- 6) Oran hareketi ----------
  function Movement(snaps) {
    const BETA = 1.0;
    const move = (f, l) => {
      const pf = devig(f), pl = devig(l);
      if (!pf || !pl) return null;
      if (pf.every((x, i) => Math.abs(x - pl[i]) < 0.005)) return null;
      const q = pl.map((x, i) => Math.min(0.99, Math.max(0.01, x + BETA * (x - pf[i]))));
      const s = q.reduce((a, b) => a + b, 0);
      return q.map(x => x / s);
    };
    return {
      id: 'HAREKET',
      predict(m) {
        const s = snaps[m.key]; if (!s) return {};
        const o = {};
        const a = move(s.f.slice(0, 3), s.l.slice(0, 3)); if (a) o.MS = a;
        const b = move(s.f.slice(3, 5), s.l.slice(3, 5)); if (b) o.AU = b;
        return o;
      },
      update() {},
    };
  }

  // ---------- Topluluk ağırlıkları (Hedge) ----------
  function Ensemble(ids) {
    const ETA = 0.2, SHARE = 0.002, FLOOR = 0.02;
    const w = {};
    for (const g of GKEYS) {
      w[g] = {};
      ids.forEach(k => { w[g][k] = k === 'HAREKET' ? FLOOR : 1; });
      const s = Object.values(w[g]).reduce((a, b) => a + b, 0);
      ids.forEach(k => { w[g][k] /= s; });
    }
    return {
      w,
      combine(preds) {
        const out = {};
        for (const g of GKEYS) {
          const av = ids.filter(k => preds[k] && preds[k][g]);
          if (!av.length) continue;
          const ws = av.reduce((a, k) => a + w[g][k], 0);
          const n = GROUPS[g].labels.length;
          out[g] = [];
          for (let i = 0; i < n; i++) out[g][i] = av.reduce((a, k) => a + w[g][k] * preds[k][g][i], 0) / ws;
        }
        return out;
      },
      update(preds, ens, oc) {
        for (const g of GKEYS) {
          const e = ens[g]; if (!e) continue;
          const y = oc[g];
          const le = -Math.log(Math.max(e[y], 1e-6));
          const wg = w[g];
          const part = ids.filter(k => preds[k] && preds[k][g]);
          if (part.length < 2) continue;
          const mass = part.reduce((a, k) => a + wg[k], 0);
          for (const k of part) { const li = -Math.log(Math.max(preds[k][g][y], 1e-6)); wg[k] *= Math.exp(-ETA * (li - le)); }
          const s = part.reduce((a, k) => a + wg[k], 0);
          for (const k of part) wg[k] = Math.max(((1 - SHARE) * wg[k] / s + SHARE / part.length) * mass, FLOOR);
          const t = Object.values(wg).reduce((a, b) => a + b, 0);
          for (const k of Object.keys(wg)) wg[k] /= t;
        }
      },
      weightsFor(g, avail) {
        const sub = avail.filter(k => k in w[g]);
        const s = sub.reduce((a, k) => a + w[g][k], 0);
        const o = {}; sub.forEach(k => { o[k] = w[g][k] / s; }); return o;
      },
    };
  }

  // ---------- İstatistikler ----------
  function MethodStat() { return { n: 0, logLoss: 0, brier: 0, correct: 0 }; }
  function addStat(s, p, y) {
    s.n++; s.logLoss += -Math.log(Math.max(p[y], 1e-6));
    s.brier += p.reduce((a, v, i) => a + (v - (i === y ? 1 : 0)) ** 2, 0);
    let best = 0; for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
    if (best === y) s.correct++;
  }
  const ODDS_BANDS = [1.0, 1.30, 1.50, 1.70, 2.00, 2.50, 3.20, 4.50, 1000];
  function bandOf(o) { for (let i = 0; i < ODDS_BANDS.length - 1; i++) if (o < ODDS_BANDS[i + 1]) return i; return ODDS_BANDS.length - 2; }

  const WARMUP = 1500;

  function run(all, upcoming, snaps, recentDays = 21) {
    const methods = [Market(), Calibration(), Similar(), Poisson(), Sharp(), Movement(snaps || {})];
    const ids = methods.map(m => m.id);
    const ens = Ensemble(ids);
    const pl = all.filter(played).sort((a, b) => a.day - b.day || (a.lg < b.lg ? -1 : a.lg > b.lg ? 1 : 0) || (a.home < b.home ? -1 : a.home > b.home ? 1 : 0));
    const stats = {}; GKEYS.forEach(g => { stats[g] = {}; });
    const ensStats = {}; GKEYS.forEach(g => { ensStats[g] = MethodStat(); });
    const bands = {};
    const strategies = [
      { name: 'Her maçta en yüksek ihtimal (MS)', n: 0, hits: 0, profit: 0 },
      { name: 'Değer > %0 (ortalama oran)', n: 0, hits: 0, profit: 0 },
      { name: 'Değer > %5 (ortalama oran)', n: 0, hits: 0, profit: 0 },
      { name: 'Değer > %0 (en yüksek oran)', n: 0, hits: 0, profit: 0 },
    ];
    const recent = [];
    const lastDay = pl.length ? pl[pl.length - 1].day : null;
    let evalFrom = null, seen = 0;
    const predictAll = m => { const p = {}; for (const mt of methods) { const r = mt.predict(m); if (Object.keys(r).length) p[mt.id] = r; } return p; };

    let i = 0;
    while (i < pl.length) {
      let j = i; while (j < pl.length && pl[j].day === pl[i].day) j++;
      const day = pl.slice(i, j);
      const preds = day.map(predictAll);
      const enss = preds.map(p => ens.combine(p));
      for (let x = 0; x < day.length; x++) {
        const m = day[x], p = preds[x], e = enss[x], oc = result(m);
        if (seen >= WARMUP) {
          if (evalFrom == null) evalFrom = m.date;
          for (const k of Object.keys(p)) for (const g of Object.keys(p[k])) { stats[g][k] = stats[g][k] || MethodStat(); addStat(stats[g][k], p[k][g], oc[g]); }
          for (const g of Object.keys(e)) addStat(ensStats[g], e[g], oc[g]);
          evalStrategies(m, e, oc, strategies);
        }
        addBands(bands, m, oc);
        if (lastDay != null && m.day >= lastDay - recentDays) recent.push({ match: m, ensemble: e, byMethod: p });
        ens.update(p, e, oc);
        for (const mt of methods) mt.update(m, oc);
        seen++;
      }
      i = j;
    }
    const up = upcoming.slice().sort((a, b) => a.day - b.day || String(a.time || '').localeCompare(String(b.time || '')) || a.lg.localeCompare(b.lg))
      .map(m => { const p = predictAll(m); return { match: m, ensemble: ens.combine(p), byMethod: p }; });
    const canPredict = { MS: MKEYS, AU: MKEYS, KG: ['KALIBRASYON', 'BENZER', 'POISSON'] };
    const weights = {}; GKEYS.forEach(g => { weights[g] = ens.weightsFor(g, canPredict[g]); });
    return { upcoming: up, recent: recent.reverse(), weights, stats, ensembleStats: ensStats, bands, strategies, playedCount: pl.length, evalFrom };
  }

  function evalStrategies(m, e, oc, st) {
    const ms = e.MS, avg = m.avg; if (!ms || !avg) return;
    const y = oc.MS;
    const bet = (s, i, odds) => { s.n++; if (i === y) { s.hits++; s.profit += odds - 1; } else s.profit -= 1; };
    let top = 0; for (let i = 1; i < 3; i++) if (ms[i] > ms[top]) top = i;
    bet(st[0], top, avg[top]);
    for (let i = 0; i < 3; i++) {
      const ev = ms[i] * avg[i] - 1;
      if (ev > 0) bet(st[1], i, avg[i]);
      if (ev > 0.05) bet(st[2], i, avg[i]);
      if (m.max && ms[i] * m.max[i] - 1 > 0) bet(st[3], i, m.max[i]);
    }
  }

  function addBands(bands, m, oc) {
    for (const lg of ['', m.lg]) {
      const t = bands[lg] = bands[lg] || {};
      for (const o of OUTCOMES) {
        const odds = avgOdds(m, o); if (odds == null) continue;
        const probs = devig(o.g === 'MS' ? m.avg : m.avgOU); if (!probs) continue;
        const arr = t[o.code] = t[o.code] || ODDS_BANDS.slice(1).map(() => ({ n: 0, hits: 0, implied: 0, profit: 0 }));
        const b = arr[bandOf(odds)];
        const hit = oc[o.g] === o.i;
        b.n++; b.implied += probs[o.i];
        if (hit) { b.hits++; b.profit += odds - 1; } else b.profit -= 1;
      }
    }
  }

  // ---------- Kupon ----------
  function ranked(mp) {
    return OUTCOMES.filter(o => mp.ensemble[o.g]).map(o => ({ o, p: mp.ensemble[o.g][o.i] })).sort((a, b) => b.p - a.p);
  }
  function buildCoupon(preds, count, mode, minOdds, oddsOf, minProbForValue = 0.40) {
    const cands = [];
    for (const mp of preds) {
      const opts = [];
      for (const o of OUTCOMES) {
        const e = mp.ensemble[o.g]; if (!e) continue;
        const odds = oddsOf(mp, o); if (odds == null || odds < minOdds) continue;
        const p = e[o.i];
        opts.push({ mp, o, p, odds, ev: p * odds - 1 });
      }
      let best = null;
      if (mode === 'GUVENLI') { for (const x of opts) if (!best || x.p > best.p) best = x; }
      else { for (const x of opts) if (x.p >= minProbForValue && x.ev > 0 && (!best || x.ev > best.ev)) best = x; }
      if (best) cands.push(best);
    }
    cands.sort((a, b) => mode === 'GUVENLI' ? b.p - a.p : b.ev - a.ev);
    const picks = cands.slice(0, count);
    const prob = picks.reduce((a, x) => a * x.p, 1), odds = picks.reduce((a, x) => a * x.odds, 1);
    return { picks, requested: count, prob, odds, ev: prob * odds - 1 };
  }

  const api = { GROUPS, GKEYS, OUTCOMES, METHODS, MKEYS, LEAGUES, ODDS_BANDS, devig, parseCsv, played, result, avgOdds, scoreProbs, run, ranked, buildCoupon, bandOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);
