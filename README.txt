cc-platform v0.5.0 - Adim 5: firma yonetici ekrani (profil+logo, kullanicilar, roller/izinler, sifre)

CALISMA AKISI
  1) Kod 'test' dalina gonderilir (git).
  2) TEST ortamina yayinlanir:   npx wrangler deploy --env test
  3) Test basariliysa 'test' dali 'main'e birlestirilir.
  4) CANLI ortama yayinlanir:    npx wrangler deploy

GIZLI DEGISKENLER (her ortam icin ayri; test icin sonuna  --env test  eklenir)
  npx wrangler secret put DATABASE_URL --env test
  npx wrangler secret put OTURUM_ANAHTARI --env test    (en az 32 karakter, rastgele)
  npx wrangler secret put KURULUM_ANAHTARI --env test   (en az 20 karakter, rastgele)
  SIFRE_TEKRAR (istege bagli): sifre ozeti tekrar sayisi, varsayilan 100000

RASTGELE ANAHTAR URETMEK (Node kuruluysa):
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

SAYFALAR:   /          giris
            /kurulum   platform yoneticisi + firma + firma yoneticisi olusturma
            /saglik    baglanti testi (yalniz platform yoneticisi)

BASKA SUNUCUYA TASIMA:
  DATABASE_URL=... OTURUM_ANAHTARI=... KURULUM_ANAHTARI=... node src/node.js
Platforma bagli tek dosya: src/worker.js (+ wrangler.toml).

ISTEMCI KODU (arayuz)
  Kaynak: src/istemci/*.js  ->  uretilen: src/istemci.gen.js  (elle degistirme)
  Arayuzde degisiklik yapildiktan sonra:  npm run istemci
