// Kurulum sayfasi (v__SURUM__)
function bolum(baslik, aciklama, alanlar, dugmeMetni, gonder) {
  const kutu = el('div', { style: 'display:none' });
  const dugme = el('button', { type: 'submit', 'class': 'tam', metin: dugmeMetni });
  const form = el('form', { novalidate: 'novalidate', style: 'margin-top:22px;padding-top:6px;border-top:1px solid #dde3ea' },
    [el('h1', { metin: baslik, style: 'margin-top:14px' }), el('p', { 'class': 'alt', metin: aciklama })].concat(alanlar).concat([dugme, kutu]));
  form.addEventListener('submit', (olay) => {
    olay.preventDefault(); mesaj(kutu, '', ''); dugme.disabled = true;
    gonder(deger('anahtar')).then((s) => {
      dugme.disabled = false;
      if (s.ok) mesaj(kutu, 'basari', hataMetni(s, 'Tamam.')); else mesaj(kutu, 'hata', hataMetni(s));
    });
  });
  return form;
}
kok.appendChild(el('div', { 'class': 'kart' }, [
  el('h1', { metin: 'Platform kurulumu' }),
  el('p', { 'class': 'alt', metin: 'Yalnızca kurulum anahtarını bilen kişi kullanabilir. Anahtar sunucuda gizli değişken olarak saklanır.' }),
  alan('Kurulum anahtarı', 'anahtar', { tip: 'password' }),
  bolum('1) Platform yöneticisi', 'Tüm firmaları yöneten kullanıcı. Yalnızca bir kez oluşturulabilir.',
    [alan('Kullanıcı adı', 'p_kullanici'), alan('Şifre (en az 10 karakter)', 'p_sifre', { tip: 'password' })],
    'Platform yöneticisini oluştur',
    (anahtar) => api('/api/kurulum/platform-admin', { kullanici_adi: deger('p_kullanici'), sifre: deger('p_sifre') }, 'POST', { 'X-Kurulum-Anahtari': anahtar })),
  bolum('2) Firma ve firma yöneticisi', 'Firma yoksa tabloları kurulur; firmanın yöneticisi yoksa oluşturulur.',
    [alan('Firma kodu (küçük harf/rakam)', 'f_kod'), alan('Firma ünvanı', 'f_unvan'),
     alan('Yönetici kullanıcı adı', 'f_kullanici'), alan('Yönetici ad soyad', 'f_ad'),
     alan('Yönetici şifresi (en az 10 karakter)', 'f_sifre', { tip: 'password' })],
    'Firmayı ve yöneticisini oluştur',
    (anahtar) => api('/api/kurulum/firma', { firma_kodu: deger('f_kod'), unvan: deger('f_unvan'), admin_kullanici_adi: deger('f_kullanici'), admin_ad_soyad: deger('f_ad'), admin_sifre: deger('f_sifre') }, 'POST', { 'X-Kurulum-Anahtari': anahtar }))
]));
kok.appendChild(el('div', { 'class': 'surum', metin: 'v' + SURUM }));
