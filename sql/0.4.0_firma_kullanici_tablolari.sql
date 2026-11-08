BEGIN;

CREATE SCHEMA IF NOT EXISTS cc;
REVOKE ALL ON SCHEMA cc FROM PUBLIC;

CREATE OR REPLACE FUNCTION cc.guncelleme_damgasi() RETURNS trigger AS $$
BEGIN
  NEW.guncelleme := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS cc.firmalar (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kod         text NOT NULL,
  unvan       text NOT NULL,
  kisa_ad     text,
  logo        bytea,
  logo_tipi   text,
  adres       text,
  telefon     text,
  eposta      text,
  web         text,
  vergi_no    text,
  durum       text NOT NULL DEFAULT 'aktif',
  olusturma   timestamptz NOT NULL DEFAULT now(),
  guncelleme  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firmalar_kod_uk UNIQUE (kod),
  CONSTRAINT firmalar_kod_chk CHECK (kod ~ '^[a-z0-9]{1,20}$' AND kod <> 'platform'),
  CONSTRAINT firmalar_durum_chk CHECK (durum IN ('aktif','pasif')),
  CONSTRAINT firmalar_logo_boyut_chk CHECK (logo IS NULL OR octet_length(logo) <= 204800),
  CONSTRAINT firmalar_logo_tip_chk CHECK (logo IS NULL OR (logo_tipi IS NOT NULL AND logo_tipi IN ('image/png','image/jpeg')))
);

CREATE TABLE IF NOT EXISTS cc.kullanicilar (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id         uuid REFERENCES cc.firmalar(id),
  kullanici_adi    text NOT NULL,
  ad_soyad         text NOT NULL DEFAULT '',
  sifre_ozeti      text NOT NULL,
  rol_kod          text NOT NULL,
  yonetici_id      uuid,
  eposta           text,
  telefon          text,
  gorev            text,
  notlar           text,
  aktif            boolean NOT NULL DEFAULT true,
  oturum_surumu    integer NOT NULL DEFAULT 1,
  basarisiz_deneme integer NOT NULL DEFAULT 0,
  kilit_bitis      timestamptz,
  son_giris        timestamptz,
  olusturma        timestamptz NOT NULL DEFAULT now(),
  guncelleme       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kullanicilar_id_firma_uk UNIQUE (id, firma_id),
  CONSTRAINT kullanicilar_yonetici_fk FOREIGN KEY (yonetici_id, firma_id)
    REFERENCES cc.kullanicilar (id, firma_id),
  CONSTRAINT kullanicilar_yonetici_chk CHECK (yonetici_id IS NULL OR (yonetici_id <> id AND firma_id IS NOT NULL)),
  CONSTRAINT kullanicilar_ad_chk CHECK (kullanici_adi ~ '^[a-z0-9._@-]{2,60}$'),
  CONSTRAINT kullanicilar_rol_chk CHECK (rol_kod ~ '^[a-z0-9_]{1,30}$'),
  CONSTRAINT kullanicilar_platform_chk CHECK ((firma_id IS NULL) = (rol_kod = 'platform_admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS kullanicilar_firma_ad_uk
  ON cc.kullanicilar (firma_id, kullanici_adi) WHERE firma_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kullanicilar_platform_ad_uk
  ON cc.kullanicilar (kullanici_adi) WHERE firma_id IS NULL;
CREATE INDEX IF NOT EXISTS kullanicilar_yonetici_ix
  ON cc.kullanicilar (yonetici_id) WHERE yonetici_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cc.giris_kayitlari (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firma_kodu    text NOT NULL,
  kullanici_adi text NOT NULL,
  basarili      boolean NOT NULL,
  ip            text,
  zaman         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS giris_kayitlari_kisi_ix
  ON cc.giris_kayitlari (firma_kodu, kullanici_adi, zaman DESC);
CREATE INDEX IF NOT EXISTS giris_kayitlari_zaman_ix
  ON cc.giris_kayitlari (zaman DESC);

DROP TRIGGER IF EXISTS firmalar_guncelleme ON cc.firmalar;
CREATE TRIGGER firmalar_guncelleme BEFORE UPDATE ON cc.firmalar
  FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();

DROP TRIGGER IF EXISTS kullanicilar_guncelleme ON cc.kullanicilar;
CREATE TRIGGER kullanicilar_guncelleme BEFORE UPDATE ON cc.kullanicilar
  FOR EACH ROW EXECUTE FUNCTION cc.guncelleme_damgasi();

ALTER TABLE cc.firmalar         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc.kullanicilar     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc.giris_kayitlari  ENABLE ROW LEVEL SECURITY;

COMMIT;
