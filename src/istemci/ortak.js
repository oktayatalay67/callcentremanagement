// Ortak istemci yardimcilari (v__SURUM__)  -  hem giris/uygulama hem kurulum sayfasinda kullanilir
const kok = document.getElementById('kok');
const SURUM = '__SURUM__';

function el(ad, ozellik, cocuklar) {
  const e = document.createElement(ad);
  const oz = ozellik || {};
  for (const k in oz) {
    const v = oz[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'metin') e.textContent = v;
    else if (k === 'deger') e.value = v;
    else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  (cocuklar || []).forEach((c) => {
    if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}

// Etiketli metin alani. secenek: { tip, deger, ipucu, devre, cok (textarea) }
function alan(etiket, ad, secenek) {
  const s = secenek || {};
  const o = { id: 'f_' + ad, name: ad, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', disabled: !!s.devre };
  let girdi;
  if (s.cok) { girdi = el('textarea', Object.assign(o, { rows: '3' })); girdi.value = s.deger || ''; }
  else {
    girdi = el('input', Object.assign(o, { type: s.tip || 'text' }));
    if (s.deger) girdi.value = s.deger;
  }
  if (s.ipucu) girdi.setAttribute('placeholder', s.ipucu);
  return el('div', null, [el('label', { 'for': 'f_' + ad, metin: etiket }), girdi]);
}

// secenekler: [[deger, etiket], ...]
function secim(etiket, ad, secenekler, secili, devre) {
  const s = el('select', { id: 'f_' + ad, name: ad, disabled: !!devre });
  secenekler.forEach((x) => {
    const o = el('option', { value: x[0], metin: x[1] });
    if (x[0] === secili) o.selected = true;
    s.appendChild(o);
  });
  return el('div', null, [el('label', { 'for': 'f_' + ad, metin: etiket }), s]);
}

function deger(ad) { return document.getElementById('f_' + ad).value; }

function api(yol, govde, yontem, basliklar) {
  const secenek = { method: yontem || (govde ? 'POST' : 'GET'), credentials: 'same-origin', headers: {} };
  if (govde) { secenek.headers['Content-Type'] = 'application/json'; secenek.body = JSON.stringify(govde); }
  if (basliklar) { for (const k in basliklar) secenek.headers[k] = basliklar[k]; }
  return fetch(yol, secenek).then((r) =>
    r.json().catch(() => null).then((j) => {
      if (r.status === 401 && yol !== '/api/giris' && typeof window.oturumDustu === 'function') window.oturumDustu();
      return { ok: r.ok, durum: r.status, j: j };
    })
  ).catch(() => ({ ok: false, durum: 0, j: { mesaj: 'Sunucuya ulaşılamadı.' } }));
}

function mesaj(kutu, sinif, metin) {
  kutu.className = sinif;
  kutu.textContent = metin;
  kutu.style.display = metin ? 'block' : 'none';
}
function hataMetni(s, varsayilan) { return (s && s.j && s.j.mesaj) || varsayilan || 'İşlem başarısız.'; }
function tarih(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}
