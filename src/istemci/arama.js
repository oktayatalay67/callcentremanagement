// Arama modulu arayuzu (v__SURUM__): agent arama ekrani, arama listeleri, ayarlar, takvim

const KUTU_ADLARI = [['yeni', 'Yeni'], ['tekrar', 'Tekrar aranacak'], ['ulasilamadi', 'Ulaşılamayan'], ['tamam', 'Tamamlanan']];
function yerelTarihIso(v) { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString(); }
function bos(c) { c.innerHTML = ''; return c; }
function etiketSatir(e, v) { return el('div', { style: 'margin:2px 0' }, [el('span', { style: 'color:#5c6b7d', metin: e + ': ' }), el('span', { metin: v || '-' })]); }

// ================= AGENT ARAMA EKRANI =================
function sayfaArama() {
  icerik.appendChild(baslik('Arama ekranı'));
  const st = { kutu: 'yeni', liste_id: '', q: '', sayfa: 1 };
  const kutuSatir = el('div', { 'class': 'kutular' });
  const filtre = el('div');
  const liste = el('div');
  icerik.appendChild(kutuSatir); icerik.appendChild(filtre); icerik.appendChild(liste);
  let zaman = null;

  function kutulariGetir() {
    api('/api/arama/kutular').then((s) => {
      if (!s.ok) { kutuSatir.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      bos(kutuSatir);
      KUTU_ADLARI.forEach((x) => {
        kutuSatir.appendChild(el('button', { type: 'button', 'class': 'kutu' + (st.kutu === x[0] ? ' aktif' : ''),
          onclick: () => { st.kutu = x[0]; st.sayfa = 1; kutulariGetir(); getir(); } },
          [el('div', { 'class': 'sayi', metin: String(s.j.kutular[x[0]]) }), el('div', { metin: x[1] })]));
      });
      if (!filtre.firstChild) {
        const ara = el('input', { type: 'text', id: 'f_ar_q', placeholder: 'Ünvan veya telefon ara' });
        ara.addEventListener('input', () => { clearTimeout(zaman); zaman = setTimeout(() => { st.q = ara.value; st.sayfa = 1; getir(); }, 350); });
        const ls = secimChip('Liste', 'ar_liste', [['', 'Tüm listeler']].concat(s.j.listeler.map((l) => [l.id, l.ad])), '', (v) => { st.liste_id = v; st.sayfa = 1; kutulariGetir(); getir(); });
        filtre.appendChild(panel([el('div', null, [el('label', { 'for': 'f_ar_q', metin: 'Ara' }), ara]), ls]));
      }
    });
  }
  function getir() {
    const ps = new URLSearchParams({ kutu: st.kutu, sayfa: String(st.sayfa) });
    if (st.liste_id) ps.set('liste_id', st.liste_id);
    if (st.q) ps.set('q', st.q);
    api('/api/arama/kayitlar?' + ps.toString()).then((s) => {
      bos(liste);
      if (!s.ok) { liste.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      const j = s.j;
      if (!j.kayitlar.length) liste.appendChild(panel([el('p', { metin: 'Bu kutuda kayıt yok.' })]));
      j.kayitlar.forEach((r) => {
        const yasak = r.aranmayacak_kontak;
        liste.appendChild(el('div', { 'class': 'kayit' + (yasak ? ' yasak' : '') }, [
          el('div', { style: 'flex:1;min-width:220px' }, [
            el('div', { style: 'font-weight:600', metin: r.unvan }),
            el('div', { 'class': 'alt', metin: [r.sektor, [r.il, r.ilce].filter(Boolean).join(' / ')].filter(Boolean).join(' · ') }),
            el('div', { 'class': 'alt', metin: (r.telefon || 'Telefon yok') + ' · ' + r.liste_ad + (r.kontak_sayisi ? ' · ' + r.kontak_sayisi + ' yetkili' : '') }),
            r.urunler ? el('div', { 'class': 'alt', metin: 'Ürünler: ' + r.urunler }) : null,
            yasak ? el('div', { 'class': 'bant', metin: 'Aranmak istemeyen yetkili var' }) : null,
            r.kilitli ? el('div', { 'class': 'bant', metin: 'Şu anda başka bir kullanıcı arıyor' }) : null,
          ]),
          el('div', { 'class': 'alt', style: 'min-width:150px' }, [
            el('div', { metin: 'Deneme: ' + r.deneme_sayisi }),
            r.durum_etiket ? el('div', { metin: 'Son: ' + r.durum_etiket }) : null,
            r.son_arama ? el('div', { metin: tarih(r.son_arama) }) : null,
            r.sonraki_arama ? el('div', { metin: 'Sonraki: ' + tarih(r.sonraki_arama) }) : null,
            r.atanan && ben.izinler.kapsam.arama === 'TUM' ? el('div', { metin: 'Atanan: ' + r.atanan }) : null,
          ]),
          el('button', { type: 'button', metin: 'Ara', disabled: !!r.kilitli, onclick: () => aramaModal(r.id, () => { kutulariGetir(); getir(); }) }),
        ]));
      });
      const sayfaSayisi = Math.max(1, Math.ceil(j.toplam / j.boyut));
      if (sayfaSayisi > 1) liste.appendChild(el('div', { 'class': 'satir' }, [
        el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Önceki', disabled: j.sayfa <= 1, onclick: () => { st.sayfa--; getir(); } }),
        el('span', { metin: j.sayfa + ' / ' + sayfaSayisi + ' (' + j.toplam + ' kayıt)' }),
        el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Sonraki', disabled: j.sayfa >= sayfaSayisi, onclick: () => { st.sayfa++; getir(); } }),
      ]));
    });
  }
  kutulariGetir(); getir();
}

// ================= ARAMA MODALI (SSSO akisi) =================
function aramaModal(kayitId, kapaninca) {
  const arka = el('div', { 'class': 'modal-arka' });
  const kutu = el('div', { 'class': 'modal' });
  arka.appendChild(kutu);
  document.body.appendChild(arka);
  let veri = null; let aramaId = null; let kapali = false;
  const s = { kontak_id: '', neden: '', ulasildi: null, dogru: null, uygun: null, durum: null, ulasilamadiNedeni: null };

  function kapat(yenile2) { if (kapali) return; kapali = true; arka.remove(); if (kapaninca) kapaninca(yenile2); }
  function iptalEt() {
    if (aramaId) api('/api/arama/' + aramaId + '/iptal', {}).then(() => kapat(true)); else kapat(false);
  }
  api('/api/arama/kayit/' + kayitId).then((r) => {
    if (!r.ok) { kutu.appendChild(el('div', { 'class': 'hata', metin: hataMetni(r) })); kutu.appendChild(el('button', { type: 'button', metin: 'Kapat', onclick: () => kapat(false) })); return; }
    veri = r.j;
    const ilk = veri.kontaklar.find((x) => !x.aranmayacak && !x.numara_yanlis) || veri.kontaklar.find((x) => !x.aranmayacak);
    s.kontak_id = ilk ? ilk.id : '';
    ciz();
  });

  const secKontak = () => veri.kontaklar.find((x) => x.id === s.kontak_id) || null;
  function telefon() { const kt = secKontak(); return (kt && (kt.telefon || kt.telefon2)) || veri.kayit.telefon || ''; }
  const nedenler = () => veri.secenekler.filter((x) => x.tur === 'gorusme_nedeni');
  const nedenEtiket = () => { const n = nedenler().find((x) => x.kod === s.neden); return n ? n.etiket : ''; };
  const listeUrunleri = () => {
    const kodlar = (veri.kayit.urun_odak || '').split(',').filter(Boolean);
    return veri.secenekler.filter((x) => x.tur === 'urun_hizmet' && kodlar.indexOf(x.kod) >= 0);
  };
  const deneme = () => veri.kayit.deneme_sayisi + 1;
  const limit = () => veri.kayit.deneme_limiti || veri.ayar.deneme_limiti;

  // Yumusak uyarilar (engellemez): gunde 2 deneme, deneme arasi 4 saat, 09:00-17:00 araligi
  function uyarilar() {
    const u = []; const k = veri.kayit; const simdi = new Date();
    if (k.bugun_adet >= 2) u.push('Bu müşteri bugün ' + k.bugun_adet + ' kez arandı; günde en fazla 2 deneme önerilir.');
    if (k.son_arama_zaman && (simdi - new Date(k.son_arama_zaman)) < 4 * 3600000 && k.bugun_adet < 2) u.push('Son arama 4 saatten kısa süre önce yapıldı; denemeler arasında en az 4 saat önerilir.');
    const sa = simdi.getHours();
    if (sa < 9 || sa >= 17) u.push('Arama saati 09:00-17:00 aralığının dışında.');
    return u;
  }
  function ustBilgi() {
    const m = veri.kayit;
    return el('div', null, [
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
        el('h2', { style: 'margin:0;flex:1', metin: m.unvan }), el('span', { 'class': 'rozet', metin: 'Deneme ' + deneme() + ' / ' + limit() }),
      ]),
      el('div', { 'class': 'alt', style: 'margin:2px 0', metin: [m.dis_no, m.sektor, [m.il, m.ilce].filter(Boolean).join(' / '), m.liste_ad].filter(Boolean).join(' · ') }),
      m.adres ? el('div', { 'class': 'alt', style: 'margin:2px 0', metin: m.adres }) : null,
      veri.musteri_yasakli ? el('div', { 'class': 'bant', metin: 'Bu müşteri aranmak istemiyor.' }) : null,
      uyarilar().length ? el('div', null, uyarilar().map((u) => el('div', { 'class': 'bant', style: 'display:block', metin: u }))) : null,
      listeUrunleri().length ? el('div', { 'class': 'urunband' }, [el('b', { metin: 'Bu listede aranan ürünler: ' }), listeUrunleri().map((u) => u.etiket).join(', ')]) : null,
    ]);
  }
  // Yetkili listesi: alt alta, ad soyad / gorev / e-posta / telefon, onceki arama ozeti
  function kontakListesi(secilebilir) {
    const kap = el('div', { 'class': 'kisiler' });
    if (!veri.kontaklar.length) kap.appendChild(el('div', { 'class': 'alt', metin: 'Bu müşteride kayıtlı yetkili yok; firma telefonu aranacak.' }));
    veri.kontaklar.forEach((x) => {
      const secili = x.id === s.kontak_id;
      const kisi = el('div', { 'class': 'kisi' + (secili ? ' secili' : '') + (x.aranmayacak ? ' yasak' : ''), onclick: secilebilir && !x.aranmayacak ? () => { s.kontak_id = x.id; ciz(); } : null }, [
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          el('span', { 'class': 'isaret', metin: secili ? '●' : '○' }),
          el('span', { style: 'font-weight:700', metin: x.ad_soyad }),
          x.karar_verici ? el('span', { 'class': 'rozet yesil', metin: 'Karar verici' }) : null,
          x.aranmayacak ? el('span', { 'class': 'bant', style: 'margin:0', metin: 'ARANMAK İSTEMİYOR' }) : null,
          x.numara_yanlis ? el('span', { 'class': 'bant', style: 'margin:0', metin: 'NUMARA YANLIŞ — ulaşılamadı' }) : null,
          x.bos_adet >= 3 && !x.numara_yanlis ? el('span', { 'class': 'bant', style: 'margin:0', metin: x.bos_adet + ' kez ulaşılamadı — başka kişi/numara deneyin' }) : null,
        ]),
        el('div', { 'class': 'alt', style: 'margin:2px 0 0 22px', metin: 'Görevi: ' + (x.gorev || '-') + ' · E-posta: ' + (x.eposta || '-') + ' · Tel: ' + ([x.telefon, x.telefon2].filter(Boolean).join(' / ') || '-') }),
        el('div', { 'class': 'alt', style: 'margin:2px 0 0 22px', metin: x.arama_adet ? 'Bu kişiyle ' + x.arama_adet + ' arama · son: ' + (x.son_sonuc || '-') + ' (' + tarih(x.son_zaman) + ')' : 'Bu kişi daha önce aranmadı' }),
      ]);
      kap.appendChild(kisi);
    });
    return kap;
  }
  function gecmisPaneli() {
    if (!veri.gecmis.length) return el('div', { 'class': 'alt', metin: 'Bu müşteri için daha önce arama yapılmamış.' });
    const t = el('table', null, [el('thead', null, [el('tr', null, ['Tarih', 'Arayan', 'Aranan yetkili', 'Sonuç', 'Not'].map((h) => el('th', { metin: h })))]),
      el('tbody', null, veri.gecmis.map((g) => el('tr', null, [tarih(g.baslangic), g.kullanici_adi, g.kontak_ad ? g.kontak_ad + (g.kontak_gorev ? ' (' + g.kontak_gorev + ')' : '') : 'Firma telefonu', g.durum_etiket || '-', g.not_metni || ''].map((x) => el('td', { metin: x })))))]);
    return t;
  }
  function telKutusu() {
    const tel = telefon();
    return el('div', { 'class': 'telkutu' }, [
      el('div', { style: 'font-size:20px;font-weight:700', metin: tel || 'Telefon numarası yok' }),
      tel ? el('a', { href: 'tel:' + tel.replace(/[^\d+]/g, ''), 'class': 'dugme-link', metin: 'Telefonla ara' }) : null,
      tel ? el('button', { type: 'button', 'class': 'ikincil kucuk', metin: 'Kopyala', onclick: (e) => { try { navigator.clipboard.writeText(tel); e.target.textContent = 'Kopyalandı'; } catch (x) { e.target.textContent = 'Kopyalanamadı'; } } }) : null,
    ]);
  }
  function chipSatir(baslikMetni, secenekler, secili, onSec) {
    return el('div', { 'class': 'soru' }, [el('div', { style: 'font-weight:600;margin-bottom:6px', metin: baslikMetni }),
      el('div', { 'class': 'secenekler', style: 'margin:0' }, secenekler.map((o) => el('button', { type: 'button', 'class': 'sec' + (secili === o[0] ? ' aktif' : ''), metin: o[1], onclick: () => onSec(o[0]) })))]);
  }
  function durumChipleri(dal, baslikMetni, hariç) {
    const l = veri.durumlar.filter((d) => d.dal === dal && !(hariç || []).includes(d.kod));
    return chipSatir(baslikMetni, l.map((d) => [d.kod, d.etiket]), s.durum, (k2) => { s.durum = k2; ciz(); });
  }

  function ciz() {
    bos(kutu);
    kutu.appendChild(ustBilgi());
    // ---------- 1) ARAMA BASLAMADAN ----------
    if (!aramaId) {
      kutu.appendChild(el('h3', { style: 'margin:14px 0 6px', metin: 'Kimi arayacaksınız?' }));
      kutu.appendChild(el('div', { 'class': 'alt', style: 'margin:0 0 6px', metin: 'Yetkilinin görevine ve önceki aramalara bakarak seçin.' }));
      kutu.appendChild(kontakListesi(true));
      kutu.appendChild(el('h3', { style: 'margin:14px 0 6px', metin: 'Önceki aramalar (' + veri.gecmis.length + ')' }));
      kutu.appendChild(gecmisPaneli());
      if (nedenler().length) kutu.appendChild(chipSatir('Arama nedeni (zorunlu)', nedenler().map((x) => [x.kod, x.etiket]), s.neden, (k2) => { s.neden = k2; ciz(); }));
      kutu.appendChild(telKutusu());
      const hata = el('div', { style: 'display:none' });
      kutu.appendChild(hata);
      const hazir = (!nedenler().length || !!s.neden) && !veri.musteri_yasakli;
      kutu.appendChild(el('div', { 'class': 'satir' }, [
        el('button', { type: 'button', metin: 'Aramayı başlat', disabled: !hazir, onclick: (e) => {
          e.target.disabled = true;
          api('/api/arama/baslat', { kayit_id: kayitId, kontak_id: s.kontak_id || null, neden_kodu: s.neden || null }).then((r) => {
            if (!r.ok) { e.target.disabled = false; mesaj(hata, 'hata', hataMetni(r)); return; }
            aramaId = r.j.arama_id; ciz();
          });
        } }),
        !hazir && !veri.musteri_yasakli ? el('span', { 'class': 'alt', style: 'margin:0', metin: 'Önce arama nedenini seçin.' }) : null,
        el('button', { type: 'button', 'class': 'ikincil', metin: 'Vazgeç', onclick: () => kapat(false) }),
      ]));
      return;
    }
    // ---------- 2) ARAMA ACIK ----------
    const kt = secKontak();
    kutu.appendChild(el('div', { 'class': 'alt', style: 'margin:8px 0 0', metin: 'Arama nedeni: ' + (nedenEtiket() || '-') + ' · Aranan: ' + (kt ? kt.ad_soyad + (kt.gorev ? ' (' + kt.gorev + ')' : '') : 'Firma telefonu') }));
    kutu.appendChild(telKutusu());
    const ikili = (metin, deg, ev, ha) => chipSatir(metin, [['e', 'Evet'], ['h', 'Hayır']], deg === true ? 'e' : (deg === false ? 'h' : ''), (v) => (v === 'e' ? ev() : ha()));
    kutu.appendChild(ikili('Ulaşıldı mı?', s.ulasildi, () => { s.ulasildi = true; s.dogru = null; s.uygun = null; s.durum = null; ciz(); }, () => { s.ulasildi = false; s.dogru = null; s.uygun = null; s.durum = null; ciz(); }));
    let dal = null; let ozelKaydet = null;
    const tekrarAlani = (zorunlu) => el('div', null, [el('label', { 'for': 'f_md_tekrar', metin: 'Tekrar arama tarihi' + (zorunlu ? ' (zorunlu)' : ' (isteğe bağlı)') }), el('input', { type: 'datetime-local', id: 'f_md_tekrar' })]);
    const ekPaneller = [];
    if (s.ulasildi === false) {
      dal = 'ulasilamadi';
      kutu.appendChild(durumChipleri('ulasilamadi', 'Ulaşılamama nedeni', ['ulasilamiyor']));
      const sonDeneme = deneme() >= limit();
      if (s.durum === 'numara_yanlis') {
        ekPaneller.push(el('div', { 'class': 'bant', style: 'display:block', metin: 'Numara yanlış: seçili yetkili "numarası yanlış, ulaşılamadı" olarak işaretlenir ve görev sonlandırılır.' }));
        ozelKaydet = 'Görevi sonlandır — numara yanlış';
      } else if (s.durum) {
        if (sonDeneme) {
          ekPaneller.push(el('div', { 'class': 'bant', style: 'display:block', metin: 'Bu ' + limit() + '. deneme. Kaydedince görev "Ulaşılamıyor" olarak sonlandırılır.' }));
          ozelKaydet = 'Ulaşılamıyor — görevi sonlandır';
        } else {
          ekPaneller.push(tekrarAlani(true));
          ekPaneller.push(el('div', { 'class': 'alt', metin: 'Deneme ' + deneme() + ' / ' + limit() + '. Limit dolunca görev otomatik sonlandırılır.' }));
          ozelKaydet = 'Tekrar aranacak';
        }
      }
    }
    if (s.ulasildi === true) {
      kutu.appendChild(ikili('Doğru kişiye mi ulaşıldı?', s.dogru, () => { s.dogru = true; s.uygun = null; s.durum = null; ciz(); }, () => { s.dogru = false; s.uygun = null; s.durum = null; ciz(); }));
      if (s.dogru === false) { dal = 'muhatap_degil'; kutu.appendChild(durumChipleri('muhatap_degil', 'Ne oldu?')); }
      if (s.dogru === true) {
        const ic = veri.icerikler;
        const parca = (tur, ad) => { const x = ic.filter((i) => i.tur === tur); if (!x.length) return null; return el('details', { open: tur === 'script' ? 'open' : null }, [el('summary', { metin: ad }), el('div', { 'class': 'metin', metin: x.map((i) => (i.baslik ? i.baslik + '\n' : '') + i.metin).join('\n\n') })]); };
        if (veri.kayit.konusma_metni) kutu.appendChild(el('details', { open: 'open' }, [el('summary', { metin: 'Liste konuşma metni' }), el('div', { 'class': 'metin', metin: veri.kayit.konusma_metni })]));
        [parca('script', 'Konuşma metni'), parca('ipucu', 'İpuçları'), parca('rehber_notu', 'Rehber notu')].forEach((p) => { if (p) kutu.appendChild(p); });
        kutu.appendChild(ikili('Görüşmek için uygun mu?', s.uygun, () => { s.uygun = true; s.durum = null; ciz(); }, () => { s.uygun = false; s.durum = null; ciz(); }));
        if (s.uygun === false) { dal = 'uygun_degil'; kutu.appendChild(durumChipleri('uygun_degil', 'Sonuç')); }
        if (s.uygun === true) { dal = 'bilgi_verildi'; kutu.appendChild(durumChipleri('bilgi_verildi', 'Görüşme sonucu')); }
      }
    }
    const asiz = veri.durumlar.filter((d) => d.dal === 'aramasiz');
    if (asiz.length) kutu.appendChild(el('details', null, [el('summary', { metin: 'Aramasız kapat' }), chipSatir('Neden', asiz.map((d) => [d.kod, d.etiket]), s.durum, (k2) => { s.durum = k2; dal = 'aramasiz'; ciz(); })]));
    const d = veri.durumlar.find((x) => x.kod === s.durum);
    const hata = el('div', { style: 'display:none' });
    if (d) {
      const b = d.bayraklar || {};
      const alanlar = [el('div', { 'class': 'rozet yesil', style: 'margin-top:12px', metin: 'Seçilen sonuç: ' + d.etiket })].concat(ekPaneller);
      if (d.alt_soru) alanlar.push(alan(d.alt_soru, 'md_alt'));
      if (b.alt_secenekler && b.alt_secenekler.length) alanlar.push(secimChip('Neden' + (b.alt_zorunlu ? ' (zorunlu)' : ''), 'md_alt', (b.alt_zorunlu ? [] : [['', 'Belirtilmedi']]).concat(b.alt_secenekler.map((x) => [x, x])), ''));
      if (d.dal !== 'ulasilamadi' && b.tekrar_tarihi) alanlar.push(tekrarAlani(b.tekrar_tarihi === 'zorunlu'));
      if (b.randevu) alanlar.push(el('div', null, [el('label', { 'for': 'f_md_randevu', metin: 'Randevu zamanı (zorunlu)' }), el('input', { type: 'datetime-local', id: 'f_md_randevu' })]));
      if (b.yeni_kontak) alanlar.push(el('div', { 'class': 'soru' }, [el('div', { style: 'font-weight:600', metin: d.dal === 'muhatap_degil' ? 'Doğru kişinin bilgileri (biliyorsanız)' : 'Yeni yetkili' }), el('div', { 'class': 'izgara' }, [alan('Ad soyad', 'md_yk_ad'), alan('Görev', 'md_yk_gorev'), alan('Telefon', 'md_yk_tel'), alan('E-posta', 'md_yk_eposta')])]));
      if (b.satis_bilgisi) {
        const tumUrun = veri.secenekler.filter((x) => x.tur === 'urun_hizmet');
        const urunler = listeUrunleri().length ? listeUrunleri() : tumUrun;
        const urunZorunlu = listeUrunleri().length > 0;
        if (urunler.length) alanlar.push(el('div', null, [el('label', { metin: 'Müşterinin ilgisini çeken ürün / hizmet' + (urunZorunlu ? ' (zorunlu — bu listedeki ürünlerden)' : '') }), el('div', { 'class': 'secenekler' }, urunler.map((u) => el('label', { 'class': 'onay' }, [el('input', { type: 'checkbox', 'data-urun': u.kod }), ' ' + u.etiket])))]));
        alanlar.push(el('div', { 'class': 'izgara' }, [alan('Adet', 'md_adet', { tip: 'number' }), alan('Tahmini tutar', 'md_tutar', { tip: 'number' })]));
        alanlar.push(secimChip('İlgi seviyesi', 'md_ilgi', [['', 'Belirtilmedi'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], ''));
        alanlar.push(alan('Rakip sözleşme bitiş' + (b.rakip_sozlesme ? ' (zorunlu — bitişten 60 gün önce otomatik aranır)' : ''), 'md_rakip', { tip: 'date' }));
      }
      alanlar.push(alan('Not' + (b.metin_zorunlu ? ' (zorunlu)' : ''), 'md_not', { cok: true }));
      if (b.aranmayacak === 'musteri') alanlar.push(el('div', { 'class': 'bant', style: 'display:block', metin: 'Bu sonuç müşteriyi "aranmak istemiyor" listesine alır; bir daha aranmaz.' }));
      if (b.aranmayacak === 'kontak') alanlar.push(el('div', { 'class': 'bant', style: 'display:block', metin: 'Bu sonuç seçili yetkiliyi "aranmak istemiyor" listesine alır.' }));
      kutu.appendChild(el('div', null, alanlar));
    }
    kutu.appendChild(el('details', null, [el('summary', { metin: 'Önceki aramalar (' + veri.gecmis.length + ')' }), gecmisPaneli()]));
    kutu.appendChild(hata);
    const etiket = ozelKaydet || 'Aramayı kaydet';
    const kaydet = el('button', { type: 'button', metin: etiket, 'class': ozelKaydet && ozelKaydet !== 'Tekrar aranacak' ? 'tehlike' : '', disabled: !d, onclick: () => {
      const b = d.bayraklar || {};
      const v = (id) => { const e = document.getElementById('f_' + id); return e ? e.value : ''; };
      const g = { durum_kodu: d.kod, kontak_id: s.kontak_id || null, not_metni: v('md_not') };
      if (document.getElementById('f_md_alt')) g.alt_cevap = v('md_alt');
      if (document.getElementById('f_md_tekrar')) g.tekrar_tarihi = yerelTarihIso(v('md_tekrar'));
      if (b.randevu) g.randevu_zamani = yerelTarihIso(v('md_randevu'));
      if (b.yeni_kontak && v('md_yk_ad').trim()) g.yeni_kontak = { ad_soyad: v('md_yk_ad'), gorev: v('md_yk_gorev'), telefon: v('md_yk_tel'), eposta: v('md_yk_eposta') };
      if (b.satis_bilgisi) {
        g.urun_kodlari = Array.prototype.map.call(kutu.querySelectorAll('input[data-urun]:checked'), (x) => x.getAttribute('data-urun'));
        g.adet = v('md_adet'); g.tahmini_tutar = v('md_tutar'); g.ilgi_seviyesi = v('md_ilgi'); g.rakip_sozlesme_bitis = v('md_rakip');
      }
      g.aranan_telefon = telefon();
      const tekrarZorunlu = (d.dal === 'ulasilamadi' && d.kod !== 'numara_yanlis' && !(deneme() >= limit())) || b.tekrar_tarihi === 'zorunlu';
      if (tekrarZorunlu && !g.tekrar_tarihi) { mesaj(hata, 'hata', 'Tekrar arama tarihi zorunludur.'); return; }
      if (b.alt_zorunlu && !g.alt_cevap) { mesaj(hata, 'hata', 'Nedeni seçin.'); return; }
      if (b.satis_bilgisi && listeUrunleri().length && !(g.urun_kodlari || []).length) { mesaj(hata, 'hata', 'Müşterinin ilgisini çeken ürün/hizmeti işaretleyin.'); return; }
      if (b.rakip_sozlesme && !g.rakip_sozlesme_bitis) { mesaj(hata, 'hata', 'Rakip sözleşme bitiş tarihi zorunludur.'); return; }
      if (b.randevu && !g.randevu_zamani) { mesaj(hata, 'hata', 'Randevu zamanı zorunludur.'); return; }
      if (b.metin_zorunlu && !g.not_metni.trim()) { mesaj(hata, 'hata', 'Bu sonuç için not zorunludur.'); return; }
      kaydet.disabled = true;
      api('/api/arama/' + aramaId + '/tamamla', g).then((r) => {
        if (!r.ok) { kaydet.disabled = false; mesaj(hata, 'hata', hataMetni(r)); return; }
        aramaId = null; kapat(true);
      });
    } });
    const sonlandir = (s.ulasildi === false && s.durum && s.durum !== 'numara_yanlis' && deneme() < limit())
      ? el('button', { type: 'button', 'class': 'tehlike', metin: 'Ulaşılamıyor — görevi sonlandır', onclick: () => {
        if (!confirm('Görev sonlandırılsın mı? Bu müşteri "Ulaşılamıyor" olarak kapanır.')) return;
        api('/api/arama/' + aramaId + '/tamamla', { durum_kodu: 'ulasilamiyor', kontak_id: s.kontak_id || null, not_metni: (document.getElementById('f_md_not') || {}).value || '' }).then((r) => {
          if (!r.ok) { mesaj(hata, 'hata', hataMetni(r)); return; } aramaId = null; kapat(true);
        });
      } }) : null;
    kutu.appendChild(el('div', { 'class': 'satir' }, [kaydet, sonlandir, el('button', { type: 'button', 'class': 'ikincil', metin: 'Aramayı iptal et', onclick: iptalEt })]));
  }
}

// ================= ARAMA LISTELERI (yonetici) =================
// Urun secimi: birden fazla isaretlenebilir (onay kutulari). secili: kod dizisi
function urunSecici(kap, secili) {
  api('/api/urun-secenekleri').then((r) => {
    kap.innerHTML = '';
    if (!r.ok) { kap.appendChild(el('span', { 'class': 'alt', metin: 'Ürün listesi alınamadı.' })); return; }
    if (!r.j.urunler.length) { kap.appendChild(el('span', { 'class': 'alt', metin: 'Tanımlı ürün yok. "Arama ayarları" ekranından ürün/hizmet ekleyin.' })); return; }
    r.j.urunler.forEach((u) => {
      const cb = el('input', { type: 'checkbox', 'data-lurun': u.kod }); cb.checked = (secili || []).indexOf(u.kod) >= 0;
      kap.appendChild(el('label', { 'class': 'onay' }, [cb, ' ' + u.etiket]));
    });
  });
}
function seciliUrunler(kap) { return Array.prototype.map.call(kap.querySelectorAll('input[data-lurun]:checked'), (x) => x.getAttribute('data-lurun')); }

function sayfaListeler() {
  icerik.appendChild(baslik('Arama listeleri'));
  const yeniKap = el('div'); const liste = el('div'); const detay = el('div');
  icerik.appendChild(yeniKap); icerik.appendChild(detay); icerik.appendChild(liste);

  const hata = el('div', { style: 'display:none' });
  const nlUrunKap = el('div', { 'class': 'secenekler' }); urunSecici(nlUrunKap, []);
  yeniKap.appendChild(panel([el('h3', { metin: 'Yeni liste' }), el('div', { 'class': 'izgara' }, [alan('Liste adı', 'nl_ad'), alan('Deneme limiti (boşsa firma ayarı)', 'nl_limit', { tip: 'number' })]),
    el('div', { style: 'margin-bottom:10px' }, [el('label', { metin: 'Bu liste hangi ürün/hizmetler için aranacak? (birden fazla işaretlenebilir)' }), nlUrunKap]),
    alan('Açıklama', 'nl_acik'), alan('Konuşma metni (agent ekranında görünür)', 'nl_konusma', { cok: true }),
    el('div', { 'class': 'satir' }, [el('button', { type: 'button', metin: 'Liste oluştur', onclick: () => {
      api('/api/listeler', { ad: deger('nl_ad'), deneme_limiti: deger('nl_limit'), urun_kodlari: seciliUrunler(nlUrunKap), aciklama: deger('nl_acik'), konusma_metni: deger('nl_konusma') }).then((s) => {
        if (!s.ok) { mesaj(hata, 'hata', hataMetni(s)); return; }
        getir(s.j.id);
      });
    } })]), hata]));

  function getir(acId) {
    api('/api/listeler').then((s) => {
      bos(liste);
      if (!s.ok) { liste.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      const t = el('table', null, [el('thead', null, [el('tr', null, ['Liste', 'Durum', 'Toplam', 'Yeni', 'Tekrar', 'Ulaşılamayan', 'Tamamlanan', ''].map((h) => el('th', { metin: h })))]),
        el('tbody', null, s.j.listeler.map((l) => el('tr', null, [
          el('td', { metin: l.ad }), el('td', null, [el('span', { 'class': 'rozet ' + (l.durum === 'aktif' ? 'yesil' : 'gri'), metin: l.durum })]),
          el('td', { metin: String(l.toplam) }), el('td', { metin: String(l.yeni) }), el('td', { metin: String(l.tekrar) }), el('td', { metin: String(l.ulasilamadi) }), el('td', { metin: String(l.tamam) }),
          el('td', null, [el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Yönet', onclick: () => detayAc(l.id) })]),
        ])))]);
      liste.appendChild(panel([t]));
      if (acId) detayAc(acId);
    });
  }

  function detayAc(id) {
    api('/api/listeler/' + id).then((s) => {
      bos(detay);
      if (!s.ok) { detay.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      const l = s.j.liste; const mk = el('div', { style: 'display:none' });
      const ldUrunKap = el('div', { 'class': 'secenekler' }); urunSecici(ldUrunKap, (l.urun_odak || '').split(',').filter(Boolean));
      const dag = el('table', null, [el('thead', null, [el('tr', null, ['Kullanıcı', 'Toplam', 'Yeni', 'Tekrar', 'Ulaşılamayan', 'Tamam'].map((h) => el('th', { metin: h })))]),
        el('tbody', null, s.j.dagilim.map((x) => el('tr', null, [x.ad, x.toplam, x.yeni, x.tekrar, x.ulasilamadi, x.tamam].map((v) => el('td', { metin: String(v) })))))]);
      const kullKap = el('div', { 'class': 'secenekler' });
      const filtre = el('div', { 'class': 'izgara' });
      const yukSel = el('select', { id: 'f_ld_yuk' }); yukSel.appendChild(el('option', { value: '', metin: 'Tüm yüklemeler' }));
      const sekSel = el('select', { id: 'f_ld_sek' }); sekSel.appendChild(el('option', { value: '', metin: 'Tüm sektörler' }));
      const ilSel = el('select', { id: 'f_ld_il' }); ilSel.appendChild(el('option', { value: '', metin: 'Tüm iller' }));
      filtre.appendChild(el('div', null, [el('label', { metin: 'Yükleme' }), yukSel]));
      filtre.appendChild(el('div', null, [el('label', { metin: 'Sektör' }), sekSel]));
      filtre.appendChild(el('div', null, [el('label', { metin: 'İl' }), ilSel]));
      api('/api/musteri-filtre').then((f) => { if (f.ok) { (f.j.sektorler || []).forEach((x) => sekSel.appendChild(el('option', { value: x, metin: x }))); (f.j.iller || []).forEach((x) => ilSel.appendChild(el('option', { value: x, metin: x }))); } });
      api('/api/yuklemeler').then((y) => { if (y.ok) (y.j.yuklemeler || []).filter((x) => !x.geri_alma_zamani).forEach((x) => yukSel.appendChild(el('option', { value: x.id, metin: x.dosya_adi + ' (' + tarih(x.olusturma) + ')' }))); });
      api('/api/atanabilir-kullanicilar').then((u) => {
        if (!u.ok) { kullKap.appendChild(el('span', { 'class': 'alt', metin: 'Kullanıcı listesi alınamadı.' })); return; }
        u.j.kullanicilar.forEach((x) => kullKap.appendChild(el('label', { 'class': 'onay' }, [el('input', { type: 'checkbox', 'data-kul': x.id }), ' ' + x.ad + ' (' + x.rol_kod + ')'])));
      });
      const secili = () => Array.prototype.map.call(detay.querySelectorAll('input[data-kul]:checked'), (x) => x.getAttribute('data-kul'));
      const yaz = (mesajMetni, sinif) => mesaj(mk, sinif || 'basari', mesajMetni);
      detay.appendChild(panel([
        el('h3', { metin: 'Liste: ' + l.ad }),
        el('div', { 'class': 'izgara' }, [alan('Ad', 'ld_ad', { deger: l.ad }), alan('Deneme limiti', 'ld_limit', { tip: 'number', deger: l.deneme_limiti || '' }),           secimChip('Durum', 'ld_durum', [['hazirlik', 'Hazırlık'], ['aktif', 'Aktif'], ['durdu', 'Durdu'], ['bitti', 'Bitti']], l.durum)]),
        el('div', { style: 'margin-bottom:10px' }, [el('label', { metin: 'Bu liste hangi ürün/hizmetler için aranacak?' }), ldUrunKap]),
        alan('Açıklama', 'ld_acik', { deger: l.aciklama || '' }), alan('Konuşma metni', 'ld_konusma', { cok: true, deger: l.konusma_metni || '' }),
        el('div', { 'class': 'satir' }, [
          el('button', { type: 'button', metin: 'Kaydet', onclick: () => api('/api/listeler/' + id, { ad: deger('ld_ad'), deneme_limiti: deger('ld_limit'), urun_kodlari: seciliUrunler(ldUrunKap), durum: deger('ld_durum'), aciklama: deger('ld_acik'), konusma_metni: deger('ld_konusma') }, 'PATCH').then((r) => { if (r.ok) getir(id); else yaz(hataMetni(r), 'hata'); }) }),
          eylemVar('liste_sil') ? el('button', { type: 'button', 'class': 'tehlike', metin: 'Listeyi sil', onclick: () => { if (confirm('Liste silinsin mi?')) api('/api/listeler/' + id, null, 'DELETE').then((r) => { if (r.ok) { bos(detay); getir(); } else yaz(hataMetni(r), 'hata'); }); } }) : null]),
        el('h3', { metin: 'Müşteri ekle ve dağıt' }), filtre,
        el('label', { 'class': 'onay' }, [el('input', { type: 'checkbox', id: 'f_ld_atanmamis' }), ' Sadece kimseye atanmamış müşteriler']),
        el('div', { style: 'margin-top:8px' }, [el('label', { metin: 'Agent seçimi (seçilirse eklenenler eşit dağıtılır)' }), kullKap]),
        el('div', { 'class': 'satir' }, [
          el('button', { type: 'button', metin: 'Filtreye uyanları listeye ekle', onclick: () => api('/api/listeler/' + id + '/musteri-ekle', { filtre: { yukleme_id: deger('ld_yuk'), sektor: deger('ld_sek'), il: deger('ld_il'), sadece_atanmamis: document.getElementById('f_ld_atanmamis').checked }, kullanicilar: secili() }).then((r) => {
            if (!r.ok) { yaz(hataMetni(r), 'hata'); return; } detayAc(id); setTimeout(() => yaz(r.j.eklenen + ' müşteri eklendi, ' + r.j.atanan + ' atama yapıldı.'), 400); getir(); }) }),
          eylemVar('atama_yap') ? el('button', { type: 'button', 'class': 'ikincil', metin: 'Aranmamışları seçili agentlara yeniden dağıt', onclick: () => { const k = secili(); if (!k.length) { yaz('Önce agent seçin.', 'hata'); return; } api('/api/listeler/' + id + '/yeniden-dagit', { kullanicilar: k }).then((r) => { if (!r.ok) { yaz(hataMetni(r), 'hata'); return; } detayAc(id); setTimeout(() => yaz(r.j.atanan + ' müşteri yeniden dağıtıldı.'), 400); }); } }) : null]),
        mk, el('h3', { metin: 'Agent bazında dağılım' }), dag,
      ]));
    });
  }
  getir();
}

// ================= ARAMA AYARLARI (yonetici) =================
function sayfaAyarlar() {
  icerik.appendChild(baslik('Arama ayarları'));
  const kok2 = el('div'); icerik.appendChild(kok2);
  const DAL_ADI = { ulasilamadi: 'Ulaşılamadı', muhatap_degil: 'Doğru kişi değil', uygun_degil: 'Görüşmeye uygun değil', bilgi_verildi: 'Görüşme yapıldı', aramasiz: 'Aramasız kapat' };
  function yukle(sonMesaj) {
    api('/api/arama-ayarlari').then((s) => {
      bos(kok2);
      if (!s.ok) { kok2.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      const j = s.j; const mk = el('div', { style: 'display:none' });
      if (sonMesaj) mesaj(mk, 'basari', sonMesaj);
      const hepsi = (r) => { if (r.ok) yukle('Kaydedildi.'); else mesaj(mk, 'hata', hataMetni(r)); };
      kok2.appendChild(panel([el('h3', { metin: 'Genel kurallar' }), el('div', { 'class': 'izgara' }, [
        alan('Deneme limiti (ulaşılamayan için)', 'ay_limit', { tip: 'number', deger: j.ayar.deneme_limiti }),
        alan('Bekleme süresi (gün)', 'ay_cool', { tip: 'number', deger: j.ayar.cooldown_gun }),
        alan('Takip limiti (ulaşılan görüşme sayısı)', 'ay_takip', { tip: 'number', deger: j.ayar.takip_limiti }),
        alan('Kayıt kilidi (dakika)', 'ay_kilit', { tip: 'number', deger: j.ayar.kilit_dakika })]),
        el('div', { 'class': 'satir' }, [el('button', { type: 'button', metin: 'Kaydet', onclick: () => api('/api/arama-ayarlari/sayisal', { deneme_limiti: deger('ay_limit'), cooldown_gun: deger('ay_cool'), takip_limiti: deger('ay_takip'), kilit_dakika: deger('ay_kilit') }, 'PUT').then(hepsi) })]), mk]));
      // Durumlar
      const gruplar = {};
      j.durumlar.forEach((d) => { (gruplar[d.dal] = gruplar[d.dal] || []).push(d); });
      const dp = [el('h3', { metin: 'Arama sonuçları (akış)' }), el('p', { 'class': 'alt', metin: 'Agent bu sonuçları SSSO akışındaki sırayla görür. Sistem satırları silinemez, yalnızca adı, sırası ve aktifliği değiştirilebilir.' })];
      Object.keys(DAL_ADI).forEach((dal) => {
        if (!gruplar[dal]) return;
        dp.push(el('h4', { metin: DAL_ADI[dal] }));
        dp.push(el('table', null, [el('thead', null, [el('tr', null, ['Etiket', 'Sıra', 'Aktif', 'Kutu', ''].map((h) => el('th', { metin: h })))]),
          el('tbody', null, gruplar[dal].map((d) => {
            const e = el('input', { type: 'text', value: d.etiket }); const si = el('input', { type: 'number', value: String(d.sira), style: 'width:70px' });
            const ak = el('input', { type: 'checkbox' }); ak.checked = d.aktif;
            return el('tr', null, [el('td', null, [e]), el('td', null, [si]), el('td', null, [ak]), el('td', { metin: d.kutu }),
              el('td', null, [el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Kaydet', onclick: () => api('/api/durumlar/' + d.kod, { etiket: e.value, sira: Number(si.value), aktif: ak.checked }, 'PATCH').then(hepsi) })])]);
          }))]));
      });
      const yDal = secimChip('Dal', 'dy_dal', Object.keys(DAL_ADI).map((k2) => [k2, DAL_ADI[k2]]), 'ulasilamadi');
      dp.push(el('h4', { metin: 'Yeni sonuç ekle' }));
      dp.push(el('div', { 'class': 'izgara' }, [alan('Etiket', 'dy_etiket'), yDal,
        secimChip('Kutu', 'dy_kutu', [['yeni', 'Yeni'], ['tekrar', 'Tekrar aranacak'], ['ulasilamadi', 'Ulaşılamayan'], ['tamam', 'Tamamlanan']], 'tamam'),
        secimChip('Sonuç grubu', 'dy_grup', [['olumlu', 'Olumlu'], ['olumsuz', 'Olumsuz'], ['ulasilamadi', 'Ulaşılamadı'], ['beklemede', 'Beklemede']], 'olumsuz'),
        secimChip('Tekrar tarihi', 'dy_tekrar', [['', 'Yok'], ['opsiyonel', 'İsteğe bağlı'], ['zorunlu', 'Zorunlu']], '')]));
      dp.push(el('div', { 'class': 'satir' }, [el('button', { type: 'button', metin: 'Sonuç ekle', onclick: () => {
        const b = {}; if (deger('dy_tekrar')) b.tekrar_tarihi = deger('dy_tekrar');
        api('/api/durumlar', { etiket: deger('dy_etiket'), dal: deger('dy_dal'), kutu: deger('dy_kutu'), sonuc_grubu: deger('dy_grup'), bayraklar: b }).then(hepsi);
      } })]));
      kok2.appendChild(panel(dp));
      // Secenekler
      const TUR = { urun_hizmet: 'Ürün / hizmetler', gorusme_nedeni: 'Görüşme nedenleri', kanal: 'Kanallar' };
      const sp = [el('h3', { metin: 'Seçenek listeleri' })];
      Object.keys(TUR).forEach((tur) => {
        sp.push(el('h4', { metin: TUR[tur] }));
        j.secenekler.filter((x) => x.tur === tur).forEach((x) => {
          const e = el('input', { type: 'text', value: x.etiket }); const ak = el('input', { type: 'checkbox' }); ak.checked = x.aktif;
          sp.push(el('div', { 'class': 'satir', style: 'margin:4px 0' }, [e, el('label', { 'class': 'onay' }, [ak, ' aktif']),
            el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Kaydet', onclick: () => api('/api/secenekler/' + tur + '/' + x.kod, { etiket: e.value, aktif: ak.checked }, 'PATCH').then(hepsi) })]));
        });
        const yn = el('input', { type: 'text', placeholder: 'Yeni ' + TUR[tur].toLowerCase() + ' ekle' });
        sp.push(el('div', { 'class': 'satir', style: 'margin:4px 0' }, [yn, el('button', { type: 'button', 'class': 'kucuk', metin: 'Ekle', onclick: () => api('/api/secenekler', { tur: tur, etiket: yn.value }).then(hepsi) })]));
      });
      kok2.appendChild(panel(sp));
      // Icerikler
      const IT = { script: 'Konuşma metni', ipucu: 'İpucu', rehber_notu: 'Rehber notu' };
      const ip = [el('h3', { metin: 'Konuşma metni, ipucu ve rehber notları' }), el('p', { 'class': 'alt', metin: 'Sektör "*" ise tüm müşterilerde, aksi halde yalnız o sektördeki müşterilerde görünür.' })];
      j.icerikler.forEach((x) => {
        const m = el('textarea', { rows: '3' }); m.value = x.metin; const sk = el('input', { type: 'text', value: x.sektor, style: 'width:140px' });
        ip.push(el('div', { 'class': 'icerik-kutu' }, [el('div', { 'class': 'satir', style: 'margin:0 0 6px' }, [el('span', { 'class': 'rozet', metin: IT[x.tur] }), el('span', { 'class': 'alt', metin: 'Sektör:' }), sk]), m,
          el('div', { 'class': 'satir' }, [el('button', { type: 'button', 'class': 'kucuk', metin: 'Kaydet', onclick: () => api('/api/icerikler/' + x.id, { tur: x.tur, sektor: sk.value, baslik: x.baslik, metin: m.value, sira: x.sira, aktif: x.aktif }, 'PATCH').then(hepsi) }),
            el('button', { type: 'button', 'class': 'kucuk tehlike', metin: 'Sil', onclick: () => { if (confirm('Silinsin mi?')) api('/api/icerikler/' + x.id, null, 'DELETE').then(hepsi); } })])]));
      });
      ip.push(el('h4', { metin: 'Yeni içerik' }));
      ip.push(el('div', { 'class': 'izgara' }, [secimChip('Tür', 'ni_tur', Object.keys(IT).map((k2) => [k2, IT[k2]]), 'script'), alan('Sektör (* = hepsi)', 'ni_sektor', { deger: '*' })]));
      ip.push(alan('Metin', 'ni_metin', { cok: true }));
      ip.push(el('div', { 'class': 'satir' }, [el('button', { type: 'button', metin: 'İçerik ekle', onclick: () => api('/api/icerikler', { tur: deger('ni_tur'), sektor: deger('ni_sektor'), metin: deger('ni_metin') }).then(hepsi) })]));
      kok2.appendChild(panel(ip));
    });
  }
  yukle();
}

// ================= TAKVIM =================
function sayfaTakvim() {
  icerik.appendChild(baslik('Takvim'));
  const kap = el('div'); icerik.appendChild(kap);
  function getir() {
    api('/api/takvim').then((s) => {
      bos(kap);
      if (!s.ok) { kap.appendChild(el('div', { 'class': 'hata', metin: hataMetni(s) })); return; }
      if (!s.j.kayitlar.length) { kap.appendChild(panel([el('p', { metin: 'Açık randevu veya görev yok.' })])); return; }
      const tum = ben.izinler.kapsam.takvim === 'TUM';
      kap.appendChild(panel([el('table', null, [
        el('thead', null, [el('tr', null, ['Zaman', 'Tür', 'Müşteri', 'Yetkili', 'Telefon', 'Başlık'].concat(tum ? ['Kullanıcı'] : []).concat(['']).map((h) => el('th', { metin: h })))]),
        el('tbody', null, s.j.kayitlar.map((t) => el('tr', null, [tarih(t.baslangic), t.tur === 'randevu' ? 'Randevu' : 'Görev', t.unvan || '-', t.kontak_ad || '-', t.kontak_telefon || '-', t.baslik].concat(tum ? [t.kullanici || '-'] : []).map((v) => el('td', { metin: v })).concat([
          el('td', null, [el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'Tamamlandı', onclick: () => api('/api/takvim/' + t.id, { durum: 'tamamlandi' }, 'PATCH').then(getir) }),
            ' ', el('button', { type: 'button', 'class': 'kucuk ikincil', metin: 'İptal', onclick: () => api('/api/takvim/' + t.id, { durum: 'iptal' }, 'PATCH').then(getir) })])])))),
      ])]));
    });
  }
  getir();
}
