// email.js
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
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
  
  return { tipo: 'PROCESAR', razon: 'Email normal de cliente' };
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
  const imap = new Imap({
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASS,
    host: 'frezzyks-com.correoseguro.dinaserver.com',
    port: 993,
    tls: true,
    keepalive: true,
    connTimeout: 10000, // 10 segundos timeout
    authTimeout: 5000,  // 5 segundos timeout en auth
    tlsOptions: { rejectUnauthorized: false } // Para certificados self-signed
  });

  let lastSeqNumber = 0; // guarda el último número de secuencia procesado
  let isConnected = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 5000; // 5 segundos entre intentos

  function conectar() {
    try {
      console.log('[IMAP] Intentando conectar...');
      imap.connect();
    } catch (err) {
      console.error('[IMAP] Error en connect():', err.message);
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`[IMAP] Reintentando conexión (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) en ${RECONNECT_DELAY}ms...`);
        setTimeout(conectar, RECONNECT_DELAY);
      }
    }
  }

  imap.once('ready', () => {
    console.log('[IMAP] ✅ Conectado al servidor');
    isConnected = true;
    reconnectAttempts = 0;
    
    imap.openBox('INBOX', false, (err, box) => {
      if (err) {
        console.error('[IMAP] Error abriendo INBOX:', err.message);
        imap.end();
        return;
      }

      console.log(`[IMAP] INBOX abierta. Total mensajes: ${box.messages.total}`);
      lastSeqNumber = box.messages.total; // número total mensajes al iniciar

      imap.on('mail', (numNewMsgs) => {
        console.log(`[IMAP] 📧 ${numNewMsgs} nuevo(s) email(s) detectado(s)`);
        
        const fetchFrom = lastSeqNumber + 1;
        const fetchTo = lastSeqNumber + numNewMsgs;

        if (fetchFrom > fetchTo) {
          console.log('[IMAP] Sin mensajes nuevos para procesar');
          return;
        }

        console.log(`[IMAP] Procesando emails ${fetchFrom}:${fetchTo}`);
        const fetchRange = `${fetchFrom}:${fetchTo}`;
        lastSeqNumber = fetchTo; // actualizamos para la próxima vez

        const fetch = imap.seq.fetch(fetchRange, { bodies: '' });

        fetch.on('message', (msg) => {
          let buffer = '';

          msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });

            stream.once('end', async () => {
              const tiempoInicio = Date.now();
              let destinatario = 'Desconocido'; // Variable definida aquí para acceso en catch
              
              try {
                const parsed = await simpleParser(buffer);
                if (!parsed) return;

                const texto = parsed.text;
                destinatario = parsed.from?.value?.[0]?.address;
                const messageId = parsed.messageId;
                const subjectOriginal = parsed.subject || 'Sin asunto';
                const references = parsed.references ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references) : null;
                const inReplyTo = parsed.inReplyTo;

                if (!texto || !destinatario) {
                  console.log('Correo incompleto');
                  return;
                }

                // 📊 Métrica: Email recibido
                registrarEmailRecibido();

                // ============= VALIDACIÓN 1: INTERMEDIARIOS =============
                // NUNCA responder a intermediarios (mailer@shopify.com, no-reply, etc.)
                if (esIntermediario(destinatario)) {
                  logInfo(`🚫 BLOQUEADO: Email de intermediario ${destinatario} - NO SE RESPONDE`);
                  registrarIntermediario(); // 📊 Métrica
                  
                  // Buscar Reply-To o email real en el contenido
                  const replyTo = parsed.replyTo?.value?.[0]?.address;
                  let emailReal = null;
                  
                  if (replyTo && !esIntermediario(replyTo)) {
                    emailReal = replyTo;
                    logInfo(`✅ Encontrado Reply-To real: ${emailReal}`);
                  } else {
                    // Intentar extraer el email del contenido (caso Shopify)
                    emailReal = extraerEmailDelContenido(texto);
                    if (emailReal && !esIntermediario(emailReal)) {
                      logInfo(`✅ Email extraído del contenido: ${emailReal}`);
                    }
                  }
                  
                  if (emailReal) {
                    // Reemplazar destinatario con el email real y continuar el flujo normal
                    logInfo(`📧 Redirigiendo respuesta al cliente real: ${emailReal}`);
                    destinatario = emailReal;
                    // NO hacer return, continuar el flujo para que se procese normalmente
                  } else {
                    logInfo(`⚠️ No se puede identificar destinatario real - se escala a humano`);
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal);
                    registrarEmailEscalado('soporte'); // 📊 Métrica
                    return;
                  }
                }

                // ============= VALIDACIÓN 2: CLASIFICACIÓN POR DOMINIO =============
                const clasificacionDominio = clasificarPorDominio(destinatario, subjectOriginal, texto);
                if (clasificacionDominio.tipo === 'IGNORAR') {
                  logInfo(`🚫 IGNORADO: ${clasificacionDominio.razon} - De: ${destinatario}`);
                  registrarEmailIgnorado(clasificacionDominio.razon); // 📊 Métrica
                  return;
                } else if (clasificacionDominio.tipo === 'HUMANO') {
                  logInfo(`👤 ESCALADO: ${clasificacionDominio.razon} - De: ${destinatario}`);
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal);
                  registrarEmailEscalado('soporte'); // 📊 Métrica
                  return;
                }

                // ============= VALIDACIÓN 3: DUPLICADOS =============
                // Identificar el hilo de conversación
                const claveHilo = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                
                // Verificar si ya se respondió recientemente
                if (yaRespondidoRecientemente(claveHilo, 30)) {
                  logInfo(`🚫 DUPLICADO BLOQUEADO: Ya se respondió a este hilo en los últimos 30 minutos - De: ${destinatario}`);
                  registrarDuplicado(); // 📊 Métrica
                  return;
                }
                
                const historial = obtenerHistorialHilo(claveHilo);
                
                // Agregar el mensaje del cliente al historial
                agregarMensajeAHilo(claveHilo, 'cliente', texto);

                logInfo(`Nuevo email de ${destinatario} - Asunto: ${subjectOriginal} - Hilo: ${historial.length} mensajes previos`);

                // ============= CLASIFICACIÓN Y RESPUESTA =============
                const respuesta = await clasificarYResponder(texto, destinatario, subjectOriginal, historial);
                console.log('[DEBUG] Respuesta del clasificador:', respuesta);

                // ============= GUARD RAILS: ESTADOS INTERNOS =============
                // NUNCA ENVIAR ESTADOS INTERNOS AL CLIENTE
                const ESTADOS_INTERNOS = ['SOPORTE', 'SAMU', 'NECESITA_PERSONA', 'SIN_RESPUESTA'];
                
                if (respuesta === 'SOPORTE') {
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal);
                  logInfo(`📧 Email derivado a SOPORTE desde ${destinatario}`);
                  registrarEmailEscalado('soporte'); // 📊 Métrica
                  return;
                } else if (respuesta === 'SAMU') {
                  await reenviarCorreo('samu@frezzyks.com', destinatario, texto, subjectOriginal);
                  logInfo(`📧 Email derivado a SAMU desde ${destinatario}`);
                  registrarEmailEscalado('samu'); // 📊 Métrica
                  return;
                } else if (respuesta === 'NECESITA_PERSONA') {
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal);
                  logInfo(`👤 Email requiere atención humana de ${destinatario}`);
                  registrarEmailEscalado('soporte'); // 📊 Métrica
                  return;
                } else if (respuesta === 'SIN_RESPUESTA') {
                  logInfo(`🔇 Sin respuesta necesaria para ${destinatario}`);
                  registrarEmailIgnorado('sin respuesta necesaria'); // 📊 Métrica
                  return;
                }

                // ============= VALIDACIÓN FINAL: SEGURIDAD =============
                // Doble verificación: asegurar que NO se envíen estados internos
                let mensajeAEnviar = null;
                
                if (respuesta && typeof respuesta === 'object' && respuesta.mensaje) {
                  mensajeAEnviar = respuesta.mensaje;
                } else if (typeof respuesta === 'string') {
                  // Verificar que no sea un estado interno
                  if (ESTADOS_INTERNOS.includes(respuesta.trim().toUpperCase())) {
                    logError(destinatario, new Error('Estado interno detectado en string'), `⚠️ CRÍTICO: Intentó enviar estado interno "${respuesta}" al cliente - BLOQUEADO`);
                    registrarGuardrailActivado(); // 📊 Métrica
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal);
                    registrarEmailEscalado('soporte'); // 📊 Métrica
                    return;
                  }
                  mensajeAEnviar = respuesta;
                }

                // Verificación adicional de seguridad en el mensaje
                if (mensajeAEnviar) {
                  const mensajeUpper = mensajeAEnviar.toUpperCase();
                  const contieneTacoInterno = ESTADOS_INTERNOS.some(estado => 
                    mensajeUpper.includes(estado) || 
                    mensajeUpper.includes('NECESITA_PERSONA') ||
                    mensajeUpper.includes('SIN_RESPUESTA')
                  );
                  
                  if (contieneTacoInterno) {
                    logError(destinatario, new Error('Mensaje con estado interno detectado'), `⚠️ CRÍTICO: Mensaje contiene estados internos - BLOQUEADO - Mensaje: ${mensajeAEnviar}`);
                    registrarGuardrailActivado(); // 📊 Métrica
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal);
                    registrarEmailEscalado('soporte'); // 📊 Métrica
                    return;
                  }
                  
                  // ✅ TODO BIEN - Enviar respuesta al cliente
                  agregarMensajeAHilo(claveHilo, 'bot', mensajeAEnviar);
                  registrarRespuestaEnviada(claveHilo);
                  
                  await enviarCorreo(destinatario, mensajeAEnviar, messageId, subjectOriginal);
                  logRespuesta(destinatario, mensajeAEnviar, 'EMAIL');
                  logInfo(`✅ Email automático enviado a ${destinatario}`);
                  
                  // 📊 Métricas
                  registrarEmailAutomatizado();
                  const tiempoRespuesta = (Date.now() - tiempoInicio) / 1000;
                  registrarTiempoRespuesta(tiempoRespuesta);
                } else {
                  logInfo(`⚠️ Sin mensaje válido para enviar a ${destinatario}`);
                }

              } catch (err) {
                console.error('Error parseando mensaje:', err);
                logError(destinatario || 'Desconocido', err, 'Error procesando email');
                registrarError(); // 📊 Métrica
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
          console.log('[IMAP] Fetch completado');
        });
      });

      // Evento para cambios en el estado de la carpeta
      imap.on('update', (seqno, info) => {
        console.log(`[IMAP] Update en mensaje ${seqno}:`, info);
      });
    });
  });

  imap.once('error', (err) => {
    console.error('[IMAP] ❌ Error de conexión:', err.message);
    console.error('[IMAP] Detalles:', err);
    isConnected = false;
    logError('IMAP_CONNECTION', err, 'Error de conexión IMAP');
  });

  imap.once('end', () => {
    console.log('[IMAP] 🔌 Conexión cerrada');
    isConnected = false;
    // Intentar reconectar después de 10 segundos
    console.log('[IMAP] Reintentando conexión en 10 segundos...');
    setTimeout(conectar, 10000);
  });

  imap.on('close', () => {
    console.log('[IMAP] Evento close disparado');
    isConnected = false;
  });

  // Iniciar la conexión
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

    console.log('Email enviado correctamente:', data);
  } catch (err) {
    console.error('Error en enviarCorreo:', err);
    throw err;
  }
}

async function reenviarCorreo(destinatarioEquipo, remitenteOriginal, textoOriginal, subjectOriginal) {
  try {
    // Asunto con formato de reenvío
    let subject = subjectOriginal.startsWith('Fwd:') ? subjectOriginal : `Fwd: ${subjectOriginal}`;
    
    // Cuerpo con información del remitente original
    const cuerpoReenvio = `
---------- Mensaje reenviado ----------
De: ${remitenteOriginal}
Asunto: ${subjectOriginal}

${textoOriginal}
`;

    const { data, error } = await resend.emails.send({
      from: 'Soporte Frezzyks <contacto@frezzyks.com>',
      to: [destinatarioEquipo],
      cc: ['contacto@frezzyks.com'], // Añadido en copia para que las respuestas lleguen a ambos
      subject: subject,
      text: cuerpoReenvio,
      reply_to: remitenteOriginal // Para que las respuestas vayan al cliente original
    });

    if (error) {
      console.error('Error reenviando email con Resend:', error);
      logError(destinatarioEquipo, error, 'Error reenviando email');
      throw error;
    }

    console.log('Email reenviado correctamente a', destinatarioEquipo, '(CC: contacto@frezzyks.com) - Cliente original:', remitenteOriginal);
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
              if (err) throw err;

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
