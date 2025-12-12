// logger.js
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'respuestas.log');

/**
 * Formatea la fecha actual
 */
function obtenerFechaHora() {
  const now = new Date();
  const dia = String(now.getDate()).padStart(2, '0');
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  const año = now.getFullYear();
  const hora = String(now.getHours()).padStart(2, '0');
  const minuto = String(now.getMinutes()).padStart(2, '0');
  const segundo = String(now.getSeconds()).padStart(2, '0');
  
  return `${dia}/${mes}/${año} ${hora}:${minuto}:${segundo}`;
}

/**
 * Registra una respuesta enviada
 */
function logRespuesta(destinatario, mensaje, tipo = 'EMAIL') {
  const fechaHora = obtenerFechaHora();
  const mensajeTruncado = mensaje.substring(0, 200).replace(/\n/g, ' ');
  
  const logEntry = `[${fechaHora}] [${tipo}] DESTINATARIO: ${destinatario}\nMENSAJE: ${mensajeTruncado}...\n${'='.repeat(80)}\n`;
  
  fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
  console.log(`[LOG] Respuesta registrada para ${destinatario}`);
}

/**
 * Registra un error
 */
function logError(destinatario, error, contexto = '') {
  const fechaHora = obtenerFechaHora();
  
  const logEntry = `[${fechaHora}] [ERROR] ${contexto}\nDESTINATARIO: ${destinatario}\nERROR: ${error.message}\nSTACK: ${error.stack}\n${'='.repeat(80)}\n`;
  
  fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
  console.error(`[LOG] Error registrado para ${destinatario}: ${error.message}`);
}

/**
 * Registra información general
 */
function logInfo(mensaje) {
  const fechaHora = obtenerFechaHora();
  
  const logEntry = `[${fechaHora}] [INFO] ${mensaje}\n`;
  
  fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
}

module.exports = {
  logRespuesta,
  logError,
  logInfo
};
