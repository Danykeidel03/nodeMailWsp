// whatsapp.js
const axios = require('axios');

function iniciarWhatsapp() {
  console.log('Webhook de WhatsApp listo.');
  // Puedes validar el webhook aquí si lo necesitas.
}

async function enviarMensajeWhatsapp(numero, texto) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: numero,
      text: { body: texto },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

module.exports = {
  iniciarWhatsapp,
  enviarMensajeWhatsapp
};
