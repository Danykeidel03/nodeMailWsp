// index.js
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { iniciarWhatsapp } = require('./whatsapp');
const { iniciarEmailListener, mostrarUltimoEmail } = require('./email');
const { enviarMensajeWhatsapp } = require('./whatsapp');
const { clasificarYResponder } = require('./classifier');
const { logInfo } = require('./logger');

const app = express();
app.use(express.json());

// Variable para almacenar el access token (en producción usa una base de datos)
let shopifyAccessToken = null;

// Ruta de inicio para instalar la app en Shopify
app.get('/shopify/install', (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const scopes = 'read_orders';
  const redirectUri = `${process.env.NGROK_URL}/shopify/callback`;
  const nonce = crypto.randomBytes(16).toString('hex');

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${redirectUri}&state=${nonce}`;

  res.redirect(installUrl);
});

// Callback de OAuth
app.get('/shopify/callback', async (req, res) => {
  const { shop, code } = req.query;

  if (!shop || !code) {
    return res.status(400).send('Missing parameters');
  }

  try {
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;

    // Intercambiar el código por un access token
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
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

app.post('/webhook', async (req, res) => {
  const mensaje = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (mensaje) {
    const texto = mensaje.text?.body;
    //const numero = mensaje.from;
    const respuesta = await clasificarYResponder(texto);
    if (respuesta) {
      //await enviarMensajeWhatsapp(numero, respuesta);
    }
  }
  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log('Servidor iniciado en http://localhost:3000');
  console.log(`\nPara obtener el Access Token de Shopify, visita:`);
  console.log(`${process.env.NGROK_URL}/shopify/install?shop=${process.env.SHOPIFY_SHOP}\n`);
  
  logInfo('========== SERVIDOR INICIADO ==========');
  logInfo('Email listener activado');
  
  //iniciarWhatsapp();
  //mostrarUltimoEmail();
  iniciarEmailListener();
});
