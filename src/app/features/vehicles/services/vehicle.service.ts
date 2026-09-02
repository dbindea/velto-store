import { Injectable, inject } from '@angular/core';
import {
  CollectionReference,
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
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
import { APP_DEFAULTS } from '@shared/constants/app.constants';
import { Observable, from, throwError } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class VehicleService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
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

  async createVehicle(vehicle: VehicleFormData, acrissCode: string): Promise<string> {
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
    // Sort pricing rules before saving
    let pricingRules = data.pricingRules;
    if (pricingRules?.length) {
      pricingRules = sortPricingRules(pricingRules);
    }

    const docRef = doc(this.firestore, `vehicles/${id}`);
    await updateDoc(
      docRef,
      this.cleanData({
        ...data,
        pricingRules,
        updatedAt: { seconds: Date.now() / 1000 },
      }),
    );
  }

  async deleteVehicle(id: string): Promise<void> {
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
