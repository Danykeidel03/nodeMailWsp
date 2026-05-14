// tests/email.test.js
import { describe, expect } from 'vitest';
import {
  esIntermediario,
  extraerEmailDelContenido,
  clasificarPorDominio
} from '../email.js';


describe('Email - Detección de Intermediarios', () => {
  
  test.each([
    ['mailer@shopify.com', true],
    ['no-reply@empresa.com', true],
    ['noreply@tienda.es', true],
    ['notifications@shopify.com', true],
    ['automated@sistema.com', true],
    ['cliente@gmail.com', false],
    ['juan.perez@hotmail.com', false],
    ['NO-REPLY@empresa.com', true],
    ['MAILER@SHOPIFY.COM', true],
  ])('esIntermediario("%s") -> %s', (email, expected) => {
    expect(esIntermediario(email)).toBe(expected);
  });
});


describe('Email - Extracción de Email del Contenido', () => {
  
  test.each([
    ['Cliente: Juan\nCorreo electrónico: juan@gmail.com\nPedido: #1234', 'juan@gmail.com'],
    ['Datos del cliente\nEmail: cliente@hotmail.com\nTeléfono: 123456', 'cliente@hotmail.com'],
    ['E-mail: test@example.org', 'test@example.org'],
    ['Hola, tengo una consulta sobre mi pedido', null],
    ['Correo electronico: sin.tilde@mail.com', 'sin.tilde@mail.com'],
  ])('extraerEmailDelContenido -> %s', (texto, expected) => {
    expect(extraerEmailDelContenido(texto)).toBe(expected);
  });
});


describe('Email - Clasificación por Dominio', () => {
  
  test.each([
    // Judge.me
    ['reviews@judge.me', 'Nueva reseña', 'You received a 5 star review!', 'IGNORAR', 'judge.me 5 star'],
    ['reviews@judge.me', 'Nueva reseña', 'You received a 1 star review', 'HUMANO', 'judge.me 1 star'],
    // Newsletters
    ['promo@mailchimp.com', 'Oferta', '', 'IGNORAR', 'mailchimp'],
    ['info@sendinblue.com', 'Newsletter', '', 'IGNORAR', 'sendinblue'],
    // Notificaciones internas
    ['sistema@frezzyks.com', 'New subscriber to newsletter', '', 'IGNORAR', 'frezzyks subscriber'],
    ['alertas@frezzyks.com', 'Low stock alert', '', 'IGNORAR', 'frezzyks low stock'],
    // Spam comercial
    ['sales@agency.com', 'Partnership', 'I would like to help you grow your business with our marketing services', 'IGNORAR', 'spam marketing'],
    ['john@seocompany.com', 'SEO Proposal', 'We offer SEO services and link building', 'IGNORAR', 'spam seo'],
    ['info@consultant.com', 'Free consultation', 'Book your free consultation today', 'IGNORAR', 'spam consultation'],
    // Clientes normales
    ['juan@gmail.com', '¿Dónde está mi pedido?', 'Hola, quiero saber el estado de mi pedido #1234', 'PROCESAR', 'cliente normal 1'],
    ['maria@hotmail.com', 'Devolución', 'Quiero devolver un producto que llegó dañado', 'PROCESAR', 'cliente normal 2'],
  ])('clasificarPorDominio - %s -> %s', (email, asunto, texto, expected, _label) => {
    const result = clasificarPorDominio(email, asunto, texto);
    expect(result.tipo).toBe(expected);
  });
});
