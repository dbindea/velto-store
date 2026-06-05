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
    const docRef = await addDoc(this.vehiclesRef, {
      ...vehicle,
      acrissCode,
      publicEnabled: false,
      status: 'available',
      images: [],
      createdAt: { seconds: Date.now() / 1000 }
    });
    return docRef.id;
  }

  async updateVehicle(id: string, data: Partial<VehicleFormData>): Promise<void> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    await updateDoc(docRef, {
      ...data,
      updatedAt: { seconds: Date.now() / 1000 }
    });
  }

  async deleteVehicle(id: string): Promise<void> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    await deleteDoc(docRef);
  }

  async changeStatus(id: string, status: VehicleStatus): Promise<void> {
    const docRef = doc(this.firestore, `vehicles/${id}`);
    await updateDoc(docRef, { status, updatedAt: { seconds: Date.now() / 1000 } });
  }

  async uploadMainImage(vehicleId: string, file: File): Promise<string> {
    const timestamp = Date.now();
    const filename = `${timestamp}-${file.name}`;
    const storagePath = `vehicles/${vehicleId}/main/${filename}`;
    const storageRef = ref(this.storage, storagePath);

    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const docRef = doc(this.firestore, `vehicles/${vehicleId}`);
    const imageData: VehicleImage = {
      url,
      path: storagePath,
      isMain: true,
      uploadedAt: { seconds: Date.now() / 1000 }
    };

    await updateDoc(docRef, { mainImageUrl: url, images: [imageData], updatedAt: { seconds: Date.now() / 1000 } });
    return url;
  }

  async uploadGalleryImage(vehicleId: string, file: File): Promise<VehicleImage> {
    const timestamp = Date.now();
    const filename = `${timestamp}-${file.name}`;
    const storagePath = `vehicles/${vehicleId}/gallery/${filename}`;
    const storageRef = ref(this.storage, storagePath);

    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const imageData: VehicleImage = {
      url,
      path: storagePath,
      isMain: false,
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

    const update: Partial<Vehicle> = { images };
    if (image.isMain) {
      update.mainImageUrl = undefined;
    }

    await updateDoc(docRef, update);
  }

  async setMainImage(vehicleId: string, image: VehicleImage): Promise<void> {
    const docRef = doc(this.firestore, `vehicles/${vehicleId}`);
    const vehicleSnap = await getDoc(docRef);
    const vehicle = vehicleSnap.data() as Vehicle;

    const images = (vehicle.images || []).map(img => ({
      ...img,
      isMain: img.path === image.path
    }));

    await updateDoc(docRef, {
      mainImageUrl: image.url,
      images,
      updatedAt: { seconds: Date.now() / 1000 }
    });
  }
}
