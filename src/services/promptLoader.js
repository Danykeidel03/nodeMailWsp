// src/services/promptLoader.js
const fs = require('node:fs');
const path = require('node:path');

const PROMPTS_DIR = path.join(__dirname, '../../prompts');
const SECTIONS_DIR = path.join(PROMPTS_DIR, 'sections');

// Cache del prompt compilado
let promptCache = null;
let lastModified = null;

/**
 * Lee todas las secciones y las combina en un solo prompt
 */
function cargarSecciones() {
  const archivos = fs.readdirSync(SECTIONS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort(); // Ordenar por número (01-, 02-, etc.)

  const secciones = archivos.map(archivo => {
    const contenido = fs.readFileSync(path.join(SECTIONS_DIR, archivo), 'utf8');
    return contenido.trim();
  });

  return secciones.join('\n\n---\n\n');
}

/**
 * Obtiene el timestamp más reciente de los archivos de prompt
 */
function obtenerUltimaModificacion() {
  const archivos = fs.readdirSync(SECTIONS_DIR).filter(f => f.endsWith('.md'));
  
  let maxTime = 0;
  for (const archivo of archivos) {
    const stat = fs.statSync(path.join(SECTIONS_DIR, archivo));
    if (stat.mtimeMs > maxTime) {
      maxTime = stat.mtimeMs;
    }
  }
  
  return maxTime;
}

/**
 * Carga el prompt del sistema, usando cache si no hay cambios
 */
function cargarPromptSistema() {
  const ultimaModificacion = obtenerUltimaModificacion();
  
  // Si hay cache y no hubo cambios, usar cache
  if (promptCache && lastModified === ultimaModificacion) {
    return promptCache;
  }

  console.log('[PROMPT] Recargando prompt desde archivos...');
  promptCache = cargarSecciones();
  lastModified = ultimaModificacion;
  
  return promptCache;
}

/**
 * Extrae campos de formulario del texto si matchea patrón Shopify/contacto
 */
function extraerDatosFormulario(texto) {
  if (!texto) return null;
  const campos = {};
  const nombre = texto.match(/nombre\s*[:=]\s*(.+)/i);
  const telefono = texto.match(/(?:tel[eé]fono|phone|tel)\s*[:=]\s*(.+)/i);
  const ciudad = texto.match(/(?:ciudad|city)\s*[:=]\s*(.+)/i);
  const tipo = texto.match(/(?:tipo(?:\s+de\s+negocio)?|type|negocio)\s*[:=]\s*(.+)/i);
  const email = texto.match(/(?:e?-?mail|correo)\s*[:=]\s*(.+)/i);
  const intencion = texto.match(/(?:intenci[oó]n|mensaje|consulta|motivo)\s*[:=]\s*(.+)/i);
  const tipoCliente = texto.match(/tipo\s+de\s+cliente\s*[:=]\s*(.+)/i);
  if (nombre) campos.nombre = nombre[1].trim();
  if (telefono) campos.telefono = telefono[1].trim();
  if (ciudad) campos.ciudad = ciudad[1].trim();
  if (tipo) campos.tipo = tipo[1].trim();
  if (email) campos.email = email[1].trim();
  if (intencion) campos.intencion = intencion[1].trim();
  if (tipoCliente) campos.tipoCliente = tipoCliente[1].trim();
  return Object.keys(campos).length > 0 ? campos : null;
}

/**
 * Construye el prompt completo con variables dinámicas
 */
function construirPrompt(opciones = {}) {
  const {
    historialConversacion = [],
    infoAdjuntos = null,
    infoPedido = '',
    infoSeguimiento = ''
  } = opciones;

  let prompt = cargarPromptSistema();

  // Construir bloque de datos de formulario si el primer mensaje los contiene
  let bloqueFormulario = '';
  const primerMensaje = historialConversacion[0]?.texto;
  const datosFormulario = extraerDatosFormulario(primerMensaje);
  if (datosFormulario) {
    bloqueFormulario = '--- DATOS YA CONOCIDOS DEL FORMULARIO ---\n';
    if (datosFormulario.nombre) bloqueFormulario += `Nombre: ${datosFormulario.nombre}\n`;
    if (datosFormulario.email) bloqueFormulario += `Email: ${datosFormulario.email}\n`;
    if (datosFormulario.telefono) bloqueFormulario += `Teléfono: ${datosFormulario.telefono}\n`;
    if (datosFormulario.ciudad) bloqueFormulario += `Ciudad: ${datosFormulario.ciudad}\n`;
    if (datosFormulario.tipo) bloqueFormulario += `Tipo de negocio: ${datosFormulario.tipo}\n`;
    if (datosFormulario.tipoCliente) bloqueFormulario += `Tipo de cliente: ${datosFormulario.tipoCliente}\n`;
    if (datosFormulario.intencion) bloqueFormulario += `Intención/consulta: ${datosFormulario.intencion}\n`;
    bloqueFormulario += '--- FIN DE DATOS ---\n';
  }

  // Construir contexto de conversación previa
  let contextoConversacion = '';
  if (historialConversacion.length > 0) {
    contextoConversacion = '\n--- HISTORIAL DE LA CONVERSACIÓN ---\n';
    historialConversacion.forEach((msg) => {
      contextoConversacion += `${msg.rol === 'bot' ? 'TÚ (Bot)' : 'Cliente'}: ${msg.texto}\n`;
    });
    contextoConversacion += '--- FIN DEL HISTORIAL ---\n\n';
  }

  // Construir información de adjuntos
  let infoArchivosAdjuntos = '';
  if (infoAdjuntos?.tieneAdjuntos) {
    infoArchivosAdjuntos = infoAdjuntos.resumen;
  }

  // Agregar secciones dinámicas al prompt (bloque de formulario va antes del historial)
  const seccionesDinamicas = [];

  if (bloqueFormulario) {
    seccionesDinamicas.push(bloqueFormulario);
  }

  if (contextoConversacion) {
    seccionesDinamicas.push(contextoConversacion);
  }

  if (infoArchivosAdjuntos) {
    seccionesDinamicas.push(infoArchivosAdjuntos);
  }

  if (infoPedido) {
    seccionesDinamicas.push('INFO PEDIDO PARA EL CLIENTE:\n' + infoPedido);
  }

  if (infoSeguimiento) {
    seccionesDinamicas.push(infoSeguimiento);
  }

  if (seccionesDinamicas.length > 0) {
    prompt += '\n\n---\n\n## Contexto de esta conversación:\n\n' + seccionesDinamicas.join('\n\n');
  }

  return prompt;
}

/**
 * Fuerza la recarga del prompt (útil para desarrollo)
 */
function invalidarCache() {
  promptCache = null;
  lastModified = null;
  console.log('[PROMPT] Cache invalidado');
}

/**
 * Lista las secciones disponibles
 */
function listarSecciones() {
  const archivos = fs.readdirSync(SECTIONS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();
  
  return archivos.map(f => {
    const contenido = fs.readFileSync(path.join(SECTIONS_DIR, f), 'utf8');
    const primeraLinea = contenido.split('\n')[0].replace(/^#\s*/, '');
    return {
      archivo: f,
      titulo: primeraLinea,
      tamaño: contenido.length
    };
  });
}

module.exports = {
  cargarPromptSistema,
  construirPrompt,
  invalidarCache,
  listarSecciones,
  extraerDatosFormulario
};
