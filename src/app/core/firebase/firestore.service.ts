import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, getDoc, getDocs } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private firestore = inject(Firestore);

  getCollection(path: string) {
    return collection(this.firestore, path);
  }

  getDocument(path: string) {
    return doc(this.firestore, path);
  }

  async setDocument(path: string, data: unknown) {
    return setDoc(doc(this.firestore, path), data);
  }

  async getDocumentData(path: string) {
    const snap = await getDoc(doc(this.firestore, path));
    return snap.exists() ? snap.data() : null;
  }

  async getCollectionData(path: string) {
    const snap = await getDocs(collection(this.firestore, path));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}
