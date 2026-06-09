import { Injectable, inject } from '@angular/core';
import { Firestore, CollectionReference, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, query, orderBy } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable, from, throwError } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { Vehicle, VehicleImage, VehicleStatus, VehicleFormData } from '@shared/models/vehicle.model';

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
        cleaned[key] = typeof value === 'object' && !Array.isArray(value) && value !== null
          ? this.cleanData(value)
          : value;
      }
    }
    return cleaned;
  }

  getVehicles(): Observable<Vehicle[]> {
    const q = query(this.vehiclesRef, orderBy('createdAt', 'desc'));
    return from(getDocs(q)).pipe(
      map(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle)))
    );
  }

  getVehicleById(id: string): Observable<Vehicle> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    return from(getDoc(docRef)).pipe(
      map(snap => {
        if (!snap.exists()) throwError(() => new Error('Vehicle not found'));
        return { id: snap.id, ...snap.data() } as Vehicle;
      })
    );
  }

  async createVehicle(vehicle: VehicleFormData, acrissCode: string): Promise<string> {
    const data = this.cleanData({
      ...vehicle,
      acrissCode,
      publicEnabled: false,
      status: 'available',
      images: [],
      createdAt: { seconds: Date.now() / 1000 }
    });
    const docRef = await addDoc(this.vehiclesRef, data);
    return docRef.id;
  }

  async updateVehicle(id: string, data: Partial<VehicleFormData>): Promise<void> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    await updateDoc(docRef, this.cleanData({
      ...data,
      updatedAt: { seconds: Date.now() / 1000 }
    }));
  }

  async deleteVehicle(id: string): Promise<void> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    await deleteDoc(docRef);
  }

  async changeStatus(id: string, status: VehicleStatus): Promise<void> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    await updateDoc(docRef, { status, updatedAt: { seconds: Date.now() / 1000 } });
  }

  async uploadImage(vehicleId: string, file: File): Promise<VehicleImage> {
    const timestamp = Date.now();
    const filename = `${timestamp}-${file.name}`;
    const storagePath = `vehicles/${vehicleId}/gallery/${filename}`;
    const storageRef = ref(this.storage, storagePath);

    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const imageData: VehicleImage = {
      url,
      path: storagePath,
      uploadedAt: { seconds: Date.now() / 1000 }
    };

    const docRef = doc(this.firestore, `vehicles/${vehicleId}`);
    const vehicleSnap = await getDoc(docRef);
    const vehicle = vehicleSnap.data() as Vehicle;
    const images = [...(vehicle.images || []), imageData];

    await updateDoc(docRef, { images, updatedAt: { seconds: Date.now() / 1000 } });
    return imageData;
  }

  async deleteVehicleImage(vehicleId: string, image: VehicleImage): Promise<void> {
    try {
      const storageRef = ref(this.storage, image.path);
      await deleteObject(storageRef);
    } catch (e) {
      // Ignore storage delete errors
    }

    const docRef = doc(this.firestore, `vehicles/${vehicleId}`);
    const vehicleSnap = await getDoc(docRef);
    const vehicle = vehicleSnap.data() as Vehicle;
    const images = (vehicle.images || []).filter(img => img.path !== image.path);

    await updateDoc(docRef, { images, updatedAt: { seconds: Date.now() / 1000 } });
  }
}