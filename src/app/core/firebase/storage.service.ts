import { Injectable, inject } from '@angular/core';
import {
  Storage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  StorageReference
} from '@angular/fire/storage';

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

  /**
   * Borra una carpeta entera de Storage, con lo que cuelgue de ella.
   *
   * ⚠️ **Borrar el documento de Firestore no se lleva sus ficheros.** Son dos
   * servicios distintos, y durante meses eliminar un cliente dejaba su DNI y su
   * carné en Storage —con el token de descarga vivo— después de que su ficha
   * hubiera desaparecido de la aplicación. Con datos de prueba era desorden;
   * con clientes reales es un documento de identidad que sigue accesible por su
   * enlace cuando ya se pidió borrarlo.
   *
   * **Storage no tiene borrado recursivo**: hay que listar y borrar uno a uno.
   * `listAll` pagina internamente y devuelve también los prefijos (las
   * «subcarpetas»), que se recorren igual — un cliente guarda sus ficheros en
   * `clients/{id}/documents/…`, un nivel por debajo del que se pide borrar.
   *
   * Devuelve cuántos ficheros se borraron. **No lanza si algo falla**: quien
   * llama ya ha borrado —o va a borrar— el documento de Firestore, y dejar la
   * ficha a medio borrar por un fichero que se resiste es peor que quedarse con
   * un huérfano. Lo que sí hace es registrarlo.
   */
  async deleteFolder(path: string): Promise<number> {
    let deleted = 0;

    const walk = async (folder: StorageReference): Promise<void> => {
      const listing = await listAll(folder);
      // Los ficheros de este nivel, en paralelo: son borrados independientes y
      // en serie una carpeta con veinte fotos tarda lo que veinte viajes.
      const results = await Promise.allSettled(
        listing.items.map(item => deleteObject(item))
      );
      for (const result of results) {
        if (result.status === 'fulfilled') deleted++;
        else console.warn('No se pudo borrar un fichero de Storage', result.reason);
      }
      for (const prefix of listing.prefixes) {
        await walk(prefix);
      }
    };

    try {
      await walk(ref(this.storage, path));
    } catch (error) {
      // Una carpeta que no existe entra por aquí, y es el caso normal: un
      // cliente sin documentos subidos no tiene carpeta.
      console.warn(`No se pudo vaciar la carpeta de Storage «${path}»`, error);
    }

    return deleted;
  }
}
