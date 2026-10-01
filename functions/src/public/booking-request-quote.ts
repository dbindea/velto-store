/**
 * El presupuesto en PDF de una pre-reserva hecha desde la web.
 *
 * ⚠️ **Reutiliza `buildQuotePdf`, el mismo documento que manda el operador.**
 * No es un PDF nuevo: es el presupuesto de siempre con los datos que ya tiene
 * la solicitud. Un segundo generador habría dado dos presupuestos con distinta
 * letra pequeña, y el que se queda viejo es siempre el que menos se mira.
 *
 * ⚠️ **Y NO lleva la matrícula.** El mapeador público la excluye a propósito
 * —clonado de placas, y en un coche cedido señala el vehículo de un
 * particular—, así que meterla en un PDF que cualquiera puede generar
 * rellenando un formulario publicaría por la puerta de atrás justo el campo que
 * la API se cuida de no dar. El documento nombra el coche por marca, modelo y
 * versión, que es lo que el cliente ha elegido.
 *
 * ⚠️ **La validez del presupuesto es la del PRECIO GARANTIZADO, no los días de
 * Ajustes.** El diálogo promete 24 horas y el PDF diría «válido 7 días»: dos
 * plazos para el mismo precio, y el cliente se queda con el que más le
 * conviene — con razón, porque se lo hemos dado por escrito.
 */

import * as logger from 'firebase-functions/logger';
import { randomUUID } from 'crypto';
import { uploadPdf } from '../documents/storage';
import { documentLinkUrl, shortIdFor } from '../documents/documentLink';
import { companyConfig } from '../company-config';
import type { ContractLocale } from '../contracts/contract-types';

export interface DatosPresupuesto {
  nombre: string;
  telefono: string;
  email: string;
  /** El documento del vehículo, tal cual sale de Firestore. */
  coche: Record<string, unknown>;
  recogida: Date;
  devolucion: Date;
  dias: number;
  precio: { net: number; gross: number; vatRate: number };
  /** Hasta cuándo vale, que es lo mismo que dura el precio garantizado. */
  validoHasta: Date;
  fianza?: number;
}

/**
 * Genera el PDF y lo sube. Devuelve el enlace corto, o `null` si algo falla.
 *
 * ⚠️ **Nunca lanza.** Quien llama ya ha escrito la solicitud: perder el
 * presupuesto es un problema, perder la pre-reserva que el cliente acaba de
 * mandar es uno mucho mayor. Es la misma regla que el sellado del contrato,
 * que se guarda sin sellar antes que perder la firma.
 */
export async function presupuestoDeSolicitud(d: DatosPresupuesto): Promise<string | null> {
  try {
    const locale: ContractLocale =
      (process.env.VELTO_DEFAULT_CONTRACT_LOCALE as ContractLocale) || 'es';

    /*
     * ⚠️ **Perezoso, como el resto de los generadores.** `index.ts` evalúa
     * este fichero en cada arranque en frío de CUALQUIERA de las functions:
     * con el import arriba, una petición para listar cuatro coches cargaría
     * `pdf-lib` y `fontkit` enteros. Lo vigila `arranque.spec.ts`.
     */
    const { buildQuotePdf } = await import('../documents/documents-pdf');

    const pdfBytes = await buildQuotePdf({
      company: companyConfig(),
      client: { fullName: d.nombre, phone: d.telefono, ...(d.email ? { email: d.email } : {}) },
      vehicle: {
        brand: String(d.coche['brand'] ?? ''),
        model: String(d.coche['model'] ?? ''),
        ...(d.coche['version'] ? { version: String(d.coche['version']) } : {}),
        // Sin matrícula: ver la nota de cabecera.
        plateNumber: '',
        ...(typeof d.coche['year'] === 'number' ? { year: d.coche['year'] } : {}),
        ...(d.coche['fuelType'] ? { fuelType: String(d.coche['fuelType']) } : {}),
        ...(d.coche['transmission'] ? { transmission: String(d.coche['transmission']) } : {}),
      },
      rental: {
        pickupDateTime: d.recogida,
        returnDateTime: d.devolucion,
        totalDays: d.dias,
      },
      pricing: {
        finalPrice: d.precio.gross,
        netPrice: d.precio.net,
        vatRate: d.precio.vatRate,
        ...(typeof d.fianza === 'number' ? { depositAmount: d.fianza } : {}),
      },
      locale,
      generatedAt: new Date(),
      validUntil: d.validoHasta,
    });

    /*
     * Carpeta nueva por presupuesto, como la del operador: dos presupuestos
     * del mismo coche el mismo día son dos ofertas distintas, y pisar una con
     * la otra cambiaría un documento que ya se ha mandado.
     *
     * ⚠️ **El id es el secreto que guarda el documento** (~95 bits), igual que
     * en `/d/…`: no se deriva de la referencia de la solicitud, que es corta y
     * se dicta por teléfono.
     */
    const quoteId = randomUUID().replace(/-/g, '').slice(0, 16);
    await uploadPdf(`quotes/${quoteId}/quote.pdf`, pdfBytes);
    return documentLinkUrl(shortIdFor('quote', quoteId));
  } catch (error) {
    logger.error('No se pudo generar el presupuesto de la solicitud', error);
    return null;
  }
}
