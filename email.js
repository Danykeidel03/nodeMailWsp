// email.js
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { clasificarYResponder } = require('./classifier');
const { logRespuesta, logError, logInfo } = require('./logger');
const Imap = require('imap');

const resend = new Resend(process.env.RESEND_API_KEY);

// Almacenamiento temporal de hilos de conversación
// Clave: email del destinatario + references/in-reply-to
// Valor: array de mensajes [{rol: 'cliente'|'bot', texto: '...', timestamp: ...}]
const hilosConversacion = new Map();

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

function iniciarEmailListener() {
  const imap = new Imap({
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASS,
    host: 'frezzyks-com.correoseguro.dinaserver.com',
    port: 993,
    tls: true
  });

  let lastSeqNumber = 0; // guarda el último número de secuencia procesado

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) throw err;

      lastSeqNumber = box.messages.total; // número total mensajes al iniciar

      imap.on('mail', (numNewMsgs) => {
        const fetchFrom = lastSeqNumber + 1;
        const fetchTo = lastSeqNumber + numNewMsgs;

        if (fetchFrom > fetchTo) {
          // No hay mensajes nuevos
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
              try {
                const parsed = await simpleParser(buffer);
                if (!parsed) return;

                const texto = parsed.text;
                const destinatario = parsed.from?.value?.[0]?.address;
                const messageId = parsed.messageId;
                const subjectOriginal = parsed.subject || 'Sin asunto';
                const references = parsed.references ? parsed.references.join(' ') : null;
                const inReplyTo = parsed.inReplyTo;

                if (!texto || !destinatario) {
                  console.log('Correo incompleto');
                  return;
                }

                // Identificar el hilo de conversación
                const claveHilo = obtenerClaveHilo(destinatario, references, inReplyTo, messageId);
                const historial = obtenerHistorialHilo(claveHilo);
                
                // Agregar el mensaje del cliente al historial
                agregarMensajeAHilo(claveHilo, 'cliente', texto);

                logInfo(`Nuevo email de ${destinatario} - Asunto: ${subjectOriginal} - Hilo: ${historial.length} mensajes previos`);

                const respuesta = await clasificarYResponder(texto, destinatario, subjectOriginal, historial);
                console.log(respuesta);

                // Manejo de casos especiales (derivación a humanos)
                if (respuesta === 'SOPORTE') {
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal);
                  logInfo(`Email derivado a SOPORTE desde ${destinatario}`);
                  return;
                } else if (respuesta === 'SAMU') {
                  await reenviarCorreo('samu@frezzyks.com', destinatario, texto, subjectOriginal);
                  logInfo(`Email derivado a SAMU desde ${destinatario}`);
                  return;
                } else if (respuesta === 'NECESITA_PERSONA') {
                  await reenviarCorreo('soporte@frezzyks.com', destinatario, texto, subjectOriginal);
                  logInfo(`Email requiere atención humana de ${destinatario}`);
                  return;
                } else if (respuesta === 'SIN_RESPUESTA') {
                  logInfo(`Sin respuesta necesaria para ${destinatario}`);
                  return;
                }

                // Respuesta automática al cliente
                if (respuesta && typeof respuesta === 'object' && respuesta.mensaje) {
                  // Agregar la respuesta del bot al historial
                  agregarMensajeAHilo(claveHilo, 'bot', respuesta.mensaje);
                  
                  await enviarCorreo(destinatario, respuesta.mensaje, messageId, subjectOriginal);
                  logRespuesta(destinatario, respuesta.mensaje, 'EMAIL');
                } else if (typeof respuesta === 'string' && respuesta !== 'SOPORTE' && respuesta !== 'SAMU' && respuesta !== 'NECESITA_PERSONA') {
                  // Agregar la respuesta del bot al historial
                  agregarMensajeAHilo(claveHilo, 'bot', texto);
                  
                  await enviarCorreo(destinatario, texto, messageId, subjectOriginal);
                  logRespuesta(destinatario, texto, 'EMAIL');
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
          console.error('Error en fetch:', err);
        });
      });
    });
  });

  imap.once('error', (err) => {
    console.error('Error con IMAP:', err);
  });

  imap.once('end', () => {
    console.log('Conexión IMAP finalizada.');
  });

  imap.connect();
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
      subject: subject,
      text: cuerpoReenvio,
      reply_to: remitenteOriginal // Para que las respuestas vayan al cliente original
    });

    if (error) {
      console.error('Error reenviando email con Resend:', error);
      logError(destinatarioEquipo, error, 'Error reenviando email');
      throw error;
    }

    console.log('Email reenviado correctamente a', destinatarioEquipo, '- Cliente original:', remitenteOriginal);
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
