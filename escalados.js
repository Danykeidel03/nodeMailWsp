// escalados.js
// Capa de persistencia de escalaciones y cron de recordatorios diarios.
// NO importar de ./email — usar inyección via iniciarCronRecordatorios(enviarFn)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logError, logInfo } = require('./logger');

const PATH_ESCALADOS_DEFAULT = path.join(__dirname, 'escalados.json');
const VENTANA_MS = 72 * 60 * 60 * 1000; // 72 horas en ms

// Permite inyectar una ruta alternativa en tests (no usar en producción)
let _pathOverride = null;
function _setPathForTesting(p) { _pathOverride = p; }
function _resetPath() { _pathOverride = null; }
function _getPath() { return _pathOverride || PATH_ESCALADOS_DEFAULT; }

// Expuesto solo para tests que necesiten comparar el path de producción
const PATH_ESCALADOS = PATH_ESCALADOS_DEFAULT;

/**
 * Lee el archivo escalados.json y devuelve un objeto { [uuid]: entrada }.
 * Si el archivo no existe o está corrupto, devuelve {} y loguea el error.
 */
function leerEscalados() {
  const filePath = _getPath();
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logError('escalados.json', new Error('formato invalido'), 'Fallback a {}');
      return {};
    }
    return parsed;
  } catch (err) {
    logError('escalados.json', err, 'Lectura/parse falló — fallback a {}');
    return {};
  }
}

/**
 * Escribe el objeto de escalaciones en disco (full-overwrite).
 */
function guardarEscalados(obj) {
  fs.writeFileSync(_getPath(), JSON.stringify(obj, null, 2));
}

/**
 * Registra una nueva escalación en escalados.json.
 * @param {{ remitente: string, asunto: string, resumen: string }} param0
 * @returns {string} UUID asignado a la entrada
 */
function registrarEscalado({ remitente, asunto, resumen }) {
  const data = leerEscalados();
  const id = crypto.randomUUID();
  data[id] = {
    remitente,
    asunto,
    resumen: (resumen || '').slice(0, 300),
    escaladoEn: new Date().toISOString()
  };
  guardarEscalados(data);
  logInfo(`Escalado registrado [${id}] de ${remitente}`);
  return id;
}

/**
 * Calcula los ms hasta la próxima medianoche UTC.
 * Si el delta es exactamente 0 (raro), devuelve 86_400_000 para evitar disparo inmediato.
 */
function msHastaMedianoche() {
  const now = new Date();
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  const delta = target.getTime() - now.getTime();
  return delta === 0 ? 24 * 60 * 60 * 1000 : delta;
}

/**
 * Procesa las escalaciones pendientes: envía recordatorio a soporte para las
 * que superaron la ventana de 72h. Borra las entradas enviadas con éxito.
 * Las que fallan se retienen para reintento al día siguiente.
 * @param {Function} enviarFn - función async (entrada) => void inyectada desde email.js
 * @returns {Promise<{ enviados: number, fallidos: number, vivos: number }>}
 */
async function procesarRecordatorios(enviarFn) {
  const data = leerEscalados();
  const ids = Object.keys(data);
  if (ids.length === 0) return { enviados: 0, fallidos: 0, vivos: 0 };

  const ahora = Date.now();
  let enviados = 0, fallidos = 0, vivos = 0;

  for (const id of ids) {
    const entrada = data[id];
    const escaladoEnMs = Date.parse(entrada.escaladoEn);
    if (Number.isNaN(escaladoEnMs) || (ahora - escaladoEnMs) < VENTANA_MS) {
      vivos++;
      continue;
    }
    try {
      await enviarFn(entrada);
      delete data[id];
      enviados++;
    } catch (err) {
      fallidos++;
      logError(entrada.remitente, err, `Falló envío recordatorio [${id}] — se reintentará mañana`);
    }
  }

  guardarEscalados(data);
  logInfo(`Cron recordatorios: ${enviados} enviados, ${fallidos} fallidos, ${vivos} aún <72h`);
  return { enviados, fallidos, vivos };
}

/**
 * Inicia el cron de recordatorios con scheduling recursivo hacia cada 00:00 UTC.
 * Se reprograma automáticamente en el finally (nunca se detiene ante errores).
 * @param {Function} enviarFn - función async (entrada) => void
 */
function iniciarCronRecordatorios(enviarFn) {
  const delay = msHastaMedianoche();
  logInfo(`Cron recordatorios programado en ${Math.round(delay / 60000)} min`);
  setTimeout(async () => {
    try {
      await procesarRecordatorios(enviarFn);
    } catch (err) {
      logError('cron-recordatorios', err, 'Error global del cron');
    } finally {
      iniciarCronRecordatorios(enviarFn);
    }
  }, delay);
}

module.exports = {
  registrarEscalado,
  procesarRecordatorios,
  iniciarCronRecordatorios,
  msHastaMedianoche,      // exportado para tests
  leerEscalados,          // exportado para tests
  guardarEscalados,       // exportado para tests
  PATH_ESCALADOS,
  VENTANA_MS,
  // Testing helpers — no usar en producción
  _setPathForTesting,
  _resetPath
};
