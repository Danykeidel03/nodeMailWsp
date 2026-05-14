// logger.js
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const LOG_FILE = path.join(__dirname, 'respuestas.log');
const LOG_WATCHERS = (process.env.LOG_WATCHERS || 'trunkxx777@gmail.com,samu@frezzyks.com')
  .split(',')
  .map((email) => email.trim())
  .filter(Boolean);
const resend = new Resend(process.env.RESEND_API_KEY);
const pendingLogs = [];

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

  agregarLogPendiente(`Respuesta enviada (${tipo})\n${logEntry}`);
}

/**
 * Registra un error
 */
function logError(destinatario, error, contexto = '') {
  const fechaHora = obtenerFechaHora();
  
  const logEntry = `[${fechaHora}] [ERROR] ${contexto}\nDESTINATARIO: ${destinatario}\nERROR: ${error.message}\nSTACK: ${error.stack}\n${'='.repeat(80)}\n`;
  
  fs.appendFileSync(LOG_FILE, logEntry, 'utf8');

  agregarLogPendiente(`Error procesando (${contexto || 'sin contexto'})\n${logEntry}`);
}

/**
 * Registra información general
 */
function logInfo(mensaje) {
  const fechaHora = obtenerFechaHora();
  
  const logEntry = `[${fechaHora}] [INFO] ${mensaje}\n`;
  
  fs.appendFileSync(LOG_FILE, logEntry, 'utf8');

  agregarLogPendiente(`INFO\n${logEntry}`);
}

/**
 * Envía una copia del log por correo a los observadores configurados
 */
async function enviarLogPorCorreo(subject, body) {
  if (!LOG_WATCHERS.length || !process.env.RESEND_API_KEY) return;

  try {
    await resend.emails.send({
      from: 'Logs Frezzyks <contacto@frezzyks.com>',
      to: LOG_WATCHERS,
      subject,
      text: body,
    });
  } catch (err) {
    // Se evita que un fallo en el correo interrumpa el flujo principal
    console.error('[LOG] Error enviando log por correo:', err.message);
  }
}

/**
 * Agrega un log a la cola semanal
 */
function agregarLogPendiente(entry) {
  if (!LOG_WATCHERS.length) return;
  pendingLogs.push(entry);
}

/**
 * Calcula los milisegundos hasta el próximo lunes a las 08:00 (hora local)
 */
function msHastaProximoLunes8() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(8, 0, 0, 0);

  // getDay: 0 domingo, 1 lunes, ...
  let diasHastaLunes = (1 - now.getDay() + 7) % 7;
  if (diasHastaLunes === 0 && now >= target) {
    diasHastaLunes = 7; // si ya pasó el lunes 8:00 de hoy, apuntar al próximo
  }

  target.setDate(now.getDate() + diasHastaLunes);
  return target.getTime() - now.getTime();
}

/**
 * Envía el resumen pendiente y reprograma el siguiente envío semanal
 */
async function enviarResumenSemanal() {
  if (!pendingLogs.length) {
    programarEnvioSemanal();
    return;
  }

  const cuerpo = `Resumen semanal de logs (total: ${pendingLogs.length})\n\n${pendingLogs.join('\n')}`;

  try {
    await enviarLogPorCorreo('Resumen semanal de logs', cuerpo);
    pendingLogs.length = 0;
  } catch (err) {
    console.error('[LOG] Error enviando resumen semanal:', err.message);
  } finally {
    programarEnvioSemanal();
  }
}

/**
 * Programa el envío semanal (lunes 08:00 hora local)
 */
function programarEnvioSemanal() {
  const delay = msHastaProximoLunes8();
  setTimeout(enviarResumenSemanal, delay);
}

// Arranca la programación en cuanto se carga el módulo
if (LOG_WATCHERS.length && process.env.RESEND_API_KEY) {
  programarEnvioSemanal();
}

module.exports = {
  logRespuesta,
  logError,
  logInfo
};
