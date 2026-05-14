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

  // Agregar secciones dinámicas al prompt
  const seccionesDinamicas = [];
  
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
  listarSecciones
};
