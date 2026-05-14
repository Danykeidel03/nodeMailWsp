// shopify.js
const _nodeFetch = require('node-fetch');

// Permite inyectar un fetch alternativo en tests (no usar en producción)
let _fetchImpl = _nodeFetch;
function _setFetchForTesting(mockFetch) {
  _fetchImpl = mockFetch;
}
function _resetFetch() {
  _fetchImpl = _nodeFetch;
}

/**
 * Consulta la Shopify Admin API para obtener tracking de un pedido por su número.
 *
 * @param {string} numeroPedido - Número del pedido (sin '#'), ej: "5070".
 * @returns {Promise<{encontrado?: boolean, numeroPedido?: string, numeroSeguimiento?: string, estadoEntrega?: string, cliente?: string, total?: string, moneda?: string, error?: string}>}
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

    // Buscar directamente por nombre del pedido (order_number)
    const apiUrl = `https://${SHOPIFY_SHOP}/admin/api/2025-10/orders.json`;
    const pedidosResponse = await _fetchImpl(`${apiUrl}?name=${numeroPedido}&status=any`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!pedidosResponse.ok) {
      console.error(`[ERROR] Shopify API respondió con status: ${pedidosResponse.status}`);
      const errorText = await pedidosResponse.text();
      console.error(`[ERROR] Respuesta:`, errorText);
      return { error: 'Error al consultar Shopify API', encontrado: false };
    }

    const pedidosData = await pedidosResponse.json();
    
    console.log(`[DEBUG SHOPIFY] Búsqueda por name=${numeroPedido}, resultados:`, pedidosData.orders?.length || 0);

    if (!pedidosData.orders || pedidosData.orders.length === 0) {
      return { 
        error: `Pedido #${numeroPedido} no encontrado`,
        encontrado: false 
      };
    }

    // El primer resultado debería ser nuestro pedido
    const pedido = pedidosData.orders[0];

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
  obtenerSeguimientoPorPedido,
  // Exportado para testing — no usar fuera de tests
  _setFetchForTesting,
  _resetFetch
};
