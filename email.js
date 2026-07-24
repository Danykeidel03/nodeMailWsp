// email.js
const crypto = require('crypto');
const { simpleParser } = require('mailparser');
const { Resend } = require('resend');
const { clasificarYResponder } = require('./classifier');
const { logRespuesta, logError, logInfo } = require('./logger');
const {
  registrarEmailRecibido,
  registrarEmailAutomatizado,
  registrarEmailEscalado,
  registrarEmailIgnorado,
  registrarDuplicado,
  registrarIntermediario,
  registrarGuardrailActivado,
  registrarError,
  registrarTiempoRespuesta
} = require('./metricas');
const { registrarEscalado } = require('./escalados');
let Imap = require('imap');

let resend = new Resend(process.env.RESEND_API_KEY);

// Permite inyectar un cliente Resend alternativo en tests (no usar en producción)
function _setResendForTesting(mockResend) {
  resend = mockResend;
}
function _resetResend() {
  resend = new Resend(process.env.RESEND_API_KEY);
}

// Permite inyectar un constructor Imap alternativo en tests (no usar en producción).
// require('imap') no puede mockearse con vi.mock — Vitest solo intercepta import/import(),
// no el require() nativo de CommonJS que usa este archivo.
function _setImapForTesting(mockImap) {
  Imap = mockImap;
}
function _resetImap() {
  Imap = require('imap');
}

// Almacenamiento temporal de hilos de conversación
// Clave: email del destinatario + references/in-reply-to
// Valor: array de mensajes [{rol: 'cliente'|'bot', texto: '...', timestamp: ...}]
const hilosConversacion = new Map();

// Control de respuestas recientes para evitar duplicados
// Clave: thread_id
// Valor: { timestamp, hash_contenido }
const respuestasRecientes = new Map();

// Registrar hilos escalados a soporte/SAMU para que el bot no responda
// Clave: thread_id
// Valor: { timestamp, destinatario ('soporte' | 'samu') }
const hilosEscalados = new Map();

// Deduplicación por contenido: evita procesar el mismo email recibido N veces
// Clave: email::asunto_normalizado, Valor: { timestamp }
const contenidoReciente = new Map();

// Deduplicación de incidencias recurrentes (ej: Correos reportando mismo paquete)
// Clave: remitente::asunto_normalizado (sin fecha), Valor: { timestamp }
const incidenciasEscaladas = new Map();

// Deduplicación de mensajes entrantes por contenido (evita doble-fetch IMAP)
// Clave: sha256(from::body[0..200]), Valor: timestamp
const mensajesRecientes = new Map();

// Limpiar hilos antiguos (más de 24 horas)
setInterval(() => {
  const ahora = Date.now();
  const TIEMPO_EXPIRACION = 24 * 60 * 60 * 1000; // 24 horas
  
  for (const [clave, hilo] of hilosConversacion.entries()) {
    const ultimoMensaje = hilo[hilo.length - 1];
    if (ultimoMensaje && (ahora - ultimoMensaje.timestamp > TIEMPO_EXPIRACION)) {
      hilosConversacion.delete(clave);
    }
  }
}, 60 * 60 * 1000); // Revisar cada hora

function obtenerClaveHilo(destinatario, references, inReplyTo, messageId) {
  // Usar references o in-reply-to para identificar el hilo
  const threadId = references || inReplyTo || messageId;
  return `${destinatario}:${threadId}`;
}

// Registrar que un hilo fue escalado a soporte/SAMU (bot no debe responder)
function registrarHiloEscalado(claveHilo, destinatario) {
  hilosEscalados.set(claveHilo, {
    timestamp: Date.now(),
    destinatario // 'soporte' o 'samu'
  });
}

// Verificar si un hilo ya fue escalado a humano
function hiloYaEscalado(claveHilo) {
  return hilosEscalados.has(claveHilo);
}

function agregarMensajeAHilo(clave, rol, texto) {
  if (!hilosConversacion.has(clave)) {
    hilosConversacion.set(clave, []);
  }
  hilosConversacion.get(clave).push({
    rol,
    texto,
    timestamp: Date.now()
  });
  
  // Limitar el historial a los últimos 10 mensajes para no saturar el contexto
  const hilo = hilosConversacion.get(clave);
  if (hilo.length > 10) {
    hilosConversacion.set(clave, hilo.slice(-10));
  }
}

function obtenerHistorialHilo(clave) {
  return hilosConversacion.get(clave) || [];
}

// Detectar si el remitente es un intermediario (no-reply, mailer, etc.)
function esIntermediario(email) {
  const intermediarios = [
    'mailer@shopify.com',
    'no-reply',
    'noreply',
    'notifications@',
    'notification@',
    'automated@',
    'donotreply@',
    'do-not-reply@'
  ];
  
  const emailLower = email.toLowerCase();
  return intermediarios.some(pattern => emailLower.includes(pattern));
}

// Extraer email real del cliente desde el contenido (para correos de Shopify)
function extraerEmailDelContenido(texto) {
  // Buscar patrones específicos de Shopify
  const patronShopify = /Correo\s+electr[óo]nico:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const matchShopify = texto.match(patronShopify);
  if (matchShopify) {
    return matchShopify[1];
  }
  
  // Patrón genérico: buscar "Email:" o "E-mail:" seguido de un email
  const patronGenerico = /(?:Email|E-mail):\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const matchGenerico = texto.match(patronGenerico);
  if (matchGenerico) {
    return matchGenerico[1];
  }
  
  return null;
}

function detectarClienteTienda(texto) {
  if (!texto || typeof texto !== 'string') return false;
  return /tipo\s+de\s+cliente\s*[:=]\s*tienda\s*$/im.test(texto);
}

// Analizar adjuntos del email para informar a la IA
function analizarAdjuntos(parsed) {
  const adjuntos = parsed.attachments || [];
  const tieneAdjuntos = adjuntos.length > 0;
  
  if (!tieneAdjuntos) {
    return { tieneAdjuntos: false, resumen: null };
  }
  
  const imagenes = [];
  const documentos = [];
  const videos = [];
  const otros = [];
  
  adjuntos.forEach(adj => {
    const tipo = adj.contentType || '';
    const nombre = adj.filename || 'sin nombre';
    const tamanio = adj.size ? `${Math.round(adj.size / 1024)}KB` : 'desconocido';
    
    const info = { nombre, tamanio, tipo };
    
    if (tipo.startsWith('image/')) {
      imagenes.push(info);
    } else if (tipo.includes('pdf') || tipo.includes('document') || tipo.includes('word') || tipo.includes('excel') || tipo.includes('spreadsheet')) {
      documentos.push(info);
    } else if (tipo.startsWith('video/')) {
      videos.push(info);
    } else {
      otros.push(info);
    }
  });
  
  // También detectar imágenes inline (pegadas en el cuerpo)
  const imagenesInline = parsed.html ? 
    (parsed.html.match(/<img[^>]+src=["']cid:/gi) || []).length : 0;
  
  let resumen = '📎 ADJUNTOS EN ESTE EMAIL:\n';
  
  if (imagenes.length > 0 || imagenesInline > 0) {
    const totalImagenes = imagenes.length + imagenesInline;
    resumen += `- ${totalImagenes} imagen(es) adjunta(s)`;
    if (imagenes.length > 0) {
      resumen += `: ${imagenes.map(i => i.nombre).join(', ')}`;
    }
    if (imagenesInline > 0) {
      resumen += ` (${imagenesInline} pegada(s) en el email)`;
    }
    resumen += '\n';
  }
  
  if (documentos.length > 0) {
    resumen += `- ${documentos.length} documento(s): ${documentos.map(d => d.nombre).join(', ')}\n`;
  }
  
  if (videos.length > 0) {
    resumen += `- ${videos.length} video(s): ${videos.map(v => v.nombre).join(', ')}\n`;
  }
  
  if (otros.length > 0) {
    resumen += `- ${otros.length} archivo(s) adicional(es): ${otros.map(o => o.nombre).join(', ')}\n`;
  }
  
  resumen += '\n⚠️ IMPORTANTE: El cliente YA HA ENVIADO estos archivos. NO le pidas que envíe fotos o documentos si ya lo ha hecho. Agradece que los haya adjuntado y procesa su solicitud.';
  
  return {
    tieneAdjuntos: true,
    totalAdjuntos: adjuntos.length + imagenesInline,
    imagenes: imagenes.length + imagenesInline,
    documentos: documentos.length,
    videos: videos.length,
    otros: otros.length,
    resumen
  };
}

// Clasificar emails por dominio para filtrar spam/newsletters
function clasificarPorDominio(email, asunto, texto) {
  const emailLower = email.toLowerCase();
  const asuntoLower = (asunto || '').toLowerCase();
  const textoLower = (texto || '').toLowerCase();

  // Dominios de proveedores conocidos — ignorar silenciosamente sin escalar
  const DOMINIOS_PROVEEDORES = ['embaleo.es'];
  if (DOMINIOS_PROVEEDORES.some(d => emailLower.includes(d))) {
    return { tipo: 'IGNORAR', razon: 'proveedor' };
  }

  /**
   * Judge.me review escalation threshold
   * Business rule: reviews with ≤2 stars require human attention (HUMANO).
   * Reviews with ≥3 stars are silently ignored (positive/neutral).
   * Source: SDD change weekly-audit-fixes-may2026 (Bug 6).
   */
  // Escalar reseñas ≤2 estrellas — decisión de negocio 2026-05-25
  if (emailLower.includes('judge.me')) {
    const patronesResenaBaja = [
      // Inglés singular y plural
      '1 star', '1-star', '1 stars', '1-stars',
      '2 star', '2-star', '2 stars', '2-stars',
      // Español
      '1 estrella', '2 estrellas',
      // Numérico fracción
      '1/5', '2/5',
      // Numérico contexto rating
      'rating: 1', 'rating: 2', 'rating:1', 'rating:2',
      'rated 1', 'rated 2',
      '1 out of 5', '2 out of 5',
    ];
    const esResenaBaja = patronesResenaBaja.some(p => textoLower.includes(p));
    if (esResenaBaja) {
      return { tipo: 'HUMANO', razon: 'Reseña ≤2 estrellas de Judge.me — escalada a humano' };
    }
    return { tipo: 'IGNORAR', razon: 'Notificación de Judge.me - no requiere respuesta' };
  }

  // Newsletters / marketing
  const newsletterDomains = [
    'merkandi.es', 'mailchimp.com', 'sendinblue.com', 'newsletter@',
    'shop.tiktok.com',       // TikTok Shop — marketing puro
    'wakeupformacion.es',    // Cursos bonificados — no cliente
    'asesor.wakeupformacion.es',
  ];
  if (newsletterDomains.some(d => emailLower.includes(d))) {
    return { tipo: 'IGNORAR', razon: 'Newsletter/Marketing - no es cliente' };
  }

  // Detección genérica de newsletters promocionales por contenido
  const patronesNewsletter = [
    'unsubscribe', 'darse de baja', 'cancelar suscripci',
    'ver en el navegador', 'view in browser', 'view this email',
    'all rights reserved', 'todos los derechos reservados',
    'ya no deseas recibir', 'haz clic aquí para cancelar',
    'política de privacidad', 'privacy policy',
  ];
  const esNewsletter = patronesNewsletter.some(p => textoLower.includes(p));
  if (esNewsletter) {
    return { tipo: 'IGNORAR', razon: 'Email promocional con footer de newsletter detectado' };
  }
  
  // Notificaciones internas de Frezzyks — incluyendo WP Mail SMTP (Fix 5 — T5.2)
  if (emailLower.includes('frezzyks.com') &&
      (asuntoLower.includes('new subscriber') ||
       asuntoLower.includes('low stock') ||
       asuntoLower.includes('pocas existencias') ||
       asuntoLower.includes('wp mail smtp') ||         // Fix 5
       asuntoLower.includes('email statistics') ||      // Fix 5
       asuntoLower.includes('email log') ||             // Fix 5
       asuntoLower.includes('wordpress'))) {            // Fix 5
    return { tipo: 'IGNORAR', razon: 'Notificación interna - no requiere respuesta' };
  }
  
  // ============= DETECCIÓN DE SPAM / VENTAS NO SOLICITADAS =============
  // Patrones de spam comercial (gente ofreciendo servicios)
  const patronesSpamVentas = [
    // Cold outreach en inglés
    'i\'d like to help you', 'i would like to help you',
    'drive.*sales', 'driving.*sales', 'new sales',
    'handle the marketing', 'marketing services', 'marketing agency',
    'no upfront cost', 'risk-free', 'risk free',
    'only take.*%', 'commission based', 'performance based',
    'prove value first', 'long-term partnership', 'long term partnership',
    'would you be interested', 'are you interested',
    'before i share full details', 'let me know if',
    'i can help you', 'we can help you',
    'grow your business', 'scale your business',
    'increase your revenue', 'boost your sales',
    // SEO / Link building spam
    'seo services', 'link building', 'backlinks',
    'guest post', 'sponsored post',
    // Ofertas genéricas en inglés
    'our agency', 'my agency', 'our team can',
    'free consultation', 'free audit',
    'i noticed your', 'i came across your',
    'how are you doing today', 'hope this email finds you',
    'quick question', 'reaching out because',
    // Cold outreach en español — agencias y servicios no solicitados
    'soy una agencia', 'somos una agencia',
    'agencia asociada de shopify', 'agencia de shopify',
    'analizando el rendimiento de',
    'me gustaría hacerte algunas preguntas',
    'hacerte algunas preguntas sencillas',
    'ideas rápidas que podrían ayudarte',
    'podría ayudarte a mejorar',
    'podría ayudarte a aumentar',
    'me pongo en contacto para ofrecerte',
    'me pongo en contacto para presentarte',
    'nos ponemos en contacto para ofrecerte',
    'hemos analizado tu tienda',
    'encontré tu tienda',
    'encontre tu tienda',
    'vi tu tienda',
    'nuestra agencia', 'mi agencia',
    'servicios de marketing',
    'consultoría gratuita', 'consultoria gratuita',
    'sin coste inicial', 'sin costo inicial',
    'a comisión', 'a comision',
    'te traigo pedidos', 'traerte pedidos', 'conseguirte pedidos',
    'pedidos a comisión', 'pedidos a comision',
    'a cambio de un porcentaje', 'a cambio de una comisión',
    'puedo conseguirte', 'puedo traerte', 'puedo generarte',
    'clientes diarios', 'ventas diarias',
  ];
  
  const esSpamVentas = patronesSpamVentas.some(patron => 
    textoLower.includes(patron) || asuntoLower.includes(patron)
  );
  
  // Porcentajes de comisión típicos de spam de ventas/afiliados
  // Usamos includes() en vez de regex para evitar ReDoS sobre input externo (emails)
  const kwComision = ['sales', 'revenue', 'commission', 'comisión', 'comision', 'pedidos', 'clientes', 'ventas'];
  const verbosAccion = ['logro', 'acumulo', 'traigo', 'consigo', 'genero', 'traerte', 'conseguirte', 'generarte'];
  const mencionaComision = (textoLower.includes('%') && kwComision.some(k => textoLower.includes(k)))
    || textoLower.includes('% de comisi')
    || verbosAccion.some(v => textoLower.includes(v) && textoLower.includes('pedido'))
    || textoLower.includes('pedidos diarios')
    || textoLower.includes('pedidos al día') || textoLower.includes('pedidos al dia')
    || textoLower.includes('pedidos semanales')
    || (textoLower.includes('si logro') && textoLower.includes('pedido'))
    || ['te traigo', 'te consigo', 'te genero'].some(v =>
        textoLower.includes(v) && ['clientes', 'ventas', 'pedidos'].some(k => textoLower.includes(k)));
  
  // Asuntos genéricos típicos de spam
  const asuntosSpam = ['hello', 'hi there', 'quick question', 'partnership', 'opportunity', 'proposal'];
  const asuntoEsSpam = asuntosSpam.some(s => asuntoLower === s || asuntoLower === 're: ' + s);
  
  if (esSpamVentas || mencionaComision || (asuntoEsSpam && textoLower.length > 500)) {
    return { tipo: 'IGNORAR', razon: 'Spam comercial / Oferta de servicios no solicitada' };
  }
  
  return { tipo: 'PROCESAR', razon: 'Email normal de cliente' };
}

// Usar IA para detectar problemas críticos de entrega que requieren soporte humano
async function detectarProblemaEntregaConIA(asunto, texto) {
  try {
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const analisisPrompt = `Analiza el siguiente email. Responde SOPORTE ÚNICAMENTE si el cliente describe explícitamente que su paquete físico fue entregado en una dirección equivocada o en casa de otra persona.

Responde SOPORTE solo si:
- El paquete fue entregado en una dirección incorrecta, diferente o en casa de otra persona
- El paquete fue entregado en un domicilio equivocado
- El paquete fue perdido o robado físicamente

Responde NORMAL en TODOS los demás casos, incluyendo:
- Consultas sobre el estado del pedido o del envío
- Código de descuento o cupón que no funciona
- Preguntas de facturación, pago o factura
- Retrasos normales en la entrega
- Cualquier mención de "pedido" sin un problema de dirección física
- Notificaciones automáticas de Correos sobre paquetes estacionados o pendientes de recogida

Email:
Asunto: ${asunto}
Texto: ${texto}

Responde solo una palabra: SOPORTE o NORMAL`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Eres un analizador de problemas de entrega. Responde con una sola palabra: SOPORTE o NORMAL.' },
        { role: 'user', content: analisisPrompt }
      ],
      temperature: 0.3,
      max_tokens: 10
    });

    const respuesta = completion.choices[0].message.content.trim().toUpperCase();
    
    return {
      tieneProblemaEntrega: respuesta.includes('SOPORTE'),
      razon: 'IA detectó problema crítico de entrega - requiere soporte'
    };
  } catch (error) {
    console.error('Error en detectarProblemaEntregaConIA:', error);
    logError('PROBLEMA_ENTREGA_DETECTOR', error, 'Error analizando problema de entrega con IA');
    // En caso de error, no escalar (mejor errar siendo permisivo)
    return { tieneProblemaEntrega: false, razon: 'Error en análisis' };
  }
}

// Detectar problemas de entrega que requieren intervención humana urgente
function detectarProblemaEntrega(asunto, texto) {
  const asuntoLower = (asunto || '').toLowerCase();
  const textoLower = (texto || '').toLowerCase();
  
  // Patrones de entrega en dirección incorrecta/diferente
  const patronesProblemaEntrega = [
    'entregado en otra dirección',
    'entregado en dirección incorrecta',
    'entregado en dirección diferente',
    'dejado en otra dirección',
    'dejado en dirección equivocada',
    'paquete entregado en dirección equivocada',
    'entregado en direccion erronea',
    'entregado en casa equivocada',
    'entregado en domicilio equivocado',
    'lo entregaron en otra dirección',
    'lo entregaron en dirección incorrecta',
    'fue entregado en otra dirección',
    'fue entregado en dirección erróne',
    'entregado en lugar equivocado',
    'entregado en sitio equivocado'
  ];
  
  // Buscar en asunto y texto
  const tieneProblemaEntrega = patronesProblemaEntrega.some(patron => 
    asuntoLower.includes(patron) || textoLower.includes(patron)
  );
  
  return {
    tieneProblemaEntrega,
    razon: 'Problema de entrega en dirección incorrecta - requiere soporte'
  };
}

// Verificar si ya se respondió recientemente a este hilo
function yaRespondidoRecientemente(threadId, minutos = 30) {
  const respuesta = respuestasRecientes.get(threadId);
  if (!respuesta) return false;
  
  const tiempoTranscurrido = Date.now() - respuesta.timestamp;
  const minutosTranscurridos = tiempoTranscurrido / (1000 * 60);
  
  return minutosTranscurridos < minutos;
}

// Dominios de notificaciones automáticas que deben ignorarse silenciosamente
// (no tienen remitente real recuperable, nunca necesitan escalación humana)
function esNotificacionAutomaticaIgnorable(email) {
  const emailLower = email.toLowerCase();
  const dominios = [
    'facebookmail.com',
    'business.facebook.com',           // Fix 3 — Meta Business (T3.2)
    'business-updates.facebook.com',   // Fix 3 — Meta Business (T3.2)
    'notification@facebook', 'notifications@facebook',
    'mail.instagram.com', 'notify.twitter.com', 'notifications.google.com',
    'accounts.google.com', 'no-reply@linkedin.com',
  ];
  return dominios.some(d => emailLower.includes(d));
}

// Comprueba si ya se procesó un email con este remitente+asunto en la ventana indicada
function yaProcessadoContenido(email, asunto, ventanaMs = 300000) {
  const clave = `${email.toLowerCase()}::${(asunto || '').toLowerCase().trim()}`;
  const registro = contenidoReciente.get(clave);
  if (!registro) return false;
  return (Date.now() - registro.timestamp) < ventanaMs;
}

function registrarContenidoProcesado(email, asunto) {
  const clave = `${email.toLowerCase()}::${(asunto || '').toLowerCase().trim()}`;
  contenidoReciente.set(clave, { timestamp: Date.now() });
  // Limpiar entradas antiguas (> 10 minutos)
  for (const [k, v] of contenidoReciente.entries()) {
    if (Date.now() - v.timestamp > 10 * 60 * 1000) contenidoReciente.delete(k);
  }
}

// Dedup de mensajes entrantes por contenido — evita doble procesamiento de re-entregas IMAP
function hashMensaje(from, body) {
  return crypto.createHash('sha256').update(`${from}::${(body || '').slice(0, 200)}`).digest('hex');
}

function esMensajeDuplicado(from, body) {
  const hash = hashMensaje(from, body);
  if (mensajesRecientes.has(hash)) return true;
  mensajesRecientes.set(hash, Date.now());
  setTimeout(() => mensajesRecientes.delete(hash), 60 * 1000);
  return false;
}

/**
 * Helper para detectar dominios de logística conocidos.
 * Se usa en el dedup simétrico del path classifier SOPORTE (Fix 2 — ADR-4).
 * @param {string|null} email
 * @returns {boolean}
 */
function esDominioLogistica(email) {
  const dominios = ['correos.es', 'correosexpress.com', 'seur.', 'mrw.es', 'nacex.', 'gls-spain'];
  return dominios.some(d => (email || '').toLowerCase().includes(d));
}

/**
 * Genera una clave de deduplicación para incidencias recurrentes.
 *
 * Estrategia 1 (::id::): extrae tracking ID / número de pedido / "Envío NNN" del asunto.
 *   → Mismo incidente = misma clave independientemente de decoración con fechas.
 * Estrategia 2 (::subj::): fallback — asunto normalizado sin fechas ni números sueltos.
 *   → TTL más corto (24h) para evitar sobre-supresión de incidentes distintos.
 *
 * Fix 2 — ADR-2 (lazy TTL) + ADR-3 (ID-extraction key).
 */
function claveIncidencia(remitente, asunto) {
  const r = remitente.toLowerCase().trim();
  const s = (asunto || '').toLowerCase();

  // Estrategia 1: extraer ID de tracking / pedido
  const trackingMatch =
    s.match(/\b([a-z]{2,5}\d{8,}[a-z]*)\b/i) ||       // Correos: PKCZG09800025120147014R
    s.match(/#(\d{4,})/) ||                             // pedido #5070
    s.match(/env[ií]o\s+(\d{6,})/i);                   // "Envío 123456"

  if (trackingMatch) {
    const id = (trackingMatch[1] || trackingMatch[2] || '').toLowerCase();
    return `${r}::id::${id}`;
  }

  // Estrategia 2: asunto normalizado — eliminar RE:/FWD:, fechas, números sueltos
  const subjectNorm = s
    .replace(/^(re:|fwd?:)\s*/gi, '')
    .replace(/\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/g, '')  // fechas dd/mm/yyyy
    .replace(/\b\d+\b/g, '')                              // números sueltos
    .replace(/\s+/g, ' ')
    .trim();

  return `${r}::subj::${subjectNorm}`;
}

/**
 * Lazy-TTL check para dedup de incidencias.
 * TTL: 72h para claves con ID extraído (::id::), 24h para fallback (::subj::).
 * Fix 2 — ADR-2: reemplaza setTimeout con timestamp-on-read.
 */
function yaEscaladaIncidenciaReciente(remitente, asunto) {
  const clave = claveIncidencia(remitente, asunto);
  const registro = incidenciasEscaladas.get(clave);
  if (!registro) return false;

  const TTL = clave.includes('::id::')
    ? 72 * 60 * 60 * 1000   // 72h para incidencias con ID concreto
    : 24 * 60 * 60 * 1000;  // 24h para fallback normalizado

  if (Date.now() - registro.timestamp > TTL) {
    incidenciasEscaladas.delete(clave);
    return false;
  }
  return true;
}

/**
 * Registra una incidencia escalada con timestamp en lugar de setTimeout.
 * El sweep de entradas obsoletas ocurre aquí de forma oportunista.
 * Fix 2 — ADR-2.
 */
function registrarIncidenciaEscalada(remitente, asunto) {
  const clave = claveIncidencia(remitente, asunto);
  incidenciasEscaladas.set(clave, { timestamp: Date.now() });

  // Sweep oportunístico: eliminar entradas más viejas que 72h (TTL máximo)
  const maxTTL = 72 * 60 * 60 * 1000;
  const ahora = Date.now();
  for (const [k, v] of incidenciasEscaladas.entries()) {
    if (ahora - v.timestamp > maxTTL) {
      incidenciasEscaladas.delete(k);
    }
  }
}

// Registrar que se envió una respuesta
function registrarRespuestaEnviada(threadId) {
  respuestasRecientes.set(threadId, {
    timestamp: Date.now()
  });
  
  // Limpiar respuestas antiguas (más de 2 horas)
  for (const [key, value] of respuestasRecientes.entries()) {
    if (Date.now() - value.timestamp > 2 * 60 * 60 * 1000) {
      respuestasRecientes.delete(key);
    }
  }
}

function iniciarEmailListener() {
  // lastSeqNumber persiste a través de reconexiones para no reprocesar emails ya vistos
  let lastSeqNumber = 0;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;

  function conectar() {
    console.log('[IMAP] Intentando conectar...');

    // Se crea un nuevo objeto Imap en cada intento — los objetos IMAP no son reutilizables
    const imap = new Imap({
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASS,
      host: 'frezzyks-com.correoseguro.dinaserver.com',
      port: 993,
      tls: true,
      keepalive: true,
      connTimeout: 10000,
      authTimeout: 5000,
    });

    imap.once('ready', () => {
      console.log('[IMAP] ✅ Conectado al servidor');
      reconnectAttempts = 0;

      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('[IMAP] Error abriendo INBOX:', err.message);
          imap.end();
          return;
        }

        console.log(`[IMAP] INBOX abierta. Total mensajes: ${box.messages.total}`);
        lastSeqNumber = box.messages.total;

        imap.on('mail', (numNewMsgs) => { // NOSONAR — IMAP callback chain requires nesting
          const fetchFrom = lastSeqNumber + 1;
          const fetchTo = lastSeqNumber + numNewMsgs;

          if (fetchFrom > fetchTo) return;

          const fetchRange = `${fetchFrom}:${fetchTo}`;
          lastSeqNumber = fetchTo;

          const fetch = imap.seq.fetch(fetchRange, { bodies: '' });

          fetch.on('message', (msg) => {
            let buffer = '';

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });

              stream.once('end', async () => {
                registrarEmailRecibido();
                const tiempoInicio = Date.now();
                let destinatario = 'Desconocido';

                try {
                  const parsed = await simpleParser(buffer);
                  if (!parsed) return;

                  const texto = parsed.text;
                  destinatario = parsed.from?.value?.[0]?.address;

                  // 🚫 BLOQUEAR LOOP: No procesar emails internos de Frezzyks
                  // Fix 5 (T5.2) — se agregan info@, no-reply@, noreply@, wordpress@ (ADR-7: lista explícita, no dominio-wide)
                  const emailsInternosFrezzyks = [
                    'contacto@frezzyks.com',
                    'soporte@frezzyks.com',
                    'samu@frezzyks.com',
                    'ventas@frezzyks.com',
                    'info@frezzyks.com',           // Fix 5 — WP Mail SMTP + interno
                    'no-reply@frezzyks.com',       // Fix 5 — defensivo
                    'noreply@frezzyks.com',        // Fix 5 — defensivo
                    'wordpress@frezzyks.com',      // Fix 5 — WP Mail SMTP sender
                  ];
                  if (destinatario && emailsInternosFrezzyks.includes(destinatario.toLowerCase())) {
                    logInfo(`🚫 BLOQUEADO: Email interno de ${destinatario} - evitando loop`);
                    registrarEmailIgnorado(`loop ${destinatario}`);
                    return;
                  }

                  const messageId = parsed.messageId;
                  const subjectOriginal = parsed.subject || 'Sin asunto';

                  logInfo(`Persona: ${destinatario} | Asunto: ${subjectOriginal}`);
                  logInfo(`Mensaje recibido:\n${texto}`);
                  const references = parsed.references ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references) : null;
                  const inReplyTo = parsed.inReplyTo;

                  if (!texto || !destinatario) {
                    console.log('Correo incompleto');
                    return;
                  }

                  // ============= VALIDACIÓN 0: DEDUP DE CONTENIDO ENTRANTE (60s) =============
                  // Protege contra doble-fetch IMAP del mismo mensaje. Ventana corta (60s).
                  if (esMensajeDuplicado(destinatario, texto)) {
                    logInfo(`🔁 MENSAJE DUPLICADO IGNORADO: ${destinatario} - mismo contenido en < 60s`);
                    registrarDuplicado();
                    return;
                  }

                  // ============= VALIDACIÓN 1: INTERMEDIARIOS =============
                  if (esIntermediario(destinatario)) {
                    logInfo(`🚫 BLOQUEADO: Email de intermediario ${destinatario} - NO SE RESPONDE`);

                    const replyTo = parsed.replyTo?.value?.[0]?.address;
                    let emailReal = null;

                    if (replyTo && !esIntermediario(replyTo)) {
                      emailReal = replyTo;
                      logInfo(`✅ Encontrado Reply-To real: ${emailReal}`);
                    } else {
                      emailReal = extraerEmailDelContenido(texto);
                      if (emailReal && !esIntermediario(emailReal)) {
                        logInfo(`✅ Email extraído del contenido: ${emailReal}`);
                      }
                    }

                    if (emailReal) {
                      logInfo(`📧 Redirigiendo respuesta al cliente real: ${emailReal}`);
                      destinatario = emailReal;
                    } else if (esNotificacionAutomaticaIgnorable(destinatario)) {
                      logInfo(`🔇 IGNORADO: Notificación automática sin remitente recuperable - ${destinatario}`);
                      registrarEmailIgnorado(`notificación automática ignorable ${destinatario}`);
                      return;
                    } else {
                      const clasificacionIntermediario = clasificarPorDominio(destinatario, subjectOriginal, texto);
                      if (clasificacionIntermediario.tipo === 'IGNORAR') {
                        logInfo(`🔇 IGNORADO en bloque intermediario: ${clasificacionIntermediario.razon} - De: ${destinatario} | Asunto: ${subjectOriginal}`);
                        registrarEmailIgnorado(clasificacionIntermediario.razon);
                        return;
                      }
                      registrarIntermediario();
                      logInfo(`⚠️ No se puede identificar destinatario real - se escala a humano`);
                      await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, []);
                      registrarEscalado({ remitente: destinatario, asunto: subjectOriginal, resumen: texto });
                      return;
                    }
                  }

                  // ============= VALIDACIÓN 1.5: B2B TIENDA (Shopify form) =============
                  if (detectarClienteTienda(texto)) {
                    logInfo(`B2B TIENDA detectado - escalando a ventas@frezzyks.com - De: ${destinatario}`);
                    const claveHiloTemp = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                    const historialTemp = obtenerHistorialHilo(claveHiloTemp);
                    registrarHiloEscalado(claveHiloTemp, 'ventas');
                    registrarEmailEscalado('ventas');
                    await reenviarCorreo('ventas@frezzyks.com', destinatario, texto, subjectOriginal, historialTemp);
                    return;
                  }

                  // ============= VALIDACIÓN 2: CLASIFICACIÓN POR DOMINIO =============
                  const clasificacionDominio = clasificarPorDominio(destinatario, subjectOriginal, texto);
                  if (clasificacionDominio.tipo === 'IGNORAR') {
                    logInfo(`🚫 IGNORADO: ${clasificacionDominio.razon} - De: ${destinatario}`);
                    registrarEmailIgnorado(clasificacionDominio.razon);
                    return;
                  } else if (clasificacionDominio.tipo === 'HUMANO') {
                    logInfo(`👤 ESCALADO: ${clasificacionDominio.razon} - De: ${destinatario}`);
                    const claveHiloTemp = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                    const historialTemp = obtenerHistorialHilo(claveHiloTemp);
                    await escalarASoporte({ claveHilo: claveHiloTemp, destinatario, texto, subjectOriginal, historial: historialTemp });
                    return;
                  }

                  // ============= VALIDACIÓN 2.5: PROBLEMA DE ENTREGA CON IA =============
                  const problemaEntrega = await detectarProblemaEntregaConIA(subjectOriginal, texto);
                  if (problemaEntrega.tieneProblemaEntrega) {
                    // Dedup: no re-escalar la misma incidencia dentro de la ventana de 48h
                    if (yaEscaladaIncidenciaReciente(destinatario, subjectOriginal)) {
                      logInfo(`🔁 INCIDENCIA YA ESCALADA RECIENTEMENTE: ${destinatario} - "${subjectOriginal}" - sin nueva notificación`);
                      return;
                    }
                    registrarIncidenciaEscalada(destinatario, subjectOriginal);

                    logInfo(`🚨 PROBLEMA ENTREGA: ${problemaEntrega.razon} - Escalando a SOPORTE - De: ${destinatario}`);
                    const claveHiloTemp = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                    const historialTemp = obtenerHistorialHilo(claveHiloTemp);
                    await escalarASoporte({ claveHilo: claveHiloTemp, destinatario, texto, subjectOriginal, historial: historialTemp });
                    return;
                  }

                  // ============= VALIDACIÓN 3: DUPLICADOS =============

                  // Dedup por contenido: mismo remitente+asunto en ventana de 5 min
                  // Evita doble procesamiento de formularios Shopify y envíos duplicados del servidor
                  if (yaProcessadoContenido(destinatario, subjectOriginal)) {
                    logInfo(`🚫 CONTENIDO DUPLICADO BLOQUEADO: ${destinatario} - "${subjectOriginal}" ya fue procesado en los últimos 5 min`);
                    registrarDuplicado();
                    return;
                  }

                  const claveHilo = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);

                  if (hiloYaEscalado(claveHilo)) {
                    logInfo(`🔇 HILO ESCALADO: Este email ya fue delegado a soporte/SAMU. No responder. - De: ${destinatario}`);
                    return;
                  }

                  registrarContenidoProcesado(destinatario, subjectOriginal);
                  agregarMensajeAHilo(claveHilo, 'cliente', texto);
                  const historial = obtenerHistorialHilo(claveHilo);

                  // ============= ANÁLISIS DE ADJUNTOS =============
                  const infoAdjuntos = analizarAdjuntos(parsed);
                  if (infoAdjuntos.tieneAdjuntos) {
                    logInfo(`📎 Email con ${infoAdjuntos.totalAdjuntos} adjunto(s): ${infoAdjuntos.imagenes} imagen(es), ${infoAdjuntos.documentos} documento(s)`);
                  }

                  // ============= CLASIFICACIÓN Y RESPUESTA =============
                  const respuesta = await clasificarYResponder(texto, destinatario, subjectOriginal, historial, infoAdjuntos);
                  const respuestaLog = typeof respuesta === 'object' ? JSON.stringify(respuesta) : respuesta;
                  logInfo(`Respuesta del bot: ${respuestaLog}`);

                  // ============= GUARD RAILS: ESTADOS INTERNOS =============
                  const ESTADOS_INTERNOS = ['SOPORTE', 'SAMU', 'NECESITA_PERSONA', 'SIN_RESPUESTA'];

                  if (respuesta === 'SOPORTE') {
                    // Dedup simétrico: no re-escalar incidencia logística activa dentro de 72h (T2.4)
                    if (esDominioLogistica(destinatario) && yaEscaladaIncidenciaReciente(destinatario, subjectOriginal)) {
                      logInfo(`🔁 INCIDENCIA LOGÍSTICA YA ESCALADA (classifier): ${destinatario} - sin nueva notificación`);
                      return;
                    }
                    if (esDominioLogistica(destinatario)) {
                      registrarIncidenciaEscalada(destinatario, subjectOriginal);
                    }
                    const historialCompleto = obtenerHistorialHilo(claveHilo);
                    await escalarASoporte({ claveHilo, destinatario, texto, subjectOriginal, historial: historialCompleto, mensajeLog: `📧 Email derivado a SOPORTE desde ${destinatario}` });
                    return;
                  } else if (respuesta === 'SAMU') {
                    registrarHiloEscalado(claveHilo, 'samu');
                    registrarEmailEscalado('samu');
                    const historialCompleto = obtenerHistorialHilo(claveHilo);
                    await reenviarCorreo('samu@frezzyks.com', destinatario, texto, subjectOriginal, historialCompleto);
                    logInfo(`📧 Email derivado a SAMU desde ${destinatario}`);
                    return;
                  } else if (respuesta === 'NECESITA_PERSONA') {
                    const historialCompleto = obtenerHistorialHilo(claveHilo);
                    await escalarASoporte({ claveHilo, destinatario, texto, subjectOriginal, historial: historialCompleto, mensajeLog: `👤 Email requiere atención humana de ${destinatario}` });
                    return;
                  } else if (respuesta === 'SIN_RESPUESTA') {
                    registrarEmailIgnorado('SIN_RESPUESTA');
                    logInfo(`🔇 Sin respuesta necesaria para ${destinatario}`);
                    return;
                  }

                  // ============= VALIDACIÓN FINAL: SEGURIDAD =============
                  let mensajeAEnviar = null;

                  // @ts-ignore -- checkJs narrowing false positive; respuesta is string | object at runtime
                  if (respuesta && typeof respuesta === 'object' && respuesta.mensaje) {
                    // @ts-ignore -- same narrowing false positive
                    mensajeAEnviar = respuesta.mensaje;
                  } else if (typeof respuesta === 'string') {
                    // @ts-ignore -- checkJs narrowing false positive; respuesta IS string here at runtime
                    if (ESTADOS_INTERNOS.includes(respuesta.trim().toUpperCase())) {
                      registrarGuardrailActivado();
                      logError(destinatario, new Error('Estado interno detectado en string'), `⚠️ CRÍTICO: Intentó enviar estado interno "${respuesta}" al cliente - BLOQUEADO`);
                      const historialCompleto = obtenerHistorialHilo(claveHilo);
                      await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialCompleto);
                      registrarEscalado({ remitente: destinatario, asunto: subjectOriginal, resumen: texto });
                      return;
                    }
                    mensajeAEnviar = respuesta;
                  }

                  if (mensajeAEnviar) {
                    const mensajeUpper = mensajeAEnviar.toUpperCase();
                    const contieneTacoInterno = ESTADOS_INTERNOS.some(estado =>
                      mensajeUpper.includes(estado) ||
                      mensajeUpper.includes('NECESITA_PERSONA') ||
                      mensajeUpper.includes('SIN_RESPUESTA')
                    );

                    if (contieneTacoInterno) {
                      registrarGuardrailActivado();
                      logError(destinatario, new Error('Mensaje con estado interno detectado'), `⚠️ CRÍTICO: Mensaje contiene estados internos - BLOQUEADO - Mensaje: ${mensajeAEnviar}`);
                      const historialCompleto = obtenerHistorialHilo(claveHilo);
                      await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialCompleto);
                      registrarEscalado({ remitente: destinatario, asunto: subjectOriginal, resumen: texto });
                      return;
                    }

                    // ✅ TODO BIEN - Enviar respuesta al cliente
                    // Guard de dedup en el send-path: evita re-enviar reply al mismo hilo en < 30min
                    if (yaRespondidoRecientemente(claveHilo, 30)) {
                      logInfo(`🚫 dedup-reply suppressed: ya se respondió a este hilo en los últimos 30 min - De: ${destinatario}`);
                      registrarDuplicado();
                      return;
                    }

                    agregarMensajeAHilo(claveHilo, 'bot', mensajeAEnviar);
                    registrarRespuestaEnviada(claveHilo);

                    await enviarCorreo(destinatario, mensajeAEnviar, messageId, subjectOriginal);
                    logRespuesta(destinatario, mensajeAEnviar, 'EMAIL');

                    registrarEmailAutomatizado();
                    registrarTiempoRespuesta((Date.now() - tiempoInicio) / 1000);

                    const resumenMensaje = mensajeAEnviar.substring(0, 80).replaceAll('\n', ' ');
                    console.log(`\n📧 Mail recibido: ${destinatario}`);
                    console.log(`✅ Respuesta dada: ${resumenMensaje}...\n`);
                  } else {
                    logInfo(`⚠️ Sin mensaje válido para enviar a ${destinatario}`);
                  }

                } catch (err) {
                  registrarError();
                  console.error('Error parseando mensaje:', err);
                  logError(destinatario || 'Desconocido', err, 'Error procesando email');
                }
              });
            });

            msg.once('attributes', (attrs) => {
              const { uid } = attrs;
              imap.addFlags(uid, '\\Seen', (err) => {
                if (err) console.log('Error marcando mensaje como leído:', err);
              });
            });
          });

          fetch.once('error', (err) => {
            console.error('[IMAP] Error en fetch:', err.message);
            logError('IMAP_FETCH', err, 'Error al descargar emails');
          });

          fetch.once('end', () => {
            // Procesos completados silenciosamente
          });
        });

        imap.on('update', (seqno, info) => { // NOSONAR — IMAP callback chain requires nesting
          // Cambios procesados silenciosamente
        });
      });
    });

    imap.once('error', (err) => {
      console.error('[IMAP] ❌ Error de conexión:', err.message);
      console.error('[IMAP] Detalles:', err);
      logError('IMAP_CONNECTION', err, 'Error de conexión IMAP');
    });

    let desconexionManejada = false;

    // 'end' solo dispara con un FIN limpio del servidor; 'close' es el único evento
    // garantizado en cualquier desconexión (timeout, RST, corte abrupto). Ambos pueden
    // dispararse para el mismo corte, así que el guard evita reconectar dos veces.
    function manejarDesconexion(origen) {
      if (desconexionManejada) return;
      desconexionManejada = true;

      console.log(`[IMAP] 🔌 Conexión cerrada (evento: ${origen})`);
      reconnectAttempts++;
      if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
        console.log(`[IMAP] Reintentando conexión (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) en ${delay}ms...`);
        setTimeout(conectar, delay);
      } else {
        console.error('[IMAP] ❌ Máximo de intentos de reconexión alcanzado. Reiniciando proceso para que Railway lo levante de nuevo.');
        logError('IMAP_RECONNECT', new Error('Max reconnect attempts reached'), 'IMAP listener detenido permanentemente — forzando reinicio del proceso');
        process.exit(1);
      }
    }

    imap.once('end', () => manejarDesconexion('end'));
    imap.once('close', () => manejarDesconexion('close'));

    try {
      imap.connect();
    } catch (err) {
      console.error('[IMAP] Error en connect():', err.message);
      reconnectAttempts++;
      const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
      setTimeout(conectar, delay);
    }
  }

  conectar();
}

/**
 * Envía un email de respuesta al cliente vía Resend.
 *
 * @param {string} destinatario - Email del cliente destinatario.
 * @param {string} texto - Cuerpo en texto plano.
 * @param {string} messageId - Message-ID original para threading (In-Reply-To/References).
 * @param {string} subjectOriginal - Asunto original (se prepende "Re:" si no lo tiene).
 * @returns {Promise<void>}
 * @throws {Error} Si Resend devuelve un error o la conexión falla.
 */
async function enviarCorreo(destinatario, texto, messageId, subjectOriginal) {
  try {
    // Añadir "Re:" sólo si no está ya en el asunto
    let subject = subjectOriginal.startsWith('Re:') ? subjectOriginal : `Re: ${subjectOriginal}`;

    const { data, error } = await resend.emails.send({
      from: 'Soporte Frezzyks <contacto@frezzyks.com>',
      to: [destinatario],
      subject: subject,
      text: texto,
      headers: {
        'In-Reply-To': messageId,
        'References': messageId
      }
    });

    if (error) {
      console.error('Error enviando email con Resend:', error);
      logError(destinatario, error, 'Error enviando email');
      throw error;
    }

    // Email enviado exitosamente
  } catch (err) {
    console.error('Error en enviarCorreo:', err);
    throw err;
  }
}

/**
 * Reenvía un caso escalado al equipo interno (soporte o SAMU). El cliente NO recibe copia.
 *
 * @param {string} destinatarioEquipo - Email del equipo (soporte@... o samu@...).
 * @param {string} remitenteOriginal - Email del cliente original (irá en el asunto).
 * @param {string} textoOriginal - Cuerpo del último mensaje del cliente.
 * @param {string} subjectOriginal - Asunto original del cliente.
 * @param {Array<{rol: 'cliente'|'bot', texto: string, timestamp: number}>} [historialConversacion=[]] - Historial completo del hilo.
 * @returns {Promise<void>}
 * @throws {Error} Si Resend falla.
 */
async function reenviarCorreo(destinatarioEquipo, remitenteOriginal, textoOriginal, subjectOriginal, historialConversacion = []) {
  try {
    // Asunto con formato de reenvío + email del cliente para fácil identificación
    let subject = `[${remitenteOriginal}] ${subjectOriginal}`;
    
    // Determinar el tipo de equipo para personalizar el mensaje
    const esEquipoSamu = destinatarioEquipo.toLowerCase().includes('samu');
    const nombreEquipo = esEquipoSamu ? 'SAMU (Dirección)' : 'Soporte';
    
    // Construir el historial completo para texto plano
    let historialTexto = '';
    if (historialConversacion && historialConversacion.length > 0) {
      historialTexto = '\n\n━━━━━━━━ HISTORIAL DE CONVERSACIÓN ━━━━━━━━\n\n';
      historialConversacion.forEach((msg, index) => {
        const emisor = msg.rol === 'cliente' ? '👤 CLIENTE' : '🤖 BOT';
        const fecha = new Date(msg.timestamp).toLocaleString('es-ES');
        historialTexto += `[${index + 1}] ${emisor} - ${fecha}\n${msg.texto}\n\n`;
      });
      historialTexto += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    }
    
    // Cuerpo INTERNO para el equipo (NO se envía al cliente)
    const cuerpoTextoPlano = `📬 CASO ESCALADO A ${nombreEquipo.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 Cliente: ${remitenteOriginal}
📋 Asunto original: ${subjectOriginal}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 ÚLTIMO MENSAJE DEL CLIENTE:
${textoOriginal}
${historialTexto}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 INSTRUCCIONES:
• El cliente NO ha sido notificado de este escalado
• Para responder: Simplemente responde a este email (Reply)
• Tu respuesta llegará DIRECTAMENTE al cliente (${remitenteOriginal})
• El bot NO intervendrá en tu respuesta
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    // Construir el historial HTML para el email interno
    let historialHTML = '';
    if (historialConversacion && historialConversacion.length > 0) {
      historialHTML = '<div class="history-section"><div class="history-title">📜 Historial de conversación:</div>';
      historialConversacion.forEach((msg, index) => {
        const esCliente = msg.rol === 'cliente';
        const emisor = esCliente ? '👤 Cliente' : '🤖 Bot';
        const fecha = new Date(msg.timestamp).toLocaleString('es-ES');
        const colorBorde = esCliente ? '#2196F3' : '#FF9800';
        const colorFondo = esCliente ? '#E3F2FD' : '#FFF3E0';
        
        historialHTML += `
          <div class="history-item" style="border-left: 4px solid ${colorBorde}; background: ${colorFondo}; padding: 15px; margin-bottom: 12px; border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
              <strong>${emisor}</strong>
              <span style="font-size: 12px; color: #999;">${fecha}</span>
            </div>
            <div style="white-space: pre-wrap;">${msg.texto.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</div>
          </div>
        `;
      });
      historialHTML += '</div>';
    }

    // Cuerpo HTML INTERNO para el equipo
    const cuerpoHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 20px; }
          .container { background: white; padding: 25px; border-radius: 12px; border: 1px solid #e0e0e0; }
          .header { background: ${esEquipoSamu ? '#9C27B0' : '#4CAF50'}; color: white; padding: 15px 20px; border-radius: 8px; margin-bottom: 20px; }
          .header h2 { margin: 0; }
          .info-row { background: #f5f5f5; padding: 12px 15px; border-radius: 6px; margin-bottom: 10px; }
          .info-label { font-weight: 600; color: #666; }
          .message-box { background: #fff3e0; border-left: 4px solid #FF9800; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .instructions { background: #E8F5E9; border: 1px solid #4CAF50; padding: 15px; border-radius: 8px; margin-top: 20px; }
          .instructions h4 { margin: 0 0 10px 0; color: #2E7D32; }
          .instructions ul { margin: 0; padding-left: 20px; }
          .instructions li { margin: 5px 0; }
          .client-email { background: #2196F3; color: white; padding: 3px 10px; border-radius: 4px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>📬 Caso escalado a ${nombreEquipo}</h2>
          </div>
          
          <div class="info-row">
            <span class="info-label">📧 Cliente:</span> <span class="client-email">${remitenteOriginal}</span>
          </div>
          <div class="info-row">
            <span class="info-label">📋 Asunto:</span> ${subjectOriginal}
          </div>
          
          <div class="message-box">
            <div style="font-weight: 600; color: #E65100; margin-bottom: 10px;">📝 Último mensaje del cliente:</div>
            <div style="white-space: pre-wrap;">${textoOriginal.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          </div>
          
          ${historialHTML}
          
          <div class="instructions">
            <h4>💡 Instrucciones</h4>
            <ul>
              <li><strong>El cliente NO ha sido notificado</strong> de este escalado</li>
              <li>Para responder: <strong>Simplemente haz "Responder" a este email</strong></li>
              <li>Tu respuesta llegará <strong>directamente al cliente</strong></li>
              <li>El bot <strong>NO intervendrá</strong> en tu respuesta</li>
            </ul>
          </div>
        </div>
      </body>
      </html>
    `;

    // ENVIAR SOLO AL EQUIPO INTERNO - NO al cliente
    // Reply-To apunta al cliente para que la respuesta le llegue directamente
    const { data, error } = await resend.emails.send({
      from: 'Bot Frezzyks <contacto@frezzyks.com>',
      to: [destinatarioEquipo], // SOLO al equipo interno
      subject: subject,
      text: cuerpoTextoPlano,
      html: cuerpoHTML,
      replyTo: remitenteOriginal // Las respuestas van DIRECTAMENTE al cliente
    });

    if (error) {
      console.error('Error reenviando email con Resend:', error);
      logError(remitenteOriginal, error, 'Error reenviando email');
      throw error;
    }

    console.log(`📧 Caso escalado a ${nombreEquipo} (${destinatarioEquipo}) - Cliente: ${remitenteOriginal} - Reply-To configurado al cliente`);
  } catch (err) {
    console.error('Error en reenviarCorreo:', err);
    throw err;
  }
}

function mostrarUltimoEmail() {
  const imap = new Imap({
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASS,
    host: 'frezzyks-com.correoseguro.dinaserver.com',
    port: 993,
    tls: true
  });

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) throw err;

      imap.search(['ALL'], (err, results) => {
        if (err || !results || results.length === 0) {
          console.log('No hay correos.');
          imap.end();
          return;
        }

        const ultimoId = results[results.length - 1]; // ID del correo más reciente
        const fetch = imap.fetch(ultimoId, { bodies: '' });

        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, (err, parsed) => {
              if (err) {
                console.error('[IMAP] Error parseando último email:', err.message);
                imap.end();
                return;
              }

              console.log('--- Último Email ---');
              console.log('De:', parsed.from.text);
              console.log('Asunto:', parsed.subject);
              console.log('Fecha:', parsed.date);
              console.log('Texto:', parsed.text);
              console.log('--------------------');
            });
          });
        });

        fetch.once('end', () => {
          imap.end();
        });
      });
    });
  });

  imap.once('error', (err) => {
    console.error('Error IMAP:', err);
  });

  imap.once('end', () => {
    console.log('Conexión cerrada.');
  });

  imap.connect();
}

/**
 * Wrapper para los 4 call sites estándar de escalado a soporte.
 * Agrupa registrarHiloEscalado + registrarEmailEscalado + reenviarCorreo + registrarEscalado.
 * NO usar en call sites que ya hacen su propio bookkeeping de hilo (guardrails).
 */
async function escalarASoporte({ claveHilo, destinatario, texto, subjectOriginal, historial, mensajeLog = null }) {
  registrarHiloEscalado(claveHilo, 'soporte');
  registrarEmailEscalado('soporte');
  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historial);
  registrarEscalado({
    remitente: destinatario,
    asunto: subjectOriginal,
    resumen: texto
  });
  if (mensajeLog) logInfo(mensajeLog);
}

/**
 * Envía un recordatorio de 72h a soporte@frezzyks.com para una escalación pendiente.
 * Usada por el cron de escalados.js (inyectada via iniciarCronRecordatorios).
 * @param {{ remitente: string, asunto: string, resumen: string }} entrada
 */
async function enviarRecordatorio(entrada) {
  return reenviarCorreo(
    'soporte@frezzyks.com',
    entrada.remitente,
    entrada.resumen,
    `[RECORDATORIO 72h] ${entrada.asunto}`,
    []
  );
}

module.exports = {
  iniciarEmailListener,
  mostrarUltimoEmail,
  enviarRecordatorio,
  // Exportado para testing — no usar fuera de tests
  yaProcessadoContenido,
  yaRespondidoRecientemente,
  enviarCorreo,
  reenviarCorreo,
  esIntermediario,
  esNotificacionAutomaticaIgnorable,  // Fix 3 — export para tests T3.1
  extraerEmailDelContenido,
  clasificarPorDominio,
  claveIncidencia,
  yaEscaladaIncidenciaReciente,
  registrarIncidenciaEscalada,
  esDominioLogistica,                 // Fix 2 — export para tests T2.3
  hashMensaje,
  esMensajeDuplicado,
  detectarClienteTienda,
  _setResendForTesting,
  _resetResend,
  _setImapForTesting,
  _resetImap
};
