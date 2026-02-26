const { OpenAI } = require('openai');
const axios = require('axios');
const { obtenerEstadoPedido } = require('./woo');
const { obtenerSeguimientoPorPedido } = require('./shopify');
const { obtenerEstadoEnvio } = require('./seguimiento');
const { logError } = require('./logger');

// Validar que OPENAI_API_KEY esté presente
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ ERROR CRÍTICO: OPENAI_API_KEY no está configurado');
  console.error('Por favor, configura esta variable de entorno en Railway');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function obtenerEstadoSeguimiento(numeroSeguimiento) {
  try {
    console.log(`[DEBUG] Consultando seguimiento: ${numeroSeguimiento}`);
    
    const response = await axios.post(
      'https://www.cexpr.es/wspsc/apiRestSeguimientoEnviosk8s/json/seguimientoEnvio',
      {
        codigoCliente: process.env.CORREOS_CLIENTE,
        dato: numeroSeguimiento,
        idioma: 'ES'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${process.env.CORREOS_AUTH}`
        }
      }
    );
    
    const data = response.data;
    
    if (data.error !== 0) {
      console.error(`[ERROR] Correos API Error: ${data.mensajeError}`);
      return null;
    }
    
    // Extraer solo la información importante para el cliente
    const infoSimplificada = {
      numEnvio: data.numEnvio,
      estado: data.descEstado,
      fecha: data.fechaEstado,
      hora: data.horaEstado,
      destinatario: data.nomDest,
      ciudad: data.pobDest,
      referencia: data.ref,
      bultos: data.numBultos ? parseInt(data.numBultos) : 1,
      kilos: data.kilos ? parseFloat(data.kilos) : null,
      ultimos_eventos: data.estadoEnvios ? data.estadoEnvios.slice(-3).map(e => ({
        estado: e.descEstado,
        fecha: e.fechaEstado,
        hora: e.horaEstado,
        ubicacion: e.nombreDelegacion
      })) : []
    };
    
    console.log(`[DEBUG] Info simplificada:`, JSON.stringify(infoSimplificada, null, 2));
    return infoSimplificada;
  } catch (error) {
    console.error(`[ERROR] Obtener estado de seguimiento: ${error.message}`);
    if (error.response) {
      console.error(`[ERROR] Status: ${error.response.status}`);
      console.error(`[ERROR] Data:`, error.response.data);
    }
    return null;
  }
}

async function clasificarYResponder(mensaje, destinatario, asunto, historialConversacion = [], infoAdjuntos = null) {
  let infoPedido = '';
  let infoSeguimiento = '';
  let infoArchivosAdjuntos = '';
  let estadoCompletoDisponible = false;
  
  // Procesar información de adjuntos si existe
  if (infoAdjuntos && infoAdjuntos.tieneAdjuntos) {
    infoArchivosAdjuntos = infoAdjuntos.resumen;
  }
  
  // ============= DETECCIÓN DE FRUSTRACIÓN / REPETICIÓN =============
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
  
  const clienteFrustrado = patronesFrustracion.some(patron => mensajeLower.includes(patron));
  
  // Detectar si el bot ya respondió múltiples veces sobre el mismo tema
  const respuestasDelBot = historialConversacion.filter(m => m.rol === 'bot').length;
  const bucleDetectado = respuestasDelBot >= 2 && historialConversacion.length >= 4;
  
  if (clienteFrustrado || bucleDetectado) {
    console.log(`[DEBUG] ${clienteFrustrado ? 'Cliente frustrado detectado' : 'Bucle de conversación detectado'} - Escalando a SOPORTE`);
    return 'SOPORTE';
  }

  // Extraer número de pedido
  const regexPedido = /#(\d{4,})|(?:número de )?pedido[:\s#]+(\d{4,})/i;
  const textoCompleto = `${mensaje} ${asunto || ''}`;
  const matchPedido = textoCompleto.match(regexPedido);
  let numeroPedido = null;
  
  try {
    if (matchPedido) {
      numeroPedido = matchPedido[1] || matchPedido[2];
      console.log(`[DEBUG] Pedido detectado: #${numeroPedido}`);
      
      // Obtener número de seguimiento y estado del pedido
      const infoPedidoShopify = await obtenerSeguimientoPorPedido(numeroPedido);
      console.log(`[DEBUG] Respuesta Shopify:`, JSON.stringify(infoPedidoShopify, null, 2));
      
      if (infoPedidoShopify.encontrado) {
        if (infoPedidoShopify.numeroSeguimiento) {
          // Obtener estado del envío
          const estadoEnvio = await obtenerEstadoEnvio(infoPedidoShopify.numeroSeguimiento);
          
          if (estadoEnvio.encontrado) {
            estadoCompletoDisponible = true;
            
            // Agregar información completa del estado al contexto
            infoPedido = `INFORMACIÓN DEL PEDIDO #${numeroPedido}:
- Estado del envío: ${estadoEnvio.estado}
- Número de seguimiento: ${estadoEnvio.numeroSeguimiento}
- Destinatario: ${estadoEnvio.destinatario}
- Última actualización: ${estadoEnvio.fecha} a las ${estadoEnvio.hora}
- Enlace de seguimiento: https://s.correosexpress.com/SeguimientoSinCP/search-es?tracking-number=${estadoEnvio.numeroSeguimiento}

IMPORTANTE: Incluir el enlace de seguimiento en la respuesta de forma amigable para que el cliente pueda hacer seguimiento en tiempo real.
`;
          } else {
            infoPedido = `El pedido #${numeroPedido} tiene número de seguimiento (${infoPedidoShopify.numeroSeguimiento}) pero no se puede consultar su estado en este momento.\n`;
          }
        } else {
          infoPedido = `INFORMACIÓN DEL PEDIDO #${numeroPedido}:
- El pedido está en preparación
- Aún no tiene número de seguimiento asignado
- Recordar al cliente: Los pedidos tardan 3-5 días hábiles en prepararse. Una vez enviado, recibirá el número de seguimiento por email/SMS.
`;
        }
      } else {
        infoPedido = `No se encontró el pedido #${numeroPedido} en nuestro sistema.\n`;
      }
    }
  } catch (error) {
    console.error(`[ERROR] Error al obtener información del pedido:`, error.message);
    logError(destinatario || 'Desconocido', error, 'Error obteniendo info de pedido Shopify');
  }

  // Extraer número de seguimiento directo (números de 13+ dígitos)
  let regexSeguimiento = /(?:número de seguimiento|tracking|seguimiento)[:\s#]*(\d{13,})/i;
  let matchSeguimiento = textoCompleto.match(regexSeguimiento);
  
  if (!matchSeguimiento) {
    regexSeguimiento = /\b(\d{13,})\b/;
    matchSeguimiento = textoCompleto.match(regexSeguimiento);
  }
  
  let numeroSeguimiento = null;
  
  if (matchSeguimiento && !estadoCompletoDisponible) {
    numeroSeguimiento = matchSeguimiento[1];
    
    const estadoEnvio = await obtenerEstadoEnvio(numeroSeguimiento);
    
    if (estadoEnvio.encontrado) {
      infoSeguimiento = `ESTADO DEL ENVÍO #${numeroSeguimiento}:
- Estado: *${estadoEnvio.estado}*
- Destinatario: ${estadoEnvio.destinatario}
- Última actualización: ${estadoEnvio.fecha} ${estadoEnvio.hora}
- Enlace de seguimiento: https://s.correosexpress.com/SeguimientoSinCP/search-es?tracking-number=${numeroSeguimiento}

IMPORTANTE: Incluir el enlace de seguimiento en la respuesta de forma amigable.
`;
    }
  }

  if (mensaje.toLowerCase().includes('persona')) return null;

  // Construir contexto de conversación previa si existe
  let contextoConversacion = '';
  if (historialConversacion && historialConversacion.length > 0) {
    contextoConversacion = '\n--- HISTORIAL DE LA CONVERSACIÓN ---\n';
    historialConversacion.forEach((msg, idx) => {
      contextoConversacion += `${msg.rol === 'bot' ? 'TÚ (Bot)' : 'Cliente'}: ${msg.texto}\n`;
    });
    contextoConversacion += '--- FIN DEL HISTORIAL ---\n\n';
  }

  const prompt = `
Eres el asistente virtual de atención al cliente de *Frezzyks*, una tienda online de golosinas liofilizadas y marshmallows gourmet. Tu estilo es:

•⁠  ⁠Amable, directo, cercano y resolutivo.
•⁠  ⁠Tuteas siempre.
•⁠  ⁠Escribes como un/a joven majo/a y profesional (sin forzar jerga ni bromas raras).
•⁠  ⁠Usas emojis solo al final de frases (máximo 2), y solo si el contexto lo permite.
•⁠  ⁠Cierras siempre con: "Un saludo!!, equipo Frezzyks 🍬" (salvo en WhatsApp, donde puede ser más corto).

${contextoConversacion}🚨 REGLAS CRÍTICAS ANTI-REPETICIÓN (MUY IMPORTANTE):

1. **NUNCA repitas una respuesta que ya diste** - Si ya explicaste algo en el historial, NO lo vuelvas a explicar con las mismas palabras.

2. **Si el cliente repite su problema o insiste:**
   - Reconoce que entiendes su frustración
   - NO repitas la misma información
   - Ofrece una ALTERNATIVA o ESCALADO: "Entiendo que esto es frustrante. Voy a pasar tu caso a un compañero para que te ayude personalmente"
   - Si no puedes ofrecer nada nuevo, responde SOPORTE para escalar a humano

3. **Si el cliente parece frustrado o insatisfecho con tu respuesta anterior:**
   - Frases como "ya me dijiste eso", "no me sirve", "eso ya lo sé", "no entiendes", "pero es que...", "sigo sin...", "otra vez lo mismo"
   - En estos casos, responde únicamente: SOPORTE (para que un humano tome el control)

4. **Si el cliente da las gracias:** respuesta CORTA ("¡De nada! Aquí estamos 😊")

5. **Si el cliente hace una pregunta de seguimiento:** responde SOLO eso, sin repetir contexto.

6. **Detecta bucles:** Si ves que en el historial ya respondiste 2+ veces sobre el mismo tema y el cliente sigue preguntando lo mismo, responde: SOPORTE

---
${infoArchivosAdjuntos ? infoArchivosAdjuntos + '\n\n' : ''}${infoPedido ? 'INFO PEDIDO PARA EL CLIENTE:\n' + infoPedido + '\n' : ''}${infoSeguimiento ? infoSeguimiento + '\n' : ''}---
A continuación, se describen los temas más frecuentes que puedes resolver tú:

NO inventes respuestas. Si no puedes ayudar, responde únicamente con la palabra NECESITA_PERSONA.
NO converses. Si no puedes ayudar, responde únicamente con la palabra NECESITA_PERSONA.

🔹 *ENVÍOS*

•⁠  ⁠Producción del pedido: tarda *3–5 días hábiles* (personalizamos y montamos todo a mano).
•⁠  ⁠Una vez enviado, el paquete llega en *24–48 h* con Correos o *24 h* con Correos Express.
•⁠  ⁠Si han pasado más de *5 días hábiles sin número de seguimiento, o **3 días desde el envío sin recibir el pedido*, se considera retraso.
•⁠  ⁠El seguimiento llega al cliente por correo/SMS cuando el pedido sale de nuestras oficinas.
•⁠  ⁠Solo enviamos a *Península y Baleares* (de momento no a Canarias, Ceuta o Melilla por dificultades con logística, aunque en un futuro nos gustaría).
•⁠  ⁠Todos nuestros envíos actuales son exprés (no hay una opción más rápida).
•⁠  ⁠Si el cliente se equivoca con la dirección:
  - Si aún no se ha enviado, la corregimos sin problema.
  - Si ya está en reparto o estacionado, podemos pedir modificación.
  - Si no se puede entregar por culpa del cliente, *no nos hacemos responsables del coste extra*.
•⁠  ⁠Si el número de seguimiento no se actualiza: 
  - Indicar al cliente que contacte con la empresa de transporte, o que nos pase su número de pedido para revisar nosotros directamente.

🔹 *DEVOLUCIONES / REEMBOLSOS*

•⁠  ⁠*Los packs personalizados no pueden devolverse* por ser productos alimenticios hechos a medida (incluye megapacks, superpacks o packs degustación), salvo error nuestro.
•⁠  ⁠Para el resto de productos, sí se pueden devolver.
•⁠  ⁠Si el pedido llegó roto o equivocado:
  - Pedimos fotos como prueba y ofrecemos una solución justa (código de descuento, nuevo envío o reembolso).
•⁠  ⁠Los reembolsos se hacen por el mismo método de pago y pueden tardar mínimo *24–48 h* en procesarse.
•⁠  ⁠Cubrimos los gastos de devolución *solo si el error fue nuestro* (no incluye los gastos de envío).

🔹 *PAGOS / FACTURAS*

•⁠  ⁠Aceptamos: *Bizum, tarjeta, Apple Pay, Google Pay y Revolut Pay*.
•⁠  ⁠Si no reciben confirmación de pago o no encuentran su pedido:
  - Pedimos SIEMPRE: email con el que hizo la compra + nombre completo.
  - Ejemplo de respuesta: "Para poder ayudarte, ¿me pasas el email con el que hiciste el pedido y tu nombre completo? Así lo busco en el sistema 😊"
•⁠  ⁠Si quieren factura:
  - Pedimos número de pedido + datos fiscales completos.

🔹 *NEWSLETTER / DESCUENTOS*

•⁠  ⁠Si preguntan por el descuento de suscripción a la newsletter:
  - El código de descuento les llega automáticamente por email tras suscribirse.
  - Que revisen la carpeta de SPAM o correo no deseado, a veces llega ahí.
  - Si no lo encuentran, que nos den el email con el que se suscribieron para reenviar el código.

🔹 *PEDIDO NO APARECE EN MI CUENTA*

•⁠  ⁠Si el cliente dice que no ve su pedido en su cuenta o que no le aparece:
  - Pedir SIEMPRE desde el principio: email con el que hizo el pedido Y nombre completo.
  - Explicar que a veces el pedido se hace con un email diferente al de la cuenta.
  - Si hizo el pedido como invitado, no aparecerá en su cuenta pero el pedido existe igualmente.
  - Una vez tengamos los datos, podemos buscar el pedido y darle información.

🔹 *PRODUCTOS / FAQ*

•⁠  ⁠Las chuches liofilizadas son caramelos o gominolas sometidos a un proceso de deshidratación al vacío que les da textura crujiente y sabor concentrado.
•⁠  ⁠Tenemos opciones sin azúcar, sin gluten y halal (consultables en filtros y fichas de producto en la web).
•⁠  ⁠Aptas para niños, pero siempre con supervisión en menores de 3 años.
•⁠  ⁠Hacemos packs 100 % personalizados a través de la web, y en TikTok Shop hay opciones variadas con detalles extra.
•⁠  ⁠No se pueden elegir sabores exactos en los packs sorpresa, pero pueden ver ejemplos en la web o redes.
•⁠  ⁠Los regalinchis no se pueden elegir, son sorpresa y exclusivos.

🔹 *B2B / TIENDAS / DISTRIBUIDORES*

•⁠  ⁠Si alguien quiere vender nuestros productos en su tienda:
  - Respondemos con interés, reenviamos el mensaje a ventas@frezzyks.com
  - Pedido mínimo actual: 4 cajas.
  - Que dejen nombre, tienda, ciudad y forma de contacto.

🔹 *COLABORACIONES / INFLUENCERS*

•⁠  ⁠Contactar por email o por DM.
•⁠  ⁠Si nos interesa, les hacemos propuesta. Si no, agradecemos el interés y les guardamos en cartera.
•⁠  ⁠Tenemos sistema de afiliados solo en TikTok Shop. No enviamos muestras sin acuerdo previo.

🔹 *RESPUESTAS AUTOMÁTICAS / ESCALADO*

Si se menciona alguno de los siguientes temas:

🔹 *RESPUESTAS AUTOMÁTICAS / ESCALADO*

Si se menciona alguno de los siguientes temas:

•⁠  ⁠Palabras como “estacionado” o estado del envío estacionado → responde únicamente con la palabra SOPORTE (sin añadir nada más).

•⁠  ⁠Palabras como “caducidad”, “producto caducado”, “fecha de caducidad”, "caducado", "caducidad pasada" tambien en caso de que el mensaje ponga algo de que esta caducado → responde únicamente con la palabra SOPORTE (sin añadir nada más).

•⁠  Si el mensaje del usuario contiene cualquier mención o insinuación de temas relacionados con colaboraciones, estrategia de marca, sanciones, multas, impuestos, hacienda o subvenciones, responde únicamente con la palabra "SAMU". No añadas ningún otro texto. Esto incluye sinónimos, derivados o formas informales (como "colaboración", "marca", "Hacienda", etc.).

•⁠  ⁠Temas no reconocidos o muy sensibles (denuncias, problemas legales, facturación compleja, etc.) → responde únicamente con la palabra SAMU (sin añadir nada más).

•⁠  ⁠Si el correo proviene de una dirección tipo "noreply" o similar (donde no se espera respuesta del cliente), ADEMAS COSAS QUE VENGAN DEL PROPIO FREZZYKS COMO PROCTOS CON POCAS EXISTENCIAS O NEW SUBSCRIBER TO FREZZYKS O SPAM → responde únicamente con la palabra SIN_RESPUESTA (sin añadir nada más).

`;


  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: mensaje }
    ]
  });

  const respuesta = completion.choices[0].message.content.trim();

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
  clasificarYResponder
};
