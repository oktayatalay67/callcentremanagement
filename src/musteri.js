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

const SATIR_PARCA_MAX = 300;        // tek istekte en cok satir
const YUKLEME_SATIR_MAX = 20000;    // tek dosyada en cok satir
const EK_ALAN_MAX = 20;

const kisalt = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return s ? s.slice(0, n) : null;
};

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

    const m = { id: [], dis: [], unvan: [], sektor: [], il: [], ilce: [], adres: [], tel: [], ep: [], web: [], ek: [] };
    const kont = [];   // { musteriId, ad, gorev, tel, ep }
    const hatalar = [];
    let atlananBos = 0;
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
      m.id.push(mid); m.dis.push(kisalt(s.dis_no, 60)); m.unvan.push(unvan);
      m.sektor.push(kisalt(s.sektor, 100)); m.il.push(kisalt(s.il, 60)); m.ilce.push(kisalt(s.ilce, 60));
      m.adres.push(kisalt(s.adres, 500)); m.tel.push(telefonNorm(s.telefon));
      m.ep.push(kisalt(s.eposta, 200)); m.web.push(kisalt(s.web, 200)); m.ek.push(JSON.stringify(ek));
      const kad = kisalt(s.kontak_ad, 200);
      if (kad) kont.push({ mid, ad: kad, gorev: kisalt(s.kontak_gorev, 100), tel: telefonNorm(s.kontak_telefon), ep: kisalt(s.kontak_eposta, 200) });
    });

    let eklenenIds = [];
    if (m.id.length) {
      const r = await q(
        `INSERT INTO ${T(kod, 'musteriler')} (id, dis_no, unvan, sektor, il, ilce, adres, telefon, eposta, web, ek_alanlar, yukleme_id)
         SELECT t.id, t.dis, t.unvan, t.sektor, t.il, t.ilce, t.adres, t.tel, t.ep, t.web, t.ek::jsonb, $12
           FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
                AS t(id, dis, unvan, sektor, il, ilce, adres, tel, ep, web, ek)
         ON CONFLICT (dis_no) WHERE dis_no IS NOT NULL AND NOT silindi DO NOTHING
         RETURNING id`,
        [m.id, m.dis, m.unvan, m.sektor, m.il, m.ilce, m.adres, m.tel, m.ep, m.web, m.ek, id]);
      eklenenIds = r.rows.map((x) => x.id);
    }
    const eklenenKume = new Set(eklenenIds);
    const kk = kont.filter((x) => eklenenKume.has(x.mid));
    if (kk.length) {
      await q(
        `INSERT INTO ${T(kod, 'kontaklar')} (musteri_id, ad_soyad, gorev, telefon, eposta)
         SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])`,
        [kk.map((x) => x.mid), kk.map((x) => x.ad), kk.map((x) => x.gorev), kk.map((x) => x.tel), kk.map((x) => x.ep)]);
    }
    const eklenen = eklenenIds.length;
    const mukerrer = m.id.length - eklenen;
    const atlanan = mukerrer + atlananBos;
    await q(`UPDATE ${T(kod, 'yuklemeler')} SET eklenen = eklenen + $2, atlanan = atlanan + $3 WHERE id = $1`, [id, eklenen, atlanan]);
    return { durum: 'ok', eklenen, mukerrer, bos: atlananBos, hatalar };
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
