import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, limit, orderBy, query, where } from '@angular/fire/firestore';
import { Observable, forkJoin, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Client } from '@shared/models/client.model';
import { Vehicle } from '@shared/models/vehicle.model';
import { Reservation } from '@shared/models/reservation.model';
import { Contract } from '@shared/models/contract.model';

export interface GlobalSearchResults {
  query: string;
  clients: Client[];
  vehicles: Vehicle[];
  reservations: Reservation[];
  /** Contratos localizados por su Código Seguro de Verificación. */
  contracts: Contract[];
  totalCount: number;
}

/**
 * El código canónico si lo tecleado puede serlo, o `null`.
 *
 * Acepta las dos formas que un humano tiene delante: la impresa con guiones
 * (`VLT-7M63-EE55-THDK`) y la que sale de teclearla de corrido. El alfabeto no
 * lleva I, L, O, U, 0 ni 1 porque el código se dicta por teléfono, así que un
 * cero o una ele tecleados son casi seguro un O o un I mal oídos — se traducen
 * en vez de rechazarse.
 *
 * ⚠️ Duplicado a propósito de `functions/src/contracts/verification.ts`: la app
 * y las functions no comparten módulo. Si cambia el alfabeto, se cambia en los
 * dos sitios.
 */
export function parseVerificationCode(input: string): string | null {
  // ⚠️ **Primero se limpia y después se quita el prefijo**, no al revés: con
  // un espacio delante —copiar y pegar deja uno— el `^VLT` no llegaba a
  // coincidir, el prefijo se quedaba dentro y el código salía de 15
  // caracteres. Un código canónico nunca empieza por `VLT`, porque la L no
  // está en el alfabeto.
  const raw = (input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^VLT/, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I');
  // 12 caracteres exactos, y ninguno fuera del alfabeto del código.
  if (raw.length !== 12) return null;
  return /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/.test(raw) ? raw : null;
}

export type GlobalSearchHit =
  | { kind: 'client'; id: string; title: string; subtitle?: string; route: string }
  | { kind: 'vehicle'; id: string; title: string; subtitle?: string; route: string }
  | { kind: 'reservation'; id: string; title: string; subtitle?: string; route: string }
  | { kind: 'contract'; id: string; title: string; subtitle?: string; route: string };

/**
 * Cross-collection search.  Runs three independent queries in
 * parallel and returns the union grouped by collection.
 *
 * - Clients: matches on fullName (prefix), documentNumber, email
 *   (case-insensitive contains)
 * - Vehicles: matches on plateNumber (prefix), brand, model,
 *   version
 * - Reservations: matches on contractNumber, internalReference,
 *   client fullName
 *
 * Firestore has no full-text search; we keep queries bounded with
 * `where('field', '>=', term) + where('field', '<=', term + '\uf8ff')`
 * tricks where possible.  The result is filtered client-side to
 * catch contains (e.g. middle-of-string plate matches).
 */
@Injectable({ providedIn: 'root' })
export class GlobalSearchService {
  private firestore = inject(Firestore);

  private static MAX_RESULTS_PER_COLLECTION = 8;

  search(term: string): Observable<GlobalSearchResults> {
    const cleaned = (term || '').trim();
    if (cleaned.length < 2) {
      return of({
        query: cleaned,
        clients: [],
        vehicles: [],
        reservations: [],
        contracts: [],
        totalCount: 0
      });
    }
    const lower = cleaned.toLowerCase();
    const upper = cleaned.toUpperCase();

    return forkJoin({
      clients: this.searchClients(cleaned, upper),
      vehicles: this.searchVehicles(cleaned, upper),
      reservations: this.searchReservations(cleaned, upper),
      contracts: this.searchContracts(cleaned)
    }).pipe(
      map(({ clients, vehicles, reservations, contracts }) => ({
        query: cleaned,
        clients,
        vehicles,
        reservations,
        contracts,
        totalCount: clients.length + vehicles.length + reservations.length + contracts.length
      }))
    );
  }

  /** Flatten results into a list of navigation-ready hits. */
  toHits(results: GlobalSearchResults): GlobalSearchHit[] {
    const hits: GlobalSearchHit[] = [];
    for (const c of results.clients) {
      hits.push({
        kind: 'client',
        id: c.id!,
        title: c.fullName,
        subtitle: [c.documentNumber, c.phone, c.email].filter(Boolean).join(' · '),
        route: `/clients/${c.id}`
      });
    }
    for (const v of results.vehicles) {
      const title = `${v.brand} ${v.model}${v.version ? ' ' + v.version : ''}`;
      hits.push({
        kind: 'vehicle',
        id: v.id!,
        title,
        subtitle: v.plateNumber,
        route: `/vehicles/${v.id}`
      });
    }
    for (const c of results.contracts) {
      hits.push({
        kind: 'contract',
        id: c.id!,
        title: c.contractNumber || c.id!.slice(0, 6).toUpperCase(),
        subtitle: [c.clientSnapshot?.fullName, c.vehicleSnapshot?.plateNumber]
          .filter(Boolean)
          .join(' · '),
        route: `/contracts/${c.id}`
      });
    }
    for (const r of results.reservations) {
      const title = `#${r.id?.slice(0, 6).toUpperCase() || ''} · ${r.clientSnapshot.fullName}`;
      const sub = `${r.vehicleSnapshot.plateNumber} · ${r.reservationStatus}`;
      hits.push({
        kind: 'reservation',
        id: r.id!,
        title,
        subtitle: sub,
        route: `/reservations/${r.id}`
      });
    }
    return hits;
  }

  // ---- Private helpers ----

  private searchClients(term: string, upper: string): Observable<Client[]> {
    const clientsRef = collection(this.firestore, 'clients');
    const q = query(
      clientsRef,
      orderBy('fullName'),
      where('fullName', '>=', term),
      where('fullName', '<=', term + '\uf8ff'),
      limit(GlobalSearchService.MAX_RESULTS_PER_COLLECTION)
    );
    return from(getDocs(q)).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Client)),
      map((all) =>
        all.filter((c) =>
          [c.fullName, c.documentNumber, c.email, c.phone]
            .filter(Boolean)
            .some(
              (s) =>
                (s || '').toLowerCase().includes(upper.toLowerCase()) ||
                (s || '').toUpperCase().includes(upper)
            )
        )
      ),
      catchError(() => of([] as Client[]))
    );
  }

  private searchVehicles(term: string, upper: string): Observable<Vehicle[]> {
    const vehiclesRef = collection(this.firestore, 'vehicles');
    const q = query(
      vehiclesRef,
      orderBy('plateNumber'),
      where('plateNumber', '>=', upper),
      where('plateNumber', '<=', upper + '\uf8ff'),
      limit(GlobalSearchService.MAX_RESULTS_PER_COLLECTION)
    );
    return from(getDocs(q)).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Vehicle)),
      map((all) =>
        all.filter((v) =>
          [v.plateNumber, v.brand, v.model, v.version]
            .filter(Boolean)
            .some((s) => (s || '').toLowerCase().includes(term.toLowerCase()))
        )
      ),
      catchError(() => of([] as Vehicle[]))
    );
  }

  /**
   * Contratos por su Código Seguro de Verificación (M-45).
   *
   * Es el caso de un cliente que llama con el papel delante y dicta el
   * `VLT-…`; hasta ahora ese código no se podía buscar desde ninguna pantalla.
   *
   * ⚠️ **Solo consulta si lo tecleado puede ser un código.** Es una igualdad
   * exacta sobre un campo de 12 caracteres, así que un término cualquiera no
   * encontraría nada y estaríamos pagando una lectura por cada tecla.
   */
  private searchContracts(term: string): Observable<Contract[]> {
    const code = parseVerificationCode(term);
    if (!code) return of([] as Contract[]);

    const contractsRef = collection(this.firestore, 'contracts');
    const q = query(contractsRef, where('verificationCode', '==', code), limit(1));
    return from(getDocs(q)).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contract)),
      catchError(() => of([] as Contract[]))
    );
  }

  private searchReservations(term: string, _upper: string): Observable<Reservation[]> {
    const reservationsRef = collection(this.firestore, 'reservations');
    // Firestore can't filter on dynamic client/vehicle snapshot
    // fields efficiently.  Pull the most recent N reservations and
    // filter client-side.
    const q = query(reservationsRef, orderBy('createdAt', 'desc'), limit(50));
    return from(getDocs(q)).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Reservation)),
      map((all) =>
        all
          .filter((r) => {
            const haystack = [
              r.id,
              r.clientSnapshot?.fullName,
              r.clientSnapshot?.documentNumber,
              r.vehicleSnapshot?.plateNumber
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return haystack.includes(term.toLowerCase());
          })
          .slice(0, GlobalSearchService.MAX_RESULTS_PER_COLLECTION)
      ),
      catchError(() => of([] as Reservation[]))
    );
  }
}
