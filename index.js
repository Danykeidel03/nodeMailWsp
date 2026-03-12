// index.js
require('dotenv').config();
const express = require('express');
const crypto = require('node:crypto');
const { iniciarEmailListener, mostrarUltimoEmail } = require('./email');
const { clasificarYResponder } = require('./classifier');
const { logInfo } = require('./logger');
const { obtenerMetricas, mostrarMetricas } = require('./metricas');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// Variable para almacenar el access token (en producción usa una base de datos)
let shopifyAccessToken = null;

// Ruta de inicio para instalar la app en Shopify
app.get('/shopify/install', (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  // Validar formato de shop domain
  if (!/^[a-zA-Z0-9\-]+\.myshopify\.com$/.test(shop)) {
    return res.status(400).send('Invalid shop domain');
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const scopes = 'read_orders';
  const redirectUri = `${process.env.NGROK_URL}/shopify/callback`;
  const nonce = crypto.randomBytes(16).toString('hex');

  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.append('client_id', apiKey);
  url.searchParams.append('scope', scopes);
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('state', nonce);

  res.redirect(url.toString());
});

// Callback de OAuth
app.get('/shopify/callback', async (req, res) => {
  const { shop, code } = req.query;

  if (!shop || !code) {
    return res.status(400).send('Missing parameters');
  }

  // Validar formato de shop domain
  if (!/^[a-zA-Z0-9\-]+\.myshopify\.com$/.test(shop)) {
    return res.status(400).send('Invalid shop domain');
  }

  try {
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;

    // Intercambiar el código por un access token
    const url = new URL(`https://${shop}/admin/oauth/access_token`);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        code: code
      })
    });

    const data = await response.json();
    shopifyAccessToken = data.access_token;

    console.log('[SUCCESS] Access Token obtenido:', shopifyAccessToken);
    console.log('Agrega esta línea a tu .env:');
    console.log(`SHOPIFY_ACCESS_TOKEN=${shopifyAccessToken}`);

    res.send(`
      <h1>¡Instalación exitosa!</h1>
      <p>Access Token obtenido. Cópialo y agrégalo a tu archivo .env:</p>
      <pre>SHOPIFY_ACCESS_TOKEN=${shopifyAccessToken}</pre>
    `);

  } catch (error) {
    console.error('[ERROR] Error en OAuth callback:', error);
    res.status(500).send('Error obtaining access token');
  }
});



const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.status(200).send('OK'));

// Endpoint para ver métricas en tiempo real
app.get('/metricas', (req, res) => {
  const metricas = obtenerMetricas();
  
  // Formatear como HTML para mejor visualización
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Métricas del Bot</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="refresh" content="30">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          max-width: 900px;
          margin: 40px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          border-bottom: 3px solid #4CAF50;
          padding-bottom: 10px;
        }
        .metric {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid #eee;
        }
        .metric-label {
          font-weight: 500;
          color: #555;
        }
        .metric-value {
          font-weight: 600;
          color: #333;
        }
        .section {
          margin-top: 30px;
        }
        .section-title {
          font-size: 18px;
          font-weight: 600;
          color: #4CAF50;
          margin-bottom: 15px;
        }
        .success { color: #4CAF50; }
        .warning { color: #FF9800; }
        .danger { color: #F44336; }
        .info { color: #2196F3; }
        .refresh-note {
          text-align: center;
          color: #999;
          font-size: 14px;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📊 Métricas del Bot de Clasificación</h1>
        
        <div class="metric">
          <span class="metric-label">⏱️ Tiempo activo</span>
          <span class="metric-value">${metricas.tiempoActivo}</span>
        </div>
        
        <div class="metric">
          <span class="metric-label">📧 Total emails recibidos</span>
          <span class="metric-value">${metricas.total}</span>
        </div>
        
        <div class="section">
          <div class="section-title">Procesamiento</div>
          <div class="metric">
            <span class="metric-label">✅ Emails automatizados</span>
            <span class="metric-value success">${metricas.automatizados} (${metricas.porcentajeAutomatizacion})</span>
          </div>
          <div class="metric">
            <span class="metric-label">👥 Escalados a soporte</span>
            <span class="metric-value warning">${metricas.escaladosSoporte}</span>
          </div>
          <div class="metric">
            <span class="metric-label">👔 Escalados a Samu</span>
            <span class="metric-value warning">${metricas.escaladosSamu}</span>
          </div>
          <div class="metric">
            <span class="metric-label">🔇 Ignorados (sin respuesta)</span>
            <span class="metric-value">${metricas.ignorados}</span>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">🛡️ Seguridad</div>
          <div class="metric">
            <span class="metric-label">🚫 Duplicados bloqueados</span>
            <span class="metric-value info">${metricas.duplicadosBloqueados}</span>
          </div>
          <div class="metric">
            <span class="metric-label">📮 Intermediarios bloqueados</span>
            <span class="metric-value info">${metricas.intermediariosBloqueados}</span>
          </div>
          <div class="metric">
            <span class="metric-label">📰 Newsletters ignoradas</span>
            <span class="metric-value info">${metricas.newslettersIgnoradas}</span>
          </div>
          <div class="metric">
            <span class="metric-label">🛡️ Guard-rails activados</span>
            <span class="metric-value ${metricas.guardrailsActivados > 0 ? 'danger' : 'success'}">${metricas.guardrailsActivados}</span>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Rendimiento</div>
          <div class="metric">
            <span class="metric-label">⚡ Tiempo promedio de respuesta</span>
            <span class="metric-value">${metricas.tiempoPromedioRespuesta}</span>
          </div>
          <div class="metric">
            <span class="metric-label">⚠️ Errores</span>
            <span class="metric-value ${metricas.errores > 0 ? 'danger' : 'success'}">${metricas.errores}</span>
          </div>
        </div>
        
        <div class="refresh-note">
          🔄 Página se actualiza automáticamente cada 30 segundos<br>
          Última actualización: ${new Date().toLocaleString('es-ES')}
        </div>
      </div>
    </body>
    </html>
  `;
  
  res.send(html);
});

// Endpoint JSON para métricas (para APIs o monitoreo)
app.get('/metricas/json', (req, res) => {
  const metricas = obtenerMetricas();
  res.json(metricas);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
  console.log(`Para obtener el Access Token de Shopify, visita:`);
  console.log(`${process.env.NGROK_URL}/shopify/install?shop=${process.env.SHOPIFY_SHOP}\n`);
  console.log(`📊 Métricas disponibles en: http://localhost:${PORT}/metricas\n`);

  logInfo('========== SERVIDOR INICIADO ==========');
  
  // Mostrar métricas iniciales
  mostrarMetricas();

  // Inicia listeners de manera segura después del deploy
  try {
    iniciarEmailListener();
    console.log('Email listener iniciado correctamente');
  } catch (err) {
    console.error('Error iniciando Email Listener:', err);
  }
});

