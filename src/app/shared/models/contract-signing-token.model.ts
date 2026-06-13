/**
 * One-time signing token for a contract.
 *
 * The token is the only credential the public signing page accepts.
 * It is created by a Cloud Function (secure random), stored in
 * `contractSigningTokens`, and is bound to:
 *   - a contract
 *   - a reservation
 *   - a client
 *   - an absolute expiration time
 *
 * Status flow:
 *   active → used (on successful sign)
 *   active → expired (TTL passed)
 *   active → cancelled (operator cancelled the link)
 *
 * The public signing page is reachable without auth, so this token
 * is the ONLY thing protecting the contract data exposed to the
 * customer. The token must be:
 *   - cryptographically random (Cloud Function responsibility)
 *   - long (>= 32 bytes hex recommended)
 *   - non-guessable
 *   - one-time use
 *   - time-limited
 */

export type ContractSigningTokenStatus =
  | 'active'
  | 'used'
  | 'expired'
  | 'cancelled';

export interface ContractSigningToken {
  id?: string;

  /** Plain token value used in the URL. Created server-side only. */
  token: string;
  contractId: string;
  reservationId: string;
  clientId: string;

  status: ContractSigningTokenStatus;

  /** Firestore Timestamp */
  expiresAt: any;
  /** Firestore Timestamp */
  usedAt?: any;

  clientAccessInfo?: {
    userAgent?: string;
    ip?: string;
  };

  createdAt?: any;
  updatedAt?: any;
}

export const SIGNING_TOKEN_STATUS_LABELS: Record<ContractSigningTokenStatus, string> = {
  active: 'Activo',
  used: 'Usado',
  expired: 'Caducado',
  cancelled: 'Cancelado'
};
