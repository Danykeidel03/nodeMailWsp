// metricas.js
// Sistema de métricas para el bot de clasificación

const fs = require('fs');
const path = require('path');

// Contadores en memoria
const metricas = {
  emailsRecibidos: 0,
  emailsAutomatizados: 0,
  emailsEscaladosSoporte: 0,
  emailsEscaladosSamu: 0,
  emailsIgnorados: 0,
  duplicadosBloqueados: 0,
  intermediariosBloqueados: 0,
  newslettersIgnoradas: 0,
  guardrailsActivados: 0, // Cuántas veces se bloqueó un estado interno
  errores: 0,
  
  // Desglose por tipo
  porTipo: {
    ordenPedido: 0,
    seguimientoEnvio: 0,
    devolucion: 0,
    facturacion: 0,
    colaboracion: 0,
    b2b: 0,
    consulta: 0,
    otros: 0
  },
  
  // Tiempos de respuesta (en segundos)
  tiemposRespuesta: [],
  
  inicioSesion: new Date()
};

// Registrar email recibido
function registrarEmailRecibido() {
  metricas.emailsRecibidos++;
}

// Registrar email automatizado (bot respondió)
function registrarEmailAutomatizado(tipo = 'otros') {
  metricas.emailsAutomatizados++;
  if (metricas.porTipo[tipo] !== undefined) {
    metricas.porTipo[tipo]++;
  }
}

// Registrar email escalado
function registrarEmailEscalado(destino = 'soporte') {
  if (destino === 'soporte' || destino === 'SOPORTE') {
    metricas.emailsEscaladosSoporte++;
  } else if (destino === 'samu' || destino === 'SAMU') {
    metricas.emailsEscaladosSamu++;
  }
}

// Registrar email ignorado (sin respuesta)
function registrarEmailIgnorado(razon = 'otros') {
  metricas.emailsIgnorados++;
  
  if (razon.toLowerCase().includes('newsletter') || razon.toLowerCase().includes('marketing')) {
    metricas.newslettersIgnoradas++;
  }
}

// Registrar duplicado bloqueado
function registrarDuplicado() {
  metricas.duplicadosBloqueados++;
}

// Registrar intermediario bloqueado
function registrarIntermediario() {
  metricas.intermediariosBloqueados++;
}

// Registrar guardrail activado (estado interno bloqueado)
function registrarGuardrailActivado() {
  metricas.guardrailsActivados++;
}

// Registrar error
function registrarError() {
  metricas.errores++;
}

// Registrar tiempo de respuesta
function registrarTiempoRespuesta(segundos) {
  metricas.tiemposRespuesta.push(segundos);
  
  // Mantener solo los últimos 100 tiempos
  if (metricas.tiemposRespuesta.length > 100) {
    metricas.tiemposRespuesta.shift();
  }
}

// Obtener métricas actuales
function obtenerMetricas() {
  const total = metricas.emailsRecibidos;
  const procesados = metricas.emailsAutomatizados + metricas.emailsEscaladosSoporte + 
                     metricas.emailsEscaladosSamu + metricas.emailsIgnorados;
  
  // Calcular promedios
  let tiempoPromedioRespuesta = 0;
  if (metricas.tiemposRespuesta.length > 0) {
    tiempoPromedioRespuesta = metricas.tiemposRespuesta.reduce((a, b) => a + b, 0) / 
                              metricas.tiemposRespuesta.length;
  }
  
  // Calcular porcentajes
  const porcentajeAutomatizacion = total > 0 ? ((metricas.emailsAutomatizados / total) * 100).toFixed(2) : 0;
  const porcentajeEscalado = total > 0 ? (((metricas.emailsEscaladosSoporte + metricas.emailsEscaladosSamu) / total) * 100).toFixed(2) : 0;
  
  const tiempoActivoMinutos = Math.floor((Date.now() - metricas.inicioSesion.getTime()) / 1000 / 60);
  
  return {
    total: metricas.emailsRecibidos,
    automatizados: metricas.emailsAutomatizados,
    escaladosSoporte: metricas.emailsEscaladosSoporte,
    escaladosSamu: metricas.emailsEscaladosSamu,
    ignorados: metricas.emailsIgnorados,
    procesados,
    
    // Seguridad
    duplicadosBloqueados: metricas.duplicadosBloqueados,
    intermediariosBloqueados: metricas.intermediariosBloqueados,
    newslettersIgnoradas: metricas.newslettersIgnoradas,
    guardrailsActivados: metricas.guardrailsActivados,
    
    errores: metricas.errores,
    
    // Porcentajes
    porcentajeAutomatizacion: `${porcentajeAutomatizacion}%`,
    porcentajeEscalado: `${porcentajeEscalado}%`,
    
    // Tiempos
    tiempoPromedioRespuesta: `${tiempoPromedioRespuesta.toFixed(2)}s`,
    tiempoActivo: `${tiempoActivoMinutos} minutos`,
    
    // Desglose
    porTipo: metricas.porTipo,
    
    inicioSesion: metricas.inicioSesion.toISOString()
  };
}

// Mostrar métricas en consola (formato legible)
function mostrarMetricas() {
  const m = obtenerMetricas();
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 MÉTRICAS DEL BOT DE CLASIFICACIÓN');
  console.log('='.repeat(60));
  console.log(`⏱️  Tiempo activo: ${m.tiempoActivo}`);
  console.log(`📧 Total emails recibidos: ${m.total}`);
  console.log(`✅ Emails automatizados: ${m.automatizados} (${m.porcentajeAutomatizacion})`);
  console.log(`👥 Escalados a soporte: ${m.escaladosSoporte}`);
  console.log(`👔 Escalados a Samu: ${m.escaladosSamu}`);
  console.log(`🔇 Ignorados (sin respuesta): ${m.ignorados}`);
  console.log('');
  console.log('🛡️  SEGURIDAD:');
  console.log(`   • Duplicados bloqueados: ${m.duplicadosBloqueados}`);
  console.log(`   • Intermediarios bloqueados: ${m.intermediariosBloqueados}`);
  console.log(`   • Newsletters ignoradas: ${m.newslettersIgnoradas}`);
  console.log(`   • Guard-rails activados: ${m.guardrailsActivados}`);
  console.log('');
  console.log(`⚠️  Errores: ${m.errores}`);
  console.log(`⚡ Tiempo promedio respuesta: ${m.tiempoPromedioRespuesta}`);
  console.log('='.repeat(60) + '\n');
}

// Guardar métricas en archivo (opcional, para histórico)
function guardarMetricasEnArchivo() {
  try {
    const m = obtenerMetricas();
    const archivo = path.join(__dirname, 'logs', `metricas_${new Date().toISOString().split('T')[0]}.json`);
    
    // Crear directorio logs si no existe
    const dirLogs = path.join(__dirname, 'logs');
    if (!fs.existsSync(dirLogs)) {
      fs.mkdirSync(dirLogs, { recursive: true });
    }
    
    fs.writeFileSync(archivo, JSON.stringify(m, null, 2));
    console.log(`✅ Métricas guardadas en: ${archivo}`);
  } catch (error) {
    console.error('Error guardando métricas:', error);
  }
}

// Mostrar métricas cada 30 minutos (DESACTIVADO)
// setInterval(() => {
//   mostrarMetricas();
// }, 30 * 60 * 1000); // 30 minutos

// Guardar métricas cada hora (DESACTIVADO)
// setInterval(() => {
//   guardarMetricasEnArchivo();
// }, 60 * 60 * 1000); // 1 hora

module.exports = {
  registrarEmailRecibido,
  registrarEmailAutomatizado,
  registrarEmailEscalado,
  registrarEmailIgnorado,
  registrarDuplicado,
  registrarIntermediario,
  registrarGuardrailActivado,
  registrarError,
  registrarTiempoRespuesta,
  obtenerMetricas,
  mostrarMetricas,
  guardarMetricasEnArchivo
};
