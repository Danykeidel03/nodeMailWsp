# Changelog - Bot Frezzyks

Todas las versiones y cambios notables del bot de atención al cliente.

---

## [1.2.0] - 2026-03-12

### ✨ Nuevas funcionalidades

#### 📝 Prompts modulares
- El prompt del sistema ahora está dividido en **12 archivos .md** editables
- Cada sección se puede modificar sin tocar código:
  - `01-personalidad.md` - Tono y estilo del bot
  - `02-reglas-antirepeticion.md` - Evitar respuestas repetidas
  - `03-envios.md` - Información de envíos
  - `04-devoluciones.md` - Políticas de devolución
  - `05-pagos.md` - Pagos y facturas
  - `06-newsletter.md` - Descuentos y newsletter
  - `07-pedido-cuenta.md` - Pedido no aparece en cuenta
  - `08-localizar-pedido.md` - Consultar estado de pedido
  - `09-productos.md` - FAQ de productos
  - `10-b2b.md` - Ventas B2B
  - `11-colaboraciones.md` - Influencers y colaboraciones
  - `12-escalado.md` - Reglas de SOPORTE/SAMU/etc
- Cache inteligente: solo recarga si hay cambios en los archivos

#### 🧪 Suite de tests
- **60 tests** con Vitest cubriendo:
  - Carga y construcción de prompts
  - Detección de frustración y bucles
  - Extracción de números de pedido/seguimiento
  - Detección de intermediarios y spam
  - Clasificación por dominio

#### 🗑️ Limpieza
- Eliminado código de WhatsApp (no se usaba)
- Refactorizado `classifier.js` con funciones helper extraídas
- Eliminado código duplicado (`obtenerEstadoSeguimiento`)

### 📁 Archivos nuevos
- `prompts/sections/*.md` - 12 archivos de prompt
- `src/services/promptLoader.js` - Cargador de prompts
- `tests/*.test.js` - Suite de tests
- `ROADMAP.md` - Plan de mejoras del proyecto

### 📁 Archivos modificados
- `classifier.js` - Refactorizado para usar promptLoader
- `package.json` - Scripts de test añadidos
- `index.js` - Eliminadas referencias a WhatsApp

### 📁 Archivos eliminados
- `whatsapp.js`

**Rama**: `fase-1/arquitectura-y-prompts`

---

## [1.1.2] - 2026-03-09

### ✨ Nuevas funcionalidades

#### 🔇 Escalado silencioso a superiores
- Al escalar a soporte/SAMU, **ya NO se notifica al cliente**
- El cliente no sabe que su caso ha sido derivado (evita ansiedad)
- El equipo puede decidir cuándo y cómo responder

#### 📧 Respuesta directa al cliente
- Cuando soporte/SAMU responde al email escalado, **la respuesta va directamente al cliente**
- El Reply-To apunta al email del cliente
- **El bot NO interviene** en esa respuesta (sin bucles)
- El asunto incluye el email del cliente para fácil identificación: `[cliente@email.com] Asunto`

#### 🛡️ Protección anti-bucle mejorada
- El bot ahora ignora emails de: contacto@, soporte@, samu@frezzyks.com
- Evita cualquier posible bucle de reenvío

### 📁 Archivos modificados
- `email.js` - Nueva función `reenviarCorreo()` rediseñada + bloqueo de emails internos

---

## [1.1.1] - 2026-03-05

### ✨ Nuevas funcionalidades

#### 🎟️ Descuento newsletter NO caduca
- Añadido que el código de descuento de la newsletter **no tiene fecha de caducidad**
- El cliente puede usarlo cuando quiera

#### 🔍 Preguntar número de pedido antes de escalar
- Cuando el cliente pregunta cómo localizar su pedido o dónde está:
  - El bot PRIMERO pide el número de pedido (#12345)
  - Solo si no lo proporcionan después de pedirlo, escala a soporte
  - Si lo dan, consulta el estado y responde directamente

#### 📜 Historial completo al escalar a soporte
- **CORREGIDO**: Cuando el bot deriva a soporte, ahora incluye TODO el historial:
  - Primer mensaje del cliente ✅
  - Primera respuesta del bot ✅
  - Todos los mensajes siguientes ✅
- El equipo de soporte ahora ve la conversación completa desde el principio

### 📁 Archivos modificados
- `classifier.js` - Nuevas instrucciones: descuento no caduca + pedir nº pedido
- `email.js` - Corregido orden de historial + usar `historialCompleto` al escalar

---

## [1.1.0] - 2026-02-25

### ✨ Nuevas funcionalidades

#### 📧 Descuento de Newsletter
- El bot ahora sabe responder sobre el descuento por suscribirse a la newsletter
- Indica que el código llega por email automáticamente
- Sugiere revisar la carpeta de SPAM
- Si no lo encuentran, pide el email para reenviar el código

#### 👤 Pedido no aparece en la cuenta
- Cuando el cliente dice que no ve su pedido en su cuenta:
  - El bot pide SIEMPRE email + nombre completo desde el principio
  - Explica que puede ser porque usó otro email o compró como invitado
  - Con los datos puede buscar el pedido en el sistema

#### 🛡️ Filtro anti-spam mejorado
- Detecta y filtra automáticamente emails de spam comercial como:
  - Ofertas de servicios de marketing/ventas ("I'd like to help you drive sales...")
  - Propuestas de colaboración no solicitadas con comisiones
  - SEO/Link building spam
  - Cold outreach genérico
- Ya no llegan estos emails a soporte, se ignoran directamente

### 📁 Archivos modificados
- `email.js` - Nueva detección de spam en `clasificarPorDominio()`
- `classifier.js` - Nuevas secciones de FAQ: Newsletter y Pedido no aparece

---

## [1.0.0] - 2026-02-03

### ✨ Nuevas funcionalidades

#### 📎 Detección inteligente de adjuntos
- El bot ahora detecta automáticamente archivos adjuntos en los emails:
  - Imágenes (jpg, png, gif, etc.)
  - Documentos (PDF, Word, Excel)
  - Videos
  - Imágenes pegadas directamente en el cuerpo del email (inline)
- La IA recibe un resumen de los adjuntos para **no pedir documentos que el cliente ya ha enviado**
- Ejemplo: Si el cliente adjunta fotos de un pedido roto, el bot agradece las fotos en lugar de pedirlas

#### 🚫 Sistema anti-repetición
- **Detección de frustración del cliente**: Frases como "ya me dijiste eso", "no me sirve", "quiero hablar con una persona" escalan automáticamente a soporte humano
- **Detección de bucles**: Si el bot ya respondió 2+ veces sobre el mismo tema y el cliente sigue insistiendo, se escala a SOPORTE
- **Instrucciones reforzadas** para la IA: Nunca repetir la misma información, ofrecer alternativas o escalar si el cliente no queda satisfecho

### 📁 Archivos modificados
- `email.js` - Nueva función `analizarAdjuntos()`
- `classifier.js` - Detección de frustración + nuevas reglas en el prompt

---

## [0.9.0] - Versión inicial documentada

### Funcionalidades base
- Conexión IMAP para recibir emails en tiempo real
- Clasificación de emails con OpenAI (GPT-4o-mini)
- Respuestas automáticas a consultas frecuentes:
  - Estado de pedidos (integración con Shopify)
  - Seguimiento de envíos (integración con Correos Express)
  - Información de productos, pagos, devoluciones
- Escalado automático a soporte/SAMU según el tema
- Detección de intermediarios (mailer@shopify.com, no-reply, etc.)
- Historial de conversación por hilos
- Filtrado de spam y newsletters
- Detección de problemas de entrega con IA
- Métricas y logging

### Integraciones
- Shopify API (pedidos y seguimiento)
- Correos Express API (estado de envíos)
- OpenAI API (clasificación y respuestas)
- Resend (envío de emails)
- WhatsApp (notificaciones)

---

## Próximas mejoras previstas

- [ ] Mejora en la detección de intención del cliente
- [ ] Respuestas más personalizadas según historial de compras
- [ ] Dashboard de métricas en tiempo real
- [ ] Integración con más transportistas

---

## Formato de versiones

- **MAJOR.MINOR.PATCH**
  - MAJOR: Cambios grandes o incompatibles
  - MINOR: Nuevas funcionalidades compatibles
  - PATCH: Correcciones de bugs
