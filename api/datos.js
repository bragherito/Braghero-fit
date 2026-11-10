// Trae las métricas de Instagram desde Windsor.ai y las cachea en Vercel
// hasta la próxima actualización (10:00 o 20:00, hora Argentina).
const fs = require('fs');
const path = require('path');

const BASE = 'https://connectors.windsor.ai/instagram';
// Windsor puede devolver la cuenta con cualquiera de estos dos IDs
const CUENTAS = ['17841421356337024', '39742069612106685'];
const CONSULTAS = {
  perfil: { fields: 'account_id,username,followers_count,follows_count,media_count' },
  diario: { fields: 'account_id,date,views,views_followers,views_non_followers,accounts_engaged,likes,comments,saves,shares,total_interactions', date_preset: 'last_30dT' },
  // Todas las publicaciones (reels, carruseles e imágenes) con sus métricas.
  // Las de reels (retención, gancho) vienen vacías en carruseles e imágenes, y al revés con visitas y seguidores.
  publicaciones: { fields: 'account_id,media_id,media_type,media_product_type,timestamp,media_caption,media_permalink,media_url,media_thumbnail_url,media_views,media_reach,media_saved,media_shares,media_like_count,media_comments_count,media_engagement,media_follows,media_profile_visits,media_reel_total_interactions,media_reel_avg_watch_time,media_reel_skip_rate', date_preset: 'last_30dT' }
};

async function consultar(apiKey, params) {
  const url = BASE + '?' + new URLSearchParams({ api_key: apiKey, ...params });
  const r = await fetch(url);
  if (!r.ok) throw new Error('Windsor respondió ' + r.status);
  const j = await r.json();
  const filas = Array.isArray(j) ? j : j.data;
  if (!Array.isArray(filas)) throw new Error('Respuesta inesperada de Windsor');
  // Si hay varias cuentas conectadas, quedarse solo con @braghero.fit
  const propias = filas.filter((f) => !f.account_id || CUENTAS.includes(String(f.account_id)));
  return propias.map(({ account_id, ...resto }) => resto);
}

// Segundos hasta la próxima 13:00 o 23:00 UTC (= 10:00 y 20:00 en Argentina)
function segundosHastaProxima() {
  const ahora = new Date();
  const cortes = [13, 23].map((h) => { const d = new Date(ahora); d.setUTCHours(h, 0, 0, 0); return d; });
  cortes.push(new Date(cortes[0].getTime() + 24 * 3600 * 1000));
  const prox = cortes.find((d) => d > ahora);
  return Math.max(60, Math.round((prox - ahora) / 1000));
}

module.exports = async (req, res) => {
  const apiKey = process.env.WINDSOR_API_KEY;
  try {
    if (!apiKey) throw new Error('Falta WINDSOR_API_KEY');
    const [perfil, diario, publicaciones] = await Promise.all([
      consultar(apiKey, CONSULTAS.perfil),
      consultar(apiKey, CONSULTAS.diario),
      consultar(apiKey, CONSULTAS.publicaciones)
    ]);
    // "reels" se mantiene para que versiones viejas de la página sigan funcionando
    const reels = publicaciones.filter((p) => /REEL|VIDEO/.test(String(p.media_type)));
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=' + segundosHastaProxima());
    res.status(200).json({ actualizado: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), perfil, diario, publicaciones, reels });
  } catch (e) {
    // Si Windsor falla, devolver la última copia guardada para que la página no quede vacía
    console.error(e);
    const copia = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'datos.json'), 'utf8'));
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
    res.status(200).json(copia);
  }
};
