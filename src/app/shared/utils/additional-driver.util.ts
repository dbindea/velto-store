import { AdditionalDriver } from '@shared/models/reservation.model';
import { Client } from '@shared/models/client.model';
import { FieldProblems } from '@shared/utils/form-problems.util';

/**
 * Conductores autorizados además del arrendatario.
 *
 * La cláusula 2 del contrato exige que estén **identificados nominalmente**, y
 * de ahí sale lo que se pide aquí: sin nombre no hay identificación, y sin
 * carné no se puede sostener que la persona cumple los requisitos que el
 * arrendatario garantiza en esa misma cláusula.
 */

/** Cuántos caben. Un coche de cinco plazas con más de cuatro turnándose no es
 *  un alquiler, es otra cosa; y el bloque del contrato tiene que caber. */
export const MAX_ADDITIONAL_DRIVERS = 4;

/**
 * Normaliza lo que el operador teclea.
 *
 * Mismas convenciones que el resto de la aplicación: el documento y el carné en
 * mayúsculas y sin espacios —son referencias, no texto libre— y el nombre tal y
 * como venga, que ya lo capitaliza el campo mientras se escribe.
 */
export function buildAdditionalDriver(input: {
  clientId?: string;
  fullName: string;
  documentNumber?: string;
  drivingLicenseNumber?: string;
}): AdditionalDriver {
  const driver: AdditionalDriver = {
    fullName: input.fullName.trim().replace(/\s+/g, ' ')
  };
  // Se omiten los vacíos en vez de guardarlos como cadena: Firestore prohíbe
  // `undefined`, pero un `''` guardado se imprimiría como una etiqueta vacía en
  // el contrato.
  const doc = input.documentNumber?.toUpperCase().replace(/\s+/g, '');
  const lic = input.drivingLicenseNumber?.toUpperCase().replace(/\s+/g, '');
  if (input.clientId) driver.clientId = input.clientId;
  if (doc) driver.documentNumber = doc;
  if (lic) driver.drivingLicenseNumber = lic;
  return driver;
}

/** El conductor tal y como se copia de la ficha de un cliente ya dado de alta. */
export function driverFromClient(client: Client): AdditionalDriver {
  return buildAdditionalDriver({
    clientId: client.id,
    fullName: client.fullName,
    documentNumber: client.documentNumber,
    drivingLicenseNumber: client.drivingLicenseNumber
  });
}

/**
 * Qué falta por rellenar. Una función por formulario, como manda el proyecto:
 * la misma que pinta la pantalla la llama el servicio antes de escribir.
 *
 * `existing` sirve para detectar repetidos: añadir dos veces al mismo conductor
 * no es un error del que avisar tarde, es una fila duplicada en el contrato.
 */
export function validateAdditionalDriver(
  input: { fullName: string; documentNumber?: string; drivingLicenseNumber?: string },
  existing: AdditionalDriver[] = []
): FieldProblems {
  const problems: FieldProblems = {};

  if (!input.fullName?.trim()) {
    problems['fullName'] = 'reservations.drivers.errors.nameRequired';
  }
  if (!input.documentNumber?.trim()) {
    problems['documentNumber'] = 'reservations.drivers.errors.documentRequired';
  }
  if (!input.drivingLicenseNumber?.trim()) {
    // Sin carné no se puede sostener la cláusula 2, que exige que el
    // arrendatario garantice que quien conduce está habilitado.
    problems['drivingLicenseNumber'] = 'reservations.drivers.errors.licenseRequired';
  }

  const doc = input.documentNumber?.toUpperCase().replace(/\s+/g, '');
  if (doc && existing.some(d => d.documentNumber === doc)) {
    problems['documentNumber'] = 'reservations.drivers.errors.duplicate';
  }

  if (existing.length >= MAX_ADDITIONAL_DRIVERS) {
    problems['fullName'] = 'reservations.drivers.errors.tooMany';
  }

  return problems;
}

/**
 * Una línea por conductor, para el contrato y para la pantalla de firma:
 * `Juan Pérez · DNI 12345678Z · Permiso B1234567`.
 *
 * Las etiquetas llegan traducidas de fuera porque este texto se compone en tres
 * idiomas —el del documento, no el de la aplicación— y aquí no hay acceso al
 * diccionario.
 */
export function formatAdditionalDriver(
  driver: AdditionalDriver,
  labels: { document: string; license: string }
): string {
  return [
    driver.fullName,
    driver.documentNumber ? `${labels.document} ${driver.documentNumber}` : '',
    driver.drivingLicenseNumber ? `${labels.license} ${driver.drivingLicenseNumber}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
}
