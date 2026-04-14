// email.js
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
const Imap = require('imap');

const resend = new Resend(process.env.RESEND_API_KEY);

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
  
  // Judge.me - filtrar reseñas 5 estrellas
  if (emailLower.includes('judge.me')) {
    if (textoLower.includes('5 star') || textoLower.includes('⭐⭐⭐⭐⭐')) {
      return { tipo: 'IGNORAR', razon: 'Reseña positiva de Judge.me - no requiere respuesta' };
    }
    // Si es 1-2 estrellas, sí requiere atención
    if (textoLower.includes('1 star') || textoLower.includes('2 star')) {
      return { tipo: 'HUMANO', razon: 'Reseña negativa - requiere atención' };
    }
  }
  
  // Newsletters / marketing
  const newsletterDomains = ['merkandi.es', 'mailchimp.com', 'sendinblue.com', 'newsletter@'];
  if (newsletterDomains.some(d => emailLower.includes(d))) {
    return { tipo: 'IGNORAR', razon: 'Newsletter/Marketing - no es cliente' };
  }
  
  // Notificaciones internas de Frezzyks
  if (emailLower.includes('frezzyks.com') && 
      (asuntoLower.includes('new subscriber') || 
       asuntoLower.includes('low stock') || 
       asuntoLower.includes('pocas existencias'))) {
    return { tipo: 'IGNORAR', razon: 'Notificación interna - no requiere respuesta' };
  }
  
  // ============= DETECCIÓN DE SPAM / VENTAS NO SOLICITADAS =============
  // Patrones de spam comercial (gente ofreciendo servicios)
  const patronesSpamVentas = [
    // Ofertas de servicios de marketing/ventas
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
    // Ofertas genéricas de servicios
    'our agency', 'my agency', 'our team can',
    'free consultation', 'free audit',
    'i noticed your', 'i came across your',
    // Cold outreach típico
    'how are you doing today', 'hope this email finds you',
    'quick question', 'reaching out because'
  ];
  
  const esSpamVentas = patronesSpamVentas.some(patron => 
    textoLower.includes(patron) || asuntoLower.includes(patron)
  );
  
  // Verificar también si menciona porcentajes de comisión (típico de spam de ventas)
  const mencionaComision = /\d+%.*(?:sales|revenue|commission|comisión)/i.test(texto);
  
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

    const analisisPrompt = `Analiza el siguiente email y determina si el cliente está reportando un problema crítico de entrega:
1. Paquete entregado en dirección incorrecta/diferente
2. Paquete entregado en domicilio equivocado
3. Problema de dirección que requiere intervención humana

Email:
Asunto: ${asunto}
Texto: ${texto}

Responde SOLO con una palabra:
- "SOPORTE" si hay un problema crítico de entrega/dirección que requiere humano
- "NORMAL" si es solo una consulta normal de estado o no hay problema de dirección

NO añadas explicación, solo la palabra.`;

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

        imap.on('mail', (numNewMsgs) => {
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
                  const emailsInternosFrezzyks = ['contacto@frezzyks.com', 'soporte@frezzyks.com', 'samu@frezzyks.com'];
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
                    } else {
                      registrarIntermediario();
                      logInfo(`⚠️ No se puede identificar destinatario real - se escala a humano`);
                      await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, []);
                      return;
                    }
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
                    registrarHiloEscalado(claveHiloTemp, 'soporte');
                    registrarEmailEscalado('soporte');
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialTemp);
                    return;
                  }

                  // ============= VALIDACIÓN 2.5: PROBLEMA DE ENTREGA CON IA =============
                  const problemaEntrega = await detectarProblemaEntregaConIA(subjectOriginal, texto);
                  if (problemaEntrega.tieneProblemaEntrega) {
                    logInfo(`🚨 PROBLEMA ENTREGA: ${problemaEntrega.razon} - Escalando a SOPORTE - De: ${destinatario}`);
                    const claveHiloTemp = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                    const historialTemp = obtenerHistorialHilo(claveHiloTemp);
                    registrarHiloEscalado(claveHiloTemp, 'soporte');
                    registrarEmailEscalado('soporte');
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialTemp);
                    return;
                  }

                  // ============= VALIDACIÓN 3: DUPLICADOS =============
                  const claveHilo = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);

                  if (hiloYaEscalado(claveHilo)) {
                    logInfo(`🔇 HILO ESCALADO: Este email ya fue delegado a soporte/SAMU. No responder. - De: ${destinatario}`);
                    return;
                  }

                  if (yaRespondidoRecientemente(claveHilo, 30)) {
                    logInfo(`🚫 DUPLICADO BLOQUEADO: Ya se respondió a este hilo en los últimos 30 minutos - De: ${destinatario}`);
                    registrarDuplicado();
                    return;
                  }

                  agregarMensajeAHilo(claveHilo, 'cliente', texto);
                  const historial = obtenerHistorialHilo(claveHilo);

                  // ============= ANÁLISIS DE ADJUNTOS =============
                  const infoAdjuntos = analizarAdjuntos(parsed);
                  if (infoAdjuntos.tieneAdjuntos) {
                    logInfo(`📎 Email con ${infoAdjuntos.totalAdjuntos} adjunto(s): ${infoAdjuntos.imagenes} imagen(es), ${infoAdjuntos.documentos} documento(s)`);
                  }

                  // ============= CLASIFICACIÓN Y RESPUESTA =============
                  const respuesta = await clasificarYResponder(texto, destinatario, subjectOriginal, historial, infoAdjuntos);
                  logInfo(`Respuesta del bot: ${respuesta}`);

                  // ============= GUARD RAILS: ESTADOS INTERNOS =============
                  const ESTADOS_INTERNOS = ['SOPORTE', 'SAMU', 'NECESITA_PERSONA', 'SIN_RESPUESTA'];

                  if (respuesta === 'SOPORTE') {
                    registrarHiloEscalado(claveHilo, 'soporte');
                    registrarEmailEscalado('soporte');
                    const historialCompleto = obtenerHistorialHilo(claveHilo);
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialCompleto);
                    logInfo(`📧 Email derivado a SOPORTE desde ${destinatario}`);
                    return;
                  } else if (respuesta === 'SAMU') {
                    registrarHiloEscalado(claveHilo, 'samu');
                    registrarEmailEscalado('samu');
                    const historialCompleto = obtenerHistorialHilo(claveHilo);
                    await reenviarCorreo('samu@frezzyks.com', destinatario, texto, subjectOriginal, historialCompleto);
                    logInfo(`📧 Email derivado a SAMU desde ${destinatario}`);
                    return;
                  } else if (respuesta === 'NECESITA_PERSONA') {
                    registrarHiloEscalado(claveHilo, 'soporte');
                    registrarEmailEscalado('soporte');
                    const historialCompleto = obtenerHistorialHilo(claveHilo);
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialCompleto);
                    logInfo(`👤 Email requiere atención humana de ${destinatario}`);
                    return;
                  } else if (respuesta === 'SIN_RESPUESTA') {
                    registrarEmailIgnorado('SIN_RESPUESTA');
                    logInfo(`🔇 Sin respuesta necesaria para ${destinatario}`);
                    return;
                  }

                  // ============= VALIDACIÓN FINAL: SEGURIDAD =============
                  let mensajeAEnviar = null;

                  if (respuesta && typeof respuesta === 'object' && respuesta.mensaje) {
                    mensajeAEnviar = respuesta.mensaje;
                  } else if (typeof respuesta === 'string') {
                    if (ESTADOS_INTERNOS.includes(respuesta.trim().toUpperCase())) {
                      registrarGuardrailActivado();
                      logError(destinatario, new Error('Estado interno detectado en string'), `⚠️ CRÍTICO: Intentó enviar estado interno "${respuesta}" al cliente - BLOQUEADO`);
                      const historialCompleto = obtenerHistorialHilo(claveHilo);
                      await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialCompleto);
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
                      return;
                    }

                    // ✅ TODO BIEN - Enviar respuesta al cliente
                    agregarMensajeAHilo(claveHilo, 'bot', mensajeAEnviar);
                    registrarRespuestaEnviada(claveHilo);

                    await enviarCorreo(destinatario, mensajeAEnviar, messageId, subjectOriginal);
                    logRespuesta(destinatario, mensajeAEnviar, 'EMAIL');

                    registrarEmailAutomatizado();
                    registrarTiempoRespuesta((Date.now() - tiempoInicio) / 1000);

                    const resumenMensaje = mensajeAEnviar.substring(0, 80).replace(/\n/g, ' ');
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

        imap.on('update', (seqno, info) => {
          // Cambios procesados silenciosamente
        });
      });
    });

    imap.once('error', (err) => {
      console.error('[IMAP] ❌ Error de conexión:', err.message);
      console.error('[IMAP] Detalles:', err);
      logError('IMAP_CONNECTION', err, 'Error de conexión IMAP');
    });

    imap.once('end', () => {
      console.log('[IMAP] 🔌 Conexión cerrada');
      reconnectAttempts++;
      if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
        console.log(`[IMAP] Reintentando conexión (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) en ${delay}ms...`);
        setTimeout(conectar, delay);
      } else {
        console.error('[IMAP] ❌ Máximo de intentos de reconexión alcanzado. El listener IMAP se ha detenido.');
        logError('IMAP_RECONNECT', new Error('Max reconnect attempts reached'), 'IMAP listener detenido permanentemente');
      }
    });

    imap.on('close', () => {
      console.log('[IMAP] Evento close disparado');
    });

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
            <div style="white-space: pre-wrap;">${msg.texto.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
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
      reply_to: remitenteOriginal // Las respuestas van DIRECTAMENTE al cliente
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

module.exports = {
  iniciarEmailListener,
  mostrarUltimoEmail
};
