// shopify.js
const fetch = require('node-fetch');

/**
 * Obtiene el número de seguimiento desde el número de pedido
 * @param {string} numeroPedido - Número del pedido (ej: "5070")
 * @returns {Promise<object>} - Objeto con { encontrado, numeroPedido, numeroSeguimiento, ... }
 */
async function obtenerSeguimientoPorPedido(numeroPedido) {
  try {
    console.log(`[DEBUG SHOPIFY] Buscando pedido #${numeroPedido}`);
    
    const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
    const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    
    console.log(`[DEBUG SHOPIFY] SHOPIFY_SHOP: ${SHOPIFY_SHOP ? 'configurado' : 'NO configurado'}`);
    console.log(`[DEBUG SHOPIFY] SHOPIFY_ACCESS_TOKEN: ${SHOPIFY_ACCESS_TOKEN ? 'configurado' : 'NO configurado'}`);
    
    if (!SHOPIFY_SHOP || !SHOPIFY_ACCESS_TOKEN) {
      console.error('[ERROR] Faltan credenciales de Shopify en .env (SHOPIFY_SHOP o SHOPIFY_ACCESS_TOKEN)');
      return { error: 'Faltan credenciales de Shopify', encontrado: false };
    }

    const apiUrl = `https://${SHOPIFY_SHOP}/admin/api/2025-10/orders.json`;

    // 1. Obtener lista de pedidos (últimos 250)
    const pedidosResponse = await fetch(`${apiUrl}?limit=250&status=any`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!pedidosResponse.ok) {
      console.error(`[ERROR] Shopify API respondió con status: ${pedidosResponse.status}`);
      return { error: 'Error al consultar Shopify API', encontrado: false };
    }

    const pedidosData = await pedidosResponse.json();

    if (!pedidosData.orders || pedidosData.orders.length === 0) {
      return { error: 'No se encontraron pedidos', encontrado: false };
    }

    // 2. Buscar el pedido por número de orden
    const pedido = pedidosData.orders.find(
      order => order.order_number.toString() === numeroPedido.toString()
    );

    if (!pedido) {
      return { 
        error: `Pedido #${numeroPedido} no encontrado`,
        encontrado: false 
      };
    }

    // 3. Extraer número de seguimiento
    let numeroSeguimiento = null;
    let estadoEntrega = 'desconocido';

    if (pedido.fulfillments && pedido.fulfillments.length > 0) {
      const fulfillment = pedido.fulfillments[0];
      
      if (fulfillment.tracking_numbers && fulfillment.tracking_numbers.length > 0) {
        numeroSeguimiento = fulfillment.tracking_numbers[0];
      }
      
      estadoEntrega = fulfillment.status || 'desconocido';
    }

    if (!numeroSeguimiento) {
      return {
        encontrado: true,
        numeroPedido: numeroPedido,
        error: 'No hay número de seguimiento asignado',
        estadoEntrega: estadoEntrega
      };
    }

    return {
      encontrado: true,
      numeroPedido: numeroPedido,
      numeroSeguimiento: numeroSeguimiento,
      estadoEntrega: estadoEntrega,
      cliente: pedido.customer?.email || pedido.email || 'No disponible',
      total: pedido.total_price,
      moneda: pedido.currency
    };

  } catch (error) {
    console.error(`[ERROR] obtenerSeguimientoPorPedido: ${error.message}`);
    return { error: error.message };
  }
}

module.exports = {
  obtenerSeguimientoPorPedido
};
