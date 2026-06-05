export interface AuthorizedUser {
  email: string;
  active: boolean;
  role: 'admin' | 'employee';
  displayName?: string;
  createdAt?: any;
  updatedAt?: any;
}
