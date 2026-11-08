// =====================================================================
// src/arama.js  -  Arama listeleri, atama, arama akisi, ayarlar, takvim (v0.8.0)
// PLATFORMDAN BAGIMSIZ. ILKE: firma kapsami ASLA istekten alinmaz; tablo adlari yalniz
// T() ile oturumdaki firmadan uretilir. Agent (kapsam KENDI) yalniz kendisine atanmis
// musterileri gorur ve arar. Tamamlanan arama kaydi veritabani tetikleyicisiyle degismezdir.
// =====================================================================
import { T, HttpHata, jsonGovde, norm, UUID_RE } from './yardimci.js';
import { firmaIslemi, gunluk, idAl } from './yonetim.js';

const kisalt = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return s ? s.slice(0, n) : null;
};
const uuidMi = (v) => typeof v === 'string' && UUID_RE.test(v);
const KUTULAR = ['yeni', 'tekrar', 'ulasilamadi', 'tamam'];
const DALLAR = ['ulasilamadi', 'muhatap_degil', 'uygun_degil', 'bilgi_verildi', 'aramasiz'];
const SONUC_GRUPLARI = ['olumlu', 'olumsuz', 'ulasilamadi', 'beklemede'];
const KOD_RE = /^[a-z0-9_]{1,40}$/;

function aramaKapsami(izinler) {
  const k = izinler.kapsam.arama || '';
  if (k !== 'TUM' && k !== 'KENDI') throw new HttpHata(403, 'Arama ekranına erişim yetkiniz yok.');
  return k;
}
// Kapsam kosulu: KENDI ise musteri bana atanmis olmali. par dizisine kullanici id'sini ekler.
function atamaKosulu(kod, kapsam, kullaniciId, par, musteriAlias) {
  if (kapsam !== 'KENDI') return '';
  par.push(kullaniciId);
  return ` AND EXISTS (SELECT 1 FROM ${T(kod, 'atamalar')} at1 WHERE at1.musteri_id = ${musteriAlias}.id AND at1.kullanici_id = $${par.length})`;
}
// Eski kurulumlarda tohumlanan varsayilanlari kullanici kurallarina getirir (idempotent, surec basina firma basina bir kez).
// Yalniz hala TOHUM degerinde olan satirlara dokunur; yonetici degistirdiyse korunur.
const DUZELTILEN = new Set();
async function firmaDuzelt(q, kod) {
  if (DUZELTILEN.has(kod)) return;
  const D = T(kod, 'durumlar');
  await q(`INSERT INTO ${D} (kod, etiket, dal, kutu, sonuc_grubu, bayraklar, sira, sistem)
           VALUES ('ulasilamiyor', 'Ulaşılamıyor (görev sonlandırıldı)', 'ulasilamadi', 'tamam', 'ulasilamadi', '{}', 45, true)
           ON CONFLICT (kod) DO NOTHING`);
  await q(`UPDATE ${D} SET bayraklar = '{"tekrar_tarihi": "zorunlu"}'::jsonb
            WHERE kod IN ('telefon_cevap_yok', 'asistan_gecilemedi', 'surekli_mesgul') AND bayraklar = '{}'::jsonb`);
  await q(`UPDATE ${D} SET kutu = 'tamam', bayraklar = '{}'::jsonb WHERE kod = 'numara_yanlis' AND kutu = 'ulasilamadi'`);
  await q(`UPDATE ${T(kod, 'ayarlar')} SET deger = '5' WHERE anahtar = 'deneme_limiti' AND deger = '4'`);
  DUZELTILEN.add(kod);
}
async function ayarlariOku(q, kod) {
  const r = await q(`SELECT anahtar, deger FROM ${T(kod, 'ayarlar')}`);
  const a = Object.fromEntries(r.rows.map((x) => [x.anahtar, x.deger]));
  const sayi = (v, vars, en, çok) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= en && n <= çok ? n : vars; };
  return {
    deneme_limiti: sayi(a.deneme_limiti, 5, 1, 50),
    cooldown_gun: sayi(a.cooldown_gun, 30, 0, 365),
    kilit_dakika: sayi(a.kilit_dakika, 15, 1, 240),
  };
}
function tarihOku(v, ad, { gecmisOlur = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new HttpHata(400, ad + ' geçersiz.');
  const simdi = Date.now();
  if (!gecmisOlur && d.getTime() < simdi - 10 * 60 * 1000) throw new HttpHata(400, ad + ' geçmişte olamaz.');
  if (d.getTime() > simdi + 366 * 86400000) throw new HttpHata(400, ad + ' en fazla 1 yıl sonrası olabilir.');
  return d.toISOString();
}

export function aramaRotalari(app) {
  // ------------------------------------------------------------------
  // Kullanici secenekleri (liste dagitimi / atama icin)
  // ------------------------------------------------------------------
  app.get('/api/atanabilir-kullanicilar', (c) => firmaIslemi(c, {}, async ({ q, k, izinler }) => {
    if (!izinler.eylem.has('atama_yap') && !izinler.eylem.has('liste_yonet')) throw new HttpHata(403, 'Bu işlem için yetkiniz yok.');
    const r = await q(`SELECT id, COALESCE(NULLIF(ad_soyad, ''), kullanici_adi) AS ad, kullanici_adi, rol_kod
                         FROM cc.kullanicilar WHERE firma_id = $1 AND aktif ORDER BY ad_soyad, kullanici_adi`, [k.firma_id]);
    return { durum: 'ok', kullanicilar: r.rows };
  }));

  // ------------------------------------------------------------------
  // ARAMA LISTELERI (yonetici)
  // ------------------------------------------------------------------
  app.get('/api/listeler', (c) => firmaIslemi(c, { izin: 'liste_yonet' }, async ({ q, kod }) => {
    const r = await q(
      `SELECT l.id, l.ad, l.aciklama, l.durum, l.deneme_limiti, l.konusma_metni, l.urun_odak, l.olusturma,
              count(lk.id)::int AS toplam,
              count(lk.id) FILTER (WHERE lk.kutu = 'yeni')::int AS yeni,
              count(lk.id) FILTER (WHERE lk.kutu = 'tekrar')::int AS tekrar,
              count(lk.id) FILTER (WHERE lk.kutu = 'ulasilamadi')::int AS ulasilamadi,
              count(lk.id) FILTER (WHERE lk.kutu = 'tamam')::int AS tamam
         FROM ${T(kod, 'listeler')} l LEFT JOIN ${T(kod, 'liste_kayitlari')} lk ON lk.liste_id = l.id
        GROUP BY l.id ORDER BY l.olusturma DESC`);
    return { durum: 'ok', listeler: r.rows };
  }));

  function listeAlanlari(g) {
    const ad = kisalt(g.ad, 120);
    if (!ad) throw new HttpHata(400, 'Liste adı zorunludur.');
    let limit = null;
    if (g.deneme_limiti !== null && g.deneme_limiti !== undefined && g.deneme_limiti !== '') {
      limit = Number(g.deneme_limiti);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpHata(400, 'Deneme limiti 1-50 olmalı.');
    }
    return { ad, aciklama: kisalt(g.aciklama, 500), limit, konusma: kisalt(g.konusma_metni, 5000), urun: kisalt(g.urun_odak, 200) };
  }

  app.post('/api/listeler', (c) => firmaIslemi(c, { izin: 'liste_yonet', islemli: true }, async ({ q, k, kod }) => {
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const a = listeAlanlari(g);
    const r = await q(`INSERT INTO ${T(kod, 'listeler')} (ad, aciklama, durum, deneme_limiti, konusma_metni, urun_odak, olusturan_id)
                       VALUES ($1, $2, 'aktif', $3, $4, $5, $6) RETURNING id`, [a.ad, a.aciklama, a.limit, a.konusma, a.urun, k.id]);
    await gunluk(q, kod, k.id, 'liste_olustur', 'liste', r.rows[0].id, { ad: a.ad });
    return { durum: 'ok', id: r.rows[0].id };
  }));

  app.patch('/api/listeler/:id', (c) => firmaIslemi(c, { izin: 'liste_yonet', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const a = listeAlanlari(g);
    const durum = g.durum;
    if (!['hazirlik', 'aktif', 'durdu', 'bitti'].includes(durum)) throw new HttpHata(400, 'Geçersiz durum.');
    const r = await q(`UPDATE ${T(kod, 'listeler')} SET ad=$2, aciklama=$3, durum=$4, deneme_limiti=$5, konusma_metni=$6, urun_odak=$7
                        WHERE id=$1 RETURNING id`, [id, a.ad, a.aciklama, durum, a.limit, a.konusma, a.urun]);
    if (!r.rows[0]) throw new HttpHata(404, 'Liste bulunamadı.');
    await gunluk(q, kod, k.id, 'liste_guncelle', 'liste', id, { durum });
    return { durum: 'ok', mesaj: 'Liste kaydedildi.' };
  }));

  app.delete('/api/listeler/:id', (c) => firmaIslemi(c, { izin: 'liste_sil', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const say = await q(`SELECT count(*)::int AS n FROM ${T(kod, 'aramalar')} WHERE liste_id = $1`, [id]);
    if (say.rows[0].n > 0) throw new HttpHata(409, 'Bu listede yapılmış aramalar var; silinemez. Durumunu "Bitti" yapın.');
    const r = await q(`DELETE FROM ${T(kod, 'listeler')} WHERE id = $1 RETURNING id`, [id]);
    if (!r.rows[0]) throw new HttpHata(404, 'Liste bulunamadı.');
    await gunluk(q, kod, k.id, 'liste_sil', 'liste', id, {});
    return { durum: 'ok', mesaj: 'Liste silindi.' };
  }));

  // Liste detayi: agent bazinda dagilim
  app.get('/api/listeler/:id', (c) => firmaIslemi(c, { izin: 'liste_yonet' }, async ({ q, kod }) => {
    const id = idAl(c);
    const l = await q(`SELECT id, ad, aciklama, durum, deneme_limiti, konusma_metni, urun_odak FROM ${T(kod, 'listeler')} WHERE id = $1`, [id]);
    if (!l.rows[0]) throw new HttpHata(404, 'Liste bulunamadı.');
    const d = await q(
      `SELECT COALESCE(a.kullanici_id::text, '-') AS kullanici_id,
              COALESCE(NULLIF(u.ad_soyad, ''), u.kullanici_adi, 'Atanmamış') AS ad,
              count(*)::int AS toplam,
              count(*) FILTER (WHERE lk.kutu = 'yeni')::int AS yeni,
              count(*) FILTER (WHERE lk.kutu = 'tekrar')::int AS tekrar,
              count(*) FILTER (WHERE lk.kutu = 'ulasilamadi')::int AS ulasilamadi,
              count(*) FILTER (WHERE lk.kutu = 'tamam')::int AS tamam
         FROM ${T(kod, 'liste_kayitlari')} lk
         LEFT JOIN ${T(kod, 'atamalar')} a ON a.musteri_id = lk.musteri_id
         LEFT JOIN cc.kullanicilar u ON u.id = a.kullanici_id
        WHERE lk.liste_id = $1 GROUP BY 1, 2 ORDER BY 2`, [id]);
    return { durum: 'ok', liste: l.rows[0], dagilim: d.rows };
  }));

  // Listeye musteri ekle (+ istege bagli agent'lara esit dagit)
  app.post('/api/listeler/:id/musteri-ekle', (c) => firmaIslemi(c, { izin: 'liste_yonet', islemli: true }, async ({ q, k, kod, izinler }) => {
    const id = idAl(c);
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const f = g.filtre && typeof g.filtre === 'object' ? g.filtre : {};
    const kullanicilar = Array.isArray(g.kullanicilar) ? [...new Set(g.kullanicilar.filter(uuidMi))].slice(0, 100) : [];
    if (kullanicilar.length && !izinler.eylem.has('atama_yap')) throw new HttpHata(403, 'Müşteri atama yetkiniz yok.');
    const l = await q(`SELECT id FROM ${T(kod, 'listeler')} WHERE id = $1 FOR UPDATE`, [id]);
    if (!l.rows[0]) throw new HttpHata(404, 'Liste bulunamadı.');
    if (kullanicilar.length) {
      const gecerli = await q(`SELECT id FROM cc.kullanicilar WHERE firma_id = $1 AND aktif AND id = ANY($2::uuid[]) ORDER BY id`, [k.firma_id, kullanicilar]);
      if (gecerli.rows.length !== kullanicilar.length) throw new HttpHata(400, 'Seçilen kullanıcılardan biri bu firmada yok veya pasif.');
    }
    const par = [id];
    let kosul = `NOT m.silindi AND NOT m.potansiyel_yok
      AND NOT EXISTS (SELECT 1 FROM ${T(kod, 'liste_kayitlari')} x WHERE x.liste_id = $1 AND x.musteri_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM ${T(kod, 'yasakli_liste')} y WHERE y.musteri_id = m.id AND y.kapsam = 'musteri' AND y.kaldirma_zamani IS NULL)`;
    if (uuidMi(f.yukleme_id)) { par.push(f.yukleme_id); kosul += ` AND m.yukleme_id = $${par.length}`; }
    if (kisalt(f.sektor, 100)) { par.push(kisalt(f.sektor, 100)); kosul += ` AND m.sektor = $${par.length}`; }
    if (kisalt(f.il, 60)) { par.push(kisalt(f.il, 60)); kosul += ` AND m.il = $${par.length}`; }
    if (f.sadece_atanmamis) kosul += ` AND NOT EXISTS (SELECT 1 FROM ${T(kod, 'atamalar')} z WHERE z.musteri_id = m.id)`;
    const ekle = await q(
      `WITH hedef AS (SELECT m.id FROM ${T(kod, 'musteriler')} m WHERE ${kosul} ORDER BY m.unvan, m.id LIMIT 50000)
       INSERT INTO ${T(kod, 'liste_kayitlari')} (liste_id, musteri_id) SELECT $1, id FROM hedef RETURNING musteri_id`, par);
    const eklenenIds = ekle.rows.map((x) => x.musteri_id);
    let atanan = 0;
    if (kullanicilar.length && eklenenIds.length) {
      // Zaten atanmis musteriler korunur; atanmamislar sirayla esit dagitilir
      const at = await q(
        `WITH adaylar AS (
           SELECT mid, row_number() OVER (ORDER BY mid) AS rn
             FROM unnest($1::uuid[]) AS mid
            WHERE NOT EXISTS (SELECT 1 FROM ${T(kod, 'atamalar')} z WHERE z.musteri_id = mid)),
         ins AS (
           INSERT INTO ${T(kod, 'atamalar')} (musteri_id, kullanici_id, atayan_id)
           SELECT mid, ($2::uuid[])[1 + (rn - 1) % $3::int], $4 FROM adaylar RETURNING musteri_id, kullanici_id)
         INSERT INTO ${T(kod, 'atama_gecmisi')} (musteri_id, kullanici_id, islem, yapan_id)
         SELECT musteri_id, kullanici_id, 'ekle', $4 FROM ins RETURNING 1`,
        [eklenenIds, kullanicilar, kullanicilar.length, k.id]);
      atanan = at.rows.length;
    }
    await gunluk(q, kod, k.id, 'liste_musteri_ekle', 'liste', id, { eklenen: eklenenIds.length, atanan });
    return { durum: 'ok', eklenen: eklenenIds.length, atanan };
  }));

  // Listedeki ARANMAMIS (kutu=yeni) musterileri secilen agent'lara yeniden esit dagit
  app.post('/api/listeler/:id/yeniden-dagit', (c) => firmaIslemi(c, { izin: 'atama_yap', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const kullanicilar = Array.isArray(g.kullanicilar) ? [...new Set(g.kullanicilar.filter(uuidMi))].slice(0, 100) : [];
    if (!kullanicilar.length) throw new HttpHata(400, 'En az bir kullanıcı seçin.');
    const gecerli = await q(`SELECT id FROM cc.kullanicilar WHERE firma_id = $1 AND aktif AND id = ANY($2::uuid[])`, [k.firma_id, kullanicilar]);
    if (gecerli.rows.length !== kullanicilar.length) throw new HttpHata(400, 'Seçilen kullanıcılardan biri bu firmada yok veya pasif.');
    const l = await q(`SELECT id FROM ${T(kod, 'listeler')} WHERE id = $1 FOR UPDATE`, [id]);
    if (!l.rows[0]) throw new HttpHata(404, 'Liste bulunamadı.');
    const hedef = await q(`SELECT musteri_id FROM ${T(kod, 'liste_kayitlari')} WHERE liste_id = $1 AND kutu = 'yeni' ORDER BY musteri_id`, [id]);
    const ids = hedef.rows.map((x) => x.musteri_id);
    if (!ids.length) return { durum: 'ok', atanan: 0, mesaj: 'Dağıtılacak aranmamış müşteri yok.' };
    await q(`DELETE FROM ${T(kod, 'atamalar')} WHERE musteri_id = ANY($1::uuid[])`, [ids]);
    await q(
      `WITH adaylar AS (SELECT mid, row_number() OVER (ORDER BY mid) AS rn FROM unnest($1::uuid[]) AS mid),
            ins AS (INSERT INTO ${T(kod, 'atamalar')} (musteri_id, kullanici_id, atayan_id)
                    SELECT mid, ($2::uuid[])[1 + (rn - 1) % $3::int], $4 FROM adaylar RETURNING musteri_id, kullanici_id)
       INSERT INTO ${T(kod, 'atama_gecmisi')} (musteri_id, kullanici_id, islem, yapan_id)
       SELECT musteri_id, kullanici_id, 'degistir', $4 FROM ins`, [ids, kullanicilar, kullanicilar.length, k.id]);
    await gunluk(q, kod, k.id, 'yeniden_dagit', 'liste', id, { adet: ids.length });
    return { durum: 'ok', atanan: ids.length };
  }));

  // ------------------------------------------------------------------
  // AGENT ARAMA EKRANI
  // ------------------------------------------------------------------
  const TEMEL_FROM = (kod) => `${T(kod, 'liste_kayitlari')} lk
      JOIN ${T(kod, 'listeler')} l ON l.id = lk.liste_id AND l.durum = 'aktif'
      JOIN ${T(kod, 'musteriler')} m ON m.id = lk.musteri_id AND NOT m.silindi`;

  async function yenidenKuyrugaAl(q, kod) {
    // Deneme limiti dolup bekleme suresi gecen "ulasilamadi" kayitlar tekrar Yeni kutusuna doner
    await q(`UPDATE ${T(kod, 'liste_kayitlari')} SET kutu = 'yeni', deneme_sayisi = 0, durum_kodu = NULL, sonuc_grubu = NULL, sonraki_arama = NULL
              WHERE kutu = 'tamam' AND sonuc_grubu = 'ulasilamadi' AND durum_kodu = 'ulasilamiyor' AND sonraki_arama IS NOT NULL AND sonraki_arama <= now()`);
  }

  app.get('/api/arama/kutular', (c) => firmaIslemi(c, { izin: 'arama_yap' }, async ({ q, k, kod, izinler }) => {
    const kapsam = aramaKapsami(izinler);
    await firmaDuzelt(q, kod);
    await yenidenKuyrugaAl(q, kod);
    const par = [];
    const ek = atamaKosulu(kod, kapsam, k.id, par, 'm');
    const r = await q(`SELECT lk.kutu, count(*)::int AS n FROM ${TEMEL_FROM(kod)} WHERE true${ek} GROUP BY lk.kutu`, par);
    const sayilar = { yeni: 0, tekrar: 0, ulasilamadi: 0, tamam: 0 };
    r.rows.forEach((x) => { sayilar[x.kutu] = x.n; });
    const par2 = [];
    const ek2 = atamaKosulu(kod, kapsam, k.id, par2, 'm');
    const l = await q(`SELECT DISTINCT l.id, l.ad FROM ${TEMEL_FROM(kod)} WHERE true${ek2} ORDER BY l.ad`, par2);
    return { durum: 'ok', kutular: sayilar, listeler: l.rows, kapsam };
  }));

  app.get('/api/arama/kayitlar', (c) => firmaIslemi(c, { izin: 'arama_yap' }, async ({ q, k, kod, izinler }) => {
    const kapsam = aramaKapsami(izinler);
    const kutu = c.req.query('kutu');
    if (!KUTULAR.includes(kutu)) throw new HttpHata(400, 'Geçersiz kutu.');
    const ayar = await ayarlariOku(q, kod);
    const par = [kutu];
    let kosul = 'lk.kutu = $1';
    const listeId = c.req.query('liste_id');
    if (uuidMi(listeId)) { par.push(listeId); kosul += ` AND lk.liste_id = $${par.length}`; }
    const ara = kisalt(c.req.query('q'), 100);
    if (ara) { par.push('%' + ara.replace(/[\\%_]/g, '\\$&') + '%'); kosul += ` AND (m.unvan ILIKE $${par.length} OR m.telefon ILIKE $${par.length})`; }
    const il = kisalt(c.req.query('il'), 60);
    if (il) { par.push(il); kosul += ` AND m.il = $${par.length}`; }
    kosul += atamaKosulu(kod, kapsam, k.id, par, 'm');
    const sayfa = Math.max(1, Math.min(10000, parseInt(c.req.query('sayfa'), 10) || 1));
    const BOYUT = 30;
    const toplam = await q(`SELECT count(*)::int AS n FROM ${TEMEL_FROM(kod)} WHERE ${kosul}`, par);
    par.push(k.id); const benIx = par.length;
    par.push(ayar.kilit_dakika); const kilitIx = par.length;
    const sira = (kutu === 'tekrar' || kutu === 'ulasilamadi') ? 'lk.sonraki_arama NULLS LAST, m.unvan' : kutu === 'tamam' ? 'lk.son_arama DESC NULLS LAST' : 'lk.oncelik DESC, m.unvan';
    const r = await q(
      `SELECT lk.id, lk.musteri_id, m.unvan, m.sektor, m.il, m.ilce, m.telefon, m.dis_no, lk.deneme_sayisi, lk.son_arama, lk.sonraki_arama,
              lk.durum_kodu, d.etiket AS durum_etiket, lk.sonuc_grubu, l.ad AS liste_ad, l.id AS liste_id,
              (lk.kilit_kullanici_id IS NOT NULL AND lk.kilit_kullanici_id <> $${benIx} AND lk.kilit_zaman > now() - make_interval(mins => $${kilitIx})) AS kilitli,
              (SELECT count(*)::int FROM ${T(kod, 'kontaklar')} kt WHERE kt.musteri_id = m.id AND NOT kt.silindi) AS kontak_sayisi,
              EXISTS (SELECT 1 FROM ${T(kod, 'kontaklar')} kt WHERE kt.musteri_id = m.id AND NOT kt.silindi AND kt.aranmayacak) AS aranmayacak_kontak,
              (SELECT string_agg(COALESCE(NULLIF(u.ad_soyad, ''), u.kullanici_adi), ', ') FROM ${T(kod, 'atamalar')} a2
                 JOIN cc.kullanicilar u ON u.id = a2.kullanici_id WHERE a2.musteri_id = m.id) AS atanan
         FROM ${TEMEL_FROM(kod)} LEFT JOIN ${T(kod, 'durumlar')} d ON d.kod = lk.durum_kodu
        WHERE ${kosul} ORDER BY ${sira}, lk.id LIMIT ${BOYUT} OFFSET ${(sayfa - 1) * BOYUT}`, par);
    return { durum: 'ok', toplam: toplam.rows[0].n, sayfa, boyut: BOYUT, kayitlar: r.rows };
  }));

  // Arama modali icin tum veri
  app.get('/api/arama/kayit/:id', (c) => firmaIslemi(c, { izin: 'arama_yap' }, async ({ q, k, kod, izinler }) => {
    const kapsam = aramaKapsami(izinler);
    await firmaDuzelt(q, kod);
    const id = idAl(c);
    const par = [id];
    const ek = atamaKosulu(kod, kapsam, k.id, par, 'm');
    const r = await q(
      `SELECT lk.id, lk.liste_id, lk.deneme_sayisi, lk.kutu, lk.durum_kodu, lk.sonraki_arama, l.ad AS liste_ad, l.konusma_metni, l.urun_odak,
              l.deneme_limiti, m.id AS musteri_id, m.dis_no, m.unvan, m.sektor, m.il, m.ilce, m.adres, m.telefon, m.eposta, m.web, m.ek_alanlar
         FROM ${TEMEL_FROM(kod)} WHERE lk.id = $1${ek}`, par);
    const kayit = r.rows[0];
    if (!kayit) throw new HttpHata(404, 'Kayıt bulunamadı.');
    const kontaklar = await q(
      `SELECT id, ad_soyad, gorev, telefon, telefon2, eposta, karar_verici, aranmayacak, aranmayacak_neden
         FROM ${T(kod, 'kontaklar')} WHERE musteri_id = $1 AND NOT silindi ORDER BY karar_verici DESC, ad_soyad`, [kayit.musteri_id]);
    const kontakArama = await q(
      `SELECT DISTINCT ON (a.kontak_id) a.kontak_id, a.durum_kodu, d.etiket AS son_etiket, a.baslangic AS son_zaman,
              (SELECT count(*)::int FROM ${T(kod, 'aramalar')} x WHERE x.kontak_id = a.kontak_id AND x.kayit_durumu = 'tamamlandi') AS adet
         FROM ${T(kod, 'aramalar')} a LEFT JOIN ${T(kod, 'durumlar')} d ON d.kod = a.durum_kodu
        WHERE a.musteri_id = $1 AND a.kontak_id IS NOT NULL AND a.kayit_durumu = 'tamamlandi'
        ORDER BY a.kontak_id, a.baslangic DESC`, [kayit.musteri_id]);
    const kaMap = Object.fromEntries(kontakArama.rows.map((x) => [x.kontak_id, x]));
    kontaklar.rows.forEach((x) => {
      const ka = kaMap[x.id];
      x.arama_adet = ka ? ka.adet : 0; x.son_sonuc = ka ? ka.son_etiket : null; x.son_zaman = ka ? ka.son_zaman : null;
      x.numara_yanlis = !!(ka && ka.durum_kodu === 'numara_yanlis');
    });
    const gecmis = await q(
      `SELECT a.baslangic, a.kullanici_adi, a.deneme_no, a.ulasildi, a.not_metni, a.sonraki_arama, a.randevu_zamani,
              d.etiket AS durum_etiket, kt.ad_soyad AS kontak_ad, kt.gorev AS kontak_gorev, a.liste_adi
         FROM ${T(kod, 'aramalar')} a LEFT JOIN ${T(kod, 'durumlar')} d ON d.kod = a.durum_kodu
         LEFT JOIN ${T(kod, 'kontaklar')} kt ON kt.id = a.kontak_id
        WHERE a.musteri_id = $1 AND a.kayit_durumu = 'tamamlandi' ORDER BY a.baslangic DESC LIMIT 30`, [kayit.musteri_id]);
    const yasakli = await q(`SELECT 1 FROM ${T(kod, 'yasakli_liste')} WHERE musteri_id = $1 AND kapsam = 'musteri' AND kaldirma_zamani IS NULL`, [kayit.musteri_id]);
    const durumlar = await q(`SELECT kod, etiket, dal, ust_kod, alt_soru, kutu, sonuc_grubu, bayraklar, sira FROM ${T(kod, 'durumlar')} WHERE aktif ORDER BY sira, kod`);
    const sec = await q(`SELECT tur, kod, etiket FROM ${T(kod, 'secenekler')} WHERE aktif ORDER BY tur, sira, kod`);
    const ic = await q(
      `SELECT id, tur, sektor, baslik, metin FROM ${T(kod, 'icerikler')}
        WHERE aktif AND (sektor = '*' OR lower(sektor) = lower($1)) ORDER BY tur, (sektor = '*'), sira`, [kayit.sektor || '']);
    const ayar = await ayarlariOku(q, kod);
    return { durum: 'ok', kayit, kontaklar: kontaklar.rows, gecmis: gecmis.rows, musteri_yasakli: !!yasakli.rows[0],
      durumlar: durumlar.rows, secenekler: sec.rows, icerikler: ic.rows, ayar };
  }));

  async function kayitKilitle(q, kod, k, kapsam, kayitId) {
    const par = [kayitId];
    const ek = atamaKosulu(kod, kapsam, k.id, par, 'm');
    const r = await q(
      `SELECT lk.id, lk.liste_id, lk.musteri_id, lk.deneme_sayisi, lk.kilit_kullanici_id, lk.kilit_zaman, l.ad AS liste_ad, l.deneme_limiti,
              m.unvan, m.potansiyel_yok
         FROM ${TEMEL_FROM(kod)} WHERE lk.id = $1${ek} FOR UPDATE OF lk`, par);
    if (!r.rows[0]) throw new HttpHata(404, 'Kayıt bulunamadı.');
    return r.rows[0];
  }

  app.post('/api/arama/baslat', (c) => firmaIslemi(c, { izin: 'arama_yap', islemli: true }, async ({ q, k, kod, izinler }) => {
    const kapsam = aramaKapsami(izinler);
    const g = await jsonGovde(c); if (!g || !uuidMi(g.kayit_id)) throw new HttpHata(400, 'Geçersiz istek.');
    const kayit = await kayitKilitle(q, kod, k, kapsam, g.kayit_id);
    const ayar = await ayarlariOku(q, kod);
    const yas = await q(`SELECT 1 FROM ${T(kod, 'yasakli_liste')} WHERE musteri_id = $1 AND kapsam = 'musteri' AND kaldirma_zamani IS NULL`, [kayit.musteri_id]);
    if (yas.rows[0]) throw new HttpHata(409, 'Bu müşteri aranmak istemiyor olarak işaretli.');
    const kilitSuresiDoldu = !kayit.kilit_zaman || (Date.now() - new Date(kayit.kilit_zaman).getTime()) > ayar.kilit_dakika * 60000;
    if (kayit.kilit_kullanici_id && kayit.kilit_kullanici_id !== k.id && !kilitSuresiDoldu) {
      const u = await q(`SELECT COALESCE(NULLIF(ad_soyad, ''), kullanici_adi) AS ad FROM cc.kullanicilar WHERE id = $1`, [kayit.kilit_kullanici_id]);
      throw new HttpHata(409, 'Bu müşteri şu anda ' + (u.rows[0] ? u.rows[0].ad : 'başka bir kullanıcı') + ' tarafından aranıyor.');
    }
    let kontakId = null;
    if (g.kontak_id !== undefined && g.kontak_id !== null && g.kontak_id !== '') {
      if (!uuidMi(g.kontak_id)) throw new HttpHata(400, 'Geçersiz yetkili.');
      const kt = await q(`SELECT aranmayacak FROM ${T(kod, 'kontaklar')} WHERE id = $1 AND musteri_id = $2 AND NOT silindi`, [g.kontak_id, kayit.musteri_id]);
      if (!kt.rows[0]) throw new HttpHata(404, 'Yetkili bulunamadı.');
      if (kt.rows[0].aranmayacak) throw new HttpHata(409, 'Bu yetkili aranmak istemiyor olarak işaretli.');
      kontakId = g.kontak_id;
    }
    // Arama nedeni: arama BASLARKEN secilir
    let nedenKodu = null;
    const nedenler = await q(`SELECT kod FROM ${T(kod, 'secenekler')} WHERE tur = 'gorusme_nedeni' AND aktif`);
    if (nedenler.rows.length) {
      const n = norm(g.neden_kodu);
      if (!nedenler.rows.some((x) => x.kod === n)) throw new HttpHata(400, 'Arama nedenini seçin.');
      nedenKodu = n;
    }
    // Eski acik (yarim kalmis) aramalarim: tek acik arama kalsin
    await q(`DELETE FROM ${T(kod, 'aramalar')} WHERE liste_kayit_id = $1 AND kayit_durumu = 'acik' AND (kullanici_id = $2 OR baslangic < now() - interval '3 hours')`, [kayit.id, k.id]);
    const ar = await q(
      `INSERT INTO ${T(kod, 'aramalar')} (musteri_id, kontak_id, kullanici_id, kullanici_adi, liste_id, liste_kayit_id, liste_adi, deneme_no, neden_kodu)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, baslangic`,
      [kayit.musteri_id, kontakId, k.id, k.kullanici_adi, kayit.liste_id, kayit.id, kayit.liste_adi || kayit.liste_ad, kayit.deneme_sayisi + 1, nedenKodu]);
    await q(`UPDATE ${T(kod, 'liste_kayitlari')} SET kilit_kullanici_id = $2, kilit_zaman = now() WHERE id = $1`, [kayit.id, k.id]);
    return { durum: 'ok', arama_id: ar.rows[0].id, baslangic: ar.rows[0].baslangic };
  }));

  app.post('/api/arama/:id/iptal', (c) => firmaIslemi(c, { izin: 'arama_yap', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const r = await q(`DELETE FROM ${T(kod, 'aramalar')} WHERE id = $1 AND kullanici_id = $2 AND kayit_durumu = 'acik' RETURNING liste_kayit_id`, [id, k.id]);
    if (r.rows[0] && r.rows[0].liste_kayit_id) {
      await q(`UPDATE ${T(kod, 'liste_kayitlari')} SET kilit_kullanici_id = NULL, kilit_zaman = NULL WHERE id = $1 AND kilit_kullanici_id = $2`, [r.rows[0].liste_kayit_id, k.id]);
    }
    return { durum: 'ok' };
  }));

  // Aramayi tamamla: durum + yan kayitlar (takvim, yasakli, yeni yetkili) TEK islemde
  app.post('/api/arama/:id/tamamla', (c) => firmaIslemi(c, { izin: 'arama_kapat', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const ar = await q(`SELECT * FROM ${T(kod, 'aramalar')} WHERE id = $1 AND kullanici_id = $2 FOR UPDATE`, [id, k.id]);
    const arama = ar.rows[0];
    if (!arama) throw new HttpHata(404, 'Arama bulunamadı.');
    if (arama.kayit_durumu !== 'acik') throw new HttpHata(409, 'Bu arama zaten tamamlanmış.');
    const lkR = await q(`SELECT lk.*, l.deneme_limiti FROM ${T(kod, 'liste_kayitlari')} lk JOIN ${T(kod, 'listeler')} l ON l.id = lk.liste_id WHERE lk.id = $1 FOR UPDATE OF lk`, [arama.liste_kayit_id]);
    const lk = lkR.rows[0];
    if (!lk) throw new HttpHata(409, 'Liste kaydı bulunamadı.');
    const ayar = await ayarlariOku(q, kod);
    let dKod = norm(g.durum_kodu);
    if (!KOD_RE.test(dKod)) throw new HttpHata(400, 'Sonuç seçin.');
    let dr = await q(`SELECT * FROM ${T(kod, 'durumlar')} WHERE kod = $1 AND aktif`, [dKod]);
    let durum = dr.rows[0];
    if (!durum) throw new HttpHata(400, 'Geçersiz sonuç.');
    const limit0 = lk.deneme_limiti || ayar.deneme_limiti;
    const sonDeneme = durum.dal === 'ulasilamadi' && durum.kod !== 'numara_yanlis' && (lk.deneme_sayisi + 1) >= limit0;
    let ekOrijinal = null;
    if (sonDeneme && durum.kod !== 'ulasilamiyor') {
      // Deneme limiti doldu: gorev sonlandirilir (Ulasilamiyor)
      const son = await q(`SELECT * FROM ${T(kod, 'durumlar')} WHERE kod = 'ulasilamiyor'`);
      if (son.rows[0]) { ekOrijinal = durum.kod; durum = son.rows[0]; dKod = durum.kod; }
    }
    const bay = durum.bayraklar || {};
    const gercekBay = ekOrijinal ? ((dr.rows[0] && dr.rows[0].bayraklar) || {}) : bay;
    const not = kisalt(g.not_metni, 2000);
    if (bay.metin_zorunlu && !not) throw new HttpHata(400, 'Bu sonuç için açıklama (not) zorunludur.');

    // Yetkili: mevcut ya da yeni
    let kontakId = arama.kontak_id;
    if (g.kontak_id !== undefined && g.kontak_id !== null && g.kontak_id !== '') {
      if (!uuidMi(g.kontak_id)) throw new HttpHata(400, 'Geçersiz yetkili.');
      const kt = await q(`SELECT id FROM ${T(kod, 'kontaklar')} WHERE id = $1 AND musteri_id = $2 AND NOT silindi`, [g.kontak_id, arama.musteri_id]);
      if (!kt.rows[0]) throw new HttpHata(404, 'Yetkili bulunamadı.');
      kontakId = g.kontak_id;
    }
    const yk = g.yeni_kontak && typeof g.yeni_kontak === 'object' ? g.yeni_kontak : null;
    if (yk && kisalt(yk.ad_soyad, 200)) {
      if (bay.yeni_kontak === undefined && durum.dal !== 'bilgi_verildi' && durum.dal !== 'muhatap_degil') throw new HttpHata(400, 'Bu sonuçla yeni yetkili eklenemez.');
      const kn = await q(`INSERT INTO ${T(kod, 'kontaklar')} (musteri_id, ad_soyad, gorev, telefon, eposta, karar_verici) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [arama.musteri_id, kisalt(yk.ad_soyad, 200), kisalt(yk.gorev, 100), kisalt(String(yk.telefon || '').replace(/\D/g, ''), 20), kisalt(yk.eposta, 200), !!yk.karar_verici]);
      kontakId = kn.rows[0].id;
    }

    // Tarihler
    const tekrar = tarihOku(g.tekrar_tarihi, 'Tekrar arama tarihi');
    if (gercekBay.tekrar_tarihi === 'zorunlu' && !tekrar && !ekOrijinal) throw new HttpHata(400, 'Tekrar arama tarihi zorunludur.');
    let randevu = null;
    if (bay.randevu) { randevu = tarihOku(g.randevu_zamani, 'Randevu zamanı'); if (!randevu) throw new HttpHata(400, 'Randevu zamanı zorunludur.'); }

    // Satis bilgisi
    let urunKodlari = []; let adet = null; let tutar = null; let ilgi = null; let rakip = null;
    if (bay.satis_bilgisi) {
      if (Array.isArray(g.urun_kodlari) && g.urun_kodlari.length) {
        const kodlar = [...new Set(g.urun_kodlari.map(norm).filter((x) => KOD_RE.test(x)))].slice(0, 20);
        const gecerli = await q(`SELECT kod FROM ${T(kod, 'secenekler')} WHERE tur = 'urun_hizmet' AND aktif AND kod = ANY($1::text[])`, [kodlar]);
        urunKodlari = gecerli.rows.map((x) => x.kod);
      }
      if (g.adet !== undefined && g.adet !== null && g.adet !== '') { adet = Number(g.adet); if (!Number.isInteger(adet) || adet < 0 || adet > 1000000) throw new HttpHata(400, 'Adet geçersiz.'); }
      if (g.tahmini_tutar !== undefined && g.tahmini_tutar !== null && g.tahmini_tutar !== '') { tutar = Number(g.tahmini_tutar); if (!isFinite(tutar) || tutar < 0 || tutar > 1e12) throw new HttpHata(400, 'Tahmini tutar geçersiz.'); }
      if (g.ilgi_seviyesi !== undefined && g.ilgi_seviyesi !== null && g.ilgi_seviyesi !== '') { ilgi = Number(g.ilgi_seviyesi); if (!Number.isInteger(ilgi) || ilgi < 1 || ilgi > 5) throw new HttpHata(400, 'İlgi seviyesi 1-5 olmalı.'); }
      if (g.rakip_sozlesme_bitis) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(g.rakip_sozlesme_bitis))) throw new HttpHata(400, 'Rakip sözleşme bitiş tarihi geçersiz.'); rakip = g.rakip_sozlesme_bitis; }
    }
    const nedenKodu = arama.neden_kodu || null; const kanal = arama.kanal_kodu || 'telefon';

    // Yan kayitlar
    let takvimId = null;
    const mus = await q(`SELECT unvan FROM ${T(kod, 'musteriler')} WHERE id = $1`, [arama.musteri_id]);
    const unvan = mus.rows[0] ? mus.rows[0].unvan : '';
    if (randevu) {
      const t = await q(`INSERT INTO ${T(kod, 'takvim')} (tur, musteri_id, kontak_id, kullanici_id, baslangic, bitis, baslik, aciklama)
                         VALUES ('randevu', $1, $2, $3, $4, $4::timestamptz + interval '30 minutes', $5, $6) RETURNING id`,
        [arama.musteri_id, kontakId, k.id, randevu, kisalt('Randevu: ' + unvan, 200), not]);
      takvimId = t.rows[0].id;
    } else if (bay.gorev_ac) {
      const t = await q(`INSERT INTO ${T(kod, 'takvim')} (tur, musteri_id, kontak_id, kullanici_id, baslangic, baslik, aciklama)
                         VALUES ('gorev', $1, $2, $3, COALESCE($4::timestamptz, now() + interval '1 day'), $5, $6) RETURNING id`,
        [arama.musteri_id, kontakId, k.id, tekrar, kisalt(durum.etiket + ': ' + unvan, 200), not]);
      takvimId = t.rows[0].id;
    }
    let musteriKapali = false;
    if (bay.aranmayacak === 'musteri') {
      await q(`INSERT INTO ${T(kod, 'yasakli_liste')} (musteri_id, kapsam, kim_id, neden) VALUES ($1, 'musteri', $2, $3) ON CONFLICT DO NOTHING`, [arama.musteri_id, k.id, not || durum.etiket]);
      musteriKapali = true;
    } else if (bay.aranmayacak === 'kontak') {
      if (!kontakId) throw new HttpHata(400, 'Bu sonuç için aranmak istemeyen yetkiliyi seçin.');
      await q(`INSERT INTO ${T(kod, 'yasakli_liste')} (musteri_id, kontak_id, kapsam, kim_id, neden) VALUES ($1, $2, 'kontak', $3, $4) ON CONFLICT DO NOTHING`, [arama.musteri_id, kontakId, k.id, not || durum.etiket]);
      await q(`UPDATE ${T(kod, 'kontaklar')} SET aranmayacak = true, aranmayacak_neden = $2 WHERE id = $1`, [kontakId, not || durum.etiket]);
    }
    if (bay.potansiyel_yok) { await q(`UPDATE ${T(kod, 'musteriler')} SET potansiyel_yok = true WHERE id = $1`, [arama.musteri_id]); musteriKapali = true; }
    if (musteriKapali) await q(`UPDATE ${T(kod, 'liste_kayitlari')} SET kutu = 'tamam', sonuc_grubu = 'olumsuz', kilit_kullanici_id = NULL, kilit_zaman = NULL WHERE musteri_id = $1 AND kutu <> 'tamam' AND id <> $2`, [arama.musteri_id, lk.id]);

    // Liste kaydi: kutu / deneme / sonraki arama
    const yeniDeneme = lk.deneme_sayisi + 1;
    const limit = lk.deneme_limiti || ayar.deneme_limiti;
    let kutu = durum.kutu; let sonraki = (kutu === 'tekrar' || kutu === 'ulasilamadi') ? tekrar : null;
    if (musteriKapali) kutu = 'tamam';
    if (durum.kod === 'ulasilamiyor') {
      kutu = 'tamam';
      sonraki = ayar.cooldown_gun > 0 ? new Date(Date.now() + ayar.cooldown_gun * 86400000).toISOString() : null;
    } else if (durum.dal === 'ulasilamadi' && durum.kod !== 'numara_yanlis' && !musteriKapali && yeniDeneme >= limit) {
      kutu = 'tamam'; sonraki = null;
    }
    const ulasildi = durum.dal === 'ulasilamadi' ? false : (durum.dal === 'aramasiz' ? null : true);
    const muhatap = durum.dal === 'muhatap_degil' ? false : ((durum.dal === 'uygun_degil' || durum.dal === 'bilgi_verildi') ? true : null);
    const ekVeri = {};
    if (ekOrijinal) ekVeri.asil_sonuc = ekOrijinal;
    if (kisalt(g.alt_cevap, 300)) ekVeri.alt_cevap = kisalt(g.alt_cevap, 300);
    if (kisalt(g.aranan_telefon, 30)) ekVeri.aranan_telefon = kisalt(g.aranan_telefon, 30);
    await q(`UPDATE ${T(kod, 'liste_kayitlari')} SET durum_kodu = $2, kutu = $3, sonuc_grubu = $4, deneme_sayisi = $5, son_arama = now(),
                    sonraki_arama = $6, kilit_kullanici_id = NULL, kilit_zaman = NULL WHERE id = $1`,
      [lk.id, durum.kod, kutu, durum.sonuc_grubu, yeniDeneme, sonraki]);
    await q(`UPDATE ${T(kod, 'aramalar')} SET kayit_durumu = 'tamamlandi', kontak_id = $2, bitis = now(), sure_sn = GREATEST(0, extract(epoch FROM now() - baslangic))::int,
                    ulasildi = $3, muhatap_dogru = $4, durum_kodu = $5, urun_kodlari = $6, adet = $7, tahmini_tutar = $8, ilgi_seviyesi = $9,
                    rakip_sozlesme_bitis = $10, randevu_zamani = $11, sonraki_arama = $12, not_metni = $13, olusan_takvim_id = $14,
                    ek_veri = $15::jsonb, kanal_kodu = $16, neden_kodu = $17 WHERE id = $1`,
      [id, kontakId, ulasildi, muhatap, durum.kod, urunKodlari, adet, tutar, ilgi, rakip, randevu, sonraki, not, takvimId, JSON.stringify(ekVeri), kanal, nedenKodu]);
    await gunluk(q, kod, k.id, 'arama_tamamla', 'arama', id, { durum: durum.kod, musteri: arama.musteri_id });
    return { durum: 'ok', mesaj: 'Arama kaydedildi: ' + durum.etiket, kutu };
  }));

  // ------------------------------------------------------------------
  // TAKVIM
  // ------------------------------------------------------------------
  app.get('/api/takvim', (c) => firmaIslemi(c, {}, async ({ q, k, kod, izinler }) => {
    const kapsam = izinler.kapsam.takvim || '';
    if (kapsam !== 'TUM' && kapsam !== 'KENDI') throw new HttpHata(403, 'Takvime erişim yetkiniz yok.');
    const durum = c.req.query('durum') === 'tum' ? null : 'acik';
    const par = [];
    let kosul = 'true';
    if (kapsam === 'KENDI') { par.push(k.id); kosul += ` AND t.kullanici_id = $${par.length}`; }
    if (durum) kosul += ` AND t.durum = 'acik'`;
    const r = await q(
      `SELECT t.id, t.tur, t.baslangic, t.bitis, t.baslik, t.aciklama, t.durum, m.unvan, kt.ad_soyad AS kontak_ad, kt.telefon AS kontak_telefon,
              COALESCE(NULLIF(u.ad_soyad, ''), u.kullanici_adi) AS kullanici
         FROM ${T(kod, 'takvim')} t LEFT JOIN ${T(kod, 'musteriler')} m ON m.id = t.musteri_id
         LEFT JOIN ${T(kod, 'kontaklar')} kt ON kt.id = t.kontak_id LEFT JOIN cc.kullanicilar u ON u.id = t.kullanici_id
        WHERE ${kosul} ORDER BY t.baslangic LIMIT 300`, par);
    return { durum: 'ok', kayitlar: r.rows };
  }));
  app.patch('/api/takvim/:id', (c) => firmaIslemi(c, {}, async ({ q, k, kod, izinler }) => {
    const kapsam = izinler.kapsam.takvim || '';
    if (kapsam !== 'TUM' && kapsam !== 'KENDI') throw new HttpHata(403, 'Takvime erişim yetkiniz yok.');
    const id = idAl(c);
    const g = await jsonGovde(c); if (!g || !['tamamlandi', 'iptal', 'acik'].includes(g.durum)) throw new HttpHata(400, 'Geçersiz durum.');
    const par = [id, g.durum];
    let ek = '';
    if (kapsam === 'KENDI') { par.push(k.id); ek = ' AND kullanici_id = $3'; }
    const r = await q(`UPDATE ${T(kod, 'takvim')} SET durum = $2 WHERE id = $1${ek} RETURNING id`, par);
    if (!r.rows[0]) throw new HttpHata(404, 'Kayıt bulunamadı.');
    return { durum: 'ok' };
  }));

  // ------------------------------------------------------------------
  // AYARLAR (firma yoneticisi): durumlar, secenekler, icerikler, sayisal ayarlar
  // ------------------------------------------------------------------
  app.get('/api/arama-ayarlari', (c) => firmaIslemi(c, { izin: 'ayar_yonet' }, async ({ q, kod }) => {
    const ayar = await ayarlariOku(q, kod);
    const d = await q(`SELECT kod, etiket, dal, ust_kod, alt_soru, kutu, sonuc_grubu, bayraklar, sira, aktif, sistem FROM ${T(kod, 'durumlar')} ORDER BY sira, kod`);
    const s = await q(`SELECT tur, kod, etiket, sira, aktif FROM ${T(kod, 'secenekler')} ORDER BY tur, sira, kod`);
    const i = await q(`SELECT id, tur, sektor, baslik, metin, sira, aktif FROM ${T(kod, 'icerikler')} ORDER BY tur, sektor, sira`);
    return { durum: 'ok', ayar, durumlar: d.rows, secenekler: s.rows, icerikler: i.rows };
  }));

  app.put('/api/arama-ayarlari/sayisal', (c) => firmaIslemi(c, { izin: 'ayar_yonet', islemli: true }, async ({ q, k, kod }) => {
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const sinir = { deneme_limiti: [1, 50], cooldown_gun: [0, 365], kilit_dakika: [1, 240] };
    for (const [ad, [en, cok]] of Object.entries(sinir)) {
      const n = Number(g[ad]);
      if (!Number.isInteger(n) || n < en || n > cok) throw new HttpHata(400, ad + ' ' + en + ' ile ' + cok + ' arasında olmalı.');
      await q(`INSERT INTO ${T(kod, 'ayarlar')} (anahtar, deger) VALUES ($1, $2) ON CONFLICT (anahtar) DO UPDATE SET deger = EXCLUDED.deger`, [ad, String(n)]);
    }
    await gunluk(q, kod, k.id, 'ayar_guncelle', 'ayar', null, g);
    return { durum: 'ok', mesaj: 'Ayarlar kaydedildi.' };
  }));

  const BAYRAK_TEMIZ = (b) => {
    const o = {};
    if (!b || typeof b !== 'object') return o;
    if (['zorunlu', 'opsiyonel'].includes(b.tekrar_tarihi)) o.tekrar_tarihi = b.tekrar_tarihi;
    for (const a of ['yeni_kontak', 'gorev_ac', 'randevu', 'satis_bilgisi', 'potansiyel_yok', 'metin_zorunlu']) if (b[a] === true) o[a] = true;
    if (['musteri', 'kontak'].includes(b.aranmayacak)) o.aranmayacak = b.aranmayacak;
    return o;
  };

  app.post('/api/durumlar', (c) => firmaIslemi(c, { izin: 'ayar_yonet', islemli: true }, async ({ q, k, kod }) => {
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const etiket = kisalt(g.etiket, 80); if (!etiket) throw new HttpHata(400, 'Etiket zorunludur.');
    if (!DALLAR.includes(g.dal) || !KUTULAR.includes(g.kutu) || !SONUC_GRUPLARI.includes(g.sonuc_grubu)) throw new HttpHata(400, 'Dal, kutu veya sonuç grubu geçersiz.');
    let dKod = norm(g.kod) || ('ozel_' + etiket.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) + '_' + Date.now().toString(36).slice(-4));
    if (!KOD_RE.test(dKod)) throw new HttpHata(400, 'Kod 1-40 karakter; küçük harf, rakam ve _ olmalı.');
    const sira = Number.isInteger(Number(g.sira)) ? Number(g.sira) : 200;
    await q(`INSERT INTO ${T(kod, 'durumlar')} (kod, etiket, dal, alt_soru, kutu, sonuc_grubu, bayraklar, sira, sistem)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, false)`, [dKod, etiket, g.dal, kisalt(g.alt_soru, 120), g.kutu, g.sonuc_grubu, JSON.stringify(BAYRAK_TEMIZ(g.bayraklar)), sira]);
    await gunluk(q, kod, k.id, 'durum_ekle', 'durum', dKod, {});
    return { durum: 'ok', kod: dKod };
  }));

  app.patch('/api/durumlar/:kod', (c) => firmaIslemi(c, { izin: 'ayar_yonet', islemli: true }, async ({ q, k, kod }) => {
    const dKod = norm(c.req.param('kod')); if (!KOD_RE.test(dKod)) throw new HttpHata(400, 'Geçersiz kod.');
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const mev = await q(`SELECT * FROM ${T(kod, 'durumlar')} WHERE kod = $1 FOR UPDATE`, [dKod]);
    const d = mev.rows[0]; if (!d) throw new HttpHata(404, 'Durum bulunamadı.');
    const etiket = kisalt(g.etiket, 80) || d.etiket;
    const aktif = typeof g.aktif === 'boolean' ? g.aktif : d.aktif;
    const sira = Number.isInteger(Number(g.sira)) ? Number(g.sira) : d.sira;
    const kutu = KUTULAR.includes(g.kutu) ? g.kutu : d.kutu;
    const sonuc = SONUC_GRUPLARI.includes(g.sonuc_grubu) ? g.sonuc_grubu : d.sonuc_grubu;
    const bayraklar = g.bayraklar ? BAYRAK_TEMIZ(g.bayraklar) : d.bayraklar;
    const altSoru = g.alt_soru !== undefined ? kisalt(g.alt_soru, 120) : d.alt_soru;
    if (!aktif) {
      // Her dalda en az bir aktif secenek kalmali
      const kalan = await q(`SELECT count(*)::int AS n FROM ${T(kod, 'durumlar')} WHERE dal = $1 AND aktif AND kod <> $2`, [d.dal, dKod]);
      if (kalan.rows[0].n === 0) throw new HttpHata(409, 'Bu daldaki son aktif seçenek pasife alınamaz.');
    }
    await q(`UPDATE ${T(kod, 'durumlar')} SET etiket=$2, aktif=$3, sira=$4, kutu=$5, sonuc_grubu=$6, bayraklar=$7::jsonb, alt_soru=$8 WHERE kod=$1`,
      [dKod, etiket, aktif, sira, kutu, sonuc, JSON.stringify(bayraklar), altSoru]);
    await gunluk(q, kod, k.id, 'durum_guncelle', 'durum', dKod, {});
    return { durum: 'ok', mesaj: 'Kaydedildi.' };
  }));

  app.post('/api/secenekler', (c) => firmaIslemi(c, { izin: 'ayar_yonet', islemli: true }, async ({ q, k, kod }) => {
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    if (!['kanal', 'gorusme_nedeni', 'urun_hizmet'].includes(g.tur)) throw new HttpHata(400, 'Geçersiz tür.');
    const etiket = kisalt(g.etiket, 80); if (!etiket) throw new HttpHata(400, 'Etiket zorunludur.');
    const sKod = norm(g.kod) || (etiket.toLowerCase().replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || ('s_' + Date.now().toString(36)));
    if (!KOD_RE.test(sKod)) throw new HttpHata(400, 'Geçersiz kod.');
    await q(`INSERT INTO ${T(kod, 'secenekler')} (tur, kod, etiket, sira) VALUES ($1, $2, $3, $4)`, [g.tur, sKod, etiket, Number.isInteger(Number(g.sira)) ? Number(g.sira) : 100]);
    await gunluk(q, kod, k.id, 'secenek_ekle', 'secenek', sKod, { tur: g.tur });
    return { durum: 'ok' };
  }));
  app.patch('/api/secenekler/:tur/:kod', (c) => firmaIslemi(c, { izin: 'ayar_yonet', islemli: true }, async ({ q, k, kod }) => {
    const tur = c.req.param('tur'); const sKod = norm(c.req.param('kod'));
    if (!['kanal', 'gorusme_nedeni', 'urun_hizmet'].includes(tur) || !KOD_RE.test(sKod)) throw new HttpHata(400, 'Geçersiz istek.');
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const mev = await q(`SELECT * FROM ${T(kod, 'secenekler')} WHERE tur = $1 AND kod = $2`, [tur, sKod]);
    if (!mev.rows[0]) throw new HttpHata(404, 'Seçenek bulunamadı.');
    await q(`UPDATE ${T(kod, 'secenekler')} SET etiket = $3, aktif = $4, sira = $5 WHERE tur = $1 AND kod = $2`,
      [tur, sKod, kisalt(g.etiket, 80) || mev.rows[0].etiket, typeof g.aktif === 'boolean' ? g.aktif : mev.rows[0].aktif, Number.isInteger(Number(g.sira)) ? Number(g.sira) : mev.rows[0].sira]);
    await gunluk(q, kod, k.id, 'secenek_guncelle', 'secenek', sKod, {});
    return { durum: 'ok', mesaj: 'Kaydedildi.' };
  }));

  function icerikAlanlari(g) {
    if (!['script', 'ipucu', 'rehber_notu'].includes(g.tur)) throw new HttpHata(400, 'Geçersiz tür.');
    const metin = kisalt(g.metin, 5000); if (!metin) throw new HttpHata(400, 'Metin zorunludur.');
    return { tur: g.tur, sektor: kisalt(g.sektor, 100) || '*', baslik: kisalt(g.baslik, 120) || '', metin,
      sira: Number.isInteger(Number(g.sira)) ? Number(g.sira) : 100, aktif: typeof g.aktif === 'boolean' ? g.aktif : true };
  }
  app.post('/api/icerikler', (c) => firmaIslemi(c, { izin: 'ayar_yonet', islemli: true }, async ({ q, k, kod }) => {
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const a = icerikAlanlari(g);
    const r = await q(`INSERT INTO ${T(kod, 'icerikler')} (tur, sektor, baslik, metin, sira, aktif) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [a.tur, a.sektor, a.baslik, a.metin, a.sira, a.aktif]);
    await gunluk(q, kod, k.id, 'icerik_ekle', 'icerik', r.rows[0].id, {});
    return { durum: 'ok', id: r.rows[0].id };
  }));
  app.patch('/api/icerikler/:id', (c) => firmaIslemi(c, { izin: 'ayar_yonet', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const g = await jsonGovde(c); if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const a = icerikAlanlari(g);
    const r = await q(`UPDATE ${T(kod, 'icerikler')} SET tur=$2, sektor=$3, baslik=$4, metin=$5, sira=$6, aktif=$7 WHERE id=$1 RETURNING id`, [id, a.tur, a.sektor, a.baslik, a.metin, a.sira, a.aktif]);
    if (!r.rows[0]) throw new HttpHata(404, 'İçerik bulunamadı.');
    await gunluk(q, kod, k.id, 'icerik_guncelle', 'icerik', id, {});
    return { durum: 'ok', mesaj: 'Kaydedildi.' };
  }));
  app.delete('/api/icerikler/:id', (c) => firmaIslemi(c, { izin: 'ayar_yonet', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const r = await q(`DELETE FROM ${T(kod, 'icerikler')} WHERE id = $1 RETURNING id`, [id]);
    if (!r.rows[0]) throw new HttpHata(404, 'İçerik bulunamadı.');
    await gunluk(q, kod, k.id, 'icerik_sil', 'icerik', id, {});
    return { durum: 'ok', mesaj: 'Silindi.' };
  }));
}
