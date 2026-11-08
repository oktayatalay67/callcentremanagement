// =====================================================================
// src/worker.js  -  Cloudflare Workers GIRIS dosyasi (v0.3.0)
// Platforma bagli tek dosya budur. Baska yere tasirken kullanilmaz.
// =====================================================================
import { uygulamaOlustur } from './app.js';
const app = uygulamaOlustur();
export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
};
