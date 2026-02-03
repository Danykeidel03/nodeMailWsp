// test-adjuntos.js - Prueba de detección de adjuntos

function analizarAdjuntos(parsed) {
  const adjuntos = parsed.attachments || [];
  
  if (adjuntos.length === 0 && !parsed.html) {
    return { tieneAdjuntos: false, resumen: null };
  }
  
  const imagenes = [];
  const documentos = [];
  const videos = [];
  
  adjuntos.forEach(adj => {
    const tipo = adj.contentType || '';
    const nombre = adj.filename || 'sin nombre';
    const info = { nombre };
    
    if (tipo.startsWith('image/')) {
      imagenes.push(info);
    } else if (tipo.includes('pdf') || tipo.includes('document') || tipo.includes('word')) {
      documentos.push(info);
    } else if (tipo.startsWith('video/')) {
      videos.push(info);
    }
  });
  
  const imagenesInline = parsed.html ? 
    (parsed.html.match(/<img[^>]+src=["']cid:/gi) || []).length : 0;
  
  if (adjuntos.length === 0 && imagenesInline === 0) {
    return { tieneAdjuntos: false, resumen: null };
  }
  
  let resumen = '📎 ADJUNTOS EN ESTE EMAIL:\n';
  
  if (imagenes.length > 0 || imagenesInline > 0) {
    const totalImagenes = imagenes.length + imagenesInline;
    resumen += `- ${totalImagenes} imagen(es)`;
    if (imagenes.length > 0) resumen += `: ${imagenes.map(i => i.nombre).join(', ')}`;
    if (imagenesInline > 0) resumen += ` (${imagenesInline} pegada(s) en el email)`;
    resumen += '\n';
  }
  
  if (documentos.length > 0) {
    resumen += `- ${documentos.length} documento(s): ${documentos.map(d => d.nombre).join(', ')}\n`;
  }
  
  resumen += '\n⚠️ IMPORTANTE: El cliente YA HA ENVIADO estos archivos. NO le pidas fotos/docs.';
  
  return { tieneAdjuntos: true, resumen };
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('PRUEBA 1: Cliente envía fotos de pedido roto');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(analizarAdjuntos({
  attachments: [
    { filename: 'pedido_roto.jpg', contentType: 'image/jpeg' },
    { filename: 'caja_dañada.png', contentType: 'image/png' }
  ]
}).resumen);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('PRUEBA 2: Cliente envía factura PDF');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(analizarAdjuntos({
  attachments: [{ filename: 'factura.pdf', contentType: 'application/pdf' }]
}).resumen);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('PRUEBA 3: Cliente pega capturas en el email');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(analizarAdjuntos({
  attachments: [],
  html: '<img src="cid:img1"><img src="cid:img2">'
}).resumen);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('PRUEBA 4: Email sin adjuntos');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const r = analizarAdjuntos({ attachments: [] });
console.log('Tiene adjuntos:', r.tieneAdjuntos, '(no se añade nada al prompt)');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('PRUEBA 5: Combo fotos + comprobante');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(analizarAdjuntos({
  attachments: [
    { filename: 'foto_producto.jpg', contentType: 'image/jpeg' },
    { filename: 'comprobante_bizum.pdf', contentType: 'application/pdf' }
  ]
}).resumen);
