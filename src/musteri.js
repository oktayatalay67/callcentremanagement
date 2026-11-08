// =====================================================================
// src/musteri.js  -  Musteriler ve Excel yukleme API'si (v0.6.0)  -  PLATFORMDAN BAGIMSIZ
// ---------------------------------------------------------------------
// ILKE: firma kapsami ASLA istekten alinmaz; tablo adlari yalnizca T() ile,
// dogrulanmis oturumdaki firma kodundan uretilir. Agent (kapsam KENDI) yalniz
// kendisine atanmis musterileri gorur.
// Excel dosyasi TARAYICIDA okunur; sunucuya eslenmis satirlar parca parca gelir.
// ---------------------------------------------------------------------
import { T, HttpHata, jsonGovde } from './yardimci.js';
import { firmaIslemi, gunluk, idAl } from './yonetim.js';

const SATIR_PARCA_MAX = 60;         // tek istekte en cok firma (kucuk tutulur: sunucu CPU/sure sinirlari)
const KONTAK_PARCA_MAX = 200;       // tek istekte en cok yetkili
const FIRMA_KONTAK_MAX = 40;        // bir firmada en cok yetkili
const YUKLEME_SATIR_MAX = 20000;    // tek dosyada en cok satir
const EK_ALAN_MAX = 20;

const kisalt = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return s ? s.slice(0, n) : null;
};

// Unvan anahtari: buyuk/kucuk harf, Turkce harf ve bosluk farklarini yok sayar (SQL ile ayni mantik).
export function unvanAnahtar(v) {
  return String(v || '').trim().replace(/[İIıŞşĞğÜüÖöÇç]/g, (ch) => 'iiissgguuoocc'['İIıŞşĞğÜüÖöÇç'.indexOf(ch)]).toLowerCase().replace(/\s+/g, ' ');
}
const ANAHTAR_SQL = (kol) => `regexp_replace(lower(translate(btrim(${kol}), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')), '\\s+', ' ', 'g')`;

// Telefon: yalniz rakam; basta 90 / 0 atilir; 10 hane ise bu biciminde saklanir, degilse ham rakamlar.
export function telefonNorm(v) {
  const ham = kisalt(v, 40);
  if (!ham) return null;
  let d = ham.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 12 && d.startsWith('90')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 20);
}

// Kapsam: musteri izni '' ise erisim yok; KENDI ise yalniz atanmis musteriler.
function musteriKapsami(izinler) {
  const kapsam = izinler.kapsam.musteri || '';
  if (kapsam !== 'TUM' && kapsam !== 'KENDI') throw new HttpHata(403, 'Müşterilere erişim yetkiniz yok.');
  return kapsam;
}

export function musteriRotalari(app) {
  // ---- Yukleme basligi olustur ----
  app.post('/api/yuklemeler', (c) => firmaIslemi(c, { izin: 'excel_yukle', islemli: true }, async ({ q, k, kod }) => {
    const g = await jsonGovde(c);
    if (!g) throw new HttpHata(400, 'Geçersiz istek.');
    const dosya = kisalt(g.dosya_adi, 200);
    const toplam = Number(g.satir_sayisi);
    if (!dosya) throw new HttpHata(400, 'Dosya adı gerekli.');
    if (!Number.isInteger(toplam) || toplam < 1) throw new HttpHata(400, 'Dosyada yüklenecek satır yok.');
    if (toplam > YUKLEME_SATIR_MAX) throw new HttpHata(400, 'Bir dosyada en çok ' + YUKLEME_SATIR_MAX + ' satır yüklenebilir.');
    const r = await q(
      `INSERT INTO ${T(kod, 'yuklemeler')} (dosya_adi, yukleyen_id, satir_sayisi) VALUES ($1, $2, $3) RETURNING id`,
      [dosya, k.id, toplam]);
    await gunluk(q, kod, k.id, 'yukleme_baslat', 'yukleme', r.rows[0].id, { dosya, toplam });
    return { durum: 'ok', id: r.rows[0].id, parca_max: SATIR_PARCA_MAX };
  }));

  // ---- Yukleme satirlari (parca parca) ----
  app.post('/api/yuklemeler/:id/satirlar', (c) => firmaIslemi(c, { izin: 'excel_yukle', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const g = await jsonGovde(c);
    if (!g || !Array.isArray(g.satirlar) || !g.satirlar.length) throw new HttpHata(400, 'Geçersiz istek.');
    if (g.satirlar.length > SATIR_PARCA_MAX) throw new HttpHata(400, 'Tek seferde en çok ' + SATIR_PARCA_MAX + ' satır gönderilebilir.');

    const y = await q(`SELECT yukleyen_id, durum, satir_sayisi, eklenen, atlanan FROM ${T(kod, 'yuklemeler')} WHERE id = $1 FOR UPDATE`, [id]);
    if (!y.rows[0]) throw new HttpHata(404, 'Yükleme bulunamadı.');
    if (y.rows[0].yukleyen_id !== k.id) throw new HttpHata(403, 'Bu yükleme size ait değil.');
    if (y.rows[0].durum !== 'aktif') throw new HttpHata(409, 'Bu yükleme geri alınmış.');
    if (y.rows[0].eklenen + y.rows[0].atlanan + g.satirlar.length > y.rows[0].satir_sayisi) {
      throw new HttpHata(400, 'Bildirilen satır sayısı aşıldı.');
    }

    const m = { key: [], id: [], dis: [], unvan: [], sektor: [], il: [], ilce: [], adres: [], tel: [], ep: [], web: [], ek: [] };
    const kont = [];   // { musteriId, ad, gorev, tel, ep }
    const hatalar = [];
    let atlananBos = 0;
    let kontSayisi = 0;
    g.satirlar.forEach((s, i) => {
      if (!s || typeof s !== 'object') { atlananBos++; return; }
      const unvan = kisalt(s.unvan, 300);
      if (!unvan) { atlananBos++; if (hatalar.length < 20) hatalar.push({ satir: Number(s.no) || i + 1, neden: 'Ünvan boş' }); return; }
      const ek = {};
      if (s.ek && typeof s.ek === 'object' && !Array.isArray(s.ek)) {
        Object.keys(s.ek).slice(0, EK_ALAN_MAX).forEach((a) => {
          const ad = kisalt(a, 60); const dg = kisalt(s.ek[a], 500);
          if (ad && dg && ad !== '__proto__') ek[ad] = dg;
        });
      }
      const mid = crypto.randomUUID();
      m.key.push(unvanAnahtar(unvan)); m.id.push(mid); m.dis.push(kisalt(s.dis_no, 60)); m.unvan.push(unvan);
      m.sektor.push(kisalt(s.sektor, 100)); m.il.push(kisalt(s.il, 60)); m.ilce.push(kisalt(s.ilce, 60));
      m.adres.push(kisalt(s.adres, 500)); m.tel.push(telefonNorm(s.telefon));
      m.ep.push(kisalt(s.eposta, 200)); m.web.push(kisalt(s.web, 200)); m.ek.push(JSON.stringify(ek));
      // Yetkililer: kontaklar dizisi (firma basina birlesik satirlar) veya tek kontak_* alanlari
      const liste = Array.isArray(s.kontaklar) ? s.kontaklar.slice(0, FIRMA_KONTAK_MAX) : [s];
      liste.forEach((kx) => {
        if (!kx || typeof kx !== 'object') return;
        const kad = kisalt(kx.kontak_ad !== undefined ? kx.kontak_ad : kx.ad, 200);
        if (kad) {
          kontSayisi++;
          if (kontSayisi > KONTAK_PARCA_MAX) throw new HttpHata(400, 'Tek seferde en çok ' + KONTAK_PARCA_MAX + ' yetkili gönderilebilir.');
          kont.push({ mid, ad: kad, gorev: kisalt(kx.kontak_gorev !== undefined ? kx.kontak_gorev : kx.gorev, 100),
            tel: telefonNorm(kx.kontak_telefon !== undefined ? kx.kontak_telefon : kx.telefon),
            tel2: telefonNorm(kx.kontak_telefon2 !== undefined ? kx.kontak_telefon2 : kx.telefon2),
            ep: kisalt(kx.kontak_eposta !== undefined ? kx.kontak_eposta : kx.eposta, 200) });
        }
      });
    });

    // ---- MUKERRER ONLEME: ayni unvan = ayni musteri; yetkililer tek musteride toplanir ----
    // 1) Ayni parca icinde ayni unvanli satirlari ilkine bagla
    const ilkIdx = new Map(); const yonlendir = new Map(); const tut = [];
    m.key.forEach((kx, i) => {
      if (ilkIdx.has(kx)) { yonlendir.set(m.id[i], m.id[ilkIdx.get(kx)]); } else { ilkIdx.set(kx, i); tut.push(i); }
    });
    kont.forEach((x) => { if (yonlendir.has(x.mid)) x.mid = yonlendir.get(x.mid); });
    // 2) Veritabaninda ayni unvanli (silinmemis) musteri varsa yeni kayit acma, yetkilileri ona ekle
    const mevcut = new Map();
    if (tut.length) {
      const ex = await q(`SELECT id, ${ANAHTAR_SQL('unvan')} AS anahtar FROM ${T(kod, 'musteriler')}
                           WHERE NOT silindi AND ${ANAHTAR_SQL('unvan')} = ANY($1::text[]) ORDER BY olusturma`, [tut.map((i) => m.key[i])]);
      ex.rows.forEach((x) => { if (!mevcut.has(x.anahtar)) mevcut.set(x.anahtar, x.id); });
    }
    const birlesenSayi = (m.id.length - tut.length) + tut.filter((i) => mevcut.has(m.key[i])).length;
    tut.forEach((i) => { if (mevcut.has(m.key[i])) yonlendir.set(m.id[i], mevcut.get(m.key[i])); });
    kont.forEach((x) => { if (yonlendir.has(x.mid)) x.mid = yonlendir.get(x.mid); });
    const yeniIdx = tut.filter((i) => !mevcut.has(m.key[i]));
    const sec = (dz) => yeniIdx.map((i) => dz[i]);
    const y2 = { id: sec(m.id), dis: sec(m.dis), unvan: sec(m.unvan), sektor: sec(m.sektor), il: sec(m.il), ilce: sec(m.ilce), adres: sec(m.adres), tel: sec(m.tel), ep: sec(m.ep), web: sec(m.web), ek: sec(m.ek) };

    // Musteri numarasi bos olanlara otomatik numara ver: M000001, M000002 ... (firma basina, es zamanli yuklemelere karsi kilitli)
    if (y2.dis.some((d) => d === null)) {
      await q(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['musteri_no:' + kod]);
      const mx = await q(`SELECT COALESCE(max(substring(dis_no from 2)::int), 0) AS n FROM ${T(kod, 'musteriler')} WHERE dis_no ~ '^M[0-9]{1,9}$'`);
      let sayac = mx.rows[0].n;
      y2.dis = y2.dis.map((d) => (d === null ? 'M' + String(++sayac).padStart(6, '0') : d));
    }

    let eklenenIds = [];
    if (y2.id.length) {
      const r = await q(
        `INSERT INTO ${T(kod, 'musteriler')} (id, dis_no, unvan, sektor, il, ilce, adres, telefon, eposta, web, ek_alanlar, yukleme_id)
         SELECT t.id, t.dis, t.unvan, t.sektor, t.il, t.ilce, t.adres, t.tel, t.ep, t.web, t.ek::jsonb, $12
           FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
                AS t(id, dis, unvan, sektor, il, ilce, adres, tel, ep, web, ek)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [y2.id, y2.dis, y2.unvan, y2.sektor, y2.il, y2.ilce, y2.adres, y2.tel, y2.ep, y2.web, y2.ek, id]);
      eklenenIds = r.rows.map((x) => x.id);
    }
    const eklenenKume = new Set(eklenenIds);
    const mevcutKume = new Set(mevcut.values());
    const noConflict = y2.id.length - eklenenIds.length;   // musteri no cakismasi ile atlananlar
    // Yetkililer: yeni musterilere veya mevcut musterilere eklenir; ayni ad (veya telefon) zaten varsa eklenmez
    let kk = kont.filter((x) => eklenenKume.has(x.mid) || mevcutKume.has(x.mid));
    const gorulen = new Set();
    kk = kk.filter((x) => { const a = x.mid + '|' + (x.ad || '').toLocaleLowerCase('tr'); if (gorulen.has(a)) return false; gorulen.add(a); return true; });
    if (mevcutKume.size && kk.length) {
      const var2 = await q(`SELECT musteri_id, lower(ad_soyad) AS ad FROM ${T(kod, 'kontaklar')} WHERE musteri_id = ANY($1::uuid[]) AND NOT silindi`, [[...mevcutKume]]);
      const vs = new Set(var2.rows.map((x) => x.musteri_id + '|' + x.ad));
      kk = kk.filter((x) => !vs.has(x.mid + '|' + (x.ad || '').toLowerCase()));
    }
    if (kk.length) {
      await q(
        `INSERT INTO ${T(kod, 'kontaklar')} (musteri_id, ad_soyad, gorev, telefon, telefon2, eposta)
         SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])`,
        [kk.map((x) => x.mid), kk.map((x) => x.ad), kk.map((x) => x.gorev), kk.map((x) => x.tel), kk.map((x) => x.tel2), kk.map((x) => x.ep)]);
    }
    const eklenen = eklenenIds.length;
    const mukerrer = noConflict;
    const atlanan = mukerrer + birlesenSayi + atlananBos;
    await q(`UPDATE ${T(kod, 'yuklemeler')} SET eklenen = eklenen + $2, atlanan = atlanan + $3 WHERE id = $1`, [id, eklenen, atlanan]);
    return { durum: 'ok', eklenen, mukerrer, birlesen: birlesenSayi, bos: atlananBos, kontak: kk.length, hatalar };
  }));

  // ---- Mevcut mukerrer musterileri (ayni unvan) tek kayitta birlestir ----
  async function mukerrerGruplar(q, kod) {
    const r = await q(
      `SELECT m.id, m.olusturma, ${ANAHTAR_SQL('m.unvan')} AS anahtar,
              (SELECT count(*)::int FROM ${T(kod, 'aramalar')} a WHERE a.musteri_id = m.id) AS arama,
              (SELECT count(*)::int FROM ${T(kod, 'kontaklar')} k WHERE k.musteri_id = m.id AND NOT k.silindi) AS kontak
         FROM ${T(kod, 'musteriler')} m WHERE NOT m.silindi ORDER BY m.olusturma, m.id`);
    const g = new Map();
    r.rows.forEach((x) => { if (!g.has(x.anahtar)) g.set(x.anahtar, []); g.get(x.anahtar).push(x); });
    return [...g.values()].filter((a) => a.length > 1);
  }
  app.get('/api/mukerrer-ozet', (c) => firmaIslemi(c, { izin: 'musteri_duzenle' }, async ({ q, kod }) => {
    const gr = await mukerrerGruplar(q, kod);
    return { durum: 'ok', grup: gr.length, fazla_kayit: gr.reduce((t, a) => t + a.length - 1, 0) };
  }));
  app.post('/api/mukerrer-birlestir', (c) => firmaIslemi(c, { izin: 'musteri_duzenle', islemli: true }, async ({ q, k, kod }) => {
    await q(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['musteri_no:' + kod]);
    const gr = await mukerrerGruplar(q, kod);
    let birlesen = 0; let atlanan = 0; let tasinanKontak = 0;
    for (const a of gr) {
      // Ana kayit: en cok arama gecmisi olan, sonra en eski
      const sirali = [...a].sort((x, y) => (y.arama - x.arama) || (new Date(x.olusturma) - new Date(y.olusturma)));
      const ana = sirali[0].id;
      for (const d of sirali.slice(1)) {
        if (d.arama > 0) { atlanan++; continue; }   // arama gecmisi degismez; bu kayit elle kalir
        const mk = await q(`SELECT lower(ad_soyad) AS ad FROM ${T(kod, 'kontaklar')} WHERE musteri_id = $1 AND NOT silindi`, [ana]);
        const var2 = new Set(mk.rows.map((x) => x.ad));
        const dk = await q(`SELECT id, lower(ad_soyad) AS ad FROM ${T(kod, 'kontaklar')} WHERE musteri_id = $1 AND NOT silindi ORDER BY olusturma`, [d.id]);
        const tasi = []; const sil = [];
        dk.rows.forEach((x) => { if (var2.has(x.ad)) sil.push(x.id); else { var2.add(x.ad); tasi.push(x.id); } });
        if (tasi.length) { await q(`UPDATE ${T(kod, 'kontaklar')} SET musteri_id = $1 WHERE id = ANY($2::uuid[])`, [ana, tasi]); tasinanKontak += tasi.length; }
        if (sil.length) await q(`UPDATE ${T(kod, 'kontaklar')} SET silindi = true WHERE id = ANY($1::uuid[])`, [sil]);
        // Liste kayitlari: ana kayitta ayni liste yoksa tasi, varsa sil
        await q(`UPDATE ${T(kod, 'liste_kayitlari')} lk SET musteri_id = $1 WHERE lk.musteri_id = $2
                  AND NOT EXISTS (SELECT 1 FROM ${T(kod, 'liste_kayitlari')} y WHERE y.musteri_id = $1 AND y.liste_id = lk.liste_id)`, [ana, d.id]);
        await q(`DELETE FROM ${T(kod, 'liste_kayitlari')} WHERE musteri_id = $1`, [d.id]);
        // Atama: ana kayitta yoksa tasi
        await q(`UPDATE ${T(kod, 'atamalar')} at1 SET musteri_id = $1 WHERE at1.musteri_id = $2
                  AND NOT EXISTS (SELECT 1 FROM ${T(kod, 'atamalar')} y WHERE y.musteri_id = $1 AND y.kullanici_id = at1.kullanici_id)`, [ana, d.id]);
        await q(`DELETE FROM ${T(kod, 'atamalar')} WHERE musteri_id = $1`, [d.id]);
        await q(`UPDATE ${T(kod, 'takvim')} SET musteri_id = $1 WHERE musteri_id = $2`, [ana, d.id]);
        await q(`UPDATE ${T(kod, 'yasakli_liste')} SET musteri_id = $1 WHERE musteri_id = $2 AND kapsam = 'musteri'`, [ana, d.id]);
        await q(`UPDATE ${T(kod, 'musteriler')} SET silindi = true, silinme_zamani = now() WHERE id = $1`, [d.id]);
        birlesen++;
      }
    }
    await gunluk(q, kod, k.id, 'mukerrer_birlestir', 'musteri', null, { birlesen, atlanan, tasinanKontak });
    return { durum: 'ok', birlesen, atlanan, kontak: tasinanKontak };
  }));

  // ---- Yukleme gecmisi ----
  app.get('/api/yuklemeler', (c) => firmaIslemi(c, { izin: 'excel_yukle' }, async ({ q, kod }) => {
    const r = await q(
      `SELECT y.id, y.dosya_adi, y.satir_sayisi, y.eklenen, y.atlanan, y.durum, y.olusturma, y.geri_alma_zamani,
              COALESCE(NULLIF(u.ad_soyad, ''), u.kullanici_adi) AS yukleyen
         FROM ${T(kod, 'yuklemeler')} y LEFT JOIN cc.kullanicilar u ON u.id = y.yukleyen_id
        ORDER BY y.olusturma DESC LIMIT 50`);
    return { durum: 'ok', yuklemeler: r.rows };
  }));

  // ---- Geri al: yuklemenin musterilerini (araması olmayanlari) gizle ----
  app.post('/api/yuklemeler/:id/geri-al', (c) => firmaIslemi(c, { izin: 'excel_yukle', islemli: true }, async ({ q, k, kod }) => {
    const id = idAl(c);
    const y = await q(`SELECT durum FROM ${T(kod, 'yuklemeler')} WHERE id = $1 FOR UPDATE`, [id]);
    if (!y.rows[0]) throw new HttpHata(404, 'Yükleme bulunamadı.');
    if (y.rows[0].durum !== 'aktif') throw new HttpHata(409, 'Bu yükleme zaten geri alınmış.');
    // Aranmis, bir listeye alinmis veya atanmis musteriler korunur
    const silinen = await q(
      `UPDATE ${T(kod, 'musteriler')} m SET silindi = true, silinme_zamani = now()
        WHERE m.yukleme_id = $1 AND NOT m.silindi
          AND NOT EXISTS (SELECT 1 FROM ${T(kod, 'aramalar')} a WHERE a.musteri_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM ${T(kod, 'liste_kayitlari')} l WHERE l.musteri_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM ${T(kod, 'atamalar')} t WHERE t.musteri_id = m.id)
        RETURNING m.id`, [id]);
    const kalan = await q(`SELECT count(*)::int AS n FROM ${T(kod, 'musteriler')} WHERE yukleme_id = $1 AND NOT silindi`, [id]);
    if (silinen.rows.length) {
      await q(`UPDATE ${T(kod, 'kontaklar')} SET silindi = true WHERE musteri_id = ANY($1::uuid[])`, [silinen.rows.map((x) => x.id)]);
    }
    await q(`UPDATE ${T(kod, 'yuklemeler')} SET durum = 'geri_alindi', geri_alma_zamani = now(), geri_alan_id = $2 WHERE id = $1`, [id, k.id]);
    await gunluk(q, kod, k.id, 'yukleme_geri_al', 'yukleme', id, { silinen: silinen.rows.length, korunan: kalan.rows[0].n });
    return { durum: 'ok', silinen: silinen.rows.length, korunan: kalan.rows[0].n };
  }));

  // ---- Musteri listesi (arama + filtre + sayfalama) ----
  app.get('/api/musteriler', (c) => firmaIslemi(c, {}, async ({ q, k, kod, izinler }) => {
    const kapsam = musteriKapsami(izinler);
    const ara = kisalt(c.req.query('q'), 100);
    const sektor = kisalt(c.req.query('sektor'), 100);
    const il = kisalt(c.req.query('il'), 60);
    const sayfa = Math.max(1, Math.min(10000, parseInt(c.req.query('sayfa'), 10) || 1));
    const BOYUT = 50;
    const par = [];
    const kosul = ['NOT m.silindi'];
    if (kapsam === 'KENDI') { par.push(k.id); kosul.push(`EXISTS (SELECT 1 FROM ${T(kod, 'atamalar')} t WHERE t.musteri_id = m.id AND t.kullanici_id = $${par.length})`); }
    if (ara) {
      par.push('%' + ara.replace(/[\\%_]/g, '\\$&') + '%');
      kosul.push(`(m.unvan ILIKE $${par.length} OR m.dis_no ILIKE $${par.length} OR m.telefon ILIKE $${par.length})`);
    }
    if (sektor) { par.push(sektor); kosul.push(`m.sektor = $${par.length}`); }
    if (il) { par.push(il); kosul.push(`m.il = $${par.length}`); }
    const where = kosul.join(' AND ');
    const sayim = await q(`SELECT count(*)::int AS n FROM ${T(kod, 'musteriler')} m WHERE ${where}`, par);
    const r = await q(
      `SELECT m.id, m.dis_no, m.unvan, m.sektor, m.il, m.ilce, m.telefon, m.potansiyel_yok,
              (SELECT string_agg(COALESCE(NULLIF(u.ad_soyad, ''), u.kullanici_adi), ', ' ORDER BY u.kullanici_adi)
                 FROM ${T(kod, 'atamalar')} t JOIN cc.kullanicilar u ON u.id = t.kullanici_id WHERE t.musteri_id = m.id) AS atanan
         FROM ${T(kod, 'musteriler')} m WHERE ${where}
        ORDER BY m.unvan, m.id LIMIT ${BOYUT} OFFSET ${(sayfa - 1) * BOYUT}`, par);
    return { durum: 'ok', toplam: sayim.rows[0].n, sayfa, boyut: BOYUT, musteriler: r.rows };
  }));

  // ---- Filtre secenekleri ----
  app.get('/api/musteri-filtre', (c) => firmaIslemi(c, {}, async ({ q, k, kod, izinler }) => {
    const kapsam = musteriKapsami(izinler);
    const par = [];
    let kosul = 'NOT m.silindi';
    if (kapsam === 'KENDI') { par.push(k.id); kosul += ` AND EXISTS (SELECT 1 FROM ${T(kod, 'atamalar')} t WHERE t.musteri_id = m.id AND t.kullanici_id = $1)`; }
    const s = await q(`SELECT DISTINCT m.sektor FROM ${T(kod, 'musteriler')} m WHERE ${kosul} AND m.sektor IS NOT NULL ORDER BY 1 LIMIT 300`, par);
    const i = await q(`SELECT DISTINCT m.il FROM ${T(kod, 'musteriler')} m WHERE ${kosul} AND m.il IS NOT NULL ORDER BY 1 LIMIT 300`, par);
    return { durum: 'ok', sektorler: s.rows.map((x) => x.sektor), iller: i.rows.map((x) => x.il) };
  }));

  // ---- Musteri detayi (kontaklar dahil) ----
  app.get('/api/musteriler/:id', (c) => firmaIslemi(c, {}, async ({ q, k, kod, izinler }) => {
    const kapsam = musteriKapsami(izinler);
    const id = idAl(c);
    const par = [id];
    let kosul = 'm.id = $1 AND NOT m.silindi';
    if (kapsam === 'KENDI') { par.push(k.id); kosul += ` AND EXISTS (SELECT 1 FROM ${T(kod, 'atamalar')} t WHERE t.musteri_id = m.id AND t.kullanici_id = $2)`; }
    const r = await q(`SELECT m.* FROM ${T(kod, 'musteriler')} m WHERE ${kosul}`, par);
    if (!r.rows[0]) throw new HttpHata(404, 'Müşteri bulunamadı.');
    const kt = await q(
      `SELECT id, ad_soyad, gorev, telefon, telefon2, eposta, karar_verici, aranmayacak, aranmayacak_neden
         FROM ${T(kod, 'kontaklar')} WHERE musteri_id = $1 AND NOT silindi ORDER BY ad_soyad`, [id]);
    const { yukleme_id, silindi, silinme_zamani, ...musteri } = r.rows[0];
    return { durum: 'ok', musteri, kontaklar: kt.rows };
  }));
}
