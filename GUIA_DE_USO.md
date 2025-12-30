# 📖 Guía de Uso - Sistema Mejorado

## 🚀 Inicio Rápido

### 1. Iniciar el sistema

```bash
npm start
```

### 2. Verificar que está funcionando

El sistema mostrará:
```
Servidor iniciado en puerto 3000
📊 Métricas disponibles en: http://localhost:3000/metricas

========== SERVIDOR INICIADO ==========
📊 MÉTRICAS DEL BOT DE CLASIFICACIÓN
=====================================================
⏱️  Tiempo activo: 0 minutos
📧 Total emails recibidos: 0
✅ Emails automatizados: 0 (0.00%)
...
```

### 3. Monitorear en tiempo real

Abrir en navegador: `http://localhost:3000/metricas`

---

## 🎯 Casos de Uso Reales

### Caso 1: Email de Cliente Normal ✅

**Email recibido:**
```
De: cliente@gmail.com
Asunto: ¿Dónde está mi pedido #7029?
Mensaje: Hola, realicé el pedido #7029 hace 3 días...
```

**Flujo del sistema:**
1. ✅ No es intermediario
2. ✅ No es newsletter
3. ✅ No es duplicado
4. 🤖 Clasificador analiza y responde
5. ✅ Respuesta enviada al cliente
6. 📊 Métrica: +1 email automatizado

**Log:**
```
✅ Email automático enviado a cliente@gmail.com
```

---

### Caso 2: Email de Intermediario 🚫

**Email recibido:**
```
De: mailer@shopify.com
Asunto: Order notification
Reply-To: cliente_real@gmail.com
```

**Flujo del sistema:**
1. 🚫 DETECTADO como intermediario
2. ✅ Busca Reply-To: cliente_real@gmail.com
3. ✅ Podría reprocesar con email real (opcional)
4. 📊 Métrica: +1 intermediario bloqueado

**Log:**
```
🚫 BLOQUEADO: Email de intermediario mailer@shopify.com - NO SE RESPONDE
✅ Encontrado Reply-To real: cliente_real@gmail.com
```

---

### Caso 3: Newsletter/Spam 🗑️

**Email recibido:**
```
De: newsletter@merkandi.es
Asunto: ¡Ofertas especiales!
Mensaje: Compra ahora con 50% descuento...
```

**Flujo del sistema:**
1. ✅ No es intermediario
2. 🚫 DETECTADO como newsletter
3. ❌ NO se procesa
4. 📊 Métrica: +1 newsletter ignorada

**Log:**
```
🚫 IGNORADO: Newsletter/Marketing - no es cliente - De: newsletter@merkandi.es
```

---

### Caso 4: Reseña Positiva (Judge.me) ⭐

**Email recibido:**
```
De: support@judge.me
Asunto: New 5-star review
Mensaje: ⭐⭐⭐⭐⭐ Amazing product!
```

**Flujo del sistema:**
1. ✅ No es intermediario
2. 🚫 DETECTADO: Reseña 5★
3. ❌ NO requiere respuesta
4. 📊 Métrica: +1 email ignorado

**Log:**
```
🚫 IGNORADO: Reseña positiva de Judge.me - no requiere respuesta
```

---

### Caso 5: Duplicado Bloqueado 🚫

**Email 1 recibido (10:00 AM):**
```
De: cliente@gmail.com
Asunto: Mi pedido
```
✅ Respuesta enviada

**Email 2 recibido (10:15 AM):**
```
De: cliente@gmail.com
Asunto: Re: Mi pedido
```
🚫 **BLOQUEADO** (mismo hilo, <30 minutos)

**Log:**
```
🚫 DUPLICADO BLOQUEADO: Ya se respondió a este hilo en los últimos 30 minutos
```

---

### Caso 6: Estado Interno Detectado ⚠️ (CRÍTICO)

**Clasificador intenta devolver:**
```javascript
"Necesita_persona para revisar..."  // ❌ MAL
```

**Flujo del sistema:**
1. 🛡️ GUARDRAIL ACTIVADO
2. 🚫 Mensaje BLOQUEADO
3. ✅ Escalado a soporte
4. ❌ Cliente NO recibe mensaje interno
5. 📊 Métrica: +1 guardrail activado

**Log:**
```
⚠️ CRÍTICO: Mensaje contiene estados internos - BLOQUEADO
📧 Email derivado a SOPORTE desde cliente@gmail.com
```

---

## 📊 Interpretación de Métricas

### Dashboard Web (`/metricas`)

```
📧 Total emails recibidos: 100
✅ Emails automatizados: 60 (60.00%)    ← Bot respondió solo
👥 Escalados a soporte: 25              ← Requirieron humano
👔 Escalados a Samu: 2                  ← Temas críticos
🔇 Ignorados: 13                        ← Newsletter/spam

🛡️ SEGURIDAD:
   • Duplicados bloqueados: 8           ← Sistema funcionando
   • Intermediarios bloqueados: 5       ← Protección activa
   • Newsletters ignoradas: 10          ← Filtrado de ruido
   • Guard-rails activados: 0           ← ✅ PERFECTO (debería ser 0)

⚠️ Errores: 0                           ← ✅ Sistema estable
⚡ Tiempo promedio respuesta: 2.34s     ← ✅ Rápido
```

### ¿Qué indican las métricas?

#### ✅ Sistema Saludable
- Tasa automatización: 60-70%
- Guard-rails activados: **0**
- Errores: 0-2
- Tiempo respuesta: <5s

#### ⚠️ Requiere Atención
- Guard-rails activados: **>0** → Afinar clasificador
- Errores: >5 → Revisar logs
- Tasa automatización: <40% → Demasiados casos escalados

#### 🚨 Crítico
- Guard-rails activados: **>10** → Clasificador roto
- Errores: >20 → Sistema inestable
- Tiempo respuesta: >10s → Problema de rendimiento

---

## 🔧 Ajustes Comunes

### Cambiar tiempo de bloqueo de duplicados

**Archivo:** [email.js](email.js#L106)

```javascript
// De 30 a 45 minutos
if (yaRespondidoRecientemente(claveHilo, 45)) {
```

### Agregar nuevo intermediario

**Archivo:** [email.js](email.js#L30-L46)

```javascript
const intermediarios = [
  'mailer@shopify.com',
  'no-reply',
  'nuevo-intermediario@example.com'  // ← Agregar aquí
];
```

### Agregar dominio a lista negra

**Archivo:** [email.js](email.js#L48-L79)

```javascript
const newsletterDomains = [
  'merkandi.es', 
  'mailchimp.com',
  'spam-domain.com'  // ← Agregar aquí
];
```

---

## 🐛 Troubleshooting

### Problema: Guard-rails activados > 0

**Causa:** El clasificador IA está devolviendo estados internos en mensajes.

**Solución:**
1. Revisar logs para ver qué mensaje activó el guardrail
2. Afinar el prompt en [classifier.js](classifier.js#L190-L204)
3. Agregar más ejemplos negativos al prompt

**Ejemplo de log:**
```
⚠️ CRÍTICO: Mensaje contiene estados internos - BLOQUEADO
Mensaje: "Este caso NECESITA_PERSONA especializada..."
```

→ El clasificador debe devolver SOLO: `NECESITA_PERSONA` (sin texto adicional)

---

### Problema: Muchos emails escalados (baja automatización)

**Causa:** Clasificador demasiado conservador.

**Solución:**
1. Revisar qué tipo de emails se escalan
2. Agregar más ejemplos al prompt
3. Ampliar reglas de dominio para auto-ignorar más casos

---

### Problema: Cliente reporta "no recibí respuesta"

**Checklist:**
1. ✅ ¿Se detectó como intermediario? → Revisar logs
2. ✅ ¿Se bloqueó como duplicado? → Revisar thread_id
3. ✅ ¿Se ignoró por dominio? → Verificar clasificación
4. ✅ ¿El email llegó al inbox? → Revisar Resend logs

---

## 📈 Optimización Continua

### Semana 1: Monitoreo Intensivo
- [ ] Revisar métricas cada 2 horas
- [ ] Identificar falsos positivos/negativos
- [ ] Ajustar umbrales según comportamiento real

### Semana 2: Ajuste Fino
- [ ] Analizar guard-rails activados
- [ ] Afinar reglas de dominio
- [ ] Optimizar tiempo de bloqueo duplicados

### Semana 3+: Operación Normal
- [ ] Revisar métricas 1x/día
- [ ] Guardar histórico mensual
- [ ] Agregar nuevas reglas según necesidad

---

## 📞 Soporte y Preguntas Frecuentes

### ¿Qué pasa si el clasificador se equivoca?

**Caso 1:** Email ignorado que debía procesarse
- El cliente volverá a escribir
- El historial evitará que se ignore de nuevo

**Caso 2:** Email escalado que podía automatizarse
- Humano responde (más lento pero seguro)
- Métrica ayuda a identificar patrones para mejorar

**Caso 3:** Estado interno enviado a cliente
- 🛡️ **IMPOSIBLE** - Bloqueado por múltiples guardrails

### ¿Cómo ver el rendimiento en producción?

```bash
# API JSON para integración con monitoring
curl http://tu-dominio.com/metricas/json

# Guardar en archivo
curl http://tu-dominio.com/metricas/json > metricas_$(date +%Y%m%d).json
```

### ¿Puedo desactivar alguna validación?

**NO RECOMENDADO**, pero si es necesario:

```javascript
// Desactivar bloqueo de duplicados (NO HACER)
// if (yaRespondidoRecientemente(claveHilo, 30)) {
//   return;
// }

// Desactivar filtro de intermediarios (NO HACER)
// if (esIntermediario(destinatario)) {
//   return;
// }
```

⚠️ Esto elimina las protecciones críticas del sistema.

---

## ✅ Checklist de Producción

Antes de considerar el sistema listo:

- [x] Tests automáticos pasan (test-correcciones.js)
- [x] Guard-rails activados = 0 durante 24h
- [x] Métricas accesibles vía web
- [x] Logs claros con emojis y estados
- [x] Intermediarios bloqueados correctamente
- [x] Duplicados bloqueados correctamente
- [x] Newsletters ignoradas correctamente
- [x] Estados internos NUNCA llegan a clientes

**Estado actual:** ✅ LISTO PARA PRODUCCIÓN

---

## 🎓 Conceptos Clave

### Idempotencia
No importa cuántas veces llegue el mismo email, solo se responde una vez.

### Guard Rails
Barreras de seguridad que evitan que el sistema haga algo peligroso (enviar estados internos).

### Intermediario
Servicio que reenvía emails (mailer@shopify.com). No es el cliente real.

### Thread ID
Identificador único de una conversación. Permite rastrear hilos completos.

### Estado Interno
Etiquetas del sistema que NUNCA deben llegar a clientes:
- `SOPORTE`
- `SAMU`
- `NECESITA_PERSONA`
- `SIN_RESPUESTA`

---

**Última actualización:** 30/12/2025
**Versión del sistema:** 2.0 (Producción Ready)
