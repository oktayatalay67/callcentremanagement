// =====================================================================
// src/node.js  -  Node.js GIRIS dosyasi (v0.4.0)
// Kendi sunucunda / Docker'da calistirmak icin:
//   DATABASE_URL=... OTURUM_ANAHTARI=... KURULUM_ANAHTARI=... node src/node.js
// =====================================================================
import { serve } from '@hono/node-server';
import { uygulamaOlustur } from './app.js';
const app = uygulamaOlustur();
const port = Number(process.env.PORT || 8787);
const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  OTURUM_ANAHTARI: process.env.OTURUM_ANAHTARI,
  KURULUM_ANAHTARI: process.env.KURULUM_ANAHTARI,
  SIFRE_TEKRAR: process.env.SIFRE_TEKRAR,
};
serve({ fetch: (req) => app.fetch(req, env), port });
console.log('cc-platform dinliyor: http://localhost:' + port);
