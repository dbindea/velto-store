import { Injectable, inject } from '@angular/core';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private storage = inject(Storage);

  getStorageRef(path: string) {
    return ref(this.storage, path);
  }

  async uploadFile(path: string, file: Uint8Array) {
    const storageRef = ref(this.storage, path);
    return uploadBytes(storageRef, file);
  }

  async getDownloadURL(path: string) {
    const storageRef = ref(this.storage, path);
    return getDownloadURL(storageRef);
  }

  async deleteFile(path: string) {
    const storageRef = ref(this.storage, path);
    return deleteObject(storageRef);
  }
}
