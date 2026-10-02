/**
 * Politie API Proxy — Politie Eenheid Noord-Holland
 * Draai met: node server.js
 * Vereist: Node.js 18+
 */

const http = require('http');
const https = require('https');

const PORT = 3737;

// CORS-header voor het dashboard (pas aan naar jouw domein in productie)
const CORS_ORIGIN = '*';

const GEO_PUNTEN = [
  { lat: 52.387, lon: 4.646, label: 'Haarlem' },
  { lat: 52.632, lon: 4.747, label: 'Alkmaar' },
  { lat: 52.952, lon: 4.761, label: 'Den Helder' },
  { lat: 52.703, lon: 5.050, label: 'Hoorn' },
  { lat: 52.456, lon: 5.068, label: 'Purmerend' },
];

const NH_CODE = '/04/';

// Simpele in-memory cache (60 seconden)
let cache = { ts: 0, data: null };
const CACHE_TTL = 60 * 1000;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PolitieNH-Newsroom/1.0',
      },
    };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('JSON parse mislukt: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

function isNH(b) {
  if ((b.url || '').includes(NH_CODE)) return true;
  const gebied = (b.gebied || '').toLowerCase();
  return gebied.includes('noord-holland') || gebied.includes(' nh ');
}

async function haalBerichten() {
  // Cache check
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    return cache.data;
  }

  const urls = [
    'https://api.politie.nl/v4/nieuws?language=nl&maxnumberofitems=25&offset=0',
    'https://api.politie.nl/v4/nieuws?language=nl&maxnumberofitems=25&offset=25',
    ...GEO_PUNTEN.map(p =>
      `https://api.politie.nl/v4/nieuws/lokaal?language=nl&lat=${p.lat}&lon=${p.lon}&radius=25.0&maxnumberofitems=25`
    ),
  ];

  const resultaten = await Promise.allSettled(urls.map(fetchJson));

  const seen = new Set();
  const berichten = [];

  for (const r of resultaten) {
    if (r.status !== 'fulfilled') continue;
    const items = r.value.nieuwsberichten || [];
    for (const b of items) {
      const uid = b.uid || b.canonicalHandleUuid || b.url;
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      if (isNH(b)) berichten.push(b);
    }
  }

  // Sorteer: nieuwste eerst
  berichten.sort((a, b) => {
    const da = new Date(a.publicatieDatum || 0);
    const db = new Date(b.publicatieDatum || 0);
    return db - da;
  });

  const result = {
    aantalBerichten: berichten.length,
    opgehaaldOp: new Date().toISOString(),
    berichten,
  };

  cache = { ts: Date.now(), data: result };
  return result;
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/nieuws') {
    try {
      const data = await haalBerichten();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error('Fout bij ophalen berichten:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ fout: err.message }));
    }
    return;
  }

  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      cacheOud: cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'leeg',
      cacheBerichten: cache.data ? cache.data.aantalBerichten : 0,
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ fout: 'Niet gevonden. Gebruik /nieuws of /status.' }));
});

server.listen(PORT, () => {
  console.log(`✓ Politie NH Proxy draait op http://localhost:${PORT}`);
  console.log(`  → Nieuws:  http://localhost:${PORT}/nieuws`);
  console.log(`  → Status:  http://localhost:${PORT}/status`);
  console.log(`  → Cache TTL: ${CACHE_TTL / 1000}s`);
});
