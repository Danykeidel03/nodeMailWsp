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
        const fetchFrom = lastSeqNumber + 1;
        const fetchTo = lastSeqNumber + numNewMsgs;

        if (fetchFrom > fetchTo) {
          return;
        }

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
                // 🚫 BLOQUEAR LOOP: No procesar si el remitente es contacto@frezzyks.com
                if (destinatario && destinatario.toLowerCase() === 'contacto@frezzyks.com') {
                  logInfo('🚫 BLOQUEADO: Email de contacto@frezzyks.com detectado, evitando loop de reenvío.');
                  registrarEmailIgnorado('loop contacto@frezzyks.com');
                  return;
                }
                const messageId = parsed.messageId;
                const subjectOriginal = parsed.subject || 'Sin asunto';

                // Log personalizado: Persona, Asunto, Mensaje recibido
                logInfo(`Persona: ${destinatario} | Asunto: ${subjectOriginal}`);
                logInfo(`Mensaje recibido:\n${texto}`);
                const references = parsed.references ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references) : null;
                const inReplyTo = parsed.inReplyTo;

                if (!texto || !destinatario) {
                  console.log('Correo incompleto');
                  return;
                }


                // ============= VALIDACIÓN 1: INTERMEDIARIOS =============
                // NUNCA responder a intermediarios (mailer@shopify.com, no-reply, etc.)
                if (esIntermediario(destinatario)) {
                  logInfo(`🚫 BLOQUEADO: Email de intermediario ${destinatario} - NO SE RESPONDE`);
                  
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
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, []);
                    return;
                  }
                }

                // ============= VALIDACIÓN 2: CLASIFICACIÓN POR DOMINIO =============
                const clasificacionDominio = clasificarPorDominio(destinatario, subjectOriginal, texto);
                if (clasificacionDominio.tipo === 'IGNORAR') {
                  logInfo(`🚫 IGNORADO: ${clasificacionDominio.razon} - De: ${destinatario}`);
                  return;
                } else if (clasificacionDominio.tipo === 'HUMANO') {
                  logInfo(`👤 ESCALADO: ${clasificacionDominio.razon} - De: ${destinatario}`);
                  const claveHiloTemp = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                  const historialTemp = obtenerHistorialHilo(claveHiloTemp);
                  registrarHiloEscalado(claveHiloTemp, 'soporte');
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialTemp);
                  return;
                }

                // ============= VALIDACIÓN 2.5: PROBLEMA DE ENTREGA CON IA =============
                // Usar IA para detectar si hay problema crítico de entrega (dirección incorrecta, etc)
                const problemaEntrega = await detectarProblemaEntregaConIA(subjectOriginal, texto);
                if (problemaEntrega.tieneProblemaEntrega) {
                  logInfo(`🚨 PROBLEMA ENTREGA: ${problemaEntrega.razon} - Escalando a SOPORTE inmediatamente - De: ${destinatario}`);
                  const claveHiloTemp = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                  const historialTemp = obtenerHistorialHilo(claveHiloTemp);
                  registrarHiloEscalado(claveHiloTemp, 'soporte');
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historialTemp);
                  return;
                }

                // ============= VALIDACIÓN 3: DUPLICADOS =============
                // Identificar el hilo de conversación
                const claveHilo = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                
                // Verificar si este hilo ya fue escalado a soporte/SAMU (bot no debe responder)
                if (hiloYaEscalado(claveHilo)) {
                  logInfo(`🔇 HILO ESCALADO: Este email ya fue delegado a soporte/SAMU. No responder. - De: ${destinatario}`);
                  return;
                }
                
                // Verificar si ya se respondió recientemente
                if (yaRespondidoRecientemente(claveHilo, 30)) {
                  logInfo(`🚫 DUPLICADO BLOQUEADO: Ya se respondió a este hilo en los últimos 30 minutos - De: ${destinatario}`);
                  return;
                }
                
                const historial = obtenerHistorialHilo(claveHilo);
                
                // Agregar el mensaje del cliente al historial
                agregarMensajeAHilo(claveHilo, 'cliente', texto);


                // ============= CLASIFICACIÓN Y RESPUESTA =============
                const respuesta = await clasificarYResponder(texto, destinatario, subjectOriginal, historial);
                logInfo(`Respuesta del bot: ${respuesta}`);

                // ============= GUARD RAILS: ESTADOS INTERNOS =============
                // NUNCA ENVIAR ESTADOS INTERNOS AL CLIENTE
                const ESTADOS_INTERNOS = ['SOPORTE', 'SAMU', 'NECESITA_PERSONA', 'SIN_RESPUESTA'];
                
                if (respuesta === 'SOPORTE') {
                  registrarHiloEscalado(claveHilo, 'soporte');
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historial);
                  logInfo(`📧 Email derivado a SOPORTE desde ${destinatario}`);
                  return;
                } else if (respuesta === 'SAMU') {
                  registrarHiloEscalado(claveHilo, 'samu');
                  await reenviarCorreo('samu@frezzyks.com', destinatario, texto, subjectOriginal, historial);
                  logInfo(`📧 Email derivado a SAMU desde ${destinatario}`);
                  return;
                } else if (respuesta === 'NECESITA_PERSONA') {
                  registrarHiloEscalado(claveHilo, 'soporte');
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historial);
                  logInfo(`👤 Email requiere atención humana de ${destinatario}`);
                  return;
                } else if (respuesta === 'SIN_RESPUESTA') {
                  logInfo(`🔇 Sin respuesta necesaria para ${destinatario}`);
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
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historial);
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
                    await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal, historial);
                    return;
                  }
                  
                  // ✅ TODO BIEN - Enviar respuesta al cliente
                  agregarMensajeAHilo(claveHilo, 'bot', mensajeAEnviar);
                  
                  await enviarCorreo(destinatario, mensajeAEnviar, messageId, subjectOriginal);
                  logRespuesta(destinatario, mensajeAEnviar, 'EMAIL');
                  
                  // Resumen limpio
                  const resumenMensaje = mensajeAEnviar.substring(0, 80).replace(/\n/g, ' ');
                  console.log(`\n📧 Mail recibido: ${destinatario}`);
                  console.log(`✅ Respuesta dada: ${resumenMensaje}...\n`);
                  
                  // 📊 Métricas
                } else {
                  logInfo(`⚠️ Sin mensaje válido para enviar a ${destinatario}`);
                }

              } catch (err) {
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

      // Evento para cambios en el estado de la carpeta
      imap.on('update', (seqno, info) => {
        // Cambios procesados silenciosamente
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

    // Email enviado exitosamente
  } catch (err) {
    console.error('Error en enviarCorreo:', err);
    throw err;
  }
}

async function reenviarCorreo(destinatarioEquipo, remitenteOriginal, textoOriginal, subjectOriginal, historialConversacion = []) {
  try {
    // Asunto con formato de reenvío
    let subject = subjectOriginal.startsWith('Fwd:') ? subjectOriginal : `Fwd: ${subjectOriginal}`;
    
    // Determinar el tipo de equipo para personalizar el mensaje
    const esEquipoSamu = destinatarioEquipo.toLowerCase().includes('samu');
    const nombreEquipo = esEquipoSamu ? 'equipo especializado' : 'equipo de soporte';
    
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
    
    // Cuerpo amable en texto plano (fallback)
    const cuerpoTextoPlano = `Hola,

Hemos recibido tu mensaje:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${textoOriginal}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${historialTexto}
Tu consulta ha sido delegada a nuestro ${nombreEquipo}. Te contestaremos en breve.

Un saludo!!, equipo Frezzyks 🍬`;

    // Construir el historial HTML
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
          <div class="history-item" style="border-left-color: ${colorBorde}; background: ${colorFondo};">
            <div class="history-header">
              <strong>${emisor}</strong>
              <span class="history-date">${fecha}</span>
            </div>
            <div class="history-content">${msg.texto.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          </div>
        `;
      });
      historialHTML += '</div>';
    }

    // Cuerpo HTML bonito y profesional
    const cuerpoHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .header {
            text-align: center;
            padding-bottom: 20px;
            border-bottom: 3px solid #4CAF50;
            margin-bottom: 25px;
          }
          .header h1 {
            margin: 0;
            color: #4CAF50;
            font-size: 24px;
          }
          .greeting {
            font-size: 16px;
            margin-bottom: 20px;
            color: #555;
          }
          .message-box {
            background: #f9f9f9;
            border-left: 4px solid #4CAF50;
            padding: 20px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .message-label {
            font-weight: 600;
            color: #4CAF50;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
          }
          .message-content {
            color: #333;
            font-size: 15px;
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          .info-box {
            background: #E3F2FD;
            border-left: 4px solid #2196F3;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .info-box p {
            margin: 0;
            color: #1976D2;
            font-size: 14px;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            color: #999;
            font-size: 14px;
          }
          .signature {
            margin-top: 25px;
            font-weight: 500;
            color: #555;
          }
          .badge {
            display: inline-block;
            padding: 4px 12px;
            background: #4CAF50;
            color: white;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            margin-left: 10px;
          }
          .history-section {
            margin: 30px 0;
            padding: 20px;
            background: #fafafa;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
          }
          .history-title {
            font-weight: 600;
            color: #666;
            font-size: 16px;
            margin-bottom: 15px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .history-item {
            background: white;
            padding: 15px;
            margin-bottom: 12px;
            border-left: 4px solid;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          }
          .history-item:last-child {
            margin-bottom: 0;
          }
          .history-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid #eee;
          }
          .history-date {
            font-size: 12px;
            color: #999;
          }
          .history-content {
            color: #333;
            font-size: 14px;
            white-space: pre-wrap;
            word-wrap: break-word;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🍬 Frezzyks <span class="badge">Mensaje recibido</span></h1>
          </div>
          
          <div class="greeting">
            <strong>Hola,</strong>
            <p>Hemos recibido tu mensaje correctamente y queremos que sepas que nos ocupamos de él:</p>
          </div>
          
          <div class="message-box">
            <div class="message-label">📨 Tu último mensaje:</div>
            <div class="message-content">${textoOriginal.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          </div>
          
          ${historialHTML}
          
          <div class="info-box">
            <p><strong>✅ Estado:</strong> Tu consulta ha sido delegada a nuestro ${nombreEquipo} para darte la mejor atención posible.</p>
            <p style="margin-top: 8px;"><strong>⏱️ Tiempo de respuesta:</strong> Te contestaremos en breve.</p>
          </div>
          
          <div class="signature">
            Un saludo!!,<br>
            <strong>Equipo Frezzyks 🍬</strong>
          </div>
          
          <div class="footer">
            Este mensaje ha sido generado automáticamente.<br>
            Por favor, no respondas a este email. El equipo te contactará directamente.
          </div>
        </div>
      </body>
      </html>
    `;

    const { data, error } = await resend.emails.send({
      from: 'Soporte Frezzyks <contacto@frezzyks.com>',
      to: [remitenteOriginal], // El cliente recibe el email
      cc: [destinatarioEquipo], // Samu/soporte recibe copia
      subject: subject,
      text: cuerpoTextoPlano,
      html: cuerpoHTML,
      reply_to: destinatarioEquipo // Las respuestas van al equipo que atiende
    });

    if (error) {
      console.error('Error reenviando email con Resend:', error);
      logError(remitenteOriginal, error, 'Error reenviando email');
      throw error;
    }

    console.log('Email enviado a cliente', remitenteOriginal, 'con CC a equipo', destinatarioEquipo);
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
