/* Oran Analizi — web arayüzü */
(function () {
  'use strict';
  const E = window.Engine;
  const DEFAULT_BASE = 'https://raw.githubusercontent.com/dcoyusufko/oran-veri/main/data';
  const FALLBACK_BASE = 'https://raw.githubusercontent.com/Char2mant/futbol-veri-aynasi/main/data/fd';
  const LG_KEYS = Object.keys(E.LEAGUES);
  const $ = s => document.querySelector(s);

  // ---------- küçük depolama yardımcıları ----------
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('oa.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('oa.' + k, JSON.stringify(v)); } catch (e) { /* dolu ya da kapalı */ } },
  };
  const settings = {
    get base() { return ls.get('base', DEFAULT_BASE); }, set base(v) { ls.set('base', v.trim().replace(/\/+$/, '')); },
    get fixturesUrl() { return ls.get('fixturesUrl', ''); }, set fixturesUrl(v) { ls.set('fixturesUrl', v.trim()); },
    get pastSeasons() { return ls.get('pastSeasons', 4); }, set pastSeasons(v) { ls.set('pastSeasons', v); },
    get warmup() { return ls.get('warmup', 0); }, set warmup(v) { ls.set('warmup', v); },
    get couponCount() { return ls.get('couponCount', 4); }, set couponCount(v) { ls.set('couponCount', v); },
    get minOdds() { return ls.get('minOdds', 1.2); }, set minOdds(v) { ls.set('minOdds', v); },
    get lastUpdate() { return ls.get('lastUpdate', 0); }, set lastUpdate(v) { ls.set('lastUpdate', v); },
    get installDay() { let d = ls.get('installDay', null); if (d == null) { d = todayNum(); ls.set('installDay', d); } return d; },
  };

  // ---------- tarih/saat ----------
  const todayNum = () => Math.floor((Date.now() + 3 * 3600e3) / 86400e3); // İstanbul günü (UTC+3)
  const isoOfDay = n => new Date(n * 86400e3).toISOString().slice(0, 10);
  function londonOffsetMin(utcMs) {
    try {
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const p = {}; f.formatToParts(new Date(utcMs)).forEach(x => { p[x.type] = x.value; });
      const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
      return Math.round((asUtc - utcMs) / 60000);
    } catch (e) { return 60; }
  }
  /** football-data saatleri İngiltere saatidir → İstanbul (UTC+3). */
  function istDateTime(m) {
    if (!m.time || !/^\d{1,2}:\d{2}$/.test(m.time)) return { day: m.day, time: '' };
    const [hh, mm] = m.time.split(':').map(Number);
    const naive = m.day * 86400e3 + (hh * 60 + mm) * 60e3;
    const utc = naive - londonOffsetMin(naive) * 60e3;
    const ist = utc + 3 * 3600e3;
    const d = new Date(ist);
    return { day: Math.floor(ist / 86400e3), time: String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') };
  }
  const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  function dayTitle(n) {
    const d = new Date(n * 86400e3);
    const base = `${d.getUTCDate()} ${AYLAR[d.getUTCMonth()]} ${GUNLER[d.getUTCDay()]}`;
    const t = todayNum();
    return n === t ? 'Bugün · ' + base : n === t + 1 ? 'Yarın · ' + base : base;
  }

  // ---------- biçim ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = p => '%' + Math.round(p * 100);
  const pct1 = p => '%' + (p * 100).toFixed(1).replace('.', ',');
  const odds = x => x == null ? '—' : x.toFixed(2).replace('.', ',');
  const spct = x => (x >= 0 ? '+' : '−') + '%' + Math.abs(x * 100).toFixed(1).replace('.', ',');
  const pcol = p => p >= 0.60 ? 'var(--green)' : p >= 0.45 ? 'var(--green2)' : p >= 0.30 ? 'var(--amber)' : 'var(--grey)';
  const pchip = (label, p) => `<span class="pchip" style="color:${pcol(p)};background:color-mix(in srgb, ${pcol(p)} 14%, transparent)">${esc(label)} ${pct(p)}</span>`;

  // ---------- durum ----------
  const state = {
    tab: 'bulten', detail: null, busy: false, progress: '', messages: [], result: null,
    lg: { bulten: '', kupon: '', sonuc: '', bands: '' }, bandCode: '1', mode: 'GUVENLI',
    overrides: ls.get('overrides', {}),
  };

  // ---------- veri ----------
  function seasons() {
    const d = new Date(Date.now() + 3 * 3600e3);
    const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    const out = [];
    for (let k = settings.pastSeasons; k >= 0; k--) { const s = y - k; out.push(String(s % 100).padStart(2, '0') + String((s + 1) % 100).padStart(2, '0')); }
    return out;
  }
  const CACHE = 'oran-veri-v1';
  const mem = new Map();
  async function cacheGet(key) {
    try { if (window.caches) { const c = await caches.open(CACHE); const r = await c.match(key); if (r) return await r.text(); } } catch (e) { /* yok */ }
    return mem.get(key) || null;
  }
  async function cachePut(key, text) {
    mem.set(key, text);
    try { if (window.caches) { const c = await caches.open(CACHE); await c.put(key, new Response(text, { headers: { 'content-type': 'text/csv' } })); } } catch (e) { /* yok */ }
  }
  async function download(url) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) return null;
      const t = await r.text();
      return t.includes('HomeTeam') ? t : null;
    } catch (e) { return null; }
  }
  const fixturesUrl = () => settings.fixturesUrl || settings.base + '/fixtures.csv';

  /** Dosyaları getirir: eski sezonlar önbellekten, son iki sezon ve bülten internetten. */
  async function loadTexts(force) {
    const ss = seasons();
    const msgs = [];
    let fail = 0, done = 0;
    const jobs = [];
    ss.forEach((s, si) => LG_KEYS.forEach(lg => jobs.push({ key: `sezon/${s}/${lg}`, s, lg, fresh: force || si >= ss.length - 2 })));
    const total = jobs.length + 1;
    const step = () => { done++; setProgress(`Veriler indiriliyor… ${done}/${total}`); };
    const texts = await Promise.all(jobs.map(async j => {
      let t = j.fresh ? null : await cacheGet(j.key);
      if (!t) {
        t = await download(`${settings.base}/${j.s}/${j.lg}.csv`) || await download(`${FALLBACK_BASE}/${j.s}/${j.lg}.csv`);
        if (t) await cachePut(j.key, t); else t = await cacheGet(j.key);
        if (!t) fail++;
      }
      step();
      return t;
    }));
    let fx = await download(fixturesUrl());
    if (fx) await cachePut('fixtures', fx);
    else { fx = await cacheGet('fixtures'); msgs.push('Gelecek maç listesi indirilemedi' + (fx ? ', son kayıtlı liste kullanılıyor.' : '. İnternet bağlantını ya da Ayarlar\'daki adresi kontrol et.')); }
    step();
    if (fail) msgs.push(`${fail} sezon dosyası indirilemedi.`);
    return { texts: texts.filter(Boolean), fx, msgs };
  }

  function updateSnaps(upcoming) {
    const snaps = ls.get('snaps', {});
    for (const m of upcoming) {
      const cur = [...(m.avg || [0, 0, 0]), ...(m.avgOU || [0, 0])];
      if (cur.every(x => !x)) continue;
      if (!snaps[m.key]) snaps[m.key] = { f: cur, l: cur }; else snaps[m.key].l = cur;
    }
    const cutoff = isoOfDay(todayNum() - 800);
    for (const k of Object.keys(snaps)) { const d = k.split('|')[1]; if (!d || d < cutoff) delete snaps[k]; }
    ls.set('snaps', snaps);
    return snaps;
  }

  async function refresh(force = false) {
    if (state.busy) return;
    state.busy = true; setProgress('Veriler indiriliyor…');
    try {
      const { texts, fx, msgs } = await loadTexts(force);
      setProgress('Analiz ediliyor…');
      await new Promise(r => setTimeout(r, 30));
      const hist = new Map();
      texts.forEach(t => E.parseCsv(t, LG_KEYS).forEach(m => hist.set(m.key, m)));
      const histArr = [...hist.values()];
      const playedPairs = new Set(histArr.filter(E.played).map(m => `${m.lg}|${m.home}|${m.away}|${m.date}`));
      const t = todayNum();
      const fromFx = fx ? E.parseCsv(fx, LG_KEYS).filter(m => !E.played(m) && m.day >= t - 1 && !playedPairs.has(`${m.lg}|${m.home}|${m.away}|${m.date}`)) : [];
      const fromHist = histArr.filter(m => !E.played(m) && m.day >= t - 1);
      const upMap = new Map(); [...fromFx, ...fromHist].forEach(m => upMap.set(m.key, m));
      const upcoming = [...upMap.values()];
      const snaps = updateSnaps(upcoming);
      state.result = E.run(histArr, upcoming, snaps);
      if (!upcoming.length) msgs.push('Bültende maç yok. Gelecek maçlar genelde Salı ve Cuma günleri yayınlanır.');
      state.messages = msgs;
      settings.lastUpdate = Date.now();
    } catch (e) {
      state.messages = ['Hata: ' + (e && e.message || e)];
    }
    state.busy = false; setProgress('');
    render();
  }

  function setProgress(t) {
    state.progress = t;
    $('#progress').hidden = !state.busy;
    $('#sub').textContent = state.busy ? t : '';
    $('#refresh').disabled = state.busy;
  }

  // ---------- oranlar ----------
  const iddaaOdds = (mp, o) => (state.overrides[mp.match.key] || {})[o.code];
  const oddsOf = (mp, o) => iddaaOdds(mp, o) ?? E.avgOdds(mp.match, o);
  function setOverride(key, code, v) {
    const m = state.overrides[key] = state.overrides[key] || {};
    if (v == null || !(v > 1)) delete m[code]; else m[code] = v;
    if (!Object.keys(m).length) delete state.overrides[key];
    ls.set('overrides', state.overrides);
  }

  // ---------- ekranlar ----------
  function chips(which) {
    const cur = state.lg[which];
    return `<div class="chips">${[['', 'Tümü'], ...Object.entries(E.LEAGUES)].map(([k, v]) => `<button class="chip${cur === k ? ' on' : ''}" data-lg="${which}:${k}">${v}</button>`).join('')}</div>`;
  }
  const msgsHtml = () => state.messages.map(m => `<p class="note warn" style="margin:4px 16px">${esc(m)}</p>`).join('');

  function matchCard(mp) {
    const m = mp.match, it = istDateTime(m);
    const r = E.ranked(mp);
    let best = null;
    for (const { o, p } of r) { const od = oddsOf(mp, o); if (od != null && p >= 0.40) { const ev = p * od - 1; if (!best || ev > best.ev) best = { o, ev }; } }
    const hasOv = state.overrides[m.key];
    return `<div class="card tap" data-open="${esc(m.key)}">
      <div class="meta"><span>${E.LEAGUES[m.lg]} · ${it.time}</span>${hasOv ? '<span class="warn">iddaa oranı girildi</span>' : ''}</div>
      <div class="teams">${esc(m.home)} – ${esc(m.away)}</div>
      <div class="odds">1: ${odds(m.avg && m.avg[0])} &nbsp; X: ${odds(m.avg && m.avg[1])} &nbsp; 2: ${odds(m.avg && m.avg[2])} &nbsp; Ü: ${odds(m.avgOU && m.avgOU[0])} &nbsp; A: ${odds(m.avgOU && m.avgOU[1])}</div>
      <div class="pchips">${r.slice(0, 5).map(x => pchip(x.o.label, x.p)).join('')}</div>
      ${best && best.ev > 0 ? `<div class="value">Değerli görünen: ${best.o.label} (${spct(best.ev)})</div>` : ''}
    </div>`;
  }

  function viewBulten() {
    const r = state.result;
    let h = chips('bulten') + msgsHtml();
    if (!r) return h + (state.busy ? '' : '<div class="empty">Veri yok. Sağ üstteki yenile düğmesine bas.</div>');
    const list = r.upcoming.filter(mp => !state.lg.bulten || mp.match.lg === state.lg.bulten);
    const groups = new Map();
    list.forEach(mp => { const d = istDateTime(mp.match).day; if (!groups.has(d)) groups.set(d, []); groups.get(d).push(mp); });
    [...groups.keys()].sort((a, b) => a - b).forEach(d => {
      h += `<div class="day">${dayTitle(d)}</div>` + groups.get(d).sort((a, b) => istDateTime(a.match).time.localeCompare(istDateTime(b.match).time)).map(matchCard).join('');
    });
    if (!list.length && r.upcoming.length) h += '<div class="empty">Bu ligde bültende maç yok.</div>';
    return h;
  }

  function viewDetail(mp) {
    const m = mp.match, it = istDateTime(m);
    let h = `<div class="card"><div class="meta"><span>${E.LEAGUES[m.lg]} · ${dayTitle(it.day)} ${it.time}</span></div>
      <div class="teams" style="font-size:18px;white-space:normal">${esc(m.home)} – ${esc(m.away)}</div>
      ${E.played(m) ? `<div style="color:var(--primary);font-weight:650">Skor: ${m.hg} – ${m.ag}</div>` : ''}</div>`;
    h += `<div class="card"><h2>İhtimaller ve değer</h2>
      <p class="note">Adil oran = 1 / ihtimal. iddaa oranını girersen değer (beklenen getiri) o orana göre hesaplanır; boş bırakırsan ortalama oran kullanılır.</p>
      <table><tr><th>Sonuç</th><th>İhtimal</th><th>Adil</th><th>Ort.</th><th style="text-align:center">iddaa</th><th>Değer</th></tr>`;
    E.GKEYS.forEach(g => {
      E.GROUPS[g].labels.forEach((label, i) => {
        const o = E.OUTCOMES.find(x => x.g === g && x.i === i);
        const p = mp.ensemble[g] ? mp.ensemble[g][i] : null;
        const avg = E.avgOdds(m, o), idd = iddaaOdds(mp, o), use = idd ?? avg;
        const ev = p != null && use != null ? p * use - 1 : null;
        const last = i === E.GROUPS[g].labels.length - 1;
        h += `<tr class="${last ? 'sep' : ''}"><td class="b">${label}</td>
          <td class="b" style="color:${p != null ? pcol(p) : ''}">${p != null ? pct1(p) : '—'}</td>
          <td>${p != null ? odds(1 / p) : '—'}</td><td>${odds(avg)}</td>
          <td style="text-align:center"><input class="odd" inputmode="decimal" data-ov="${o.code}" value="${idd != null ? odds(idd) : ''}"></td>
          <td class="${ev == null ? '' : ev > 0 ? 'pos' : 'neg'}" data-ev="${o.code}">${ev == null ? '—' : spct(ev)}</td></tr>`;
      });
    });
    h += '</table></div>';
    h += `<div class="card"><h2>Yöntemlere göre</h2><p class="note">Her yöntemin kendi tahmini. Parantez içi, yöntemin o pazardaki güncel ağırlığıdır.</p>`;
    E.GKEYS.forEach(g => {
      const w = state.result.weights[g] || {};
      h += `<div style="margin-top:12px;font-weight:650;font-size:13.5px">${E.GROUPS[g].title}</div><table><tr><th>Yöntem</th>${E.GROUPS[g].labels.map(l => `<th>${l}</th>`).join('')}</tr>`;
      E.MKEYS.forEach(k => {
        const pr = mp.byMethod[k] && mp.byMethod[k][g]; if (!pr) return;
        h += `<tr><td>${E.METHODS[k].title} <span class="small">(${pct(w[k] || 0)})</span></td>${pr.map(v => `<td>${pct(v)}</td>`).join('')}</tr>`;
      });
      if (mp.ensemble[g]) h += `<tr><td class="b">Birleşik</td>${mp.ensemble[g].map(v => `<td class="b">${pct(v)}</td>`).join('')}</tr>`;
      h += '</table>';
    });
    h += '</div>';
    return h;
  }

  function viewKupon() {
    const r = state.result;
    const warm = settings.warmup - Math.floor((todayNum() - settings.installDay) / 7);
    if (warm > 0) return `<div class="card"><h2>Isınma süresi</h2><p class="note">Ayarlarda belirlediğin ısınma süresi dolmadı. Kupon önerisi ${warm} hafta sonra açılacak; bu sürede bülteni ve analizleri inceleyebilirsin.</p></div>`;
    const cnt = settings.couponCount, mo = settings.minOdds;
    let h = chips('kupon') + `<div class="card"><h2>Kupon ayarları</h2>
      <label class="f">Maç sayısı: <b id="cntv">${cnt}</b><input type="range" min="1" max="10" step="1" value="${cnt}" id="cnt"></label>
      <label class="f">En düşük oran: <b id="mov">${odds(mo)}</b><input type="range" min="1" max="2.5" step="0.05" value="${mo}" id="mo"></label>
      <div class="seg"><button data-mode="GUVENLI" class="${state.mode === 'GUVENLI' ? 'on' : ''}">En yüksek ihtimal</button><button data-mode="DEGER" class="${state.mode === 'DEGER' ? 'on' : ''}">En yüksek değer</button></div>
      <p class="note">${state.mode === 'GUVENLI' ? 'Her maçın en yüksek ihtimalli sonucu alınır, en güvenli görünen maçlar seçilir.' : 'İhtimali en az %40 olan ve oranı olması gerekenden yüksek görünen seçimler alınır. iddaa oranını maç ekranında girersen hesap o orana göre yapılır.'}</p></div>`;
    if (!r) return h;
    h += '<div id="coupon">' + couponHtml() + '</div>';
    h += `<div class="card"><h2>Geçmişte bu yaklaşım nasıl sonuç verdi?</h2>` +
      r.strategies.map(s => { const roi = s.n ? s.profit / s.n : 0; return `<div class="row"><span style="font-size:13px">${esc(s.name)}</span><span class="r small ${roi >= 0 ? 'pos' : 'neg'}">${s.n} seçim · ${pct(s.n ? s.hits / s.n : 0)} · getiri ${spct(roi)}</span></div>`; }).join('') +
      `<p class="note">Tek maçlık bahislerin geçmiş simülasyonudur (ortalama oranlarla). Negatif getiri, bahis şirketinin payının uzun vadede aleyhe çalıştığını gösterir. Bu uygulama bir analiz aracıdır; kazanç garantisi vermez.</p></div>`;
    return h;
  }

  function couponHtml() {
    const r = state.result;
    const preds = r.upcoming.filter(mp => !state.lg.kupon || mp.match.lg === state.lg.kupon);
    const c = E.buildCoupon(preds, settings.couponCount, state.mode, settings.minOdds, oddsOf);
    let h = '<div class="card"><h2>Önerilen kupon</h2>';
    if (!c.picks.length) return h + (state.mode === 'DEGER'
      ? '<p class="note">Şu an ortalama oranlara göre değerli görünen seçim yok. Bu normal: piyasa oranları çoğu zaman isabetlidir. Maç ekranında iddaa oranlarını girersen değer onlara göre yeniden hesaplanır.</p></div>'
      : '<p class="note">Bu ayarlarla uygun seçim bulunamadı. En düşük oranı azaltmayı dene.</p></div>');
    h += c.picks.map(pk => {
      const m = pk.mp.match, it = istDateTime(m);
      return `<div class="row tap" data-open="${esc(m.key)}" style="cursor:pointer"><div><div style="font-weight:600">${esc(m.home)} – ${esc(m.away)}</div><div class="small">${E.LEAGUES[m.lg]} · ${dayTitle(it.day)} ${it.time}</div></div>
        <div class="r"><div style="font-weight:650">${pk.o.label} @ ${odds(pk.odds)}</div><div class="small" style="color:${pcol(pk.p)}">${pct(pk.p)} · değer ${spct(pk.ev)}</div></div></div>`;
    }).join('');
    h += `<div class="stats3"><div><b>${pct1(c.prob)}</b><span class="small">Kazanma ihtimali</span></div><div><b>${odds(c.odds)}</b><span class="small">Toplam oran</span></div><div><b>${spct(c.ev)}</b><span class="small">Beklenen değer</span></div></div>`;
    if (c.picks.length < c.requested) h += `<p class="note warn">İstenen ${c.requested} maç yerine ${c.picks.length} uygun maç bulundu.</p>`;
    h += '<p class="note">Kazanma ihtimali, seçimlerin ihtimallerinin çarpımıdır (maçlar birbirinden bağımsız varsayılır). Maç sayısı arttıkça hızla düşer.</p></div>';
    return h;
  }

  function viewAnaliz() {
    const r = state.result;
    if (!r) return '<div class="empty">Veri yükleniyor…</div>';
    let h = `<div class="card"><h2>Nasıl çalışıyor?</h2><p class="note">Altı yöntemin her biri her maç için kendi ihtimalini üretir. Uygulama ${r.playedCount} geçmiş maçı tarih sırasıyla yeniden oynatır: her maçtan önce tahmin yapar, sonuç gelince hangi yöntemin daha isabetli olduğuna bakıp ağırlıkları günceller. Bültendeki ihtimaller bu ağırlıklarla birleştirilmiş sonuçtur. Yeni sonuçlar geldikçe ağırlıklar kendiliğinden değişir.</p>
      ${r.evalFrom ? `<p class="note">İstatistikler ${r.evalFrom.split('-').reverse().join('.')} tarihinden itibaren (ilk maçlar ısınma için kullanıldı).</p>` : ''}</div>`;
    E.GKEYS.forEach(g => {
      const w = r.weights[g];
      h += `<div class="card"><h2>${E.GROUPS[g].title} · yöntem ağırlıkları</h2><table><tr><th>Yöntem</th><th style="text-align:left">Ağırlık</th><th>Doğru</th><th>Brier</th></tr>`;
      Object.entries(w).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
        const s = r.stats[g][k];
        h += `<tr><td>${E.METHODS[k].title}</td><td style="width:34%"><div class="wrow"><div class="bar"><i style="width:${Math.max(1, v * 100)}%"></i></div><span class="small">${pct(v)}</span></div></td>
          <td>${s && s.n ? pct(s.correct / s.n) : '—'}</td><td>${s && s.n ? (s.brier / s.n).toFixed(3).replace('.', ',') : '—'}</td></tr>`;
      });
      const e = r.ensembleStats[g];
      if (e.n) h += `<tr><td class="b" colspan="2" style="border-top:1px solid var(--line)">Birleşik (${e.n} maç)</td><td class="b" style="border-top:1px solid var(--line)">${pct(e.correct / e.n)}</td><td class="b" style="border-top:1px solid var(--line)">${(e.brier / e.n).toFixed(3).replace('.', ',')}</td></tr>`;
      h += '</table>';
      if ('HAREKET' in w) h += '<p class="note">Oran hareketi yöntemi uygulama kullanıldıkça veri biriktirir; kendini kanıtlayana kadar ağırlığı düşük kalır.</p>';
      h += '</div>';
    });
    h += '<div class="card"><p class="note" style="margin:0">Doğru: en yüksek ihtimal verilen sonucun tutma oranı. Brier: ihtimallerin isabet hatası, düşük olan daha iyi.</p></div>';
    // Hangi oranlar tuttu
    h += `<div class="card"><h2>Hangi oranlar tuttu?</h2><p class="note">Geçmişte bu oran aralığındaki seçimlerin gerçekte ne sıklıkla tuttuğu. "Beklenen", oranın söylediği ihtimaldir (şirket payı düşülmüş). Gerçekleşen, beklenenden yüksekse o aralık tarihsel olarak iyi ödemiş demektir.</p></div>`;
    h += chips('bands');
    h += `<div class="chips">${E.OUTCOMES.filter(o => o.g !== 'KG').map(o => `<button class="chip${state.bandCode === o.code ? ' on' : ''}" data-band="${o.code}">${o.label}</button>`).join('')}</div>`;
    const arr = (r.bands[state.lg.bands] || {})[state.bandCode];
    h += '<div class="card">';
    if (!arr) h += '<p class="note">Veri yok.</p>';
    else {
      h += '<table><tr><th>Oran</th><th>Maç</th><th>Gerçek</th><th>Beklenen</th><th>Getiri</th></tr>';
      arr.forEach((b, i) => {
        if (!b.n) return;
        const real = b.hits / b.n, ex = b.implied / b.n, roi = b.profit / b.n;
        const lab = i === arr.length - 1 ? `${odds(E.ODDS_BANDS[i])}+` : `${odds(E.ODDS_BANDS[i])}–${odds(E.ODDS_BANDS[i + 1])}`;
        h += `<tr><td>${lab}</td><td>${b.n}</td><td class="b ${real > ex ? 'pos' : 'neg'}">${pct1(real)}</td><td>${pct1(ex)}</td><td class="${roi >= 0 ? 'pos' : 'neg'}">${spct(roi)}</td></tr>`;
      });
      h += '</table><p class="note">Getiri: bu aralıktaki her seçime ortalama oranla 1 birim yatırılsaydı birim başına kâr/zarar.</p>';
    }
    h += '</div><div class="card"><h2>Yöntemler</h2>' + E.MKEYS.map(k => `<div style="font-weight:650;font-size:13.5px;margin-top:8px">${E.METHODS[k].title}</div><p class="note">${E.METHODS[k].desc}</p>`).join('') + '</div>';
    return h;
  }

  function viewSonuc() {
    const r = state.result;
    let h = chips('sonuc');
    if (!r) return h;
    const rows = r.recent.filter(mp => !state.lg.sonuc || mp.match.lg === state.lg.sonuc).map(mp => {
      const top = E.ranked(mp)[0]; if (!top) return null;
      return { mp, top, hit: E.result(mp.match)[top.o.g] === top.o.i };
    }).filter(Boolean);
    h += '<div class="card"><h2>Son 3 hafta</h2>';
    if (!rows.length) h += '<p class="note">Henüz sonuç yok.</p>';
    else {
      const hits = rows.filter(x => x.hit).length, avgP = rows.reduce((a, x) => a + x.top.p, 0) / rows.length;
      h += `<div>En güçlü tahmin ${rows.length} maçın ${hits} tanesinde tuttu (${pct(hits / rows.length)}).</div><p class="note">Modelin bu tahminlere verdiği ortalama ihtimal ${pct(avgP)} idi. İkisi yakınsa model dengeli çalışıyor demektir.</p>`;
    }
    h += '</div><div class="card">' + rows.map(({ mp, top, hit }) => {
      const m = mp.match;
      return `<div class="row" data-open="${esc(m.key)}" style="cursor:pointer"><div><div style="font-weight:600">${esc(m.home)} ${m.hg} – ${m.ag} ${esc(m.away)}</div><div class="small">${E.LEAGUES[m.lg]} · ${dayTitle(m.day)}</div></div>
        <div class="r"><div style="font-size:13px">${top.o.label} ${pct(top.p)}</div><div style="font-weight:700;font-size:12px" class="${hit ? 'pos' : 'neg'}">${hit ? 'Tuttu' : 'Tutmadı'}</div></div></div>`;
    }).join('') + '</div>';
    return h;
  }

  // ---------- çizim ----------
  function findMatch(key) {
    const r = state.result; if (!r) return null;
    return r.upcoming.find(x => x.match.key === key) || r.recent.find(x => x.match.key === key) || null;
  }
  function render() {
    const main = $('#main');
    const d = state.detail && findMatch(state.detail);
    $('#back').hidden = !d;
    $('#title').firstChild.textContent = d ? 'Maç Analizi' : 'Oran Analizi';
    $('#tabs').style.display = d ? 'none' : '';
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
    main.innerHTML = d ? viewDetail(d) : state.tab === 'bulten' ? viewBulten() : state.tab === 'kupon' ? viewKupon() : state.tab === 'analiz' ? viewAnaliz() : viewSonuc();
  }

  function openDetail(key) { state.detail = key; history.pushState({ d: key }, ''); render(); window.scrollTo(0, 0); }
  function closeDetail() { if (state.detail) history.back(); }
  window.addEventListener('popstate', () => { if (state.detail) { state.detail = null; render(); } });

  // ---------- olaylar ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-lg],[data-open],[data-mode],[data-band]');
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; render(); window.scrollTo(0, 0); }
    else if (t.dataset.lg !== undefined) { const [w, k] = t.dataset.lg.split(':'); state.lg[w] = k; render(); }
    else if (t.dataset.open) openDetail(t.dataset.open);
    else if (t.dataset.mode) { state.mode = t.dataset.mode; render(); }
    else if (t.dataset.band) { state.bandCode = t.dataset.band; render(); }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'cnt') { settings.couponCount = +t.value; $('#cntv').textContent = t.value; $('#coupon').innerHTML = couponHtml(); }
    else if (t.id === 'mo') { settings.minOdds = +t.value; $('#mov').textContent = odds(+t.value); $('#coupon').innerHTML = couponHtml(); }
    else if (t.dataset.ov) {
      const mp = findMatch(state.detail); if (!mp) return;
      const v = parseFloat(t.value.replace(',', '.'));
      setOverride(mp.match.key, t.dataset.ov, isNaN(v) ? null : v);
      const o = E.OUTCOMES.find(x => x.code === t.dataset.ov);
      const p = mp.ensemble[o.g] && mp.ensemble[o.g][o.i], use = oddsOf(mp, o);
      const cell = document.querySelector(`[data-ev="${o.code}"]`);
      if (cell) { const ev = p != null && use != null ? p * use - 1 : null; cell.textContent = ev == null ? '—' : spct(ev); cell.className = ev == null ? '' : ev > 0 ? 'pos' : 'neg'; }
    }
  });
  $('#back').onclick = closeDetail;
  $('#refresh').onclick = () => refresh(false);
  $('#settings').onclick = openSettings;

  function openSettings() {
    const lu = settings.lastUpdate;
    $('#modal').innerHTML = `<div class="modal" id="mbg"><div class="sheet">
      <h2>Ayarlar</h2>
      <label class="f">Veri aynası adresi<input type="url" id="s-base" value="${esc(settings.base)}"></label>
      <p class="note">Sezon dosyaları bu adresin altında &lt;sezon&gt;/&lt;lig&gt;.csv olarak aranır.</p>
      <label class="f">Gelecek maçlar (boşsa: adres/fixtures.csv)<input type="url" id="s-fx" value="${esc(settings.fixturesUrl)}"></label>
      <label class="f">Geçmiş sezon sayısı: <b id="s-sv">${settings.pastSeasons}</b><input type="range" min="2" max="7" step="1" id="s-s" value="${settings.pastSeasons}"></label>
      <label class="f">Kupon ısınma süresi: <b id="s-wv">${settings.warmup}</b> hafta<input type="range" min="0" max="6" step="1" id="s-w" value="${settings.warmup}"></label>
      <p class="note">Geçmiş veri yüklendiği için ısınma şart değil. İstersen ilk haftalarda kupon önerisini kapatmak için kullan.</p>
      <p class="note">${lu ? 'Son güncelleme: ' + new Date(lu).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Henüz güncellenmedi.'}</p>
      <p class="note">Bu uygulama bir istatistik ve analiz aracıdır; gösterilen ihtimaller kazanç garantisi değildir. Bahis 18 yaş altına yasaktır.</p>
      <div class="btns"><button class="btn" id="s-cancel">Vazgeç</button><button class="btn p" id="s-save">Kaydet</button></div>
    </div></div>`;
    $('#s-s').oninput = e => { $('#s-sv').textContent = e.target.value; };
    $('#s-w').oninput = e => { $('#s-wv').textContent = e.target.value; };
    const close = () => { $('#modal').innerHTML = ''; };
    $('#s-cancel').onclick = close;
    $('#mbg').onclick = e => { if (e.target.id === 'mbg') close(); };
    $('#s-save').onclick = () => {
      const base = $('#s-base').value.trim().replace(/\/+$/, '') || DEFAULT_BASE, fx = $('#s-fx').value.trim(), s = +$('#s-s').value;
      const changed = base !== settings.base || fx !== settings.fixturesUrl || s !== settings.pastSeasons;
      settings.base = base; settings.fixturesUrl = fx; settings.pastSeasons = s; settings.warmup = +$('#s-w').value;
      close();
      if (changed) refresh(true); else render();
    };
  }

  // ---------- başlat ----------
  settings.installDay;
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  refresh(false);
})();
