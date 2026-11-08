// =====================================================================
// src/app.js  -  Uygulama (v0.5.0)  -  PLATFORMDAN BAGIMSIZ
// ---------------------------------------------------------------------
// Cloudflare Workers, Node.js, Deno, Bun: hepsinde ayni kodla calisir.
// Ortam degiskenleri disaridan "env" olarak verilir (platform giris dosyasi):
//   DATABASE_URL      Postgres baglanti dizesi
//   OTURUM_ANAHTARI   oturum jetonunu imzalar (en az 32 karakter, rastgele)
//   KURULUM_ANAHTARI  /kurulum sayfasi icin gizli anahtar (en az 20 karakter)
//   SIFRE_TEKRAR      (istege bagli) PBKDF2 tekrar sayisi, varsayilan 100000
// ---------------------------------------------------------------------
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie } from 'hono/cookie';
import { veritabani } from './db.js';
import { sifreOzeti, sifreDogrula, SAHTE_OZET, anahtarEsitMi } from './guvenlik.js';
import { girisSayfasi, kurulumSayfasi } from './sayfalar.js';
import { APP_JS, KURULUM_JS, XLSX_JS } from './istemci.gen.js';
import { yonetimRotalari } from './yonetim.js';
import { musteriRotalari } from './musteri.js';
import {
  SURUM, COOKIE, FIRMA_KOD_RE, KULLANICI_RE, norm, hata, jsonGovde, istemciIp, tekrarSayisi,
  oturumAnahtari, oturumAl, oturumBaslat,
} from './yardimci.js';

export { SURUM };

const KILIT_DENEME = 5;
const KILIT_DAKIKA = 15;
const GENEL_GIRIS_HATASI = 'Firma kodu, kullanıcı adı veya şifre hatalı.';

async function kurulumYetkisi(c) {
  const a = c.env && c.env.KURULUM_ANAHTARI;
  if (typeof a !== 'string' || a.length < 20) {
    return hata(c, 503, 'Kurulum anahtarı sunucuda tanımlı değil.', 'KURULUM_ANAHTARI_YOK');
  }
  const gelen = c.req.header('x-kurulum-anahtari') || '';
  if (!(await anahtarEsitMi(gelen, a))) return hata(c, 403, 'Kurulum anahtarı hatalı.');
  return null;
}

export function uygulamaOlustur() {
  const app = new Hono();

  // ---- Ortak basliklar ----
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; " +
      "img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  });

  // ---- API korumasi: govde siniri + JSON zorunlu + ayni kaynak (Origin) denetimi ----
  app.use('/api/*', bodyLimit({ maxSize: 400 * 1024, onError: (c) => hata(c, 413, 'İstek çok büyük.') }));
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET') {
      const o = c.req.header('origin');
      if (o) {
        let ayni = false;
        try { ayni = new URL(o).host === new URL(c.req.url).host; } catch (e) { ayni = false; }
        if (!ayni) return hata(c, 403, 'İstek reddedildi.');
      }
      if (!(c.req.header('content-type') || '').startsWith('application/json')) {
        return hata(c, 415, 'Geçersiz istek biçimi.');
      }
    }
    await next();
  });

  // ---- Sayfalar ----
  app.get('/', (c) => c.html(girisSayfasi()));
  app.get('/kurulum', (c) => c.html(kurulumSayfasi()));
  app.get('/app.js', (c) => c.body(APP_JS, 200, { 'Content-Type': 'application/javascript; charset=utf-8' }));
  app.get('/xlsx.js', (c) => c.body(XLSX_JS, 200, { 'Content-Type': 'application/javascript; charset=utf-8' }));
  app.get('/kurulum.js', (c) => c.body(KURULUM_JS, 200, { 'Content-Type': 'application/javascript; charset=utf-8' }));

  // ---- Giris ----
  app.post('/api/giris', async (c) => {
    if (!oturumAnahtari(c)) return hata(c, 500, 'Sunucu yapılandırması eksik.', 'OTURUM_ANAHTARI_YOK');
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    const firmaKodu = norm(g.firma_kodu);
    const kadi = norm(g.kullanici_adi);
    const sifre = typeof g.sifre === 'string' ? g.sifre : '';
    if (!firmaKodu || !kadi || !sifre) return hata(c, 400, 'Firma kodu, kullanıcı adı ve şifre zorunludur.');
    if (sifre.length > 200) return hata(c, 401, GENEL_GIRIS_HATASI);
    const ip = istemciIp(c);

    const sonuc = await veritabani(c.env.DATABASE_URL).baglanti(async (q) => {
      // 1) Kilit: son basarili giristen sonraki, son 15 dakikadaki hatali deneme sayisi
      //    (var olmayan kullanici adlari icin de ayni sayac isler)
      const kilit = await q(
        `SELECT count(*)::int AS n FROM cc.giris_kayitlari
          WHERE firma_kodu = $1 AND kullanici_adi = $2 AND NOT basarili
            AND zaman > now() - make_interval(mins => $3)
            AND zaman > COALESCE((SELECT max(zaman) FROM cc.giris_kayitlari
                                   WHERE firma_kodu = $1 AND kullanici_adi = $2 AND basarili), to_timestamp(0))`,
        [firmaKodu, kadi, KILIT_DAKIKA]);
      if (kilit.rows[0].n >= KILIT_DENEME) return { kilitli: true };

      // 2) Kullaniciyi bul (platform yoneticisi icin firma kodu 'platform')
      const r = await q(
        `SELECT u.id, u.sifre_ozeti, u.aktif, u.oturum_surumu, f.durum AS firma_durum
           FROM cc.kullanicilar u LEFT JOIN cc.firmalar f ON f.id = u.firma_id
          WHERE u.kullanici_adi = $2
            AND (CASE WHEN $1 = 'platform' THEN u.firma_id IS NULL ELSE f.kod = $1 END)`,
        [firmaKodu, kadi]);
      const k = r.rows[0] || null;

      // 3) Sifre: kullanici olmasa da ayni is yuku
      const dogru = await sifreDogrula(sifre, k ? k.sifre_ozeti : SAHTE_OZET);
      const izinli = !!k && dogru && k.aktif && (firmaKodu === 'platform' || k.firma_durum === 'aktif');

      await q(`INSERT INTO cc.giris_kayitlari (firma_kodu, kullanici_adi, basarili, ip, surum) VALUES ($1, $2, $3, $4, $5)`,
        [firmaKodu, kadi, izinli, ip, SURUM]);
      if (!izinli) {
        if (k) await q(`UPDATE cc.kullanicilar SET basarisiz_deneme = basarisiz_deneme + 1 WHERE id = $1`, [k.id]);
        return { basarili: false };
      }
      await q(`UPDATE cc.kullanicilar SET basarisiz_deneme = 0, son_giris = now(), son_surum = $2, son_gorulme = now() WHERE id = $1`, [k.id, SURUM]);
      return { basarili: true, id: k.id, surum: k.oturum_surumu };
    });

    if (sonuc.kilitli) {
      return hata(c, 429, 'Çok fazla hatalı deneme. ' + KILIT_DAKIKA + ' dakika sonra tekrar deneyin.');
    }
    if (!sonuc.basarili) return hata(c, 401, GENEL_GIRIS_HATASI);

    await oturumBaslat(c, sonuc.id, sonuc.surum);
    return c.json({ durum: 'ok' });
  });

  app.post('/api/cikis', (c) => {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ durum: 'ok' });
  });

  // ---- Firma yonetim API'si (profil, kullanicilar, roller, sifre, /api/ben) ----
  yonetimRotalari(app);
  musteriRotalari(app);

  // ---- Kurulum (kurulum anahtari ile korunur) ----
  app.post('/api/kurulum/platform-admin', async (c) => {
    const yetkisiz = await kurulumYetkisi(c);
    if (yetkisiz) return yetkisiz;
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    const kadi = norm(g.kullanici_adi);
    const sifre = typeof g.sifre === 'string' ? g.sifre : '';
    if (!KULLANICI_RE.test(kadi)) return hata(c, 400, 'Kullanıcı adı 2-60 karakter; küçük harf, rakam ve . _ @ - kullanılabilir.');
    if (sifre.length < 10 || sifre.length > 200) return hata(c, 400, 'Şifre 10-200 karakter olmalı.');
    const ozet = await sifreOzeti(sifre, tekrarSayisi(c));
    try {
      const sonuc = await veritabani(c.env.DATABASE_URL).islem(async (q) => {
        const v = await q(`SELECT count(*)::int AS n FROM cc.kullanicilar WHERE firma_id IS NULL`);
        if (v.rows[0].n > 0) return { var: true };
        await q(`INSERT INTO cc.kullanicilar (firma_id, kullanici_adi, ad_soyad, sifre_ozeti, rol_kod)
                 VALUES (NULL, $1, $2, $3, 'platform_admin')`, [kadi, kadi, ozet]);
        return { var: false };
      });
      if (sonuc.var) return hata(c, 409, 'Platform yöneticisi zaten oluşturulmuş.');
      return c.json({ durum: 'ok', mesaj: 'Platform yöneticisi oluşturuldu. Giriş için firma kodu: platform' });
    } catch (e) {
      console.error('platform-admin hatasi:', e && e.code, e && e.message);
      return hata(c, 500, 'İşlem başarısız.', (e && e.code) || 'BILINMIYOR');
    }
  });

  app.post('/api/kurulum/firma', async (c) => {
    const yetkisiz = await kurulumYetkisi(c);
    if (yetkisiz) return yetkisiz;
    const g = await jsonGovde(c);
    if (!g) return hata(c, 400, 'Geçersiz istek.');
    const kod = norm(g.firma_kodu);
    const unvan = String(g.unvan == null ? '' : g.unvan).trim().slice(0, 200);
    const kadi = norm(g.admin_kullanici_adi);
    const adSoyad = String(g.admin_ad_soyad == null ? '' : g.admin_ad_soyad).trim().slice(0, 100) || kadi;
    const sifre = typeof g.admin_sifre === 'string' ? g.admin_sifre : '';
    if (!FIRMA_KOD_RE.test(kod) || kod === 'platform') return hata(c, 400, 'Firma kodu 1-20 karakter; yalnız küçük harf ve rakam. "platform" kullanılamaz.');
    if (!unvan) return hata(c, 400, 'Firma ünvanı zorunludur.');
    if (!KULLANICI_RE.test(kadi)) return hata(c, 400, 'Kullanıcı adı 2-60 karakter; küçük harf, rakam ve . _ @ - kullanılabilir.');
    if (sifre.length < 10 || sifre.length > 200) return hata(c, 400, 'Şifre 10-200 karakter olmalı.');
    const ozet = await sifreOzeti(sifre, tekrarSayisi(c));
    try {
      const sonuc = await veritabani(c.env.DATABASE_URL).islem(async (q) => {
        let f = await q(`SELECT id FROM cc.firmalar WHERE kod = $1`, [kod]);
        let yeniFirma = false;
        if (!f.rows[0]) {
          f = await q(`SELECT cc.firma_kur($1, $2) AS id`, [kod, unvan]);
          yeniFirma = true;
        }
        const firmaId = f.rows[0].id;
        const v = await q(`SELECT count(*)::int AS n FROM cc.kullanicilar WHERE firma_id = $1 AND rol_kod = 'firma_admin'`, [firmaId]);
        if (v.rows[0].n > 0) return { adminVar: true };
        await q(`INSERT INTO cc.kullanicilar (firma_id, kullanici_adi, ad_soyad, sifre_ozeti, rol_kod)
                 VALUES ($1, $2, $3, $4, 'firma_admin')`, [firmaId, kadi, adSoyad, ozet]);
        return { adminVar: false, yeniFirma };
      });
      if (sonuc.adminVar) return hata(c, 409, 'Bu firmanın yöneticisi zaten var. Yeni kullanıcılar yönetici ekranından eklenecek.');
      return c.json({ durum: 'ok', mesaj: (sonuc.yeniFirma ? 'Firma kuruldu ve yönetici oluşturuldu. ' : 'Firma zaten vardı; yönetici oluşturuldu. ') + 'Giriş için firma kodu: ' + kod });
    } catch (e) {
      console.error('firma-kurulum hatasi:', e && e.code, e && e.message);
      if (e && e.code === '23505') return hata(c, 409, 'Bu kullanıcı adı veya firma kodu zaten kullanılıyor.');
      return hata(c, 500, 'İşlem başarısız.', (e && e.code) || 'BILINMIYOR');
    }
  });

  // ---- Baglanti testi: yalnizca giris yapmis platform yoneticisi ----
  app.get('/saglik', async (c) => {
    const t0 = Date.now();
    const k = await oturumAl(c);
    if (!k) return hata(c, 401, 'Oturum gerekli.');
    if (k.rol_kod !== 'platform_admin') return hata(c, 403, 'Yetkiniz yok.');
    const r = await veritabani(c.env.DATABASE_URL).sorgu(
      'SELECT count(*)::int AS n, version() AS surum FROM cc.firmalar');
    return c.json({
      durum: 'ok', uygulama_surumu: SURUM, firma_sayisi: r.rows[0].n,
      postgres: r.rows[0].surum.split(' ').slice(0, 2).join(' '), sure_ms: Date.now() - t0,
    });
  });

  app.notFound((c) => c.json({ durum: 'yok' }, 404));
  app.onError((e, c) => {
    // Tam hata sunucu gunlugunde; istemciye yalnizca kod (sifre/adres sizmasin)
    console.error('hata:', e && e.code, e && e.message);
    return hata(c, 500, 'Beklenmeyen hata.', (e && e.code) || 'BILINMIYOR');
  });
  return app;
}
