import { Injectable, inject, signal } from '@angular/core';
import { Firestore, doc, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { cleanForFirestore } from '@shared/utils/firestore-clean.util';
import {
  DEFAULT_OPERATION_SETTINGS,
  OPERATION_SETTINGS_PATH,
  OperationSettings
} from '@shared/models/settings.model';
import { resolveSettings, validateSettings } from '@shared/utils/settings.util';
import { firstProblem } from '@shared/utils/form-problems.util';

/**
 * Los ajustes de la operación, leídos una vez y compartidos.
 *
 * ⚠️ **Son valores por defecto para lo que se cree a partir de ahora.** Nada de
 * lo ya creado se mueve: el IVA va congelado en cada reserva, el precio en su
 * snapshot y la caducidad en el propio token de firma. Si alguna vez alguien
 * hace que un cambio aquí recalcule algo existente, habrá roto la regla que
 * sostiene que un contrato firmado siga cuadrando dentro de dos años.
 *
 * ⚠️ **Las Cloud Functions leen este mismo documento por su cuenta**, con el
 * admin SDK, para la validez del presupuesto y la caducidad del enlace de firma:
 * esas dos decisiones se toman en el backend y no podían llegar desde aquí. Si
 * se añade un ajuste que gobierne un PDF, hay que tocar los dos lados.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private firestore = inject(Firestore);

  /**
   * Lo último leído, para que quien lo necesite no dispare una lectura por
   * pantalla. Arranca con los valores del código, que es lo que rige mientras
   * no haya documento.
   */
  private readonly _settings = signal<OperationSettings>({ ...DEFAULT_OPERATION_SETTINGS });
  readonly settings = this._settings.asReadonly();

  private loaded: Promise<OperationSettings> | null = null;

  /**
   * Los ajustes vigentes. La primera llamada lee de Firestore; las siguientes
   * comparten esa misma promesa.
   */
  load(force = false): Promise<OperationSettings> {
    if (force) this.loaded = null;
    if (this.loaded) return this.loaded;

    this.loaded = this.read();
    // Un fallo de red no se cachea: la siguiente pantalla vuelve a intentarlo en
    // vez de quedarse con los valores del código para toda la sesión.
    this.loaded.catch(() => (this.loaded = null));
    return this.loaded;
  }

  private async read(): Promise<OperationSettings> {
    const snap = await getDoc(doc(this.firestore, OPERATION_SETTINGS_PATH));
    const resolved = resolveSettings(snap.exists() ? (snap.data() as OperationSettings) : null);
    this._settings.set(resolved);
    return resolved;
  }

  /**
   * Guarda. Valida antes de escribir en vez de recortar en silencio: un IVA
   * tecleado como 21 en lugar de 0,21 tiene que decirlo, no convertirse en otro
   * número a espaldas de quien lo escribió.
   */
  async save(settings: OperationSettings, updatedBy?: string): Promise<void> {
    const problem = firstProblem(validateSettings(settings));
    if (problem) throw new Error(problem);

    const payload = cleanForFirestore(
      { ...settings, updatedAt: serverTimestamp(), updatedBy },
      { stripNulls: true }
    );
    await setDoc(doc(this.firestore, OPERATION_SETTINGS_PATH), payload, { merge: true });
    this._settings.set(resolveSettings(settings));
    this.loaded = Promise.resolve(this._settings());
  }
}
