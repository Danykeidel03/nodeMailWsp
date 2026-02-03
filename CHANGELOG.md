# Changelog - Bot Frezzyks

Todas las versiones y cambios notables del bot de atención al cliente.

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
