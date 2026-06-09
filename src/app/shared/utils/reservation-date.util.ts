/**
 * Date utilities for reservation calculations.
 * 
 * Calendar days calculation:
 * - Any pickup and return within 24 hours = 1 day
 * - Any excess hour beyond 24h rounds up to next day
 * - Minimum is 1 day if return > pickup
 */

import { Timestamp } from '@angular/fire/firestore';

/**
 * Calculate calendar days between two datetimes.
 * 
 * Rules:
 * - If return <= pickup, returns 0 (invalid)
 * - Counts full 24h blocks
 * - Any remaining time >= 1 hour rounds up to next day
 * 
 * @example
 * - 10 June 12:00 → 11 June 12:00 = 1 day
 * - 10 June 12:00 → 11 June 13:00 = 2 days
 * - 10 June 12:00 → 10 June 18:00 = 1 day
 * - 10 June 12:00 → 17 June 12:00 = 7 days
 */
export function calculateCalendarDays(pickupDateTime: Date, returnDateTime: Date): number {
  if (returnDateTime <= pickupDateTime) {
    return 0;
  }

  const diffMs = returnDateTime.getTime() - pickupDateTime.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  // Calculate full 24h blocks
  const fullDays = Math.floor(diffHours / 24);
  
  // Check remaining hours - round up if >= 1 hour
  const remainingHours = diffHours % 24;
  const extraDays = remainingHours >= 1 ? 1 : 0;
  
  return fullDays + extraDays;
}

/**
 * Convert a date to Firestore Timestamp.
 */
export function toTimestamp(date: Date): any {
  return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 };
}

/**
 * Convert Firestore Timestamp or Date to Date.
 */
export function toDate(timestampOrDate: any): Date {
  if (!timestampOrDate) return new Date();
  
  if (timestampOrDate instanceof Date) {
    return timestampOrDate;
  }
  
  if (typeof timestampOrDate?.toDate === 'function') {
    return timestampOrDate.toDate();
  }
  
  if (timestampOrDate?.seconds) {
    return new Date(timestampOrDate.seconds * 1000);
  }
  
  return new Date(timestampOrDate);
}

/**
 * Check if two date ranges overlap.
 * Used for availability checking.
 */
export function dateRangesOverlap(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): boolean {
  return start1 < end2 && end1 > start2;
}

/**
 * Get default pickup datetime (today at noon).
 */
export function getDefaultPickupDateTime(): Date {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return now;
}

/**
 * Get default return datetime (tomorrow at noon).
 */
export function getDefaultReturnDateTime(): Date {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);
  return tomorrow;
}

/**
 * Format date for display.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/**
 * Format time for display.
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format datetime for display.
 */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/**
 * Get date part as YYYY-MM-DD string (for date inputs).
 */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get time part as HH:MM string (for time inputs).
 */
export function toTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Combine date and time strings into a Date object.
 */
export function combineDateAndTime(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}