-- =====================================================================
-- ADIM 2  (sürüm 0.2.0)  -  Firma kurulum şablonu
-- Ön koşul: Adım 1 (cc şeması: firmalar, kullanicilar, giris_kayitlari)
-- Ne yapar:
--   cc.firma_tablolarini_kur(kod)  : bir firma için 17 tabloyu, indeksleri,
--                                    tetikleyicileri ve başlangıç verisini kurar
--   cc.firma_kur(kod, unvan)       : firma kaydını ekler + tabloları kurar (tek işlem)
-- Bu dosya firma OLUŞTURMAZ; yalnız işlevleri tanımlar.
-- =====================================================================
BEGIN;

-- ---------- Ortak koruma işlevleri ----------

-- Tamamlanmış arama satırı değiştirilemez / silinemez.
-- Tek istisna: liste silinirken liste_id ve liste_kayit_id alanlarının boşalması.
CREATE OR REPLACE FUNCTION cc.arama_degismez() RETURNS trigger AS $$
BEGIN
  IF OLD.kayit_durumu = 'tamamlandi' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Tamamlanmis arama kaydi silinemez';
    END IF;
    IF (to_jsonb(NEW) - 'liste_id' - 'liste_kayit_id')
       IS DISTINCT FROM (to_jsonb(OLD) - 'liste_id' - 'liste_kayit_id')
       OR (NEW.liste_id IS NOT NULL AND NEW.liste_id IS DISTINCT FROM OLD.liste_id)
       OR (NEW.liste_kayit_id IS NOT NULL AND NEW.liste_kayit_id IS DISTINCT FROM OLD.liste_kayit_id) THEN
      RAISE EXCEPTION 'Tamamlanmis arama kaydi degistirilemez';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Kilitlenme koruması: firma admininin kritik izinleri kaldırılamaz.
CREATE OR REPLACE FUNCTION cc.rol_izin_koruma() RETURNS trigger AS $$
BEGIN
  IF OLD.rol_kod = 'firma_admin' AND OLD.perm_tip = 'action'
     AND OLD.perm_key IN ('rol_yonet','kullanici_yonet','firma_profil_duzenle')
     AND (TG_OP = 'DELETE' OR NEW.deger IS DISTINCT FROM '1'
          OR NEW.rol_kod IS DISTINCT FROM OLD.rol_kod
          OR NEW.perm_key IS DISTINCT FROM OLD.perm_key) THEN
    RAISE EXCEPTION 'firma_admin icin % izni kaldirilamaz', OLD.perm_key;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cc.rol_koruma() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.sistem THEN RAISE EXCEPTION 'Sistem rolu silinemez'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.kod = 'firma_admin' AND (NEW.aktif IS NOT TRUE OR NEW.kod IS DISTINCT FROM OLD.kod) THEN
    RAISE EXCEPTION 'firma_admin rolu pasife alinamaz / yeniden adlandirilamaz';
  END IF;
  IF NEW.kod IS DISTINCT FROM OLD.kod THEN
    RAISE EXCEPTION 'Rol kodu degistirilemez';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- Firma tablolarını kuran işlev ----------
CREATE OR REPLACE FUNCTION cc.firma_tablolarini_kur(p_kod text) RETURNS void AS $fn$
DECLARE
  v_ddl  text;
  v_adlar text[] := ARRAY['roller','rol_izinleri','yuklemeler','musteriler','kontaklar',
    'atamalar','atama_gecmisi','yasakli_liste','durumlar','secenekler','ayarlar',
    'icerikler','listeler','liste_kayitlari','takvim','aramalar','islem_gunlugu'];
  v_ad text;
BEGIN
  -- Tablo adı yalnız doğrulanmış kodtan üretilir
  IF p_kod IS NULL OR p_kod !~ '^[a-z0-9]{1,20}$' OR p_kod = 'platform' THEN
    RAISE EXCEPTION 'Gecersiz firma kodu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cc.firmalar WHERE kod = p_kod) THEN
    RAISE EXCEPTION 'Firma kaydi yok: %', p_kod;
  END IF;

  v_ddl := $T$
  CREATE TABLE IF NOT EXISTS __P__roller (
    kod         text PRIMARY KEY CHECK (kod ~ '^[a-z0-9_]{1,30}$'),
    gorunen_ad  text NOT NULL,
    aktif       boolean NOT NULL DEFAULT true,
    sira        integer NOT NULL DEFAULT 100,
    sistem      boolean NOT NULL DEFAULT false
  );

  CREATE TABLE IF NOT EXISTS __P__rol_izinleri (
    rol_kod   text NOT NULL REFERENCES __P__roller(kod) ON DELETE CASCADE,
    perm_tip  text NOT NULL CHECK (perm_tip IN ('scope','action')),
    perm_key  text NOT NULL,
    deger     text NOT NULL DEFAULT '',
    PRIMARY KEY (rol_kod, perm_tip, perm_key)
  );

  CREATE TABLE IF NOT EXISTS __P__yuklemeler (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dosya_adi         text NOT NULL,
    yukleyen_id       uuid REFERENCES cc.kullanicilar(id),
    satir_sayisi      integer NOT NULL DEFAULT 0,
    eklenen           integer NOT NULL DEFAULT 0,
    atlanan           integer NOT NULL DEFAULT 0,
    durum             text NOT NULL DEFAULT 'aktif' CHECK (durum IN ('aktif','geri_alindi')),
    olusturma         timestamptz NOT NULL DEFAULT now(),
    geri_alma_zamani  timestamptz,
    geri_alan_id      uuid REFERENCES cc.kullanicilar(id)
  );

  CREATE TABLE IF NOT EXISTS __P__musteriler (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dis_no          text,
    unvan           text NOT NULL,
    sektor          text,
    il              text,
    ilce            text,
    adres           text,
    telefon         text,
    eposta          text,
    web             text,
    ek_alanlar      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ek_alanlar) = 'object'),
    yukleme_id      uuid REFERENCES __P__yuklemeler(id),
    silindi         boolean NOT NULL DEFAULT false,
    silinme_zamani  timestamptz,
    potansiyel_yok  boolean NOT NULL DEFAULT false,
    olusturma       timestamptz NOT NULL DEFAULT now(),
    guncelleme      timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS __N__musteriler_disno_uk
    ON __P__musteriler (dis_no) WHERE dis_no IS NOT NULL AND NOT silindi;
  CREATE INDEX IF NOT EXISTS __N__musteriler_yukleme_ix ON __P__musteriler (yukleme_id);
  CREATE INDEX IF NOT EXISTS __N__musteriler_sektor_ix ON __P__musteriler (sektor) WHERE NOT silindi;
  CREATE INDEX IF NOT EXISTS __N__musteriler_il_ix ON __P__musteriler (il, ilce) WHERE NOT silindi;

  CREATE TABLE IF NOT EXISTS __P__kontaklar (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    musteri_id          uuid NOT NULL REFERENCES __P__musteriler(id),
    ad_soyad            text NOT NULL,
    gorev               text,
    telefon             text,
    telefon2            text,
    eposta              text,
    karar_verici        boolean NOT NULL DEFAULT false,
    aranmayacak         boolean NOT NULL DEFAULT false,
    aranmayacak_neden   text,
    notlar              text,
    silindi             boolean NOT NULL DEFAULT false,
    olusturma           timestamptz NOT NULL DEFAULT now(),
    guncelleme          timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS __N__kontaklar_musteri_ix ON __P__kontaklar (musteri_id);

  CREATE TABLE IF NOT EXISTS __P__atamalar (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    musteri_id  uuid NOT NULL REFERENCES __P__musteriler(id),
    kullanici_id uuid NOT NULL REFERENCES cc.kullanicilar(id),
    atayan_id   uuid REFERENCES cc.kullanicilar(id),
    zaman       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (musteri_id, kullanici_id)
  );
  CREATE INDEX IF NOT EXISTS __N__atamalar_kullanici_ix ON __P__atamalar (kullanici_id);

  CREATE TABLE IF NOT EXISTS __P__atama_gecmisi (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    musteri_id   uuid NOT NULL REFERENCES __P__musteriler(id),
    kullanici_id uuid NOT NULL REFERENCES cc.kullanicilar(id),
    islem        text NOT NULL CHECK (islem IN ('ekle','degistir','kaldir')),
    yapan_id     uuid REFERENCES cc.kullanicilar(id),
    zaman        timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS __N__atama_gecmisi_musteri_ix ON __P__atama_gecmisi (musteri_id, zaman DESC);

  CREATE TABLE IF NOT EXISTS __P__yasakli_liste (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    musteri_id        uuid NOT NULL REFERENCES __P__musteriler(id),
    kontak_id         uuid REFERENCES __P__kontaklar(id),
    kapsam            text NOT NULL CHECK (kapsam IN ('kontak','musteri')),
    kim_id            uuid REFERENCES cc.kullanicilar(id),
    zaman             timestamptz NOT NULL DEFAULT now(),
    neden             text,
    kaldiran_id       uuid REFERENCES cc.kullanicilar(id),
    kaldirma_zamani   timestamptz,
    CHECK ((kapsam = 'kontak') = (kontak_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS __N__yasakli_aktif_uk
    ON __P__yasakli_liste (musteri_id, COALESCE(kontak_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE kaldirma_zamani IS NULL;

  CREATE TABLE IF NOT EXISTS __P__durumlar (
    kod          text PRIMARY KEY CHECK (kod ~ '^[a-z0-9_]{1,40}$'),
    etiket       text NOT NULL,
    dal          text NOT NULL CHECK (dal IN ('ulasilamadi','muhatap_degil','uygun_degil','bilgi_verildi','aramasiz')),
    ust_kod      text REFERENCES __P__durumlar(kod),
    alt_soru     text,
    kutu         text NOT NULL CHECK (kutu IN ('yeni','tekrar','ulasilamadi','tamam')),
    sonuc_grubu  text NOT NULL CHECK (sonuc_grubu IN ('olumlu','olumsuz','ulasilamadi','beklemede')),
    bayraklar    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(bayraklar) = 'object'),
    sira         integer NOT NULL DEFAULT 100,
    aktif        boolean NOT NULL DEFAULT true,
    sistem       boolean NOT NULL DEFAULT false,
    guncelleme   timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS __P__secenekler (
    tur      text NOT NULL CHECK (tur IN ('kanal','gorusme_nedeni','urun_hizmet')),
    kod      text NOT NULL CHECK (kod ~ '^[a-z0-9_]{1,40}$'),
    etiket   text NOT NULL,
    sira     integer NOT NULL DEFAULT 100,
    aktif    boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tur, kod)
  );

  CREATE TABLE IF NOT EXISTS __P__ayarlar (
    anahtar     text PRIMARY KEY,
    deger       text NOT NULL,
    aciklama    text,
    guncelleme  timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS __P__icerikler (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tur         text NOT NULL CHECK (tur IN ('script','ipucu','rehber_notu')),
    sektor      text NOT NULL DEFAULT '*',
    baslik      text NOT NULL DEFAULT '',
    metin       text NOT NULL,
    sira        integer NOT NULL DEFAULT 100,
    aktif       boolean NOT NULL DEFAULT true,
    olusturma   timestamptz NOT NULL DEFAULT now(),
    guncelleme  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS __N__icerikler_tur_ix ON __P__icerikler (tur, sektor) WHERE aktif;

  CREATE TABLE IF NOT EXISTS __P__listeler (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ad              text NOT NULL,
    aciklama        text,
    durum           text NOT NULL DEFAULT 'hazirlik' CHECK (durum IN ('hazirlik','aktif','durdu','bitti')),
    deneme_limiti   integer CHECK (deneme_limiti IS NULL OR deneme_limiti BETWEEN 1 AND 50),
    konusma_metni   text,
    urun_odak       text,
    olusturan_id    uuid REFERENCES cc.kullanicilar(id),
    olusturma       timestamptz NOT NULL DEFAULT now(),
    guncelleme      timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS __P__liste_kayitlari (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    liste_id           uuid NOT NULL REFERENCES __P__listeler(id) ON DELETE CASCADE,
    musteri_id         uuid NOT NULL REFERENCES __P__musteriler(id),
    durum_kodu         text REFERENCES __P__durumlar(kod),
    kutu               text NOT NULL DEFAULT 'yeni' CHECK (kutu IN ('yeni','tekrar','ulasilamadi','tamam')),
    sonuc_grubu        text CHECK (sonuc_grubu IS NULL OR sonuc_grubu IN ('olumlu','olumsuz','ulasilamadi','beklemede')),
    deneme_sayisi      integer NOT NULL DEFAULT 0,
    son_arama          timestamptz,
    sonraki_arama      timestamptz,
    oncelik            integer NOT NULL DEFAULT 0,
    kilit_kullanici_id uuid REFERENCES cc.kullanicilar(id),
    kilit_zaman        timestamptz,
    olusturma          timestamptz NOT NULL DEFAULT now(),
    guncelleme         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (liste_id, musteri_id)
  );
  CREATE INDEX IF NOT EXISTS __N__lk_kuyruk_ix ON __P__liste_kayitlari (liste_id, kutu, sonraki_arama);
  CREATE INDEX IF NOT EXISTS __N__lk_musteri_ix ON __P__liste_kayitlari (musteri_id);

  CREATE TABLE IF NOT EXISTS __P__takvim (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tur           text NOT NULL CHECK (tur IN ('randevu','gorev')),
    musteri_id    uuid REFERENCES __P__musteriler(id),
    kontak_id     uuid REFERENCES __P__kontaklar(id),
    kullanici_id  uuid REFERENCES cc.kullanicilar(id),
    baslangic     timestamptz NOT NULL,
    bitis         timestamptz,
    baslik        text NOT NULL DEFAULT '',
    aciklama      text,
    durum         text NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik','tamamlandi','iptal')),
    olusturma     timestamptz NOT NULL DEFAULT now(),
    guncelleme    timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS __N__takvim_kisi_ix ON __P__takvim (kullanici_id, baslangic);
  CREATE INDEX IF NOT EXISTS __N__takvim_musteri_ix ON __P__takvim (musteri_id);

  CREATE TABLE IF NOT EXISTS __P__aramalar (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    musteri_id            uuid NOT NULL REFERENCES __P__musteriler(id),
    kontak_id             uuid REFERENCES __P__kontaklar(id),
    kullanici_id          uuid NOT NULL REFERENCES cc.kullanicilar(id),
    kullanici_adi         text NOT NULL,
    liste_id              uuid REFERENCES __P__listeler(id) ON DELETE SET NULL,
    liste_kayit_id        uuid REFERENCES __P__liste_kayitlari(id) ON DELETE SET NULL,
    liste_adi             text,
    kayit_durumu          text NOT NULL DEFAULT 'acik' CHECK (kayit_durumu IN ('acik','tamamlandi')),
    kanal_kodu            text NOT NULL DEFAULT 'telefon',
    neden_kodu            text,
    baslangic             timestamptz NOT NULL DEFAULT now(),
    bitis                 timestamptz,
    sure_sn               integer CHECK (sure_sn IS NULL OR sure_sn >= 0),
    deneme_no             integer,
    ulasildi              boolean,
    muhatap_dogru         boolean,
    durum_kodu            text REFERENCES __P__durumlar(kod),
    urun_kodlari          text[] NOT NULL DEFAULT '{}',
    adet                  integer,
    tahmini_tutar         numeric(14,2),
    ilgi_seviyesi         smallint CHECK (ilgi_seviyesi IS NULL OR ilgi_seviyesi BETWEEN 1 AND 5),
    rakip_sozlesme_bitis  date,
    randevu_zamani        timestamptz,
    sonraki_arama         timestamptz,
    not_metni             text,
    olusan_takvim_id      uuid REFERENCES __P__takvim(id),
    ek_veri               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ek_veri) = 'object'),
    CHECK (kayit_durumu = 'acik' OR (durum_kodu IS NOT NULL AND bitis IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS __N__aramalar_musteri_ix ON __P__aramalar (musteri_id, baslangic DESC);
  CREATE INDEX IF NOT EXISTS __N__aramalar_kisi_ix ON __P__aramalar (kullanici_id, baslangic DESC);
  CREATE INDEX IF NOT EXISTS __N__aramalar_liste_ix ON __P__aramalar (liste_id);

  CREATE TABLE IF NOT EXISTS __P__islem_gunlugu (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kullanici_id  uuid REFERENCES cc.kullanicilar(id),
    islem         text NOT NULL,
    nesne         text,
    nesne_id      text,
    detay         jsonb NOT NULL DEFAULT '{}'::jsonb,
    zaman         timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS __N__gunluk_zaman_ix ON __P__islem_gunlugu (zaman DESC);

  -- Tetikleyiciler
  DROP TRIGGER IF EXISTS __N__musteriler_g ON __P__musteriler;
  CREATE TRIGGER __N__musteriler_g BEFORE UPDATE ON __P__musteriler FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();
  DROP TRIGGER IF EXISTS __N__kontaklar_g ON __P__kontaklar;
  CREATE TRIGGER __N__kontaklar_g BEFORE UPDATE ON __P__kontaklar FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();
  DROP TRIGGER IF EXISTS __N__durumlar_g ON __P__durumlar;
  CREATE TRIGGER __N__durumlar_g BEFORE UPDATE ON __P__durumlar FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();
  DROP TRIGGER IF EXISTS __N__ayarlar_g ON __P__ayarlar;
  CREATE TRIGGER __N__ayarlar_g BEFORE UPDATE ON __P__ayarlar FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();
  DROP TRIGGER IF EXISTS __N__icerikler_g ON __P__icerikler;
  CREATE TRIGGER __N__icerikler_g BEFORE UPDATE ON __P__icerikler FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();
  DROP TRIGGER IF EXISTS __N__listeler_g ON __P__listeler;
  CREATE TRIGGER __N__listeler_g BEFORE UPDATE ON __P__listeler FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();
  DROP TRIGGER IF EXISTS __N__lk_g ON __P__liste_kayitlari;
  CREATE TRIGGER __N__lk_g BEFORE UPDATE ON __P__liste_kayitlari FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();
  DROP TRIGGER IF EXISTS __N__takvim_g ON __P__takvim;
  CREATE TRIGGER __N__takvim_g BEFORE UPDATE ON __P__takvim FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();

  DROP TRIGGER IF EXISTS __N__arama_degismez ON __P__aramalar;
  CREATE TRIGGER __N__arama_degismez BEFORE UPDATE OR DELETE ON __P__aramalar FOR EACH ROW EXECUTE FUNCTION cc.arama_degismez();
  DROP TRIGGER IF EXISTS __N__rol_koruma ON __P__roller;
  CREATE TRIGGER __N__rol_koruma BEFORE UPDATE OR DELETE ON __P__roller FOR EACH ROW EXECUTE FUNCTION cc.rol_koruma();
  DROP TRIGGER IF EXISTS __N__izin_koruma ON __P__rol_izinleri;
  CREATE TRIGGER __N__izin_koruma BEFORE UPDATE OR DELETE ON __P__rol_izinleri FOR EACH ROW EXECUTE FUNCTION cc.rol_izin_koruma();

  -- Başlangıç verisi: roller
  INSERT INTO __P__roller (kod, gorunen_ad, aktif, sira, sistem) VALUES
    ('firma_admin', 'Firma Yöneticisi', true, 10, true),
    ('agent',       'Agent',            true, 20, true)
  ON CONFLICT (kod) DO NOTHING;

  -- Başlangıç verisi: izinler (kapsam: TUM / KENDI / boş; eylem: 1 / 0)
  INSERT INTO __P__rol_izinleri (rol_kod, perm_tip, perm_key, deger)
  SELECT 'firma_admin', 'scope', k, 'TUM' FROM unnest(ARRAY['musteri','arama','takvim','rapor']) AS k
  ON CONFLICT DO NOTHING;
  INSERT INTO __P__rol_izinleri (rol_kod, perm_tip, perm_key, deger)
  SELECT 'agent', 'scope', k, CASE WHEN k = 'rapor' THEN '' ELSE 'KENDI' END
    FROM unnest(ARRAY['musteri','arama','takvim','rapor']) AS k
  ON CONFLICT DO NOTHING;
  INSERT INTO __P__rol_izinleri (rol_kod, perm_tip, perm_key, deger)
  SELECT 'firma_admin', 'action', e, '1' FROM unnest(ARRAY[
    'arama_yap','arama_kapat','musteri_ekle','musteri_duzenle','musteri_sil','liste_yonet','liste_sil',
    'excel_yukle','excel_aktar','atama_yap','yasakli_kaldir','ayar_yonet','kullanici_yonet',
    'rol_yonet','firma_profil_duzenle','rapor_gor','dashboard_gor']) AS e
  ON CONFLICT DO NOTHING;
  INSERT INTO __P__rol_izinleri (rol_kod, perm_tip, perm_key, deger)
  SELECT 'agent', 'action', e, CASE WHEN e IN ('arama_yap','arama_kapat') THEN '1' ELSE '0' END
    FROM unnest(ARRAY[
    'arama_yap','arama_kapat','musteri_ekle','musteri_duzenle','musteri_sil','liste_yonet','liste_sil',
    'excel_yukle','excel_aktar','atama_yap','yasakli_kaldir','ayar_yonet','kullanici_yonet',
    'rol_yonet','firma_profil_duzenle','rapor_gor','dashboard_gor']) AS e
  ON CONFLICT DO NOTHING;

  -- Başlangıç verisi: ayarlar
  INSERT INTO __P__ayarlar (anahtar, deger, aciklama) VALUES
    ('deneme_limiti', '4',  'Bir listede bir müşteri için en çok deneme sayısı'),
    ('cooldown_gun',  '30', 'Deneme limiti dolan kaydın yeniden kuyruğa girmesi için bekleme (gün)'),
    ('kilit_dakika',  '15', 'Bir kaydı açan agent için yumuşak kilit süresi (dakika)')
  ON CONFLICT (anahtar) DO NOTHING;

  -- Başlangıç verisi: seçenekler
  INSERT INTO __P__secenekler (tur, kod, etiket, sira) VALUES
    ('kanal', 'telefon',         'Telefon',          10),
    ('kanal', 'toplanti',        'Toplantı',         20),
    ('kanal', 'online_toplanti', 'Online Toplantı',  30),
    ('kanal', 'linkedin',        'LinkedIn',         40),
    ('kanal', 'mesaj_sms',       'Mesaj / SMS',      50),
    ('kanal', 'eposta',          'E-posta',          60),
    ('gorusme_nedeni', 'randevu_almak',  'Randevu almak',   10),
    ('gorusme_nedeni', 'toplanti_teyidi','Toplantı teyidi', 20),
    ('gorusme_nedeni', 'diger',          'Diğer',           90)
  ON CONFLICT (tur, kod) DO NOTHING;

  -- Başlangıç verisi: görüşme durumları (firma kendi ekranından değiştirir)
  INSERT INTO __P__durumlar (kod, etiket, dal, ust_kod, alt_soru, kutu, sonuc_grubu, bayraklar, sira, sistem) VALUES
    ('telefon_cevap_yok',   'Telefon cevap vermiyor',           'ulasilamadi',  NULL, NULL, 'ulasilamadi', 'ulasilamadi', '{}', 10, true),
    ('asistan_gecilemedi',  'Asistan geçilemedi',               'ulasilamadi',  NULL, NULL, 'ulasilamadi', 'ulasilamadi', '{}', 20, true),
    ('surekli_mesgul',      'Sürekli meşgul',                   'ulasilamadi',  NULL, NULL, 'ulasilamadi', 'ulasilamadi', '{}', 30, true),
    ('numara_yanlis',       'Numara yanlış',                    'ulasilamadi',  NULL, NULL, 'ulasilamadi', 'olumsuz',     '{"telefon_zorunlu": "opsiyonel"}', 40, true),
    ('yetkili_yanlis',      'Yetkili yanlış',                   'muhatap_degil',NULL, NULL, 'tekrar',      'beklemede',   '{"yeni_kontak": true, "tekrar_tarihi": "opsiyonel"}', 50, true),
    ('telefonu_acan_yetkili_degil', 'Telefonu açan yetkili değil', 'muhatap_degil', NULL, 'Karar verici kim?', 'tekrar', 'beklemede', '{"yeni_kontak": true, "tekrar_tarihi": "opsiyonel"}', 60, true),
    ('sonra_aranmak_istiyor','Daha sonra aranmak istiyor',      'uygun_degil',  NULL, NULL, 'tekrar',      'beklemede',   '{"tekrar_tarihi": "zorunlu"}', 70, true),
    ('aranmak_istemiyor',   'Aranmak istemiyor',                'uygun_degil',  NULL, NULL, 'tamam',       'olumsuz',     '{"aranmayacak": "musteri"}', 80, true),
    ('bilgi_verildi',       'Bilgi verildi',                    'bilgi_verildi',NULL, NULL, 'tekrar',      'olumlu',      '{"tekrar_tarihi": "opsiyonel", "satis_bilgisi": true}', 90, true),
    ('bilgi_talep_etti',    'E-posta / sunum istiyor',          'bilgi_verildi',NULL, NULL, 'tekrar',      'olumlu',      '{"gorev_ac": true, "tekrar_tarihi": "opsiyonel", "satis_bilgisi": true}', 100, true),
    ('randevu_alindi',      'Randevu alındı',                   'bilgi_verildi',NULL, NULL, 'tamam',       'olumlu',      '{"randevu": true, "satis_bilgisi": true}', 110, true),
    ('ilgilenmiyor',        'İlgilenmiyor',                     'bilgi_verildi',NULL, NULL, 'tamam',       'olumsuz',     '{"potansiyel_yok": true}', 120, true),
    ('aramasiz_firma_kapandi','Firma kapanmış / faaliyette değil','aramasiz',   NULL, NULL, 'tamam',       'olumsuz',     '{"potansiyel_yok": true}', 130, true),
    ('aramasiz_mukerrer',   'Mükerrer kayıt',                   'aramasiz',     NULL, NULL, 'tamam',       'olumsuz',     '{}', 140, true),
    ('aramasiz_diger',      'Diğer',                            'aramasiz',     NULL, 'Açıklama', 'tamam', 'olumsuz',     '{"metin_zorunlu": true}', 150, true)
  ON CONFLICT (kod) DO NOTHING;

  -- Başlangıç verisi: genel içerik (sektör '*' = tüm sektörler)
  INSERT INTO __P__icerikler (tur, sektor, baslik, metin, sira)
  SELECT 'script', '*', 'Genel açılış',
         'Merhaba, ben [Ad Soyad], [Firma] adına arıyorum. Doğru kişiyle mi görüşüyorum? Kısaca görüşmek için uygun musunuz?', 10
  WHERE NOT EXISTS (SELECT 1 FROM __P__icerikler WHERE tur = 'script' AND sektor = '*');
  $T$;

  v_ddl := replace(replace(v_ddl, '__P__', 'cc.f_' || p_kod || '_'), '__N__', 'f_' || p_kod || '_');
  EXECUTE v_ddl;

  -- Her tablo: RLS açık (politika yok), herkesten yetki alındı
  FOREACH v_ad IN ARRAY v_adlar LOOP
    EXECUTE format('ALTER TABLE cc.%I ENABLE ROW LEVEL SECURITY', 'f_' || p_kod || '_' || v_ad);
    EXECUTE format('REVOKE ALL ON cc.%I FROM PUBLIC', 'f_' || p_kod || '_' || v_ad);
  END LOOP;
END;
$fn$ LANGUAGE plpgsql;

-- ---------- Yeni firma ekleme: kayıt + tablolar tek işlemde ----------
CREATE OR REPLACE FUNCTION cc.firma_kur(p_kod text, p_unvan text) RETURNS uuid AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO cc.firmalar (kod, unvan) VALUES (p_kod, p_unvan) RETURNING id INTO v_id;
  PERFORM cc.firma_tablolarini_kur(p_kod);
  RETURN v_id;
END;
$fn$ LANGUAGE plpgsql;

-- İşlevler yalnız veritabanı sahibi / Worker bağlantısı tarafından çağrılabilir
REVOKE ALL ON FUNCTION cc.arama_degismez()               FROM PUBLIC;
REVOKE ALL ON FUNCTION cc.rol_izin_koruma()              FROM PUBLIC;
REVOKE ALL ON FUNCTION cc.rol_koruma()                   FROM PUBLIC;
REVOKE ALL ON FUNCTION cc.firma_tablolarini_kur(text)    FROM PUBLIC;
REVOKE ALL ON FUNCTION cc.firma_kur(text, text)          FROM PUBLIC;

COMMIT;
