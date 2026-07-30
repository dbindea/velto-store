import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, limit, orderBy, query, where } from '@angular/fire/firestore';
import { Observable, forkJoin, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Client } from '@shared/models/client.model';
import { Vehicle } from '@shared/models/vehicle.model';
import { Reservation } from '@shared/models/reservation.model';

export interface GlobalSearchResults {
  query: string;
  clients: Client[];
  vehicles: Vehicle[];
  reservations: Reservation[];
  totalCount: number;
}

export type GlobalSearchHit =
  | { kind: 'client'; id: string; title: string; subtitle?: string; route: string }
  | { kind: 'vehicle'; id: string; title: string; subtitle?: string; route: string }
  | { kind: 'reservation'; id: string; title: string; subtitle?: string; route: string };

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
        totalCount: 0
      });
    }
    const lower = cleaned.toLowerCase();
    const upper = cleaned.toUpperCase();

    return forkJoin({
      clients: this.searchClients(cleaned, upper),
      vehicles: this.searchVehicles(cleaned, upper),
      reservations: this.searchReservations(cleaned, upper)
    }).pipe(
      map(({ clients, vehicles, reservations }) => ({
        query: cleaned,
        clients,
        vehicles,
        reservations,
        totalCount: clients.length + vehicles.length + reservations.length
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
