# Prompt del Clasificador - Frezzyks

<!-- 
  Este archivo se genera dinámicamente combinando las secciones.
  Para editar el comportamiento del bot, modifica los archivos en /sections/
  
  Secciones disponibles:
  - 01-personalidad.md      → Tono y estilo del bot
  - 02-reglas-antirepeticion.md → Evitar respuestas repetidas
  - 03-envios.md            → Información de envíos
  - 04-devoluciones.md      → Políticas de devolución
  - 05-pagos.md             → Pagos y facturas
  - 06-newsletter.md        → Descuentos y newsletter
  - 07-pedido-cuenta.md     → Pedido no aparece en cuenta
  - 08-localizar-pedido.md  → Consultar estado de pedido
  - 09-productos.md         → FAQ de productos
  - 10-b2b.md               → Ventas B2B
  - 11-colaboraciones.md    → Influencers y colaboraciones
  - 12-escalado.md          → Reglas de escalado (SOPORTE/SAMU/etc)
-->

## Variables Dinámicas

Las siguientes variables se inyectan en tiempo de ejecución:

- `{{HISTORIAL_CONVERSACION}}` - Mensajes previos del hilo
- `{{INFO_ADJUNTOS}}` - Información sobre archivos adjuntos
- `{{INFO_PEDIDO}}` - Datos del pedido desde Shopify/Correos
- `{{INFO_SEGUIMIENTO}}` - Estado del envío
