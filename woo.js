const axios = require('axios');

async function obtenerEstadoPedido(orderNumber) {
  const shopName = process.env.SHOPIFY_SHOP_NAME;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

  const query = `
    query {
      orders(first: 1, query: "name:${orderNumber}") {
        edges {
          node {
            id
            name
            status
            displayFulfillmentStatus
            fulfillmentOrders {
              status
            }
          }
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      `https://${shopName}.myshopify.com/admin/api/2024-01/graphql.json`,
      { query },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('Error en GraphQL:', response.data.errors);
      return null;
    }

    const orders = response.data.data.orders.edges;
    
    if (!orders || orders.length === 0) {
      console.error('No se encontró pedido:', orderNumber);
      return null;
    }

    const order = orders[0].node;
    return order.displayFulfillmentStatus || order.status;

  } catch (error) {
    console.error('Error al obtener estado del pedido:', error.message);
    return null;
  }
}

module.exports = { obtenerEstadoPedido };
