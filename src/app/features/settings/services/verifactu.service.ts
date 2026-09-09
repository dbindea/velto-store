import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

/**
 * El estado de la remisión a la AEAT.
 *
 * ⚠️ **Todo esto lo sirve la function, ninguna constante de la aplicación.** Si
 * el envío está activo y contra qué entorno lo deciden las variables del
 * backend (`VELTO_VERIFACTU_ENABLED`, `VELTO_VERIFACTU_ENV`), y la aplicación se
 * compila igual para desarrollo y producción: una copia en el frontend diría lo
 * que el bundle traía escrito, no lo que está pasando. Es el mismo motivo por el
 * que el correo de la pantalla de firma lo sirve `getContractForSigning` y no
 * `brand.config.ts` (F-33).
 */
export interface PendienteVerifactu {
  invoiceId: string;
  fullNumber: string;
  estado: 'pendiente' | 'error' | 'rechazado';
  intentos: number;
  codigoError?: number;
  descripcionError?: string;
}

export interface EstadoVerifactu {
  enabled: boolean;
  /** `test` = preproducción. Aceptado ahí **no es** presentado. */
  entorno: 'test' | 'live';
  endpoint: string;
  pendientes: PendienteVerifactu[];
  aceptadas: number;
  bloqueadaPor?: string;
  siguienteEnvio?: string;
}

export interface ResumenEnvio {
  resultado: 'disabled' | 'waiting' | 'blocked' | 'empty' | 'sent';
  enviados: number;
  aceptados: number;
  rechazados: number;
  errores: number;
  pendientes: number;
  csv?: string;
  bloqueadaPor?: string;
  detalle?: string;
}

@Injectable({ providedIn: 'root' })
export class VerifactuService {
  private functions = inject(Functions);

  async status(): Promise<EstadoVerifactu> {
    const fn = httpsCallable<Record<string, unknown>, EstadoVerifactu>(
      this.functions,
      'getVerifactuStatus'
    );
    return (await fn({})).data;
  }

  /**
   * Manda ahora lo que haya pendiente.
   *
   * ⚠️ **Devuelve un resumen, no un booleano.** «No había nada que enviar»,
   * «hay que esperar al plazo que marcó la Agencia» y «la cadena está bloqueada
   * por una factura rechazada» son tres cosas distintas, y la de en medio no es
   * un fallo. Un `true`/`false` obligaría a la pantalla a inventarse cuál era.
   */
  async send(): Promise<ResumenEnvio> {
    const fn = httpsCallable<Record<string, unknown>, ResumenEnvio>(
      this.functions,
      'sendVerifactuRecords'
    );
    return (await fn({})).data;
  }
}
