// =====================================================================
// src/yonetim.js  -  Firma yonetim API'si (v0.5.0)  -  PLATFORMDAN BAGIMSIZ
// ---------------------------------------------------------------------
// Firma profili + logo, kullanici yonetimi, roller ve izinler, sifre degisimi.
// ILKE: firma kapsami ASLA istekten alinmaz; her zaman dogrulanmis oturumdaki
// firma (k.firma_id / k.firma_kod) kullanilir. Her islem izin kontrolunden gecer.
// ---------------------------------------------------------------------
import { Buffer } from 'node:buffer';
import { veritabani } from './db.js';
import { sifreOzeti, sifreDogrula } from './guvenlik.js';
import {
  KATALOG, KAPSAM_DEGERLERI, KAPSAM_ANAHTARLARI, EYLEM_ANAHTARLARI, izinleriYukle,
} from './izinler.js';
import {
  T, HttpHata, hata, jsonGovde, norm, metin, oturumAl, oturumBaslat, tekrarSayisi,
  KULLANICI_RE, ROL_KOD_RE, UUID_RE, RENK_RE, kontrastBeyaz, SURUM,
} from './yardimci.js';

const LOGO_MAX = 204800;
const LOGO_TIPLERI = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff] };
const EPOSTA_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function pgHatasi(e) {
  if (e instanceof HttpHata) return e;
  if (e && e.code === '23505') return new HttpHata(409, 'Bu kayıt zaten var.');
  if (e && e.code === '23503') return new HttpHata(400, 'Geçersiz başvuru (ör. seçilen yönetici bu firmada yok).');
  if (e && (e.code === '23514' || e.code === '22P02')) return new HttpHata(400, 'Geçersiz değer.');
  if (e && e.code === 'P0001') return new HttpHata(409, String(e.message || 'İşlem reddedildi.'));
  return null;
}

// Firma kullanicisi icin korumali islem: oturum + (istege bagli) izin + (istege bagli) islem.
// fn duz nesne dondururse JSON, Response dondururse aynen gider.
export async function firmaIslemi(c, { izin = null, islemli = false }, fn) {
  const k = await oturumAl(c);
  if (!k) return hata(c, 401, 'Oturum yok.');
  if (!k.firma_id) return hata(c, 403, 'Bu işlem yalnızca firma kullanıcıları içindir.');
  const db = veritabani(c.env.DATABASE_URL);
  const calistir = islemli ? db.islem : db.baglanti;
  try {
    const sonuc = await calistir(async (q) => {
      const izinler = await izinleriYukle(q, k.firma_kod, k.rol_kod);
      if (izin && !izinler.eylem.has(izin)) throw new HttpHata(403, 'Bu işlem için yetkiniz yok.');
      return fn({ q, k, kod: k.firma_kod, izinler });
    });
    return sonuc instanceof Response ? sonuc : c.json(sonuc);
  } catch (e) {
    const h = pgHatasi(e);
    if (h) return hata(c, h.durum, h.message);
    throw e;
  }
}

export async function gunluk(q, kod, kullaniciId, islem, nesne, nesneId, detay) {
  await q(`INSERT INTO ${T(kod, 'islem_gunlugu')} (kullanici_id, islem, nesne, nesne_id, detay)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [kullaniciId, islem, nesne, nesneId ? String(nesneId) : null, JSON.stringify(detay || {})]);
}

export function idAl(c) {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpHata(400, 'Geçersiz kimlik.');
  return id;
}

export function yonetimRotalari(app) {
  // ---------------- Kendi bilgilerim ----------------
  app.get('/api/ben', async (c) => {
    const k = await oturumAl(c);
    if (!k) return hata(c, 401, 'Oturum yok.');
    // Hangi surumun kullanildigini kaydet (sayfa her yuklendiginde; yazma sikligi sinirli). Hata oturumu bozmaz.
    try {
      await veritabani(c.env.DATABASE_URL).sorgu(
        `UPDATE cc.kullanicilar SET son_surum = $2, son_gorulme = now()
          WHERE id = $1 AND (son_surum IS DISTINCT FROM $2 OR son_gorulme IS NULL OR son_gorulme < now() - interval '5 minutes')`,
        [k.id, SURUM]);
    } catch (e) { console.error('surum kaydi hatasi:', e && e.code); }
    const temel = {
      durum: 'ok', id: k.id, kullanici_adi: k.kullanici_adi, ad_soyad: k.ad_soyad, rol_kod: k.rol_kod,
      platform: k.firma_id === null, firma_kod: k.firma_kod, firma_unvan: k.firma_unvan,
      izinler: { kapsam: {}, eylem: [] }, logo_var: false, renkler: { ana: null, vurgu: null },
    };
    if (k.firma_id === null) return c.json(temel);
    const db = veritabani(c.env.DATABASE_URL);
    return c.json(await db.baglanti(async (q) => {
      const iz = await izinleriYukle(q, k.firma_kod, k.rol_kod);
      const f = await q(`SELECT (logo IS NOT NULL) AS logo_var, renk_ana, renk_vurgu FROM cc.firmalar WHERE id = $1`, [k.firma_id]);
      const rl = await q(`SELECT gorunen_ad FROM ${T(k.firma_kod, 'roller')} WHERE kod = $1`, [k.rol_kod]);
      return { ...temel, rol_ad: rl.rows[0] ? rl.rows[0].gorunen_ad : k.rol_kod, izinler: { kapsam: iz.kapsam, eylem: [...iz.eylem] }, logo_var: !!(f.rows[0] && f.rows[0].logo_var), renkler: { ana: f.rows[0] ? f.rows[0].renk_ana : null, vurgu: f.rows[0] ? f.rows[0].renk_vurgu : null } };
    }));
  });

  app.post('/api/ben/sifre', async (c) => {
    const k = await oturumAl(c);
    if (!k) return hata(c, 401, 'Oturum yok.');
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    const eski = typeof g.eski === 'string' ? g.eski : '';
    const yeni = typeof g.yeni === 'string' ? g.yeni : '';
    if (yeni.length < 10 || yeni.length > 200) return hata(c, 400, 'Yeni şifre 10-200 karakter olmalı.');
    if (yeni === eski) return hata(c, 400, 'Yeni şifre eskisinden farklı olmalı.');
    const db = veritabani(c.env.DATABASE_URL);
    const ozet = await sifreOzeti(yeni, tekrarSayisi(c));
    const sonuc = await db.islem(async (q) => {
      const r = await q(`SELECT sifre_ozeti FROM cc.kullanicilar WHERE id = $1 FOR UPDATE`, [k.id]);
      if (!(await sifreDogrula(eski, r.rows[0].sifre_ozeti))) return { yanlis: true };
      const u = await q(`UPDATE cc.kullanicilar SET sifre_ozeti = $2, oturum_surumu = oturum_surumu + 1
                          WHERE id = $1 RETURNING oturum_surumu`, [k.id, ozet]);
      if (k.firma_id) await gunluk(q, k.firma_kod, k.id, 'sifre_degistir', 'kullanici', k.id, {});
      return { surum: u.rows[0].oturum_surumu };
    });
    if (sonuc.yanlis) return hata(c, 400, 'Mevcut şifre hatalı.');
    await oturumBaslat(c, k.id, sonuc.surum); // diger oturumlar duser, bu oturum surer
    return c.json({ durum: 'ok', mesaj: 'Şifre değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.' });
  });

  // ---------------- Firma profili ----------------
  app.get('/api/firma', (c) => firmaIslemi(c, {}, async ({ q, k }) => {
    const r = await q(`SELECT kod, unvan, kisa_ad, adres, telefon, eposta, web, vergi_no, renk_ana, renk_vurgu,
                              (logo IS NOT NULL) AS logo_var FROM cc.firmalar WHERE id = $1`, [k.firma_id]);
    return { durum: 'ok', firma: r.rows[0] };
  }));

  app.put('/api/firma', async (c) => {
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'firma_profil_duzenle', islemli: true }, async ({ q, k, kod }) => {
      const unvan = metin(g.unvan, 200);
      const kisa = metin(g.kisa_ad, 50);
      const adres = metin(g.adres, 500);
      const tel = metin(g.telefon, 30);
      const eposta = metin(g.eposta, 200);
      const web = metin(g.web, 200);
      const vergi = metin(g.vergi_no, 11);
      if (!unvan) throw new HttpHata(400, 'Firma ünvanı zorunludur.');
      if (tel && !/^[0-9+()\s-]{3,30}$/.test(tel)) throw new HttpHata(400, 'Telefon biçimi geçersiz.');
      if (eposta && !EPOSTA_RE.test(eposta)) throw new HttpHata(400, 'E-posta biçimi geçersiz.');
      if (vergi && !/^[0-9]{10,11}$/.test(vergi)) throw new HttpHata(400, 'Vergi no 10 veya 11 rakam olmalı.');
      await q(`UPDATE cc.firmalar SET unvan = $2, kisa_ad = NULLIF($3, ''), adres = NULLIF($4, ''), telefon = NULLIF($5, ''),
                      eposta = NULLIF($6, ''), web = NULLIF($7, ''), vergi_no = NULLIF($8, '') WHERE id = $1`,
        [k.firma_id, unvan, kisa, adres, tel, eposta, web, vergi]);
      await gunluk(q, kod, k.id, 'firma_profil_guncelle', 'firma', k.firma_id, {});
      return { durum: 'ok', mesaj: 'Firma bilgileri kaydedildi.' };
    });
  });

  app.put('/api/firma/renkler', async (c) => {
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'firma_profil_duzenle', islemli: true }, async ({ q, k, kod }) => {
      const oku = (v) => (v === null || v === undefined || v === '' ? null : String(v).trim());
      let ana = oku(g.renk_ana);
      let vurgu = oku(g.renk_vurgu);
      if (ana !== null && !RENK_RE.test(ana)) throw new HttpHata(400, 'Ana renk #RRGGBB biçiminde olmalı.');
      if (vurgu !== null && !RENK_RE.test(vurgu)) throw new HttpHata(400, 'Vurgu rengi #RRGGBB biçiminde olmalı.');
      if (ana !== null) ana = ana.toUpperCase();
      if (vurgu !== null) vurgu = vurgu.toUpperCase();
      if (ana !== null && kontrastBeyaz(ana) < 4.5) {
        throw new HttpHata(400, 'Ana renk beyaz yazıyla yeterince kontrast oluşturmuyor. Daha koyu bir renk seçin.');
      }
      await q(`UPDATE cc.firmalar SET renk_ana = $2, renk_vurgu = $3 WHERE id = $1`, [k.firma_id, ana, vurgu]);
      await gunluk(q, kod, k.id, 'renk_guncelle', 'firma', k.firma_id, { ana, vurgu });
      return { durum: 'ok', mesaj: 'Renkler kaydedildi.', renkler: { ana, vurgu } };
    });
  });

  app.get('/api/firma/logo', (c) => firmaIslemi(c, {}, async ({ q, k }) => {
    const r = await q(`SELECT logo, logo_tipi FROM cc.firmalar WHERE id = $1`, [k.firma_id]);
    const f = r.rows[0];
    if (!f || !f.logo) return new Response(null, { status: 404 });
    return new Response(f.logo, { status: 200, headers: { 'Content-Type': f.logo_tipi, 'Cache-Control': 'no-store' } });
  }));

  app.put('/api/firma/logo', async (c) => {
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'firma_profil_duzenle', islemli: true }, async ({ q, k, kod }) => {
      const tip = String(g.tip || '');
      const imza = LOGO_TIPLERI[tip];
      if (!imza) throw new HttpHata(400, 'Logo PNG veya JPEG olmalı.');
      if (typeof g.veri !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(g.veri)) throw new HttpHata(400, 'Logo verisi geçersiz.');
      const bayt = Buffer.from(g.veri, 'base64');
      if (bayt.length === 0 || bayt.length > LOGO_MAX) throw new HttpHata(400, 'Logo en fazla 200 KB olabilir.');
      if (!imza.every((b, i) => bayt[i] === b)) throw new HttpHata(400, 'Dosya içeriği seçilen türle uyuşmuyor.');
      await q(`UPDATE cc.firmalar SET logo = $2, logo_tipi = $3 WHERE id = $1`, [k.firma_id, bayt, tip]);
      await gunluk(q, kod, k.id, 'logo_yukle', 'firma', k.firma_id, { boyut: bayt.length });
      return { durum: 'ok', mesaj: 'Logo kaydedildi.' };
    });
  });

  app.delete('/api/firma/logo', (c) => firmaIslemi(c, { izin: 'firma_profil_duzenle', islemli: true }, async ({ q, k, kod }) => {
    await q(`UPDATE cc.firmalar SET logo = NULL, logo_tipi = NULL WHERE id = $1`, [k.firma_id]);
    await gunluk(q, kod, k.id, 'logo_kaldir', 'firma', k.firma_id, {});
    return { durum: 'ok', mesaj: 'Logo kaldırıldı.' };
  }));

  // ---------------- Kullanicilar ----------------
  app.get('/api/kullanicilar', (c) => firmaIslemi(c, { izin: 'kullanici_yonet' }, async ({ q, k, kod }) => {
    const u = await q(`SELECT id, kullanici_adi, ad_soyad, rol_kod, yonetici_id, eposta, telefon, gorev, aktif, son_giris, son_surum, son_gorulme
                         FROM cc.kullanicilar WHERE firma_id = $1 ORDER BY aktif DESC, kullanici_adi`, [k.firma_id]);
    const r = await q(`SELECT kod, gorunen_ad, aktif FROM ${T(kod, 'roller')} ORDER BY sira, kod`);
    return { durum: 'ok', kullanicilar: u.rows, roller: r.rows };
  }));

  // Giris kayitlari: YALNIZ oturumdaki firmanin kayitlari (firma kodu istekten alinmaz)
  app.get('/api/giris-kayitlari', (c) => firmaIslemi(c, { izin: 'kullanici_yonet' }, async ({ q, k }) => {
    const kisi = metin(c.req.query('kullanici'), 60);
    const sonuc = c.req.query('sonuc');
    const par = [k.firma_kod];
    let kosul = 'firma_kodu = $1';
    if (kisi) { par.push(norm(kisi)); kosul += ` AND kullanici_adi = $${par.length}`; }
    if (sonuc === 'basarili') kosul += ' AND basarili';
    else if (sonuc === 'hatali') kosul += ' AND NOT basarili';
    const r = await q(`SELECT zaman, kullanici_adi, basarili, ip, surum FROM cc.giris_kayitlari
                        WHERE ${kosul} ORDER BY zaman DESC LIMIT 300`, par);
    return { durum: 'ok', kayitlar: r.rows };
  }));

  async function rolGecerliMi(q, kod, rolKod) {
    if (!ROL_KOD_RE.test(rolKod)) return false;
    const r = await q(`SELECT 1 FROM ${T(kod, 'roller')} WHERE kod = $1 AND aktif`, [rolKod]);
    return !!r.rows[0];
  }
  // Yonetici zincirinde dongu olmasin: yeni yoneticinin ustleri arasinda kullanicinin kendisi var mi?
  async function dongu(q, kullaniciId, yoneticiId) {
    const r = await q(`WITH RECURSIVE z AS (
                         SELECT id, yonetici_id FROM cc.kullanicilar WHERE id = $1
                         UNION
                         SELECT u.id, u.yonetici_id FROM cc.kullanicilar u JOIN z ON u.id = z.yonetici_id)
                       SELECT 1 FROM z WHERE id = $2`, [yoneticiId, kullaniciId]);
    return !!r.rows[0];
  }
  // Firmada en az bir aktif firma_admin kalmali (esanli islemlere karsi once kilitler)
  async function adminKilitle(q, firmaId) {
    await q(`SELECT id FROM cc.kullanicilar WHERE firma_id = $1 AND rol_kod = 'firma_admin' AND aktif FOR UPDATE`, [firmaId]);
  }
  async function adminKaldiMi(q, firmaId) {
    const r = await q(`SELECT count(*)::int AS n FROM cc.kullanicilar WHERE firma_id = $1 AND rol_kod = 'firma_admin' AND aktif`, [firmaId]);
    if (r.rows[0].n < 1) throw new HttpHata(409, 'Firmada en az bir aktif firma yöneticisi kalmalıdır.');
  }

  app.post('/api/kullanicilar', async (c) => {
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'kullanici_yonet', islemli: true }, async ({ q, k, kod }) => {
      const kadi = norm(g.kullanici_adi);
      const sifre = typeof g.sifre === 'string' ? g.sifre : '';
      const rol = norm(g.rol_kod);
      const eposta = metin(g.eposta, 200);
      if (!KULLANICI_RE.test(kadi)) throw new HttpHata(400, 'Kullanıcı adı 2-60 karakter; küçük harf, rakam ve . _ @ - kullanılabilir.');
      if (sifre.length < 10 || sifre.length > 200) throw new HttpHata(400, 'Şifre 10-200 karakter olmalı.');
      if (eposta && !EPOSTA_RE.test(eposta)) throw new HttpHata(400, 'E-posta biçimi geçersiz.');
      if (!(await rolGecerliMi(q, kod, rol))) throw new HttpHata(400, 'Geçersiz veya pasif rol.');
      const yon = g.yonetici_id ? String(g.yonetici_id) : null;
      if (yon && !UUID_RE.test(yon)) throw new HttpHata(400, 'Geçersiz yönetici.');
      const ozet = await sifreOzeti(sifre, tekrarSayisi(c));
      const r = await q(`INSERT INTO cc.kullanicilar (firma_id, kullanici_adi, ad_soyad, sifre_ozeti, rol_kod, yonetici_id, eposta, telefon, gorev)
                         VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, '')) RETURNING id`,
        [k.firma_id, kadi, metin(g.ad_soyad, 100) || kadi, ozet, rol, yon, eposta, metin(g.telefon, 30), metin(g.gorev, 100)]);
      await gunluk(q, kod, k.id, 'kullanici_ekle', 'kullanici', r.rows[0].id, { kullanici_adi: kadi, rol });
      return { durum: 'ok', id: r.rows[0].id, mesaj: 'Kullanıcı oluşturuldu.' };
    });
  });

  app.patch('/api/kullanicilar/:id', async (c) => {
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'kullanici_yonet', islemli: true }, async ({ q, k, kod }) => {
      const id = idAl(c);
      await adminKilitle(q, k.firma_id);
      const h = await q(`SELECT id, kullanici_adi, rol_kod, aktif FROM cc.kullanicilar WHERE id = $1 AND firma_id = $2 FOR UPDATE`, [id, k.firma_id]);
      if (!h.rows[0]) throw new HttpHata(404, 'Kullanıcı bulunamadı.');
      const alanlar = []; const par = [id, k.firma_id]; const ekle = (kolon, deger) => { par.push(deger); alanlar.push(kolon + ' = $' + par.length); };
      let oturumDussun = false;
      if ('ad_soyad' in g) ekle('ad_soyad', metin(g.ad_soyad, 100) || h.rows[0].kullanici_adi);
      if ('eposta' in g) {
        const e = metin(g.eposta, 200);
        if (e && !EPOSTA_RE.test(e)) throw new HttpHata(400, 'E-posta biçimi geçersiz.');
        ekle('eposta', e || null);
      }
      if ('telefon' in g) ekle('telefon', metin(g.telefon, 30) || null);
      if ('gorev' in g) ekle('gorev', metin(g.gorev, 100) || null);
      if ('rol_kod' in g) {
        const rol = norm(g.rol_kod);
        if (!(await rolGecerliMi(q, kod, rol))) throw new HttpHata(400, 'Geçersiz veya pasif rol.');
        ekle('rol_kod', rol);
      }
      if ('yonetici_id' in g) {
        const yon = g.yonetici_id ? String(g.yonetici_id) : null;
        if (yon) {
          if (!UUID_RE.test(yon)) throw new HttpHata(400, 'Geçersiz yönetici.');
          if (yon === id || (await dongu(q, id, yon))) throw new HttpHata(400, 'Yönetici zincirinde döngü olamaz.');
        }
        ekle('yonetici_id', yon);
      }
      if ('aktif' in g) {
        if (typeof g.aktif !== 'boolean') throw new HttpHata(400, 'Geçersiz değer.');
        if (id === k.id && g.aktif === false) throw new HttpHata(400, 'Kendinizi pasife alamazsınız.');
        ekle('aktif', g.aktif);
        if (g.aktif === false) oturumDussun = true;
      }
      if (!alanlar.length) throw new HttpHata(400, 'Değiştirilecek alan yok.');
      if (oturumDussun) alanlar.push('oturum_surumu = oturum_surumu + 1');
      await q(`UPDATE cc.kullanicilar SET ${alanlar.join(', ')} WHERE id = $1 AND firma_id = $2`, par);
      await adminKaldiMi(q, k.firma_id);
      await gunluk(q, kod, k.id, 'kullanici_guncelle', 'kullanici', id, { alanlar: Object.keys(g) });
      return { durum: 'ok', mesaj: 'Kullanıcı güncellendi.' };
    });
  });

  app.post('/api/kullanicilar/:id/sifre-sifirla', async (c) => {
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'kullanici_yonet', islemli: true }, async ({ q, k, kod }) => {
      const id = idAl(c);
      const sifre = typeof g.sifre === 'string' ? g.sifre : '';
      if (sifre.length < 10 || sifre.length > 200) throw new HttpHata(400, 'Şifre 10-200 karakter olmalı.');
      const ozet = await sifreOzeti(sifre, tekrarSayisi(c));
      const r = await q(`UPDATE cc.kullanicilar SET sifre_ozeti = $3, oturum_surumu = oturum_surumu + 1, basarisiz_deneme = 0
                          WHERE id = $1 AND firma_id = $2 RETURNING kullanici_adi`, [id, k.firma_id, ozet]);
      if (!r.rows[0]) throw new HttpHata(404, 'Kullanıcı bulunamadı.');
      // Hatali deneme kilidi varsa kaldir
      await q(`DELETE FROM cc.giris_kayitlari WHERE firma_kodu = $1 AND kullanici_adi = $2 AND NOT basarili
                AND zaman > now() - interval '1 hour'`, [kod, r.rows[0].kullanici_adi]);
      await gunluk(q, kod, k.id, 'sifre_sifirla', 'kullanici', id, {});
      return { durum: 'ok', mesaj: 'Şifre sıfırlandı. Kullanıcının açık oturumları kapatıldı.' };
    });
  });

  // ---------------- Roller ve izinler ----------------
  app.get('/api/roller', (c) => firmaIslemi(c, { izin: 'rol_yonet' }, async ({ q, k, kod }) => {
    const r = await q(`SELECT kod, gorunen_ad, aktif, sira, sistem FROM ${T(kod, 'roller')} ORDER BY sira, kod`);
    const iz = await q(`SELECT rol_kod, perm_tip, perm_key, deger FROM ${T(kod, 'rol_izinleri')}`);
    const say = await q(`SELECT rol_kod, count(*)::int AS n FROM cc.kullanicilar WHERE firma_id = $1 AND aktif GROUP BY rol_kod`, [k.firma_id]);
    const sayi = Object.fromEntries(say.rows.map((s) => [s.rol_kod, s.n]));
    const roller = r.rows.map((rol) => {
      const kapsam = {}; const eylem = {};
      for (const a of KATALOG.kapsam) kapsam[a.k] = '';
      for (const a of KATALOG.eylem) eylem[a.k] = false;
      for (const s of iz.rows) {
        if (s.rol_kod !== rol.kod) continue;
        if (s.perm_tip === 'scope' && s.perm_key in kapsam) kapsam[s.perm_key] = s.deger;
        if (s.perm_tip === 'action' && s.perm_key in eylem) eylem[s.perm_key] = s.deger === '1';
      }
      return { ...rol, kullanici_sayisi: sayi[rol.kod] || 0, izinler: { kapsam, eylem } };
    });
    return { durum: 'ok', katalog: KATALOG, roller };
  }));

  app.post('/api/roller', async (c) => {
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'rol_yonet', islemli: true }, async ({ q, k, kod }) => {
      const rolKod = norm(g.kod);
      const ad = metin(g.gorunen_ad, 60);
      if (!ROL_KOD_RE.test(rolKod) || rolKod === 'platform_admin') throw new HttpHata(400, 'Rol kodu 1-30 karakter; küçük harf, rakam ve alt çizgi.');
      if (!ad) throw new HttpHata(400, 'Rol adı zorunludur.');
      const s = await q(`SELECT COALESCE(max(sira), 0) + 10 AS sira FROM ${T(kod, 'roller')}`);
      await q(`INSERT INTO ${T(kod, 'roller')} (kod, gorunen_ad, aktif, sira, sistem) VALUES ($1, $2, true, $3, false)`,
        [rolKod, ad, s.rows[0].sira]);
      // Yeni rol hicbir yetkiyle baslar
      await q(`INSERT INTO ${T(kod, 'rol_izinleri')} (rol_kod, perm_tip, perm_key, deger) SELECT $1, 'scope', x, '' FROM unnest($2::text[]) x`,
        [rolKod, KATALOG.kapsam.map((a) => a.k)]);
      await q(`INSERT INTO ${T(kod, 'rol_izinleri')} (rol_kod, perm_tip, perm_key, deger) SELECT $1, 'action', x, '0' FROM unnest($2::text[]) x`,
        [rolKod, KATALOG.eylem.map((a) => a.k)]);
      await gunluk(q, kod, k.id, 'rol_ekle', 'rol', rolKod, { gorunen_ad: ad });
      return { durum: 'ok', mesaj: 'Rol oluşturuldu. İzinleri düzenleyip kaydedin.' };
    });
  });

  app.patch('/api/roller/:kod', async (c) => {
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'rol_yonet', islemli: true }, async ({ q, k, kod }) => {
      const rolKod = norm(c.req.param('kod'));
      if (!ROL_KOD_RE.test(rolKod)) throw new HttpHata(400, 'Geçersiz rol.');
      const mevcut = await q(`SELECT kod FROM ${T(kod, 'roller')} WHERE kod = $1 FOR UPDATE`, [rolKod]);
      if (!mevcut.rows[0]) throw new HttpHata(404, 'Rol bulunamadı.');
      const alanlar = []; const par = [rolKod]; const ekle = (kolon, deger) => { par.push(deger); alanlar.push(kolon + ' = $' + par.length); };
      if ('gorunen_ad' in g) {
        const ad = metin(g.gorunen_ad, 60);
        if (!ad) throw new HttpHata(400, 'Rol adı zorunludur.');
        ekle('gorunen_ad', ad);
      }
      if ('aktif' in g) {
        if (typeof g.aktif !== 'boolean') throw new HttpHata(400, 'Geçersiz değer.');
        if (g.aktif === false) {
          const n = await q(`SELECT count(*)::int AS n FROM cc.kullanicilar WHERE firma_id = $1 AND rol_kod = $2 AND aktif`, [k.firma_id, rolKod]);
          if (n.rows[0].n > 0) throw new HttpHata(409, 'Bu role atanmış aktif kullanıcılar var. Önce kullanıcıların rolünü değiştirin.');
        }
        ekle('aktif', g.aktif);
      }
      if ('sira' in g) {
        const s = parseInt(g.sira, 10);
        if (!(s >= 0 && s <= 10000)) throw new HttpHata(400, 'Geçersiz sıra.');
        ekle('sira', s);
      }
      if (!alanlar.length) throw new HttpHata(400, 'Değiştirilecek alan yok.');
      await q(`UPDATE ${T(kod, 'roller')} SET ${alanlar.join(', ')} WHERE kod = $1`, par);
      await gunluk(q, kod, k.id, 'rol_guncelle', 'rol', rolKod, { alanlar: Object.keys(g) });
      return { durum: 'ok', mesaj: 'Rol güncellendi.' };
    });
  });

  app.put('/api/roller/:kod/izinler', async (c) => {
    const g = await jsonGovde(c);
    if (!g || typeof g.kapsam !== 'object' || typeof g.eylem !== 'object' || !g.kapsam || !g.eylem) return hata(c, 400, 'Geçersiz istek.');
    return firmaIslemi(c, { izin: 'rol_yonet', islemli: true }, async ({ q, k, kod }) => {
      const rolKod = norm(c.req.param('kod'));
      if (!ROL_KOD_RE.test(rolKod)) throw new HttpHata(400, 'Geçersiz rol.');
      const mevcut = await q(`SELECT kod FROM ${T(kod, 'roller')} WHERE kod = $1 FOR UPDATE`, [rolKod]);
      if (!mevcut.rows[0]) throw new HttpHata(404, 'Rol bulunamadı.');
      const tip = []; const anahtar = []; const deger = [];
      for (const [a, v] of Object.entries(g.kapsam)) {
        if (!KAPSAM_ANAHTARLARI.has(a) || !KAPSAM_DEGERLERI.includes(v)) throw new HttpHata(400, 'Geçersiz kapsam izni: ' + a);
        tip.push('scope'); anahtar.push(a); deger.push(v);
      }
      for (const [a, v] of Object.entries(g.eylem)) {
        if (!EYLEM_ANAHTARLARI.has(a) || typeof v !== 'boolean') throw new HttpHata(400, 'Geçersiz eylem izni: ' + a);
        tip.push('action'); anahtar.push(a); deger.push(v ? '1' : '0');
      }
      if (!tip.length) throw new HttpHata(400, 'Değiştirilecek izin yok.');
      await q(`INSERT INTO ${T(kod, 'rol_izinleri')} (rol_kod, perm_tip, perm_key, deger)
               SELECT $1, x.t, x.k, x.d FROM unnest($2::text[], $3::text[], $4::text[]) AS x(t, k, d)
               ON CONFLICT (rol_kod, perm_tip, perm_key) DO UPDATE SET deger = EXCLUDED.deger`,
        [rolKod, tip, anahtar, deger]);
      await gunluk(q, kod, k.id, 'izin_guncelle', 'rol', rolKod, {});
      return { durum: 'ok', mesaj: 'İzinler kaydedildi.' };
    });
  });
}
