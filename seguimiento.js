// seguimiento.js
const axios = require('axios');

/**
 * Obtiene el estado del envío desde el número de seguimiento
 * @param {string} numeroSeguimiento - Número de seguimiento (ej: "9930002528317467")
 * @returns {Promise<object>} - Objeto con { estado, destinatario, ciudad, fecha, hora, ... }
 */
async function obtenerEstadoEnvio(numeroSeguimiento) {
  try {
    const response = await axios.post(
      'https://www.cexpr.es/wspsc/apiRestSeguimientoEnviosk8s/json/seguimientoEnvio',
      {
        codigoCliente: process.env.CORREOS_CLIENTE,
        dato: numeroSeguimiento,
        idioma: 'ES'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${process.env.CORREOS_AUTH}`
        }
      }
    );

    const data = response.data;

    if (data.error !== 0) {
      console.error(`[ERROR] Correos API Error: ${data.mensajeError}`);
      return { error: data.mensajeError };
    }

    // Retornar información estructurada
    return {
      encontrado: true,
      numeroSeguimiento: data.numEnvio,
      estado: data.descEstado,
      fecha: data.fechaEstado,
      hora: data.horaEstado,
      destinatario: data.nomDest,
      ciudad: data.pobDest,
      referencia: data.ref,
      bultos: data.numBultos ? parseInt(data.numBultos) : 1,
      kilos: data.kilos ? parseFloat(data.kilos) : null,
      ultimos_eventos: data.estadoEnvios 
        ? data.estadoEnvios.slice(-3).map(e => ({
            estado: e.descEstado,
            fecha: e.fechaEstado,
            hora: e.horaEstado,
            ubicacion: e.nombreDelegacion
          }))
        : []
    };

  } catch (error) {
    console.error(`[ERROR] obtenerEstadoEnvio: ${error.message}`);
    return { 
      error: error.message,
      encontrado: false 
    };
  }
}

module.exports = {
  obtenerEstadoEnvio
};
