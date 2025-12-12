#!/usr/bin/env node
// test-seguimiento.js
// Script para probar obtención de número de seguimiento y su estado

require('dotenv').config();
const { obtenerSeguimientoPorPedido } = require('./shopify');
const { obtenerEstadoEnvio } = require('./seguimiento');

async function testSeguimiento() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST: Obtener Seguimiento y Estado del Envío              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Test con pedido #5070
  const numeroPedido = '5070';
  console.log(`📦 Paso 1: Obtener número de seguimiento del pedido #${numeroPedido}\n`);
  
  const infoPedido = await obtenerSeguimientoPorPedido(numeroPedido);
  
  if (!infoPedido.encontrado) {
    console.error(`❌ Error: ${infoPedido.error}`);
    process.exit(1);
  }

  console.log('✅ Pedido encontrado:');
  console.log(`   - Número pedido: #${infoPedido.numeroPedido}`);
  console.log(`   - Número seguimiento: ${infoPedido.numeroSeguimiento}`);
  console.log(`   - Estado entrega: ${infoPedido.estadoEntrega}`);
  console.log(`   - Cliente: ${infoPedido.cliente}`);
  console.log(`   - Total: ${infoPedido.total} ${infoPedido.moneda}\n`);

  // Obtener estado del envío
  console.log(`📍 Paso 2: Obtener estado del envío #${infoPedido.numeroSeguimiento}\n`);
  
  const estadoEnvio = await obtenerEstadoEnvio(infoPedido.numeroSeguimiento);
  
  if (!estadoEnvio.encontrado) {
    console.error(`❌ Error: ${estadoEnvio.error}`);
    process.exit(1);
  }

  console.log('✅ Estado del envío obtenido:');
  console.log(`   - Estado: ${estadoEnvio.estado}`);
  console.log(`   - Destinatario: ${estadoEnvio.destinatario}`);
  console.log(`   - Ciudad: ${estadoEnvio.ciudad}`);
  console.log(`   - Fecha/Hora: ${estadoEnvio.fecha} ${estadoEnvio.hora}`);
  console.log(`   - Peso: ${estadoEnvio.kilos} kg`);
  console.log(`   - Bultos: ${estadoEnvio.bultos}\n`);

  if (estadoEnvio.ultimos_eventos && estadoEnvio.ultimos_eventos.length > 0) {
    console.log('   📋 Últimos eventos:');
    estadoEnvio.ultimos_eventos.forEach((evento, idx) => {
      console.log(`      ${idx + 1}. ${evento.estado} (${evento.fecha} ${evento.hora}) - ${evento.ubicacion}`);
    });
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ TEST COMPLETADO EXITOSAMENTE                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
}

testSeguimiento().catch(error => {
  console.error('❌ Error en test:', error.message);
  process.exit(1);
});
