// email.js
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { clasificarYResponder } = require('./classifier');
const { logRespuesta, logError, logInfo } = require('./logger');
const Imap = require('imap');

const resend = new Resend(process.env.RESEND_API_KEY);

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

                if (!texto || !destinatario) {
                  console.log('Correo incompleto');
                  return;
                }

                logInfo(`Nuevo email de ${destinatario} - Asunto: ${subjectOriginal}`);

                const respuesta = await clasificarYResponder(texto, destinatario, subjectOriginal);
                console.log(respuesta);

                let destinatarioFinal = destinatario;

                if (respuesta === 'SOPORTE') {
                  destinatarioFinal = 'soporte@frezzyks.com';
                  logInfo(`Email derivado a SOPORTE desde ${destinatario}`);
                } else if (respuesta === 'SAMU') {
                  destinatarioFinal = 'samu@frezzyks.com';
                  logInfo(`Email derivado a SAMU desde ${destinatario}`);
                } else if (respuesta === 'NECESITA_PERSONA') {
                  destinatarioFinal = 'soporte@frezzyks.com';
                  logInfo(`Email requiere atención humana de ${destinatario}`);
                } else if (respuesta === 'SIN_RESPUESTA') {
                    logInfo(`Sin respuesta necesaria para ${destinatario}`);
                    return;
                }

                if (respuesta && typeof respuesta === 'object' && respuesta.mensaje) {
                  await enviarCorreo(destinatarioFinal, respuesta.mensaje, messageId, subjectOriginal);
                  logRespuesta(destinatarioFinal, respuesta.mensaje, 'EMAIL');
                } else if (typeof respuesta === 'string') {
                  const mensajeToSoporte = `Usuario: ${destinatario}\nMensaje: ${texto}`
                  await enviarCorreo(destinatarioFinal, mensajeToSoporte, messageId, subjectOriginal);
                  logRespuesta(destinatarioFinal, mensajeToSoporte, 'EMAIL');
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
