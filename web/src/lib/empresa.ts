/**
 * Los datos de la empresa, para la web pública.
 *
 * ⚠️ **Copiados a mano de `functions/src/company-config.ts`.** No se pueden
 * importar: son tres builds distintos con tres tsconfig, igual que la app y las
 * functions. Si cambian allí, cambian aquí.
 *
 * ⚠️ **Y la regla de los dos nombres se respeta también aquí**, que es donde más
 * se nota: la **marca** en todo lo que le habla al cliente, y la **razón social
 * solo junto al NIF** —el pie legal—. Un cliente no sabe qué es una S.L. ni
 * tiene por qué saberlo, y meterlo en un titular suena a notaría.
 */
export const EMPRESA = {
  /** Lo que ve el cliente en cualquier sitio salvo el pie legal. */
  marca: 'VELTO MOBILITY',
  /** Solo junto al NIF. Ojo: **acaba en punto**, así que nunca al final de una frase. */
  razonSocial: 'VELTO MOBILITY, S.L.',
  nif: 'B88866900',
  /** El domicilio social, del Registro Mercantil. Solo junto al NIF. */
  domicilioSocial: 'C/ Vereda del Melero, 3 · 28500 Arganda del Rey (Madrid)',
  /** La oficina: donde el cliente encuentra a alguien. Es la que se enseña. */
  oficina: 'C/ María Zambrano, 4 · 28500 Arganda del Rey (Madrid)',
  /** Partida en dos, para poder titular con la calle y dejar la ciudad debajo. */
  oficinaCalle: 'Calle María Zambrano, 4',
  oficinaCiudad: '28500 Arganda del Rey (Madrid)',
  telefono: '+34 623 766 181',
  /** Sin espacios ni signos, para el enlace de WhatsApp. */
  telefonoWhatsapp: '34623766181',
  correo: 'reservas@veltorent.com',
} as const;

/** El dominio canónico. `veltorent.com` sirve lo mismo y redirige aquí. */
export const SITIO = 'https://veltomobility.com';
