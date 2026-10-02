/**
 * Los datos estructurados (JSON-LD) de la web.
 *
 * ⚠️ **Existen para que un buscador —y una IA— pueda contestar sin leer la
 * página.** Google los usa para el panel local y los resultados enriquecidos;
 * los buscadores con IA los usan para citar datos concretos —el horario, el
 * teléfono, la zona de servicio— sin tener que interpretar prosa. Es el único
 * sitio de la web donde los datos están en un formato que una máquina entiende
 * sin ambigüedad.
 *
 * ⚠️ **Un solo módulo, porque el negocio se declara en DOS páginas.** Estaba
 * escrito a mano dentro de `/contacto` y la portada no declaraba nada — justo
 * la página que posiciona para «alquiler de coches Arganda». Copiarlo habría
 * dado dos descripciones del mismo negocio, y la que se queda vieja es siempre
 * la que no se mira.
 *
 * ⚠️ **Y por eso lleva `@id` estable.** Es lo que le dice al buscador que las
 * dos páginas hablan de la **misma** entidad y no de dos negocios parecidos:
 * con `@id`, lo que encuentra en una confirma lo que encuentra en la otra; sin
 * él, compiten.
 *
 * ⚠️ **Todo lo que se declara aquí tiene que ser VERDAD y coincidir con la
 * ficha de Google Business Profile.** Una discrepancia entre la web y la ficha
 * no da error en ninguna parte: simplemente el buscador se fía menos de las
 * dos. Si cambia el horario en `empresa.ts`, cambia en la ficha.
 */

import { EMPRESA, HORARIO, SITIO } from './empresa';
import { RADIO_SIN_COSTE_KM, ZONAS_CERCANAS } from './zonas';

/** La identidad del negocio, para que las dos páginas hablen de lo mismo. */
export const ID_NEGOCIO = `${SITIO}/#negocio`;

/**
 * El negocio.
 *
 * ⚠️ **`AutoRental` y no `LocalBusiness` a secas.** Es un subtipo real del
 * vocabulario de schema.org y le dice al buscador a qué se dedica esto sin que
 * tenga que deducirlo del texto. `LocalBusiness` lo entendería cualquier
 * peluquería.
 */
export function negocio() {
  return {
    '@context': 'https://schema.org',
    '@type': 'AutoRental',
    '@id': ID_NEGOCIO,
    name: EMPRESA.marca,
    legalName: EMPRESA.razonSocial,
    vatID: EMPRESA.nif,
    url: SITIO,
    /**
     * ⚠️ **La imagen es la misma que la de compartir**, y no es pereza: es la
     * única imagen de marca en PNG que existe, y el buscador la usa en el
     * panel. Un `image` que apunte a un SVG se descarta en silencio.
     */
    image: `${SITIO}/brand/og.png`,
    logo: `${SITIO}/brand/og.png`,
    telephone: EMPRESA.telefono,
    email: EMPRESA.correo,
    /**
     * ⚠️ **La oficina, no el domicilio social.** Es dónde el cliente encuentra
     * a alguien, que es lo que el buscador va a enseñar en el mapa. El
     * registral vive en `/aviso-legal`, junto al NIF.
     */
    address: {
      '@type': 'PostalAddress',
      streetAddress: EMPRESA.oficinaCalle,
      postalCode: '28500',
      addressLocality: 'Arganda del Rey',
      addressRegion: 'Madrid',
      addressCountry: 'ES',
    },
    openingHoursSpecification: HORARIO.flatMap((d) =>
      d.tramos.map((t) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [...d.dias],
        opens: t[0],
        closes: t[1],
      }))
    ),
    /**
     * Hasta dónde se llega. No es decorativo: es lo que permite salir en una
     * búsqueda hecha desde Rivas o desde Coslada, que es medio negocio.
     *
     * ⚠️ **Sale del mismo catálogo que la página de entrega**, no de una lista
     * escrita aquí: dos listas de pueblos divergen a la primera.
     */
    areaServed: [
      {
        '@type': 'GeoCircle',
        geoMidpoint: {
          '@type': 'GeoCoordinates',
          address: `${EMPRESA.oficinaCalle}, 28500 Arganda del Rey`,
        },
        geoRadius: String(RADIO_SIN_COSTE_KM * 1000),
      },
      ...ZONAS_CERCANAS.map((n) => ({ '@type': 'City', name: n })),
    ],
    /**
     * ⚠️ **`priceRange` se declara aunque parezca vago.** Google lo enseña en
     * el panel y, si falta, lo deja en blanco o se lo inventa de las reseñas.
     * Son símbolos de euro, no un importe: la escala es del buscador.
     */
    priceRange: '€€',
    currenciesAccepted: 'EUR',
    paymentAccepted: 'Efectivo, Tarjeta, Bizum, Transferencia',
    /** La ficha de Google: lo que ata esta web a ese negocio del mapa. */
    sameAs: [EMPRESA.fichaGoogle],
  };
}

/**
 * Las migas de pan, para el buscador.
 *
 * ⚠️ **No las pinta la página: las declara.** Google las usa para enseñar la
 * ruta en vez de la URL cruda en el resultado —«velto › Flota › Toyota
 * Corolla» en lugar de `veltomobility.com/coche/abc123`—, que es lo que hace
 * que un resultado se pulse. La ficha de coche tiene su enlace «Volver a la
 * flota» pero eso es navegación, no estructura declarada.
 */
export function migas(items: { nombre: string; ruta: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.nombre,
      item: `${SITIO}${it.ruta}`,
    })),
  };
}
