// Musteriler ve Excel yukleme ekranlari (v__SURUM__)

// ---------------- Excel kutuphanesi (yalniz gerektiginde yuklenir) ----------------
let xlsxYuklu = null;
function xlsxYukle() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxYuklu) return xlsxYuklu;
  xlsxYuklu = new Promise((coz, red) => {
    const s = document.createElement('script');
    s.src = '/xlsx.js';
    s.onload = () => (window.XLSX ? coz(window.XLSX) : red(new Error('xlsx')));
    s.onerror = () => { xlsxYuklu = null; red(new Error('xlsx')); };
    document.head.appendChild(s);
  });
  return xlsxYuklu;
}

// ---------------- Alan tanimlari ve otomatik eslestirme ----------------
const YUKLEME_ALANLARI = [
  ['unvan', 'Firma ünvanı *', ['unvan', 'firmaadi', 'firmaunvani', 'firma', 'sirket', 'sirketadi', 'musteriadi', 'musteriunvani', 'ticariunvan', 'isyeri', 'isyeriadi', 'kurum']],
  ['dis_no', 'Müşteri / dış kayıt no', ['disno', 'musterino', 'firmano', 'carikod', 'cari', 'ncst', 'vergino', 'vkn', 'kayitno', 'kod']],
  ['sektor', 'Sektör', ['sektor', 'faaliyet', 'faaliyetalani', 'nace']],
  ['il', 'İl', ['il', 'sehir']],
  ['ilce', 'İlçe', ['ilce']],
  ['adres', 'Adres', ['adres', 'acikadres']],
  ['telefon', 'Firma telefonu', ['telefon', 'tel', 'telefonno', 'gsm', 'cep', 'firmatelefon']],
  ['eposta', 'Firma e-postası', ['eposta', 'email', 'mail', 'epostaadresi']],
  ['web', 'Web sitesi', ['web', 'website', 'internet', 'url', 'websitesi']],
  ['kontak_ad', 'Yetkili adı soyadı', ['yetkili', 'yetkilikisi', 'yetkiliadi', 'kontak', 'kisi', 'adsoyad', 'irtibat', 'irtibatkisisi']],
  ['kontak_gorev', 'Yetkili görevi', ['gorev', 'pozisyon', 'yetkiligorevi', 'kontakgorevi']],
  ['kontak_telefon', 'Yetkili telefonu', ['yetkilitelefon', 'yetkilitel', 'yetkilicep', 'kontaktelefon', 'yetkiligsm']],
  ['kontak_eposta', 'Yetkili e-postası', ['yetkilieposta', 'yetkilimail', 'kontakeposta']],
];

function baslikSade(s) {
  return String(s == null ? '' : s).toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

function otomatikEsle(basliklar) {
  const sade = basliklar.map(baslikSade);
  const kullanildi = {};
  const harita = {};
  YUKLEME_ALANLARI.forEach((a) => {
    harita[a[0]] = -1;
    for (let k = 0; k < a[2].length && harita[a[0]] < 0; k++) {
      const i = sade.indexOf(a[2][k]);
      if (i >= 0 && !kullanildi[i]) { harita[a[0]] = i; kullanildi[i] = true; }
    }
  });
  return harita;
}

// ---------------- Excel yukleme sayfasi ----------------
function sayfaYukleme() {
  icerik.appendChild(baslik('Excel ile müşteri yükleme'));
  const sihirbaz = el('div');
  const gecmis = el('div');
  icerik.appendChild(sihirbaz);
  icerik.appendChild(gecmis);

  let dosyaAdi = '';
  let basliklar = [];
  let satirlar = [];

  function dosyaSecimi() {
    sihirbaz.innerHTML = '';
    const kutu = el('div', { style: 'display:none' });
    const girdi = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', id: 'f_dosya' });
    girdi.addEventListener('change', () => {
      const d = girdi.files && girdi.files[0];
      if (!d) return;
      if (d.size > 15 * 1024 * 1024) { mesaj(kutu, 'hata', 'Dosya 15 MB sınırını aşıyor.'); return; }
      mesaj(kutu, '', '');
      xlsxYukle().then((X) => new Promise((coz, red) => {
        const o = new FileReader();
        o.onload = () => coz(X.read(new Uint8Array(o.result), { type: 'array' }));
        o.onerror = () => red(new Error('okuma'));
        o.readAsArrayBuffer(d);
      })).then((kitap) => {
        const sayfa = kitap.Sheets[kitap.SheetNames[0]];
        const tum = window.XLSX.utils.sheet_to_json(sayfa, { header: 1, raw: false, defval: '', blankrows: false });
        if (tum.length < 2) { mesaj(kutu, 'hata', 'Dosyada başlık satırı ve en az bir veri satırı olmalı.'); return; }
        basliklar = tum[0].map((b, i) => String(b || '').trim() || ('Kolon ' + (i + 1)));
        satirlar = tum.slice(1).filter((s) => s.some((h) => String(h).trim() !== ''));
        if (!satirlar.length) { mesaj(kutu, 'hata', 'Dosyada veri satırı bulunamadı.'); return; }
        if (satirlar.length > 20000) { mesaj(kutu, 'hata', 'Bir dosyada en çok 20.000 satır yüklenebilir. Dosyayı bölün.'); return; }
        dosyaAdi = d.name;
        esleme();
      }).catch(() => mesaj(kutu, 'hata', 'Dosya okunamadı. .xlsx, .xls veya .csv olduğundan emin olun.'));
    });
    sihirbaz.appendChild(panel([
      el('h2', { metin: '1. Dosyayı seçin' }),
      el('p', { 'class': 'alt', metin: 'İlk satır kolon başlıkları olmalıdır. İlk sayfa okunur. En çok 20.000 satır.' }),
      girdi, kutu,
    ]));
  }

  function esleme() {
    sihirbaz.innerHTML = '';
    const harita = otomatikEsle(basliklar);
    const secenekler = [['-1', '(eşleme yok)']].concat(basliklar.map((b, i) => [String(i), b]));
    const secimler = YUKLEME_ALANLARI.map((a) => {
      const g = secim(a[1], 'e_' + a[0], secenekler, String(harita[a[0]]));
      return g;
    });
    const ekSakla = el('input', { type: 'checkbox', id: 'f_ek_sakla', checked: 'checked' });
    const onizle = el('div');
    const kutu = el('div', { style: 'display:none' });
    const baslat = el('button', { type: 'button', metin: satirlar.length + ' satırı yükle' });

    function eslemeOku() {
      const m = {};
      YUKLEME_ALANLARI.forEach((a) => { m[a[0]] = parseInt(deger('e_' + a[0]), 10); });
      return m;
    }
    function onizleCiz() {
      const m = eslemeOku();
      onizle.innerHTML = '';
      const alanlar = YUKLEME_ALANLARI.filter((a) => m[a[0]] >= 0);
      if (!alanlar.length) return;
      onizle.appendChild(el('p', { 'class': 'alt', style: 'margin:14px 0 6px', metin: 'Önizleme (ilk 5 satır)' }));
      onizle.appendChild(el('div', { style: 'overflow-x:auto' }, [el('table', null, [
        el('thead', null, [el('tr', null, alanlar.map((a) => el('th', { metin: a[1].replace(' *', '') })))]),
        el('tbody', null, satirlar.slice(0, 5).map((s) => el('tr', null, alanlar.map((a) => el('td', { metin: String(s[m[a[0]]] == null ? '' : s[m[a[0]]]).slice(0, 60) }))))),
      ])]));
    }
    YUKLEME_ALANLARI.forEach((a) => {
      const s = document.getElementById('f_e_' + a[0]);
      if (s) s.addEventListener('change', onizleCiz);
    });
    baslat.addEventListener('click', () => {
      const m = eslemeOku();
      if (m.unvan < 0) { mesaj(kutu, 'hata', 'Firma ünvanı için bir kolon seçmelisiniz.'); return; }
      mesaj(kutu, '', '');
      yukle(m, ekSakla.checked, baslat, kutu);
    });

    sihirbaz.appendChild(panel([
      el('h2', { metin: '2. Kolonları eşleyin' }),
      el('p', { 'class': 'alt', metin: dosyaAdi + ' · ' + satirlar.length + ' satır · ' + basliklar.length + ' kolon. Otomatik eşleme yapıldı; yanlışları düzeltin.' }),
      el('div', { 'class': 'izgara' }, secimler),
      el('div', { 'class': 'izin', style: 'margin-top:14px' }, [ekSakla, el('label', { 'for': 'f_ek_sakla', metin: 'Eşlenmeyen kolonları "ek alan" olarak müşteri kaydında sakla' })]),
      onizle,
      el('div', { 'class': 'satir' }, [baslat, el('button', { type: 'button', 'class': 'ikincil', metin: 'Başka dosya seç', onclick: dosyaSecimi })]),
      kutu,
    ]));
    onizleCiz();
  }

  async function yukle(m, ekSakla, dugme, kutu) {
    dugme.disabled = true;
    const eslenen = {};
    Object.keys(m).forEach((k2) => { if (m[k2] >= 0) eslenen[m[k2]] = true; });
    const satirNesne = satirlar.map((s, i) => {
      const o = { no: i + 2 };
      Object.keys(m).forEach((k2) => { if (m[k2] >= 0) o[k2] = s[m[k2]]; });
      if (ekSakla) {
        const ek = {};
        basliklar.forEach((b, j) => { if (!eslenen[j] && String(s[j] == null ? '' : s[j]).trim() !== '') ek[b] = s[j]; });
        o.ek = ek;
      }
      return o;
    });
    const bas = await api('/api/yuklemeler', { dosya_adi: dosyaAdi, satir_sayisi: satirNesne.length });
    if (!bas.ok) { dugme.disabled = false; mesaj(kutu, 'hata', hataMetni(bas)); return; }
    const parca = bas.j.parca_max || 300;
    let eklenen = 0; let mukerrer = 0; let bos = 0; const hatalar = [];
    for (let i = 0; i < satirNesne.length; i += parca) {
      mesaj(kutu, 'basari', 'Yükleniyor… ' + Math.min(i + parca, satirNesne.length) + ' / ' + satirNesne.length);
      const s = await api('/api/yuklemeler/' + bas.j.id + '/satirlar', { satirlar: satirNesne.slice(i, i + parca) });
      if (!s.ok) {
        dugme.disabled = false;
        mesaj(kutu, 'hata', hataMetni(s) + ' (Şu ana kadar ' + eklenen + ' kayıt eklendi; yükleme geçmişinden geri alabilirsiniz.)');
        gecmisYukle();
        return;
      }
      eklenen += s.j.eklenen; mukerrer += s.j.mukerrer; bos += s.j.bos;
      (s.j.hatalar || []).forEach((h) => { if (hatalar.length < 20) hatalar.push(h); });
    }
    sihirbaz.innerHTML = '';
    const liste = el('ul', { style: 'margin:8px 0 0;padding-left:18px;line-height:1.7' }, [
      el('li', { metin: 'Eklenen: ' + eklenen }),
      el('li', { metin: 'Mükerrer (aynı müşteri no zaten var) atlanan: ' + mukerrer }),
      el('li', { metin: 'Ünvanı boş olduğu için atlanan: ' + bos }),
    ]);
    const ozet = [el('h2', { metin: 'Yükleme tamamlandı' }), liste];
    if (hatalar.length) ozet.push(el('p', { 'class': 'alt', style: 'margin-top:10px', metin: 'Atlanan satırlar (ilk ' + hatalar.length + '): ' + hatalar.map((h) => h.satir + '. satır: ' + h.neden).join(', ') }));
    ozet.push(el('div', { 'class': 'satir' }, [
      el('button', { type: 'button', metin: 'Müşterilere git', onclick: () => { location.hash = '#/musteriler'; } }),
      el('button', { type: 'button', 'class': 'ikincil', metin: 'Yeni dosya yükle', onclick: dosyaSecimi }),
    ]));
    sihirbaz.appendChild(panel(ozet));
    gecmisYukle();
  }

  function gecmisYukle(sonMesaj) {
    api('/api/yuklemeler').then((s) => {
      gecmis.innerHTML = '';
      if (!s.ok) { gecmis.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      const kutu = el('div', { style: 'display:none' });
      const satirEl = s.j.yuklemeler.map((y) => {
        const islem = el('td', { style: 'white-space:nowrap' });
        if (y.durum === 'aktif') {
          const geriAl = el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Geri al' });
          geriAl.addEventListener('click', () => {
            islem.innerHTML = '';
            islem.appendChild(el('span', { metin: 'Emin misiniz? ' }));
            islem.appendChild(el('button', { type: 'button', 'class': 'kucuk tehlike', metin: 'Evet, geri al', onclick: () => {
              api('/api/yuklemeler/' + y.id + '/geri-al', {}).then((r) => {
                if (r.ok) {
                  gecmisYukle(['basari', r.j.silinen + ' müşteri kaldırıldı' + (r.j.korunan ? ', ' + r.j.korunan + ' müşteri aranmış/atanmış/listeye alınmış olduğu için korundu.' : '.')]);
                } else mesaj(kutu, 'hata', hataMetni(r));
              });
            } }));
            islem.appendChild(document.createTextNode(' '));
            islem.appendChild(el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Vazgeç', onclick: () => gecmisYukle() }));
          });
          islem.appendChild(geriAl);
        }
        return el('tr', { 'class': y.durum === 'aktif' ? '' : 'pasif' }, [
          el('td', { metin: tarih(y.olusturma) }), el('td', { metin: y.dosya_adi }), el('td', { metin: y.yukleyen || '' }),
          el('td', { metin: y.eklenen + ' / ' + y.satir_sayisi }), el('td', { metin: String(y.atlanan) }),
          el('td', null, [el('span', { 'class': 'rozet ' + (y.durum === 'aktif' ? 'yesil' : 'gri'), metin: y.durum === 'aktif' ? 'Aktif' : 'Geri alındı' })]),
          islem,
        ]);
      });
      gecmis.appendChild(panel([
        el('h2', { metin: 'Yükleme geçmişi' }),
        s.j.yuklemeler.length ? el('table', null, [
          el('thead', null, [el('tr', null, ['Tarih', 'Dosya', 'Yükleyen', 'Eklenen / satır', 'Atlanan', 'Durum', ''].map((b) => el('th', { metin: b })))]),
          el('tbody', null, satirEl),
        ]) : el('p', { 'class': 'alt', metin: 'Henüz yükleme yapılmadı.' }),
        kutu,
      ]));
      if (sonMesaj) mesaj(kutu, sonMesaj[0], sonMesaj[1]);
    });
  }

  dosyaSecimi();
  gecmisYukle();
}

// ---------------- Musteri listesi ----------------
function sayfaMusteriler() {
  icerik.appendChild(baslik('Müşteriler', eylemVar('excel_yukle') ? el('button', { type: 'button', metin: 'Excel ile yükle', onclick: () => { location.hash = '#/yukleme'; } }) : null));
  const filtre = el('div');
  const liste = el('div');
  const detay = el('div');
  icerik.appendChild(filtre);
  icerik.appendChild(detay);
  icerik.appendChild(liste);
  const durum = { q: '', sektor: '', il: '', sayfa: 1 };
  let zamanlayici = null;

  api('/api/musteri-filtre').then((s) => {
    const sektorler = s.ok ? s.j.sektorler : [];
    const iller = s.ok ? s.j.iller : [];
    const ara = el('input', { type: 'text', id: 'f_ara', placeholder: 'Ünvan, müşteri no veya telefon ara' });
    ara.addEventListener('input', () => {
      clearTimeout(zamanlayici);
      zamanlayici = setTimeout(() => { durum.q = ara.value; durum.sayfa = 1; getir(); }, 350);
    });
    const sektorSec = secim('Sektör', 'm_sektor', [['', 'Tümü']].concat(sektorler.map((x) => [x, x])), '');
    const ilSec = secim('İl', 'm_il', [['', 'Tümü']].concat(iller.map((x) => [x, x])), '');
    filtre.appendChild(panel([el('div', { 'class': 'izgara' }, [
      el('div', null, [el('label', { 'for': 'f_ara', metin: 'Ara' }), ara]), sektorSec, ilSec,
    ])]));
    document.getElementById('f_m_sektor').addEventListener('change', (e) => { durum.sektor = e.target.value; durum.sayfa = 1; getir(); });
    document.getElementById('f_m_il').addEventListener('change', (e) => { durum.il = e.target.value; durum.sayfa = 1; getir(); });
  });

  function getir() {
    const ps = new URLSearchParams();
    if (durum.q) ps.set('q', durum.q);
    if (durum.sektor) ps.set('sektor', durum.sektor);
    if (durum.il) ps.set('il', durum.il);
    ps.set('sayfa', String(durum.sayfa));
    api('/api/musteriler?' + ps.toString()).then((s) => {
      liste.innerHTML = '';
      if (!s.ok) { liste.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      const j = s.j;
      const toplamSayfa = Math.max(1, Math.ceil(j.toplam / j.boyut));
      const satirEl = j.musteriler.map((m) => el('tr', { style: 'cursor:pointer', onclick: () => detayAc(m.id) }, [
        el('td', { metin: m.unvan }), el('td', { metin: m.dis_no || '' }), el('td', { metin: m.sektor || '' }),
        el('td', { metin: [m.il, m.ilce].filter(Boolean).join(' / ') }), el('td', { metin: m.telefon || '' }),
        el('td', { metin: m.atanan || '-' }),
      ]));
      const onceki = el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Önceki', disabled: j.sayfa <= 1, onclick: () => { durum.sayfa--; getir(); } });
      const sonraki = el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Sonraki', disabled: j.sayfa >= toplamSayfa, onclick: () => { durum.sayfa++; getir(); } });
      liste.appendChild(panel([
        el('p', { 'class': 'alt', style: 'margin:0 0 10px', metin: j.toplam + ' müşteri' }),
        j.musteriler.length ? el('div', { style: 'overflow-x:auto' }, [el('table', null, [
          el('thead', null, [el('tr', null, ['Ünvan', 'Müşteri no', 'Sektör', 'İl / İlçe', 'Telefon', 'Atanan'].map((b) => el('th', { metin: b })))]),
          el('tbody', null, satirEl),
        ])]) : el('p', { 'class': 'alt', metin: 'Kayıt bulunamadı.' }),
        el('div', { 'class': 'satir' }, [onceki, el('span', { metin: 'Sayfa ' + j.sayfa + ' / ' + toplamSayfa }), sonraki]),
      ]));
    });
  }

  function detayAc(id) {
    api('/api/musteriler/' + id).then((s) => {
      detay.innerHTML = '';
      if (!s.ok) { detay.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      const m = s.j.musteri;
      const satir = (e, v) => (v ? [el('dt', { metin: e }), el('dd', { metin: String(v) })] : []);
      let dl = [].concat(satir('Müşteri no', m.dis_no), satir('Sektör', m.sektor), satir('İl / İlçe', [m.il, m.ilce].filter(Boolean).join(' / ')),
        satir('Adres', m.adres), satir('Telefon', m.telefon), satir('E-posta', m.eposta), satir('Web', m.web));
      Object.keys(m.ek_alanlar || {}).forEach((a) => { dl = dl.concat(satir(a, m.ek_alanlar[a])); });
      const kisiler = s.j.kontaklar.length
        ? el('table', null, [
          el('thead', null, [el('tr', null, ['Ad soyad', 'Görev', 'Telefon', 'E-posta', ''].map((b) => el('th', { metin: b })))]),
          el('tbody', null, s.j.kontaklar.map((k2) => el('tr', null, [
            el('td', { metin: k2.ad_soyad }), el('td', { metin: k2.gorev || '' }), el('td', { metin: k2.telefon || '' }),
            el('td', { metin: k2.eposta || '' }),
            el('td', null, [k2.aranmayacak ? el('span', { 'class': 'rozet gri', metin: 'Aranmayacak' }) : null]),
          ]))),
        ])
        : el('p', { 'class': 'alt', metin: 'Bu müşteri için kayıtlı yetkili yok.' });
      detay.appendChild(panel([
        el('div', { 'class': 'satir', style: 'margin:0 0 6px' }, [el('h2', { metin: m.unvan, style: 'margin:0' }), el('span', { style: 'flex:1' }),
          el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Kapat', onclick: () => { detay.innerHTML = ''; } })]),
        el('dl', null, dl),
        el('h2', { metin: 'Yetkililer', style: 'margin-top:18px' }), kisiler,
      ]));
    });
  }

  getir();
}
