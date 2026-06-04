import { Injectable, inject } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';

@Injectable({
  providedIn: 'root'
})
export class FirebaseStatusService {
  private firebaseApp = inject(FirebaseApp);
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private storage = inject(Storage);

  get status() {
    return {
      firebaseInitialized: !!this.firebaseApp,
      authConfigured: !!this.auth,
      firestoreConfigured: !!this.firestore,
      storageConfigured: !!this.storage
    };
  }
}
