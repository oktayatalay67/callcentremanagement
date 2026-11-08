// =====================================================================
// src/sayfalar.js  -  Arayuz sayfalari ve istemci kodu (v0.4.0)
// Sayfa kodu ayri dosya olarak sunulur (/app.js, /kurulum.js) cunku
// icerik guvenlik politikasi (CSP) satir ici betige izin vermez.
// DIKKAT: Asagidaki istemci kodlarinda ters tirnak ve dolar-suslu parantez YOK.
// =====================================================================
export const SURUM_ETIKETI = 'v0.4.0';

const STIL = `
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f3f5f8;color:#1c2430}
main{max-width:420px;margin:8vh auto;padding:0 16px}
.kart{background:#fff;border:1px solid #dde3ea;border-radius:10px;padding:28px}
h1{font-size:20px;margin:0 0 4px}
.alt{color:#5c6b7d;font-size:13px;margin:0 0 20px}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 4px}
input{width:100%;padding:10px 12px;font-size:15px;border:1px solid #b9c4d0;border-radius:6px}
input:focus{outline:2px solid #2f6fdb;border-color:#2f6fdb}
button{margin-top:20px;width:100%;padding:11px;font-size:15px;font-weight:600;color:#fff;background:#2f6fdb;border:0;border-radius:6px;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
button.ikincil{background:#fff;color:#2f6fdb;border:1px solid #2f6fdb;margin-top:12px}
.hata{margin-top:14px;padding:10px 12px;background:#fdecea;color:#8a1c14;border-radius:6px;font-size:14px}
.basari{margin-top:14px;padding:10px 12px;background:#e6f4ea;color:#14532d;border-radius:6px;font-size:14px}
dl{margin:16px 0 0;font-size:14px}dt{color:#5c6b7d;font-size:12px;margin-top:10px}dd{margin:2px 0 0;font-weight:600}
.sürüm{text-align:center;color:#8a96a5;font-size:12px;margin-top:14px}
a{color:#2f6fdb}
`;

function sayfa(baslik, betik) {
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + baslik + '</title><style>' + STIL + '</style></head>' +
    '<body><main id="kok"></main><script src="' + betik + '"></script></body></html>';
}

export const girisSayfasi = () => sayfa('Çağrı Merkezi Platformu', '/app.js');
export const kurulumSayfasi = () => sayfa('Platform Kurulumu', '/kurulum.js');

// ---- Ortak istemci yardimcilari (iki betikte de kullanilir) ----
const ORTAK = `
var kok = document.getElementById('kok');
function el(ad, ozellik, cocuklar) {
  var e = document.createElement(ad);
  if (ozellik) { for (var k in ozellik) { if (k === 'metin') { e.textContent = ozellik[k]; } else { e.setAttribute(k, ozellik[k]); } } }
  (cocuklar || []).forEach(function (c) { if (c) { e.appendChild(c); } });
  return e;
}
function alan(etiket, ad, tip, ipucu) {
  var giris = el('input', { type: tip || 'text', name: ad, id: 'f_' + ad, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  if (ipucu) { giris.setAttribute('placeholder', ipucu); }
  return el('div', null, [el('label', { 'for': 'f_' + ad, metin: etiket }), giris]);
}
function deger(ad) { return document.getElementById('f_' + ad).value; }
function api(yol, govde, basliklar) {
  var secenek = { method: govde ? 'POST' : 'GET', credentials: 'same-origin', headers: {} };
  if (govde) { secenek.headers['Content-Type'] = 'application/json'; secenek.body = JSON.stringify(govde); }
  if (basliklar) { for (var k in basliklar) { secenek.headers[k] = basliklar[k]; } }
  return fetch(yol, secenek).then(function (r) {
    return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, durum: r.status, j: j }; });
  }).catch(function () { return { ok: false, durum: 0, j: { mesaj: 'Sunucuya ulaşılamadı.' } }; });
}
function mesaj(kutu, sinif, metin) {
  kutu.className = sinif; kutu.textContent = metin; kutu.style.display = metin ? 'block' : 'none';
}
`;

export const APP_JS = ORTAK + `
function girisEkrani() {
  var kutu = el('div', { style: 'display:none' });
  var dugme = el('button', { type: 'submit', metin: 'Giriş yap' });
  var form = el('form', { novalidate: 'novalidate' }, [
    alan('Firma kodu', 'firma_kodu', 'text', 'ör. demo'),
    alan('Kullanıcı adı', 'kullanici_adi', 'text'),
    alan('Şifre', 'sifre', 'password'),
    dugme, kutu
  ]);
  form.addEventListener('submit', function (olay) {
    olay.preventDefault();
    mesaj(kutu, '', ''); dugme.disabled = true;
    api('/api/giris', { firma_kodu: deger('firma_kodu'), kullanici_adi: deger('kullanici_adi'), sifre: deger('sifre') }).then(function (s) {
      dugme.disabled = false;
      if (s.ok) { panel(); } else { mesaj(kutu, 'hata', (s.j && s.j.mesaj) || 'Giriş başarısız.'); }
    });
  });
  kok.innerHTML = '';
  kok.appendChild(el('div', { 'class': 'kart' }, [
    el('h1', { metin: 'Çağrı Merkezi Platformu' }),
    el('p', { 'class': 'alt', metin: 'Firma kodunuz, kullanıcı adınız ve şifrenizle giriş yapın.' }),
    form
  ]));
  kok.appendChild(el('div', { 'class': 'sürüm', metin: '${SURUM_ETIKETI}' }));
}

function panel() {
  api('/api/ben').then(function (s) {
    if (!s.ok) { girisEkrani(); return; }
    var b = s.j;
    var cikis = el('button', { type: 'button', 'class': 'ikincil', metin: 'Çıkış yap' });
    cikis.addEventListener('click', function () { api('/api/cikis', {}).then(girisEkrani); });
    var liste = el('dl', null, [
      el('dt', { metin: 'Kullanıcı' }), el('dd', { metin: b.ad_soyad || b.kullanici_adi }),
      el('dt', { metin: 'Firma' }), el('dd', { metin: b.platform ? 'Platform yönetimi' : (b.firma_unvan + ' (' + b.firma_kod + ')') }),
      el('dt', { metin: 'Rol' }), el('dd', { metin: b.rol_kod })
    ]);
    kok.innerHTML = '';
    kok.appendChild(el('div', { 'class': 'kart' }, [
      el('h1', { metin: 'Giriş başarılı' }),
      el('p', { 'class': 'alt', metin: 'Uygulama ekranları sonraki sürümlerde eklenecek.' }),
      liste, cikis
    ]));
    kok.appendChild(el('div', { 'class': 'sürüm', metin: '${SURUM_ETIKETI}' }));
  });
}
panel();
`;

export const KURULUM_JS = ORTAK + `
function bolum(baslik, aciklama, alanlar, dugmeMetni, gonder) {
  var kutu = el('div', { style: 'display:none' });
  var dugme = el('button', { type: 'submit', metin: dugmeMetni });
  var form = el('form', { novalidate: 'novalidate', style: 'margin-top:22px;padding-top:6px;border-top:1px solid #dde3ea' },
    [el('h1', { metin: baslik, style: 'margin-top:14px' }), el('p', { 'class': 'alt', metin: aciklama })].concat(alanlar).concat([dugme, kutu]));
  form.addEventListener('submit', function (olay) {
    olay.preventDefault(); mesaj(kutu, '', ''); dugme.disabled = true;
    gonder(deger('anahtar')).then(function (s) {
      dugme.disabled = false;
      if (s.ok) { mesaj(kutu, 'basari', (s.j && s.j.mesaj) || 'Tamam.'); }
      else { mesaj(kutu, 'hata', (s.j && s.j.mesaj) || 'İşlem başarısız.'); }
    });
  });
  return form;
}
kok.appendChild(el('div', { 'class': 'kart' }, [
  el('h1', { metin: 'Platform kurulumu' }),
  el('p', { 'class': 'alt', metin: 'Yalnızca kurulum anahtarını bilen kişi kullanabilir. Anahtar sunucuda gizli değişken olarak saklanır.' }),
  alan('Kurulum anahtarı', 'anahtar', 'password'),
  bolum('1) Platform yöneticisi', 'Tüm firmaları yöneten kullanıcı. Yalnızca bir kez oluşturulabilir.',
    [alan('Kullanıcı adı', 'p_kullanici', 'text'), alan('Şifre (en az 10 karakter)', 'p_sifre', 'password')],
    'Platform yöneticisini oluştur',
    function (anahtar) { return api('/api/kurulum/platform-admin', { kullanici_adi: deger('p_kullanici'), sifre: deger('p_sifre') }, { 'X-Kurulum-Anahtari': anahtar }); }),
  bolum('2) Firma ve firma yöneticisi', 'Firma yoksa tabloları kurulur; firmanın yöneticisi yoksa oluşturulur.',
    [alan('Firma kodu (küçük harf/rakam)', 'f_kod', 'text'), alan('Firma ünvanı', 'f_unvan', 'text'),
     alan('Yönetici kullanıcı adı', 'f_kullanici', 'text'), alan('Yönetici ad soyad', 'f_ad', 'text'),
     alan('Yönetici şifresi (en az 10 karakter)', 'f_sifre', 'password')],
    'Firmayı ve yöneticisini oluştur',
    function (anahtar) { return api('/api/kurulum/firma', { firma_kodu: deger('f_kod'), unvan: deger('f_unvan'), admin_kullanici_adi: deger('f_kullanici'), admin_ad_soyad: deger('f_ad'), admin_sifre: deger('f_sifre') }, { 'X-Kurulum-Anahtari': anahtar }); })
]));
kok.appendChild(el('div', { 'class': 'sürüm', metin: '${SURUM_ETIKETI}' }));
`;
