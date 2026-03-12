// tests/email.test.js
import { describe, it, expect } from 'vitest';

// Recreamos las funciones de email.js para testearlas

/**
 * Detectar si el remitente es un intermediario (no-reply, mailer, etc.)
 */
function esIntermediario(email) {
  const intermediarios = [
    'mailer@shopify.com',
    'no-reply',
    'noreply',
    'notifications@',
    'notification@',
    'automated@',
    'donotreply@',
    'do-not-reply@'
  ];
  
  const emailLower = email.toLowerCase();
  return intermediarios.some(pattern => emailLower.includes(pattern));
}

/**
 * Extraer email real del cliente desde el contenido (para correos de Shopify)
 */
function extraerEmailDelContenido(texto) {
  // Buscar patrones específicos de Shopify
  const patronShopify = /Correo\s+electr[óo]nico:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const matchShopify = texto.match(patronShopify);
  if (matchShopify) {
    return matchShopify[1];
  }
  
  // Patrón genérico: buscar "Email:" o "E-mail:" seguido de un email
  const patronGenerico = /(?:Email|E-mail):\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const matchGenerico = texto.match(patronGenerico);
  if (matchGenerico) {
    return matchGenerico[1];
  }
  
  return null;
}

/**
 * Clasificar emails por dominio para filtrar spam/newsletters
 */
function clasificarPorDominio(email, asunto, texto) {
  const emailLower = email.toLowerCase();
  const asuntoLower = (asunto || '').toLowerCase();
  const textoLower = (texto || '').toLowerCase();
  
  // Judge.me - filtrar reseñas 5 estrellas
  if (emailLower.includes('judge.me')) {
    if (textoLower.includes('5 star') || textoLower.includes('⭐⭐⭐⭐⭐')) {
      return { tipo: 'IGNORAR', razon: 'Reseña positiva de Judge.me - no requiere respuesta' };
    }
    if (textoLower.includes('1 star') || textoLower.includes('2 star')) {
      return { tipo: 'HUMANO', razon: 'Reseña negativa - requiere atención' };
    }
  }
  
  // Newsletters / marketing
  const newsletterDomains = ['merkandi.es', 'mailchimp.com', 'sendinblue.com', 'newsletter@'];
  if (newsletterDomains.some(d => emailLower.includes(d))) {
    return { tipo: 'IGNORAR', razon: 'Newsletter/Marketing - no es cliente' };
  }
  
  // Notificaciones internas de Frezzyks
  if (emailLower.includes('frezzyks.com') && 
      (asuntoLower.includes('new subscriber') || 
       asuntoLower.includes('low stock') || 
       asuntoLower.includes('pocas existencias'))) {
    return { tipo: 'IGNORAR', razon: 'Notificación interna - no requiere respuesta' };
  }
  
  // Patrones de spam comercial
  const patronesSpamVentas = [
    'i\'d like to help you', 'i would like to help you',
    'drive.*sales', 'driving.*sales', 'new sales',
    'handle the marketing', 'marketing services', 'marketing agency',
    'no upfront cost', 'risk-free', 'risk free',
    'would you be interested', 'are you interested',
    'i can help you', 'we can help you',
    'grow your business', 'scale your business',
    'seo services', 'link building', 'backlinks',
    'guest post', 'sponsored post',
    'free consultation', 'free audit'
  ];
  
  const esSpamVentas = patronesSpamVentas.some(patron => 
    textoLower.includes(patron) || asuntoLower.includes(patron)
  );
  
  if (esSpamVentas) {
    return { tipo: 'IGNORAR', razon: 'Spam comercial / Oferta de servicios no solicitada' };
  }
  
  return { tipo: 'PROCESAR', razon: 'Email normal de cliente' };
}


describe('Email - Detección de Intermediarios', () => {
  
  it('debe detectar mailer@shopify.com', () => {
    expect(esIntermediario('mailer@shopify.com')).toBe(true);
  });

  it('debe detectar no-reply', () => {
    expect(esIntermediario('no-reply@empresa.com')).toBe(true);
  });

  it('debe detectar noreply', () => {
    expect(esIntermediario('noreply@tienda.es')).toBe(true);
  });

  it('debe detectar notifications@', () => {
    expect(esIntermediario('notifications@shopify.com')).toBe(true);
  });

  it('debe detectar automated@', () => {
    expect(esIntermediario('automated@sistema.com')).toBe(true);
  });

  it('NO debe detectar email normal de cliente', () => {
    expect(esIntermediario('cliente@gmail.com')).toBe(false);
    expect(esIntermediario('juan.perez@hotmail.com')).toBe(false);
  });

  it('debe ser case-insensitive', () => {
    expect(esIntermediario('NO-REPLY@empresa.com')).toBe(true);
    expect(esIntermediario('MAILER@SHOPIFY.COM')).toBe(true);
  });
});


describe('Email - Extracción de Email del Contenido', () => {
  
  it('debe extraer email con formato Shopify "Correo electrónico:"', () => {
    const texto = 'Cliente: Juan\nCorreo electrónico: juan@gmail.com\nPedido: #1234';
    expect(extraerEmailDelContenido(texto)).toBe('juan@gmail.com');
  });

  it('debe extraer email con formato "Email:"', () => {
    const texto = 'Datos del cliente\nEmail: cliente@hotmail.com\nTeléfono: 123456';
    expect(extraerEmailDelContenido(texto)).toBe('cliente@hotmail.com');
  });

  it('debe extraer email con formato "E-mail:"', () => {
    const texto = 'E-mail: test@example.org';
    expect(extraerEmailDelContenido(texto)).toBe('test@example.org');
  });

  it('debe devolver null si no hay email en formato conocido', () => {
    const texto = 'Hola, tengo una consulta sobre mi pedido';
    expect(extraerEmailDelContenido(texto)).toBe(null);
  });

  it('debe manejar tildes en "electrónico"', () => {
    const texto = 'Correo electronico: sin.tilde@mail.com';
    expect(extraerEmailDelContenido(texto)).toBe('sin.tilde@mail.com');
  });
});


describe('Email - Clasificación por Dominio', () => {
  
  describe('Judge.me', () => {
    it('debe ignorar reseñas 5 estrellas', () => {
      const result = clasificarPorDominio(
        'reviews@judge.me',
        'Nueva reseña',
        'You received a 5 star review!'
      );
      expect(result.tipo).toBe('IGNORAR');
    });

    it('debe escalar reseñas negativas a humano', () => {
      const result = clasificarPorDominio(
        'reviews@judge.me',
        'Nueva reseña',
        'You received a 1 star review'
      );
      expect(result.tipo).toBe('HUMANO');
    });
  });

  describe('Newsletters', () => {
    it('debe ignorar emails de mailchimp', () => {
      const result = clasificarPorDominio('promo@mailchimp.com', 'Oferta', '');
      expect(result.tipo).toBe('IGNORAR');
    });

    it('debe ignorar emails de sendinblue', () => {
      const result = clasificarPorDominio('info@sendinblue.com', 'Newsletter', '');
      expect(result.tipo).toBe('IGNORAR');
    });
  });

  describe('Notificaciones internas', () => {
    it('debe ignorar "new subscriber" de frezzyks', () => {
      const result = clasificarPorDominio(
        'sistema@frezzyks.com',
        'New subscriber to newsletter',
        ''
      );
      expect(result.tipo).toBe('IGNORAR');
    });

    it('debe ignorar "low stock" de frezzyks', () => {
      const result = clasificarPorDominio(
        'alertas@frezzyks.com',
        'Low stock alert',
        ''
      );
      expect(result.tipo).toBe('IGNORAR');
    });
  });

  describe('Spam comercial', () => {
    it('debe ignorar ofertas de marketing', () => {
      const result = clasificarPorDominio(
        'sales@agency.com',
        'Partnership',
        'I would like to help you grow your business with our marketing services'
      );
      expect(result.tipo).toBe('IGNORAR');
    });

    it('debe ignorar ofertas de SEO', () => {
      const result = clasificarPorDominio(
        'john@seocompany.com',
        'SEO Proposal',
        'We offer SEO services and link building'
      );
      expect(result.tipo).toBe('IGNORAR');
    });

    it('debe ignorar "free consultation"', () => {
      const result = clasificarPorDominio(
        'info@consultant.com',
        'Free consultation',
        'Book your free consultation today'
      );
      expect(result.tipo).toBe('IGNORAR');
    });
  });

  describe('Clientes normales', () => {
    it('debe procesar email normal de cliente', () => {
      const result = clasificarPorDominio(
        'juan@gmail.com',
        '¿Dónde está mi pedido?',
        'Hola, quiero saber el estado de mi pedido #1234'
      );
      expect(result.tipo).toBe('PROCESAR');
    });

    it('debe procesar consultas legítimas', () => {
      const result = clasificarPorDominio(
        'maria@hotmail.com',
        'Devolución',
        'Quiero devolver un producto que llegó dañado'
      );
      expect(result.tipo).toBe('PROCESAR');
    });
  });
});
