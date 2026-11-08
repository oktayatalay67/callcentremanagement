// Uygulama arayuzu (v__SURUM__): giris, kabuk, ana sayfa, firma profili, kullanicilar, roller, sifre
let ben = null;
let icerik = null;

function temaUygula(r) {
  const st = document.documentElement.style;
  const ayar = (ad, v) => { if (v) st.setProperty(ad, v); else st.removeProperty(ad); };
  ayar('--ana', r && r.ana);
  ayar('--vurgu', r && r.vurgu);
}

window.oturumDustu = function () { if (ben) { ben = null; girisEkrani(); } };

function musteriKapsami() {
  const k = ben && !ben.platform && ben.izinler && ben.izinler.kapsam && ben.izinler.kapsam.musteri;
  return k === 'TUM' || k === 'KENDI';
}
// Yonetim yetkisi olan kullanici (agent degil)
function yoneticiMi() {
  return !!ben && (ben.platform || ['kullanici_yonet', 'rol_yonet', 'firma_profil_duzenle', 'excel_yukle', 'atama_yap', 'liste_yonet', 'ayar_yonet', 'rapor_gor', 'dashboard_gor'].some(eylemVar));
}
function sifreIzni() { return !!ben && (ben.platform || eylemVar('sifre_degistir')); }
function eylemVar(ad) { return !!ben && ben.izinler.eylem.indexOf(ad) >= 0; }

// ---------------- Giris ----------------
function girisEkrani() {
  const kutu = el('div', { style: 'display:none' });
  const dugme = el('button', { type: 'submit', 'class': 'tam', metin: 'Giriş yap' });
  const form = el('form', { novalidate: 'novalidate' }, [
    alan('Firma kodu', 'firma_kodu', { ipucu: 'ör. demo' }),
    alan('Kullanıcı adı', 'kullanici_adi'),
    alan('Şifre', 'sifre', { tip: 'password' }),
    dugme, kutu,
  ]);
  form.addEventListener('submit', (olay) => {
    olay.preventDefault();
    mesaj(kutu, '', ''); dugme.disabled = true;
    api('/api/giris', { firma_kodu: deger('firma_kodu'), kullanici_adi: deger('kullanici_adi'), sifre: deger('sifre') }).then((s) => {
      dugme.disabled = false;
      if (s.ok) { location.hash = '#/ana'; yenile(); } else mesaj(kutu, 'hata', hataMetni(s, 'Giriş başarısız.'));
    });
  });
  temaUygula(null);
  kok.className = '';
  kok.innerHTML = '';
  kok.appendChild(el('div', { 'class': 'kart' }, [
    el('h1', { metin: 'Çağrı Merkezi Platformu' }),
    el('p', { 'class': 'alt', metin: 'Firma kodunuz, kullanıcı adınız ve şifrenizle giriş yapın.' }),
    form,
  ]));
  kok.appendChild(el('div', { 'class': 'surum', metin: 'v' + SURUM }));
}

function cikisYap() { ben = null; api('/api/cikis', {}).then(girisEkrani); }

// ---------------- Kabuk (ust cubuk + menu + icerik) ----------------
function kabuk() {
  kok.className = 'genis';
  kok.innerHTML = '';
  const logo = ben.logo_var ? el('img', { 'class': 'logo', src: '/api/firma/logo?t=' + Date.now(), alt: '' }) : null;
  const ust = el('div', { 'class': 'ust' }, [
    logo,
    el('span', { 'class': 'firma', metin: ben.platform ? 'Platform yönetimi' : ben.firma_unvan }),
    el('span', { 'class': 'rozet', title: 'Uygulama sürümü', metin: 'v' + SURUM }),
    el('span', { 'class': 'bosluk' }),
    el('span', { 'class': 'kisi', metin: (ben.ad_soyad || ben.kullanici_adi) + ' · ' + (ben.rol_ad || ben.rol_kod) }),
    sifreIzni() ? el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Şifremi değiştir', onclick: () => { location.hash = '#/sifre'; } }) : null,
    el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Çıkış', onclick: cikisYap }),
  ]);
  const ogeler = [];
  if (yoneticiMi()) ogeler.push(['#/ana', 'Ana sayfa']);
  if (!ben.platform && eylemVar('firma_profil_duzenle')) ogeler.push(['#/profil', 'Firma profili']);
  if (musteriKapsami()) ogeler.push(['#/musteriler', ben.izinler.kapsam.musteri === 'KENDI' ? 'Aranacak müşterilerim' : 'Müşteriler']);
  if (eylemVar('excel_yukle')) ogeler.push(['#/yukleme', 'Excel yükleme']);
  if (eylemVar('kullanici_yonet')) ogeler.push(['#/kullanicilar', 'Kullanıcılar']);
  if (eylemVar('kullanici_yonet')) ogeler.push(['#/girisler', 'Giriş kayıtları']);
  if (eylemVar('rol_yonet')) ogeler.push(['#/roller', 'Roller ve izinler']);
  const menu = el('nav', { 'class': 'menu' }, ogeler.map((o) => el('a', { href: o[0], 'data-yol': o[0], metin: o[1] })));
  if (ben.platform) {
    menu.appendChild(el('a', { href: '/kurulum', metin: 'Firma kurulumu' }));
    menu.appendChild(el('a', { href: '/saglik', target: '_blank', rel: 'noopener', metin: 'Bağlantı testi' }));
  }
  menu.appendChild(el('div', { 'class': 'surum', metin: 'v' + SURUM }));
  icerik = el('section', { 'class': 'icerik' });
  kok.appendChild(ust);
  kok.appendChild(el('div', { 'class': 'govde' }, [menu, icerik]));
}

function yonlendir() {
  if (!ben || !icerik) return;
  let yol = location.hash || '#/ana';
  const izinli = {
    '#/ana': yoneticiMi(), '#/sifre': sifreIzni(), '#/profil': !ben.platform && eylemVar('firma_profil_duzenle'),
    '#/kullanicilar': eylemVar('kullanici_yonet'), '#/girisler': eylemVar('kullanici_yonet'), '#/roller': eylemVar('rol_yonet'),
    '#/musteriler': musteriKapsami(), '#/yukleme': eylemVar('excel_yukle'),
  };
  if (!izinli[yol]) yol = yoneticiMi() ? '#/ana' : (musteriKapsami() ? '#/musteriler' : '#/sifre');
  document.querySelectorAll('.menu a[data-yol]').forEach((a) => {
    a.className = a.getAttribute('data-yol') === yol ? 'aktif' : '';
  });
  icerik.innerHTML = '';
  if (yol === '#/profil') sayfaProfil();
  else if (yol === '#/kullanicilar') sayfaKullanicilar();
  else if (yol === '#/roller') sayfaRoller();
  else if (yol === '#/girisler') sayfaGirisler();
  else if (yol === '#/musteriler') sayfaMusteriler();
  else if (yol === '#/yukleme') sayfaYukleme();
  else if (yol === '#/sifre') sayfaSifre();
  else sayfaAna();
}
window.addEventListener('hashchange', yonlendir);

function yenile() {
  api('/api/ben').then((s) => {
    if (!s.ok) { ben = null; girisEkrani(); return; }
    ben = s.j; temaUygula(ben.renkler); kabuk(); yonlendir();
  });
}

function panel(cocuklar) { return el('div', { 'class': 'panel' }, cocuklar); }
function baslik(metin, sag) {
  return el('div', { 'class': 'satir', style: 'margin:0 0 14px;max-width:960px' }, [el('h2', { metin: metin, style: 'margin:0' }), el('span', { 'class': 'bosluk', style: 'flex:1' }), sag]);
}

// ---------------- Surum notlari (her yayinda en uste eklenir) ----------------
const SURUM_NOTLARI = [
  ['0.7.3', 'Agent ekranı sadece aranacak müşterileri gösterir; "Kendi şifresini değiştir" izni rol bazında yönetilir.'],
  ['0.7.2', 'Müşteri numarası boş bırakılırsa otomatik verilir (M000001, M000002 ...).'],
  ['0.7.1', 'Excel yükleme: aynı firmanın satırları tek müşteride birleştirilir (yetkili listesi), küçük parçalarla yükleme, daha açıklayıcı hata.'],
  ['0.7.0', 'Sürüm takibi: üst çubukta sürüm, kullanıcı listesinde son sürüm, Giriş kayıtları ekranı.'],
  ['0.6.1', 'Excel yüklemede hata kodu görünür; yükleme iyileştirmesi.'],
  ['0.6.0', 'Müşteri listesi ve Excel ile müşteri yükleme (kolon eşleme, geri alma).'],
  ['0.5.1', 'Firma renkleri (opsiyonel), InspireIT marka renkleri.'],
  ['0.5.0', 'Firma profili ve logo, kullanıcı yönetimi, roller ve izinler.'],
];

// ---------------- Giris kayitlari ----------------
function sayfaGirisler() {
  icerik.appendChild(baslik('Giriş kayıtları'));
  const alanAdi = el('div');
  const kisiGirdi = el('input', { type: 'text', id: 'f_g_kisi', placeholder: 'Kullanıcı adı (boş = hepsi)' });
  const sonucSec = secim('Sonuç', 'g_sonuc', [['', 'Tümü'], ['basarili', 'Başarılı'], ['hatali', 'Hatalı']], '');
  const ara = el('button', { type: 'button', metin: 'Listele' });
  icerik.appendChild(panel([el('div', { 'class': 'izgara' }, [el('div', null, [el('label', { 'for': 'f_g_kisi', metin: 'Kullanıcı' }), kisiGirdi]), sonucSec]), el('div', { 'class': 'satir' }, [ara])]));
  icerik.appendChild(alanAdi);
  function getir() {
    const ps = new URLSearchParams();
    if (kisiGirdi.value.trim()) ps.set('kullanici', kisiGirdi.value.trim());
    if (deger('g_sonuc')) ps.set('sonuc', deger('g_sonuc'));
    api('/api/giris-kayitlari?' + ps.toString()).then((s) => {
      alanAdi.innerHTML = '';
      if (!s.ok) { alanAdi.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      alanAdi.appendChild(panel([
        el('p', { 'class': 'alt', style: 'margin:0 0 10px', metin: 'Son ' + s.j.kayitlar.length + ' kayıt (en yeni üstte). Sürüm, giriş anındaki uygulama sürümüdür; eski kayıtlarda boştur.' }),
        s.j.kayitlar.length ? el('table', null, [
          el('thead', null, [el('tr', null, ['Zaman', 'Kullanıcı', 'Sonuç', 'IP', 'Sürüm'].map((b) => el('th', { metin: b })))]),
          el('tbody', null, s.j.kayitlar.map((g) => el('tr', null, [
            el('td', { metin: tarih(g.zaman) }), el('td', { metin: g.kullanici_adi }),
            el('td', null, [el('span', { 'class': 'rozet ' + (g.basarili ? 'yesil' : 'gri'), metin: g.basarili ? 'Başarılı' : 'Hatalı' })]),
            el('td', { metin: g.ip || '-' }), el('td', { metin: g.surum ? 'v' + g.surum : '-' }),
          ]))),
        ]) : el('p', { 'class': 'alt', metin: 'Kayıt yok.' }),
      ]));
    });
  }
  ara.addEventListener('click', getir);
  getir();
}

// ---------------- Ana sayfa ----------------
function sayfaAna() {
  const liste = el('ul', { style: 'margin:8px 0 0;padding-left:18px;line-height:1.7' });
  if (ben.platform) liste.appendChild(el('li', { metin: 'Platform yöneticisi olarak firmaları Firma kurulumu sayfasından oluşturabilirsiniz.' }));
  else {
    liste.appendChild(el('li', { metin: 'Firma profili: ünvan, iletişim bilgileri ve logo.' }));
    if (eylemVar('kullanici_yonet')) liste.appendChild(el('li', { metin: 'Kullanıcılar: ekleme, rol atama, pasife alma, şifre sıfırlama.' }));
    if (eylemVar('rol_yonet')) liste.appendChild(el('li', { metin: 'Roller ve izinler: firmanıza özel roller ve yetkiler.' }));
  }
  icerik.appendChild(panel([
    el('h2', { metin: 'Hoş geldiniz, ' + (ben.ad_soyad || ben.kullanici_adi) }),
    el('p', { 'class': 'alt', metin: ben.platform ? 'Platform yönetimi' : ben.firma_unvan + ' (' + ben.firma_kod + ')' }),
    el('p', { metin: 'Kullanabileceğiniz ekranlar:' }), liste,
    el('h2', { metin: 'Sürüm geçmişi', style: 'margin-top:22px' }),
    el('ul', { style: 'margin:0;padding-left:18px;line-height:1.7' }, SURUM_NOTLARI.map((n) => el('li', { metin: 'v' + n[0] + ' — ' + n[1] }))),
    el('p', { 'class': 'alt', style: 'margin-top:16px', metin: 'Atama, arama ekranı ve raporlar sonraki sürümlerde eklenecek.' }),
  ]));
}

// ---------------- Firma profili ----------------
function sayfaProfil() {
  icerik.appendChild(baslik('Firma profili'));
  const alanAdi = el('div');
  icerik.appendChild(alanAdi);
  api('/api/firma').then((s) => {
    if (!s.ok) { alanAdi.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
    const f = s.j.firma;
    const duzenle = eylemVar('firma_profil_duzenle');
    const kutu = el('div', { style: 'display:none' });
    const kaydet = el('button', { type: 'submit', metin: 'Kaydet' });
    const form = el('form', { novalidate: 'novalidate' }, [
      el('div', { 'class': 'izgara' }, [
        alan('Firma ünvanı', 'unvan', { deger: f.unvan, devre: !duzenle }),
        alan('Kısa ad', 'kisa_ad', { deger: f.kisa_ad, devre: !duzenle }),
        alan('Vergi no (10-11 rakam)', 'vergi_no', { deger: f.vergi_no, devre: !duzenle }),
        alan('Telefon', 'telefon', { deger: f.telefon, devre: !duzenle }),
        alan('E-posta', 'eposta', { deger: f.eposta, devre: !duzenle }),
        alan('Web sitesi', 'web', { deger: f.web, devre: !duzenle }),
      ]),
      alan('Adres', 'adres', { deger: f.adres, devre: !duzenle, cok: true }),
      duzenle ? el('div', { 'class': 'satir' }, [kaydet]) : null,
      kutu,
    ]);
    form.addEventListener('submit', (o) => {
      o.preventDefault(); mesaj(kutu, '', ''); kaydet.disabled = true;
      api('/api/firma', { unvan: deger('unvan'), kisa_ad: deger('kisa_ad'), vergi_no: deger('vergi_no'), telefon: deger('telefon'), eposta: deger('eposta'), web: deger('web'), adres: deger('adres') }, 'PUT').then((r) => {
        kaydet.disabled = false;
        if (r.ok) { mesaj(kutu, 'basari', hataMetni(r)); ben.firma_unvan = deger('unvan'); const fe = document.querySelector('.ust .firma'); if (fe) fe.textContent = ben.firma_unvan; }
        else mesaj(kutu, 'hata', hataMetni(r));
      });
    });
    alanAdi.appendChild(panel([el('h2', { metin: 'Bilgiler' }), form]));

    // Logo
    const lkutu = el('div', { style: 'display:none' });
    const dosya = el('input', { type: 'file', id: 'f_logo_dosya', accept: 'image/png,image/jpeg' });
    const onizleme = f.logo_var ? el('img', { src: '/api/firma/logo?t=' + Date.now(), alt: 'Logo' }) : el('span', { 'class': 'alt', metin: 'Logo yüklenmemiş' });
    const logoPanel = [el('h2', { metin: 'Logo ve renkler' }), el('p', { 'class': 'alt', metin: 'Logo' }), el('div', { 'class': 'logokutu' }, [onizleme])];
    if (duzenle) {
      const yukle = el('button', { type: 'button', metin: 'Logoyu yükle' });
      yukle.addEventListener('click', () => {
        mesaj(lkutu, '', '');
        const d = dosya.files[0];
        if (!d) { mesaj(lkutu, 'hata', 'Önce bir dosya seçin.'); return; }
        if (d.type !== 'image/png' && d.type !== 'image/jpeg') { mesaj(lkutu, 'hata', 'Logo PNG veya JPEG olmalı.'); return; }
        if (d.size > 204800) { mesaj(lkutu, 'hata', 'Logo en fazla 200 KB olabilir.'); return; }
        yukle.disabled = true;
        const okuyucu = new FileReader();
        okuyucu.onload = () => {
          const veri = String(okuyucu.result).split(',')[1];
          api('/api/firma/logo', { tip: d.type, veri: veri }, 'PUT').then((r) => {
            yukle.disabled = false;
            if (r.ok) { ben.logo_var = true; kabuk(); yonlendir(); } else mesaj(lkutu, 'hata', hataMetni(r));
          });
        };
        okuyucu.readAsDataURL(d);
      });
      const kaldir = el('button', { type: 'button', 'class': 'ikincil', metin: 'Logoyu kaldır', disabled: !f.logo_var });
      kaldir.addEventListener('click', () => {
        api('/api/firma/logo', {}, 'DELETE').then((r) => {
          if (r.ok) { ben.logo_var = false; kabuk(); yonlendir(); } else mesaj(lkutu, 'hata', hataMetni(r));
        });
      });
      logoPanel.push(el('p', { 'class': 'alt', metin: 'PNG veya JPEG, en fazla 200 KB.' }));
      logoPanel.push(el('div', { 'class': 'satir' }, [dosya, yukle, kaldir]));
    }
    logoPanel.push(lkutu);

    // Renkler (opsiyonel): isaretlenmezse platformun varsayilan rengi kullanilir
    const rkutu = el('div', { style: 'display:none' });
    const onizle = el('div', { 'class': 'satir', style: 'margin:6px 0 0' });
    function renkSatiri(etiket, ad, mevcut, ilk, aciklama) {
      const onay = el('input', { type: 'checkbox', id: 'f_' + ad + '_ozel', disabled: !duzenle });
      onay.checked = !!mevcut;
      const sec = el('input', { type: 'color', id: 'f_' + ad, value: (mevcut || ilk).toLowerCase(), disabled: !duzenle || !mevcut });
      const yazi = el('span', { 'class': 'alt', style: 'margin:0', metin: mevcut || 'Varsayılan renk' });
      const guncelle = () => {
        sec.disabled = !duzenle || !onay.checked;
        yazi.textContent = onay.checked ? sec.value.toUpperCase() : 'Varsayılan renk';
        onizleCiz();
      };
      onay.addEventListener('change', guncelle);
      sec.addEventListener('input', guncelle);
      return el('div', { 'class': 'renk' }, [
        el('span', { 'class': 'ad', metin: etiket }),
        el('label', { style: 'margin:0;display:flex;align-items:center;gap:6px;font-weight:400' }, [onay, 'Özel renk kullan']),
        sec, yazi, el('span', { 'class': 'alt', style: 'margin:0', metin: aciklama }),
      ]);
    }
    function renkDegeri(ad) {
      return document.getElementById('f_' + ad + '_ozel').checked ? document.getElementById('f_' + ad).value.toUpperCase() : null;
    }
    function onizleCiz() {
      onizle.innerHTML = '';
      const ana = renkDegeri('renk_ana') || '#2F6FDB';
      const vurgu = renkDegeri('renk_vurgu') || '#DDE3EA';
      onizle.appendChild(el('span', { 'class': 'alt', style: 'margin:0', metin: 'Önizleme:' }));
      onizle.appendChild(el('span', { style: 'background:' + ana + ';color:#fff;padding:6px 12px;border-radius:6px;font-weight:600', metin: 'Örnek düğme' }));
      onizle.appendChild(el('span', { style: 'display:inline-block;width:80px;border-bottom:3px solid ' + vurgu }));
    }
    logoPanel.push(el('h2', { metin: 'Renkler (isteğe bağlı)', style: 'margin-top:22px' }));
    logoPanel.push(el('p', { 'class': 'alt', metin: 'İşaretlemezseniz platformun varsayılan renkleri kullanılır. Ana renk üzerinde beyaz yazı okunabilmelidir.' }));
    logoPanel.push(renkSatiri('Ana renk', 'renk_ana', f.renk_ana, '#2A4B9B', 'Düğmeler, aktif menü, bağlantılar'));
    logoPanel.push(renkSatiri('Vurgu rengi', 'renk_vurgu', f.renk_vurgu, '#E33279', 'Üst çubuğun alt çizgisi'));
    logoPanel.push(onizle);
    if (duzenle) {
      const rkaydet = el('button', { type: 'button', metin: 'Renkleri kaydet' });
      rkaydet.addEventListener('click', () => {
        mesaj(rkutu, '', ''); rkaydet.disabled = true;
        api('/api/firma/renkler', { renk_ana: renkDegeri('renk_ana'), renk_vurgu: renkDegeri('renk_vurgu') }, 'PUT').then((r) => {
          rkaydet.disabled = false;
          if (r.ok) { ben.renkler = r.j.renkler; temaUygula(ben.renkler); mesaj(rkutu, 'basari', hataMetni(r)); } else mesaj(rkutu, 'hata', hataMetni(r));
        });
      });
      logoPanel.push(el('div', { 'class': 'satir' }, [rkaydet]));
    }
    logoPanel.push(rkutu);
    alanAdi.appendChild(panel(logoPanel));
    onizleCiz();
  });
}

// ---------------- Kullanicilar ----------------
function sayfaKullanicilar() {
  const panelAlani = el('div');
  const tabloAlani = el('div');
  let veri = null;
  icerik.appendChild(baslik('Kullanıcılar', el('button', { type: 'button', metin: 'Yeni kullanıcı', onclick: () => form(null) })));
  icerik.appendChild(panelAlani);
  icerik.appendChild(tabloAlani);

  const rolAdi = (kod) => { const r = veri.roller.find((x) => x.kod === kod); return r ? r.gorunen_ad : kod; };
  const kisiAdi = (id) => { const u = veri.kullanicilar.find((x) => x.id === id); return u ? (u.ad_soyad || u.kullanici_adi) : '-'; };

  function yukle() {
    return api('/api/kullanicilar').then((s) => {
      if (!s.ok) { tabloAlani.innerHTML = ''; tabloAlani.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      veri = s.j; ciz();
    });
  }

  function ciz() {
    tabloAlani.innerHTML = '';
    const satirlar = veri.kullanicilar.map((k) => {
      const islem = el('td', { style: 'white-space:nowrap' }, [
        el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Düzenle', onclick: () => form(k) }), ' ',
        el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Şifre sıfırla', onclick: () => sifreForm(k) }), ' ',
        k.id === ben.id ? null : el('button', { type: 'button', 'class': 'kucuk ikincil', metin: k.aktif ? 'Pasife al' : 'Aktif et', onclick: () => durumOnay(k) }),
      ]);
      return el('tr', { 'class': k.aktif ? '' : 'pasif' }, [
        el('td', { metin: k.kullanici_adi }), el('td', { metin: k.ad_soyad || '' }), el('td', { metin: rolAdi(k.rol_kod) }),
        el('td', { metin: k.yonetici_id ? kisiAdi(k.yonetici_id) : '-' }),
        el('td', null, [el('span', { 'class': 'rozet ' + (k.aktif ? 'yesil' : 'gri'), metin: k.aktif ? 'Aktif' : 'Pasif' })]),
        el('td', { metin: tarih(k.son_giris) }),
        el('td', null, [k.son_surum ? el('span', { 'class': 'rozet ' + (k.son_surum === SURUM ? 'yesil' : 'gri'), title: k.son_gorulme ? 'Son görülme: ' + tarih(k.son_gorulme) : '', metin: 'v' + k.son_surum }) : el('span', { metin: '-' })]),
        islem,
      ]);
    });
    tabloAlani.appendChild(panel([el('table', null, [
      el('thead', null, [el('tr', null, ['Kullanıcı adı', 'Ad soyad', 'Rol', 'Yönetici', 'Durum', 'Son giriş', 'Sürüm', ''].map((b) => el('th', { metin: b })))]),
      el('tbody', null, satirlar),
    ])]));
  }

  function kapat() { panelAlani.innerHTML = ''; }

  function form(k) {
    const yeni = !k;
    const kutu = el('div', { style: 'display:none' });
    const kaydet = el('button', { type: 'submit', metin: yeni ? 'Oluştur' : 'Kaydet' });
    const roller = (yeni ? [['', 'Rol seçin']] : []).concat(veri.roller.filter((r) => r.aktif || (k && r.kod === k.rol_kod)).map((r) => [r.kod, r.gorunen_ad]));
    const yoneticiler = [['', 'Yok']].concat(veri.kullanicilar.filter((u) => u.aktif && (!k || u.id !== k.id)).map((u) => [u.id, (u.ad_soyad || u.kullanici_adi) + ' (' + u.kullanici_adi + ')']));
    const f = el('form', { novalidate: 'novalidate' }, [
      el('h2', { metin: yeni ? 'Yeni kullanıcı' : 'Kullanıcıyı düzenle: ' + k.kullanici_adi }),
      el('div', { 'class': 'izgara' }, [
        yeni ? alan('Kullanıcı adı', 'k_kullanici') : null,
        yeni ? alan('Şifre (en az 10 karakter)', 'k_sifre', { tip: 'password' }) : null,
        alan('Ad soyad', 'k_ad', { deger: k ? k.ad_soyad : '' }),
        secim('Rol', 'k_rol', roller, k ? k.rol_kod : ''),
        secim('Yönetici', 'k_yonetici', yoneticiler, k && k.yonetici_id ? k.yonetici_id : ''),
        alan('Görev', 'k_gorev', { deger: k ? k.gorev : '' }),
        alan('E-posta', 'k_eposta', { deger: k ? k.eposta : '' }),
        alan('Telefon', 'k_telefon', { deger: k ? k.telefon : '' }),
      ]),
      el('div', { 'class': 'satir' }, [kaydet, el('button', { type: 'button', 'class': 'ikincil', metin: 'Vazgeç', onclick: kapat })]),
      kutu,
    ]);
    f.addEventListener('submit', (o) => {
      o.preventDefault(); mesaj(kutu, '', '');
      if (!deger('k_rol')) { mesaj(kutu, 'hata', 'Lütfen bir rol seçin.'); return; }
      kaydet.disabled = true;
      const govde = { ad_soyad: deger('k_ad'), rol_kod: deger('k_rol'), yonetici_id: deger('k_yonetici') || null, gorev: deger('k_gorev'), eposta: deger('k_eposta'), telefon: deger('k_telefon') };
      let istek;
      if (yeni) { govde.kullanici_adi = deger('k_kullanici'); govde.sifre = deger('k_sifre'); istek = api('/api/kullanicilar', govde); }
      else istek = api('/api/kullanicilar/' + k.id, govde, 'PATCH');
      istek.then((r) => {
        kaydet.disabled = false;
        if (r.ok) { kapat(); yukle(); if (!yeni && k.id === ben.id) yenile(); } else mesaj(kutu, 'hata', hataMetni(r));
      });
    });
    panelAlani.innerHTML = '';
    panelAlani.appendChild(panel([f]));
  }

  function sifreForm(k) {
    const kutu = el('div', { style: 'display:none' });
    const kaydet = el('button', { type: 'submit', metin: 'Şifreyi sıfırla' });
    const f = el('form', { novalidate: 'novalidate' }, [
      el('h2', { metin: 'Şifre sıfırla: ' + k.kullanici_adi }),
      el('p', { 'class': 'alt', metin: 'Yeni şifre en az 10 karakter olmalı. Kullanıcının açık oturumları kapatılır.' }),
      alan('Yeni şifre', 's_sifre', { tip: 'password' }),
      el('div', { 'class': 'satir' }, [kaydet, el('button', { type: 'button', 'class': 'ikincil', metin: 'Vazgeç', onclick: kapat })]),
      kutu,
    ]);
    f.addEventListener('submit', (o) => {
      o.preventDefault(); mesaj(kutu, '', ''); kaydet.disabled = true;
      api('/api/kullanicilar/' + k.id + '/sifre-sifirla', { sifre: deger('s_sifre') }).then((r) => {
        kaydet.disabled = false;
        if (r.ok) { kapat(); } else mesaj(kutu, 'hata', hataMetni(r));
      });
    });
    panelAlani.innerHTML = '';
    panelAlani.appendChild(panel([f]));
  }

  function durumOnay(k) {
    const kutu = el('div', { style: 'display:none' });
    const evet = el('button', { type: 'button', 'class': k.aktif ? 'tehlike' : '', metin: k.aktif ? 'Evet, pasife al' : 'Evet, aktif et' });
    evet.addEventListener('click', () => {
      evet.disabled = true;
      api('/api/kullanicilar/' + k.id, { aktif: !k.aktif }, 'PATCH').then((r) => {
        evet.disabled = false;
        if (r.ok) { kapat(); yukle(); } else mesaj(kutu, 'hata', hataMetni(r));
      });
    });
    panelAlani.innerHTML = '';
    panelAlani.appendChild(panel([
      el('h2', { metin: k.kullanici_adi + (k.aktif ? ' pasife alınsın mı?' : ' yeniden aktif edilsin mi?') }),
      el('p', { 'class': 'alt', metin: k.aktif ? 'Kullanıcı giriş yapamaz ve açık oturumları kapanır. Verileri silinmez.' : 'Kullanıcı yeniden giriş yapabilir.' }),
      el('div', { 'class': 'satir' }, [evet, el('button', { type: 'button', 'class': 'ikincil', metin: 'Vazgeç', onclick: kapat })]),
      kutu,
    ]));
  }

  yukle();
}

// ---------------- Roller ve izinler ----------------
function sayfaRoller() {
  const solAlan = el('div');
  const sagAlan = el('div');
  let veri = null;
  let secili = null;
  let sonMesaj = '';
  icerik.appendChild(baslik('Roller ve izinler'));
  icerik.appendChild(el('div', { 'class': 'iki' }, [solAlan, sagAlan]));

  const KAPSAM_SECENEKLERI = [['', 'Yok'], ['KENDI', 'Yalnız kendi kayıtları'], ['TUM', 'Tüm firma']];
  const KORUNAN = ['rol_yonet', 'kullanici_yonet', 'firma_profil_duzenle']; // firma_admin'de kapatilamaz

  function yukle(sec) {
    return api('/api/roller').then((s) => {
      if (!s.ok) { solAlan.innerHTML = ''; solAlan.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      veri = s.j;
      if (sec) secili = sec; else if (!secili || !veri.roller.some((r) => r.kod === secili)) secili = veri.roller[0] ? veri.roller[0].kod : null;
      soluCiz(); sagiCiz();
    });
  }

  function soluCiz() {
    solAlan.innerHTML = '';
    veri.roller.forEach((r) => {
      solAlan.appendChild(el('div', { 'class': 'rol' + (r.kod === secili ? ' secili' : ''), onclick: () => { secili = r.kod; soluCiz(); sagiCiz(); } }, [
        el('div', { metin: r.gorunen_ad, style: 'font-weight:700' }),
        el('div', { 'class': 'alt', style: 'margin:2px 0 0', metin: r.kod + ' · ' + r.kullanici_sayisi + ' kullanıcı' + (r.aktif ? '' : ' · pasif') }),
      ]));
    });
    const kutu = el('div', { style: 'display:none' });
    const yeniBtn = el('button', { type: 'submit', 'class': 'kucuk', metin: 'Rol ekle' });
    const f = el('form', { novalidate: 'novalidate', 'class': 'rol', style: 'cursor:default' }, [
      el('div', { metin: 'Yeni rol', style: 'font-weight:700' }),
      alan('Rol kodu (küçük harf, rakam, _)', 'r_kod'), alan('Görünen ad', 'r_ad'),
      el('div', { 'class': 'satir' }, [yeniBtn]), kutu,
    ]);
    f.addEventListener('submit', (o) => {
      o.preventDefault(); mesaj(kutu, '', ''); yeniBtn.disabled = true;
      const kod = deger('r_kod').trim().toLowerCase();
      api('/api/roller', { kod: kod, gorunen_ad: deger('r_ad') }).then((r) => {
        yeniBtn.disabled = false;
        if (r.ok) yukle(kod); else mesaj(kutu, 'hata', hataMetni(r));
      });
    });
    solAlan.appendChild(f);
  }

  function sagiCiz() {
    sagAlan.innerHTML = '';
    const r = veri.roller.find((x) => x.kod === secili);
    if (!r) return;
    const yonetici = r.kod === 'firma_admin';
    const kutu = el('div', { style: 'display:none' });
    const kaydet = el('button', { type: 'submit', metin: 'Kaydet' });
    const aktifKutu = el('input', { type: 'checkbox', id: 'f_r_aktif', disabled: yonetici });
    aktifKutu.checked = !!r.aktif;
    const kapsamlar = veri.katalog.kapsam.map((a) => secim(a.etiket, 'ks_' + a.k, KAPSAM_SECENEKLERI, r.izinler.kapsam[a.k] || ''));
    const eylemler = veri.katalog.eylem.map((a) => {
      const kilitli = yonetici && KORUNAN.indexOf(a.k) >= 0;
      const kutuc = el('input', { type: 'checkbox', id: 'ey_' + a.k, disabled: kilitli });
      kutuc.checked = !!r.izinler.eylem[a.k] || kilitli;
      return el('div', { 'class': 'izin' }, [kutuc, el('label', { 'for': 'ey_' + a.k, metin: a.etiket + (kilitli ? ' (kapatılamaz)' : '') })]);
    });
    const f = el('form', { novalidate: 'novalidate' }, [
      el('h2', { metin: r.gorunen_ad }),
      alan('Görünen ad', 'r_gad', { deger: r.gorunen_ad }),
      el('div', { 'class': 'izin', style: 'margin-top:12px' }, [aktifKutu, el('label', { 'for': 'f_r_aktif', metin: yonetici ? 'Aktif (firma yöneticisi rolü pasife alınamaz)' : 'Aktif' })]),
      el('h2', { metin: 'Kapsam izinleri', style: 'margin-top:20px' }),
      el('div', { 'class': 'izgara' }, kapsamlar),
      el('h2', { metin: 'Eylem izinleri', style: 'margin-top:20px' }),
      el('div', { 'class': 'izgara' }, eylemler),
      el('div', { 'class': 'satir' }, [kaydet]),
      kutu,
    ]);
    if (sonMesaj) { mesaj(kutu, 'basari', sonMesaj); sonMesaj = ''; }
    f.addEventListener('submit', (o) => {
      o.preventDefault(); mesaj(kutu, '', ''); kaydet.disabled = true;
      const kapsam = {}; veri.katalog.kapsam.forEach((a) => { kapsam[a.k] = deger('ks_' + a.k); });
      const eylem = {}; veri.katalog.eylem.forEach((a) => { eylem[a.k] = document.getElementById('ey_' + a.k).checked; });
      const ozet = { gorunen_ad: deger('r_gad') };
      if (!yonetici) ozet.aktif = aktifKutu.checked;
      api('/api/roller/' + r.kod, ozet, 'PATCH').then((a1) => {
        if (!a1.ok) { kaydet.disabled = false; mesaj(kutu, 'hata', hataMetni(a1)); return; }
        api('/api/roller/' + r.kod + '/izinler', { kapsam: kapsam, eylem: eylem }, 'PUT').then((a2) => {
          kaydet.disabled = false;
          if (a2.ok) { sonMesaj = 'Rol kaydedildi.'; yukle(r.kod).then(() => { if (r.kod === ben.rol_kod) yenile(); }); } else mesaj(kutu, 'hata', hataMetni(a2));
        });
      });
    });
    sagAlan.appendChild(panel([f]));
  }

  yukle();
}

// ---------------- Sifre degistir ----------------
function sayfaSifre() {
  const kutu = el('div', { style: 'display:none' });
  const kaydet = el('button', { type: 'submit', metin: 'Şifreyi değiştir' });
  const f = el('form', { novalidate: 'novalidate', style: 'max-width:420px' }, [
    alan('Mevcut şifre', 'eski', { tip: 'password' }),
    alan('Yeni şifre (en az 10 karakter)', 'yeni', { tip: 'password' }),
    alan('Yeni şifre (tekrar)', 'yeni2', { tip: 'password' }),
    el('div', { 'class': 'satir' }, [kaydet]), kutu,
  ]);
  f.addEventListener('submit', (o) => {
    o.preventDefault(); mesaj(kutu, '', '');
    if (deger('yeni') !== deger('yeni2')) { mesaj(kutu, 'hata', 'Yeni şifreler aynı değil.'); return; }
    kaydet.disabled = true;
    api('/api/ben/sifre', { eski: deger('eski'), yeni: deger('yeni') }).then((r) => {
      kaydet.disabled = false;
      if (r.ok) { mesaj(kutu, 'basari', hataMetni(r)); ['eski', 'yeni', 'yeni2'].forEach((a) => { document.getElementById('f_' + a).value = ''; }); }
      else mesaj(kutu, 'hata', hataMetni(r));
    });
  });
  icerik.appendChild(baslik('Şifremi değiştir'));
  icerik.appendChild(panel([f]));
}

yenile();
