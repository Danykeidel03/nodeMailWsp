// classifier.js
const { OpenAI } = require('openai');
const { obtenerSeguimientoPorPedido } = require('./shopify');
const { obtenerEstadoEnvio } = require('./seguimiento');
const { logError } = require('./logger');
const { construirPrompt } = require('./src/services/promptLoader');

// Validar que OPENAI_API_KEY esté presente
if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR CRITICO: OPENAI_API_KEY no está configurado');
  console.error('Por favor, configura esta variable de entorno en Railway');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Estados internos que NUNCA deben enviarse al cliente
const ESTADOS_INTERNOS = ['SOPORTE', 'SAMU', 'NECESITA_PERSONA', 'SIN_RESPUESTA'];

/**
 * Detecta si el cliente está frustrado basándose en patrones de texto
 */
function detectarFrustracion(mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  const patronesFrustracion = [
    'ya me dijiste', 'ya me has dicho', 'eso ya lo sé', 'eso ya lo se',
    'no me sirve', 'no me vale', 'no entiendes', 'no me entiendes',
    'otra vez lo mismo', 'siempre lo mismo', 'me repites lo mismo',
    'sigo sin', 'sigo igual', 'no me soluciona', 'no se soluciona',
    'estoy harto', 'estoy harta', 'me estáis tomando el pelo',
    'vaya broma', 'qué desastre', 'vergüenza', 'indignado', 'indignada',
    'quiero hablar con alguien', 'quiero hablar con una persona',
    'pasadme con', 'ponme con', 'un humano', 'persona real',
    'esto es increíble', 'no puede ser', 'inadmisible'
  ];
  
  return patronesFrustracion.some(patron => mensajeLower.includes(patron));
}

/**
 * Detecta si hay un bucle de conversación (bot respondiendo lo mismo)
 */
function detectarBucle(historialConversacion) {
  const respuestasDelBot = historialConversacion.filter(m => m.rol === 'bot').length;
  return respuestasDelBot >= 2 && historialConversacion.length >= 4;
}

/**
 * Extrae número de pedido del mensaje
 */
function extraerNumeroPedido(texto) {
  const regexPedido = /#(\d{4,})|(?:número de )?pedido[:\s#]+(\d{4,})/i;
  const match = texto.match(regexPedido);
  return match ? (match[1] || match[2]) : null;
}

/**
 * Extrae número de seguimiento del mensaje
 */
function extraerNumeroSeguimiento(texto) {
  // Patrón específico con contexto
  let regex = /(?:número de seguimiento|tracking|seguimiento)[:\s#]*(\d{13,})/i;
  let match = texto.match(regex);
  
  if (match) return match[1];
  
  // Patrón genérico: números de 13+ dígitos
  regex = /\b(\d{13,})\b/;
  match = texto.match(regex);
  
  return match ? match[1] : null;
}

/**
 * Obtiene información del pedido desde Shopify y Correos
 */
async function obtenerInfoPedido(numeroPedido, destinatario) {
  try {
    console.log(`[DEBUG] Buscando pedido #${numeroPedido}`);
    
    const infoPedidoShopify = await obtenerSeguimientoPorPedido(numeroPedido);
    console.log(`[DEBUG] Respuesta Shopify:`, JSON.stringify(infoPedidoShopify, null, 2));
    
    if (!infoPedidoShopify.encontrado) {
      return {
        texto: `No se encontró el pedido #${numeroPedido} en nuestro sistema.\n`,
        estadoCompletoDisponible: false
      };
    }
    
    if (!infoPedidoShopify.numeroSeguimiento) {
      return {
        texto: `INFORMACIÓN DEL PEDIDO #${numeroPedido}:
- El pedido está en preparación
- Aún no tiene número de seguimiento asignado
- Recordar al cliente: Los pedidos tardan 3-5 días hábiles en prepararse. Una vez enviado, recibirá el número de seguimiento por email/SMS.
`,
        estadoCompletoDisponible: false
      };
    }
    
    // Tiene número de seguimiento, consultar estado
    const estadoEnvio = await obtenerEstadoEnvio(infoPedidoShopify.numeroSeguimiento);
    
    if (!estadoEnvio.encontrado) {
      return {
        texto: `El pedido #${numeroPedido} tiene número de seguimiento (${infoPedidoShopify.numeroSeguimiento}) pero no se puede consultar su estado en este momento.\n`,
        estadoCompletoDisponible: false
      };
    }
    
    return {
      texto: `INFORMACIÓN DEL PEDIDO #${numeroPedido}:
- Estado del envío: ${estadoEnvio.estado}
- Número de seguimiento: ${estadoEnvio.numeroSeguimiento}
- Destinatario: ${estadoEnvio.destinatario}
- Última actualización: ${estadoEnvio.fecha} a las ${estadoEnvio.hora}
- Enlace de seguimiento: https://s.correosexpress.com/SeguimientoSinCP/search-es?tracking-number=${estadoEnvio.numeroSeguimiento}

IMPORTANTE: Incluir el enlace de seguimiento en la respuesta de forma amigable para que el cliente pueda hacer seguimiento en tiempo real.
`,
      estadoCompletoDisponible: true
    };
    
  } catch (error) {
    console.error(`[ERROR] Error al obtener información del pedido:`, error.message);
    logError(destinatario || 'Desconocido', error, 'Error obteniendo info de pedido Shopify');
    return { texto: '', estadoCompletoDisponible: false };
  }
}

/**
 * Obtiene información de seguimiento directo
 */
async function obtenerInfoSeguimiento(numeroSeguimiento) {
  try {
    const estadoEnvio = await obtenerEstadoEnvio(numeroSeguimiento);
    
    if (!estadoEnvio.encontrado) {
      return '';
    }
    
    return `ESTADO DEL ENVÍO #${numeroSeguimiento}:
- Estado: *${estadoEnvio.estado}*
- Destinatario: ${estadoEnvio.destinatario}
- Última actualización: ${estadoEnvio.fecha} ${estadoEnvio.hora}
- Enlace de seguimiento: https://s.correosexpress.com/SeguimientoSinCP/search-es?tracking-number=${numeroSeguimiento}

IMPORTANTE: Incluir el enlace de seguimiento en la respuesta de forma amigable.
`;
  } catch (error) {
    console.error(`[ERROR] Error obteniendo seguimiento:`, error.message);
    return '';
  }
}

/**
 * Clasifica el mensaje y genera una respuesta
 */
async function clasificarYResponder(mensaje, destinatario, asunto, historialConversacion = [], infoAdjuntos = null) {
  
  // === DETECCIÓN DE FRUSTRACIÓN / BUCLE ===
  if (detectarFrustracion(mensaje)) {
    console.log(`[DEBUG] Cliente frustrado detectado - Escalando a SOPORTE`);
    return 'SOPORTE';
  }
  
  if (detectarBucle(historialConversacion)) {
    console.log(`[DEBUG] Bucle de conversación detectado - Escalando a SOPORTE`);
    return 'SOPORTE';
  }
  
  // === OBTENER INFORMACIÓN DE CONTEXTO ===
  const textoCompleto = `${mensaje} ${asunto || ''}`;
  let infoPedido = '';
  let infoSeguimiento = '';
  let estadoCompletoDisponible = false;
  
  // Buscar número de pedido
  const numeroPedido = extraerNumeroPedido(textoCompleto);
  if (numeroPedido) {
    const resultado = await obtenerInfoPedido(numeroPedido, destinatario);
    infoPedido = resultado.texto;
    estadoCompletoDisponible = resultado.estadoCompletoDisponible;
  }
  
  // Buscar número de seguimiento (solo si no tenemos estado completo del pedido)
  if (!estadoCompletoDisponible) {
    const numeroSeguimiento = extraerNumeroSeguimiento(textoCompleto);
    if (numeroSeguimiento) {
      infoSeguimiento = await obtenerInfoSeguimiento(numeroSeguimiento);
    }
  }
  
  // Filtro especial para "persona"
  if (mensaje.toLowerCase().includes('persona')) return null;
  
  // === CONSTRUIR PROMPT Y LLAMAR A OPENAI ===
  const prompt = construirPrompt({
    historialConversacion,
    infoAdjuntos,
    infoPedido,
    infoSeguimiento
  });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: mensaje }
    ]
  });

  const respuesta = completion.choices[0].message.content.trim();

  // === DETECTAR ESTADOS INTERNOS ===
  if (respuesta.includes('NECESITA_PERSONA')) return 'NECESITA_PERSONA';
  if (respuesta.includes('SIN_RESPUESTA')) return 'SIN_RESPUESTA';
  if (respuesta.includes('SOPORTE')) return 'SOPORTE';
  if (respuesta.includes('SAMU')) return 'SAMU';

  return {
    destinatario,
    mensaje: respuesta
  };
}

module.exports = {
  clasificarYResponder,
  ESTADOS_INTERNOS
};
