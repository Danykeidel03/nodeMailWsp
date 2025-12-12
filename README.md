# 🤖 NodeMailWsp - Sistema Automatizado de Atención al Cliente

Un sistema inteligente de automatización de atención al cliente que integra IA, email, WhatsApp, Shopify y seguimiento de envíos en tiempo real.

## ✨ Características Principales

- **🔄 Procesamiento Automático de Emails**: Monitoreo en tiempo real de buzón IMAP
- **🤖 IA Inteligente**: Clasificación y respuesta automática con OpenAI GPT
- **📦 Seguimiento de Pedidos**: Integración completa con Shopify
- **🚚 Tracking de Envíos**: Consulta de estado con Correos Express
- **💬 WhatsApp Integration**: Envío de mensajes automáticos
- **🎯 Derivación Inteligente**: Detecta cuando es necesaria intervención humana
- **📊 Logging Detallado**: Registro completo de operaciones y errores
- **🔐 Seguridad OAuth**: Autenticación segura con Shopify

## 🛠️ Stack Tecnológico

| Tecnología | Propósito |
|-----------|----------|
| **Node.js + Express** | Backend y API REST |
| **OpenAI API** | Procesamiento inteligente de mensajes |
| **Shopify API** | Gestión de pedidos |
| **Correos Express API** | Seguimiento de envíos |
| **WhatsApp Business API** | Comunicación vía WhatsApp |
| **Nodemailer** | Envío de respuestas por email |
| **IMAP** | Monitoreo de emails |
| **Axios** | Cliente HTTP |

## 📋 Requisitos Previos

- Node.js >= 14.x
- npm o yarn
- Credenciales de:
  - OpenAI API
  - Shopify Store
  - Correos Express
  - Email IMAP (Servidor)
  - WhatsApp Business API

## 🚀 Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/Danykeidel03/nodeMailWsp.git
cd nodeMailWsp
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# OpenAI
OPENAI_API_KEY=tu_clave_openai

# Shopify
SHOPIFY_API_KEY=tu_api_key
SHOPIFY_API_SECRET=tu_api_secret
SHOPIFY_SHOP=tu_tienda.myshopify.com
SHOPIFY_ACCESS_TOKEN=tu_token_acceso

# Email IMAP
EMAIL_USER=tu_email@example.com
EMAIL_PASS=tu_contraseña_imap

# Correos Express
CORREOS_CLIENTE=codigo_cliente
CORREOS_AUTH=credencial_base64

# WhatsApp
WHATSAPP_PHONE_ID=id_telefono
WHATSAPP_TOKEN=token_whatsapp

# URLs
NGROK_URL=https://tu-ngrok-url.ngrok.io

# Otros
NODE_ENV=development
```

## 📖 Uso

### Iniciar el servidor

```bash
npm start
```

El servidor se iniciará en `http://localhost:3000`

### Flujo de Operación

```
Email Entrante
    ↓
IMAP Listener detecta
    ↓
Parser extrae contenido
    ↓
Clasificador IA analiza
    ↓
Busca info en Shopify/Correos
    ↓
IA genera respuesta inteligente
    ↓
Envía por email/derivada a soporte
    ↓
Log de operación guardado
```

## 🔌 Endpoints Principales

### Autenticación Shopify

```bash
GET /shopify/install?shop=tu_tienda.myshopify.com
```
Inicia el flujo OAuth con Shopify para obtener Access Token.

```bash
GET /shopify/callback
```
Callback de Shopify después de la autorización.

### Webhook de WhatsApp

```bash
POST /webhook
```
Recibe y procesa mensajes de WhatsApp.

## 📁 Estructura del Proyecto

```
nodeMailWsp/
├── index.js              # Servidor principal y rutas
├── email.js              # Lógica de monitoreo IMAP
├── classifier.js         # IA y clasificación de mensajes
├── whatsapp.js           # Integración WhatsApp
├── shopify.js            # API Shopify
├── seguimiento.js        # API Correos Express
├── woo.js                # Integración WooCommerce (opcional)
├── logger.js             # Sistema de logging
├── verify-token.js       # Utilidad de verificación
├── obtener-token-shopify.js  # Helper para OAuth
├── package.json          # Dependencias
├── .env                  # Variables de entorno (no versionado)
└── README.md            # Este archivo
```

## 🧠 Cómo Funciona el Clasificador IA

El módulo `classifier.js` es el corazón del sistema:

### 1. **Detección de Patrones**
- Extrae número de pedido: `#5070` o `pedido: 5070`
- Busca números de seguimiento: `13+ dígitos`
- Identifica temas de consulta

### 2. **Obtención de Información**
```javascript
// Consulta Shopify por número de pedido
const infoPedido = await obtenerSeguimientoPorPedido(numeroPedido);

// Consulta Correos Express por tracking
const estadoEnvio = await obtenerEstadoEnvio(numeroSeguimiento);
```

### 3. **Generación de Respuesta**
- OpenAI procesa el mensaje con contexto
- Genera respuesta personalizada y amigable
- Incluye enlaces de seguimiento en tiempo real

### 4. **Derivación Inteligente**
- `SOPORTE`: Consulta compleja
- `SAMU`: Reembolsos/devoluciones
- `NECESITA_PERSONA`: Requiere atención humana
- `SIN_RESPUESTA`: Mensaje que no necesita respuesta

## 📊 Ejemplo de Respuesta Automática

**Entrada del cliente:**
```
Hola, ¿dónde está mi pedido #5070?
```

**Proceso interno:**
1. ✅ Extrae `#5070`
2. ✅ Consulta Shopify → Obtiene tracking `9930002528317467`
3. ✅ Consulta Correos → Obtiene estado actual
4. ✅ IA genera respuesta personalizada

**Respuesta enviada:**
```
¡Hola! Tu pedido #5070 se encuentra en TRÁNSITO.

📍 Ubicación actual: Delegación de Madrid
📅 Última actualización: 12/12/2025 14:30
👤 Destinatario: Tu Nombre
📦 Número de seguimiento: 9930002528317467

Puedes hacer seguimiento en tiempo real aquí:
https://s.correosexpress.com/SeguimientoSinCP/search-es?tracking-number=9930002528317467

¿Algo más en lo que pueda ayudarte?
```

## 📝 Logging y Monitoreo

El sistema registra:
- ✅ Emails recibidos y procesados
- ✅ Respuestas generadas
- ✅ Errores y excepciones
- ✅ Derivaciones a soporte
- ✅ Eventos de seguimiento

```javascript
// Ejemplos de logging
logInfo('Nuevo email procesado');
logRespuesta(email, respuesta, 'EMAIL');
logError(destinatario, error, 'Error contexto');
```

## 🔐 Seguridad

- **Variables de entorno**: Credenciales no versionadas
- **OAuth 2.0**: Autenticación segura con Shopify
- **HTTPS/TLS**: Conexiones encriptadas
- **Validación de entrada**: Protección contra inyecciones
- **Rate limiting**: Prevención de abuso (recomendado implementar)

## 🐛 Troubleshooting

### Error: "Missing shop parameter"
```bash
Asegúrate de que SHOPIFY_SHOP está configurado en .env
```

### Error: "IMAP connection failed"
```bash
Verifica credenciales de email:
- EMAIL_USER es la dirección correcta
- EMAIL_PASS es correcta (puede ser contraseña de aplicación)
- El servidor IMAP es accesible
```

### Error: "Correos API Error"
```bash
Valida:
- CORREOS_CLIENTE está correcto
- CORREOS_AUTH es válido (base64)
- El número de seguimiento existe
```

### OpenAI no responde
```bash
- Verifica OPENAI_API_KEY
- Comprueba límite de uso de API
- Asegúrate de estar en plan activo
```

## 🚀 Próximas Mejoras

- [ ] Base de datos para historial de conversaciones
- [ ] Dashboard de estadísticas
- [ ] Multi-idioma automático
- [ ] Integraciones adicionales (SMS, Telegram)
- [ ] Sistema de colas (Bull/RabbitMQ)
- [ ] Tests unitarios e integración
- [ ] Docker para deployments
- [ ] Rate limiting y anti-spam

## 📚 API Referencias

### [OpenAI API](https://platform.openai.com/docs)
Documentación para clasificación y generación de texto.

### [Shopify API](https://shopify.dev/docs/api/admin-rest)
Gestión de pedidos y fulfillments.

### [Correos Express API](https://www.cexpr.es/)
Consulta de seguimiento de envíos.

### [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
Envío de mensajes WhatsApp.

## 💬 Soporte

Para problemas o preguntas:
- 📧 Abre un [Issue](https://github.com/Danykeidel03/nodeMailWsp/issues)
- 💡 Sugiere mejoras en [Discussions](https://github.com/Danykeidel03/nodeMailWsp/discussions)

## 📄 Licencia

ISC License - Ver LICENSE para más detalles

## 🙌 Autor

**Dany Keidel**
- GitHub: [@Danykeidel03](https://github.com/Danykeidel03)
- LinkedIn: [tu-perfil-linkedin]

---

**Hecho con ❤️ para automatizar y mejorar la atención al cliente**
