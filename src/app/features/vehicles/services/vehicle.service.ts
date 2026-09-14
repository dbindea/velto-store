import { Injectable, inject } from '@angular/core';
import {
  CollectionReference,
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Storage, deleteObject, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';
import {
  MAX_IMAGE_SIZE,
  MAX_THUMBNAIL_SIZE,
  resizeImage,
  resizedFilename
} from '@shared/utils/image-resize.util';
import {
  Vehicle,
  VehicleFormData,
  VehicleImage,
  VehicleStatus,
} from '@shared/models/vehicle.model';
import { getDefaultPricingRules, sortPricingRules } from '@shared/utils/pricing.util';
import { vehicleOwnershipProblem } from '@shared/utils/owner-share.util';
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { Observable, from, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { PermissionsService } from '@core/auth/permissions.service';
import { StorageService } from '@core/firebase/storage.service';

@Injectable({ providedIn: 'root' })
export class VehicleService {
  private firestore = inject(Firestore);
  private permissions = inject(PermissionsService);
  private storage = inject(Storage);
  private storageService = inject(StorageService);
  private vehiclesRef: CollectionReference;

  constructor() {
    this.vehiclesRef = collection(this.firestore, 'vehicles');
  }

  /** Removes undefined/null fields recursively - required by Firestore */
  private cleanData<T extends object>(data: T): Partial<T> {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        cleaned[key] =
          typeof value === 'object' && !Array.isArray(value) && value !== null
            ? this.cleanData(value)
            : value;
      }
    }
    return cleaned;
  }

  getVehicles(): Observable<Vehicle[]> {
    const q = query(this.vehiclesRef, orderBy('createdAt', 'desc'));
    return from(getDocs(q)).pipe(
      map((snapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Vehicle)),
    );
  }

  getVehicleById(id: string): Observable<Vehicle> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    return from(getDoc(docRef)).pipe(
      map((snap) => {
        if (!snap.exists()) throwError(() => new Error('Vehicle not found'));
        return { id: snap.id, ...snap.data() } as Vehicle;
      }),
    );
  }

  /**
   * Lo que impide guardar la propiedad del coche.
   *
   * ⚠️ **Se comprueba aquí aunque la pantalla ya lo haya hecho**, y es la misma
   * función: un coche marcado «de colaborador» sin colaborador deja una reserva
   * que dice que hay que pagarle a alguien sin decir a quién, y eso no se
   * descubre hasta que se cierra el primer alquiler. Es la defensa en
   * profundidad de siempre — pantalla, servicio y reglas.
   */
  private assertOwnership(data: Partial<VehicleFormData>): void {
    const problems = vehicleOwnershipProblem({
      ownership: data.ownership,
      ownerCollaboratorId: data.ownerCollaboratorId,
      ownerSharePercent: data.ownerSharePercent
    });
    const primero: string | undefined = Object.values(problems)[0];
    if (primero) throw new Error(primero);
  }

  async createVehicle(vehicle: VehicleFormData, acrissCode: string): Promise<string> {
    this.assertOwnership(vehicle);

    // Use default pricing rules if not provided
    const pricingRules = vehicle.pricingRules?.length
      ? vehicle.pricingRules
      : getDefaultPricingRules();

    const data = this.cleanData({
      ...vehicle,
      acrissCode,
      publicEnabled: false,
      status: 'available',
      images: [],
      pricingRules: sortPricingRules(pricingRules),
      defaultDepositAmount: vehicle.defaultDepositAmount ?? APP_DEFAULTS.DEFAULT_DEPOSIT_AMOUNT,
      includedKmPerDay: vehicle.includedKmPerDay ?? APP_DEFAULTS.DEFAULT_INCLUDED_KM_PER_DAY,
      extraKmPrice: vehicle.extraKmPrice ?? APP_DEFAULTS.DEFAULT_EXTRA_KM_PRICE,
      minimumRentalDays: vehicle.minimumRentalDays ?? APP_DEFAULTS.DEFAULT_MINIMUM_RENTAL_DAYS,
      manualPriceAllowed: vehicle.manualPriceAllowed ?? true,
      createdAt: { seconds: Date.now() / 1000 },
    });
    const docRef = await addDoc(this.vehiclesRef, data);
    return docRef.id;
  }

  async updateVehicle(id: string, data: Partial<VehicleFormData>): Promise<void> {
    this.assertOwnership(data);

    // Sort pricing rules before saving
    let pricingRules = data.pricingRules;
    if (pricingRules?.length) {
      pricingRules = sortPricingRules(pricingRules);
    }

    const docRef = doc(this.firestore, `vehicles/${id}`);
    const payload: Record<string, unknown> = this.cleanData({
      ...data,
      pricingRules,
      updatedAt: { seconds: Date.now() / 1000 },
    });

    /**
     * Un coche que deja de ser de un colaborador **se queda sin propietario de
     * verdad**.
     *
     * ⚠️ `cleanData()` descarta `undefined`, así que no basta con dejar los
     * campos vacíos: quedarían los de antes escritos en Firestore, y el coche
     * diría a la vez que es propio y que le toca un 75 % a Juan. Hoy no
     * repartiría —`ownerShareSnapshotOf()` mira `ownership` primero— pero es un
     * dato creíble y falso esperando a que alguien lo lea.
     *
     * ⚠️ **El centinela se añade DESPUÉS de limpiar, nunca dentro.**
     * `deleteField()` es un objeto con propiedades propias: pasarlo por un
     * limpiador que recorre con `Object.entries()` lo convierte en un mapa
     * vacío y Firestore escribiría `{}` en vez de borrar el campo. Es
     * exactamente lo que corrompió los timestamps de los contratos (F-4).
     */
    if ((data.ownership || 'own') !== 'collaborator') {
      payload['ownership'] = 'own';
      payload['ownerCollaboratorId'] = deleteField();
      payload['ownerCollaboratorName'] = deleteField();
      payload['ownerSharePercent'] = deleteField();
    }

    await updateDoc(docRef, payload);
  }

  /**
   * Borra un vehículo **y sus fotos**.
   *
   * Borrar el documento de Firestore no se lleva lo que hay en Storage: sin
   * esto, cada coche dado de baja dejaba su galería completa —originales y
   * miniaturas— ocupando espacio para siempre, sin nada en la aplicación que
   * apuntara a ella.
   */
  async deleteVehicle(id: string): Promise<void> {
    // Defensa en profundidad: la UI esconde el botón y esto rechaza la
    // llamada igualmente. Cualquier camino que no pase por ese botón se
    // saltaría el permiso.
    if (!this.permissions.can('deleteRecords')) {
      throw new Error('permissions.notAllowed');
    }

    /**
     * ⚠️ **Un vehículo con reservas no se borra**, exactamente por lo mismo que
     * un cliente con reservas (M-47): su marca, su modelo y su **matrícula**
     * siguen dentro del `vehicleSnapshot` de cada reserva y de cada contrato,
     * así que quitar la ficha no borra nada — solo deja un coche fantasma al
     * que el histórico apunta y que ya no se puede abrir.
     *
     * Y aquí es peor que en el cliente: un **contrato firmado** acredita que ese
     * coche se alquiló, y `firestore.rules` prohíbe borrarlo incluso a un
     * administrador. Borrar el vehículo dejaría ese documento señalando al
     * vacío.
     *
     * ⚠️ **Para un coche vendido o retirado NO es esto, es el estado**
     * `out_of_service`: deja de ofrecerse para reservas nuevas y el histórico
     * sigue entero. Borrar está para limpiar un alta de prueba o duplicada.
     */
    const reservations = await getDocs(
      query(collection(this.firestore, 'reservations'), where('vehicleId', '==', id), limit(1))
    );
    if (!reservations.empty) {
      throw new Error('vehicles.errors.deleteHasReservations');
    }

    await this.storageService.deleteFolder(`vehicles/${id}`);
    const docRef = doc(this.firestore, `vehicles/${id}`);
    await deleteDoc(docRef);
  }

  async changeStatus(id: string, status: VehicleStatus): Promise<void> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    await updateDoc(docRef, { status, updatedAt: { seconds: Date.now() / 1000 } });
  }

  /**
   * Sube una foto de vehículo **reducida en el navegador**, más su miniatura.
   *
   * Antes se subía el fichero tal cual: una foto de móvil son 3-5 MB, y la
   * lista de flota los descargaba enteros para pintarlos en una caja de 140 px.
   * Ahora se sube una versión de uso (máx. 1600 px) y una miniatura (400 px),
   * unos 300 KB entre las dos.
   *
   * Si el navegador no sabe reducir el fichero —un HEIC, por ejemplo— se sube
   * el original y se sigue: **una miniatura que falla no puede costar la foto**.
   */
  async uploadImage(vehicleId: string, file: File): Promise<VehicleImage> {
    const timestamp = Date.now();

    const resized = await resizeImage(file, MAX_IMAGE_SIZE);
    const body = resized ?? file;
    const filename = resized
      ? `${timestamp}-${resizedFilename(file.name)}`
      : `${timestamp}-${file.name}`;
    const storagePath = `vehicles/${vehicleId}/gallery/${filename}`;
    const storageRef = ref(this.storage, storagePath);

    await uploadBytes(storageRef, body);
    const url = await getDownloadURL(storageRef);

    // La miniatura va aparte y su fallo no aborta nada.
    let thumbnailUrl: string | undefined;
    let thumbnailPath: string | undefined;
    const thumb = await resizeImage(file, MAX_THUMBNAIL_SIZE);
    if (thumb) {
      thumbnailPath = `vehicles/${vehicleId}/gallery/${timestamp}-${resizedFilename(file.name, '-thumb')}`;
      await uploadBytes(ref(this.storage, thumbnailPath), thumb);
      thumbnailUrl = await getDownloadURL(ref(this.storage, thumbnailPath));
    }

    const imageData: VehicleImage = {
      url,
      path: storagePath,
      ...(thumbnailUrl ? { thumbnailUrl, thumbnailPath } : {}),
      uploadedAt: { seconds: Date.now() / 1000 },
    };

    const docRef = doc(this.firestore, `vehicles/${vehicleId}`);
    const vehicleSnap = await getDoc(docRef);
    const vehicle = vehicleSnap.data() as Vehicle;
    const images = [...(vehicle.images || []), imageData];

    await updateDoc(docRef, { images, updatedAt: { seconds: Date.now() / 1000 } });
    return imageData;
  }

  async deleteVehicleImage(vehicleId: string, image: VehicleImage): Promise<void> {
    // Las dos, o la miniatura se queda huérfana en Storage para siempre.
    for (const path of [image.path, image.thumbnailPath]) {
      if (!path) continue;
      try {
        await deleteObject(ref(this.storage, path));
      } catch (e) {
        // Ignore storage delete errors
      }
    }

    const docRef = doc(this.firestore, `vehicles/${vehicleId}`);
    const vehicleSnap = await getDoc(docRef);
    const vehicle = vehicleSnap.data() as Vehicle;
    const images = (vehicle.images || []).filter((img) => img.path !== image.path);

    await updateDoc(docRef, { images, updatedAt: { seconds: Date.now() / 1000 } });
  }
}
