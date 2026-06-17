/**
 * Carrier tracking resolver. In this demo it derives status deterministically
 * from seeded scan events (a stand-in for live FedEx/UPS/DHL APIs). The shape
 * it returns is exactly what a real multi-carrier integration would normalize
 * to, so swapping in live carrier calls is isolated to this file.
 */
import { getTrackingEvents } from '../db/repos.js';
import type { Claim, TrackingState, TrackingStatus } from '@shared';

function daysBetween(fromISO: string, to: Date): number {
  const from = new Date(fromISO).getTime();
  return Math.floor((to.getTime() - from) / 86_400_000);
}

function deriveState(lastStatus: string): TrackingState {
  const s = lastStatus.toLowerCase();
  if (s.startsWith('delivered')) return 'delivered';
  if (s.includes('exception')) return 'exception';
  if (s.includes('returned')) return 'returned';
  if (s.includes('out for delivery')) return 'out_for_delivery';
  return 'in_transit';
}

export function resolveTracking(claim: Pick<Claim, 'id' | 'trackingNumber' | 'carrierId'> & { carrierCode?: string }): TrackingStatus {
  const events = getTrackingEvents(claim.id);
  if (events.length === 0) {
    return {
      trackingNumber: claim.trackingNumber,
      carrierCode: claim.carrierCode ?? '',
      state: 'no_data',
      lastScan: null,
      lastLocation: null,
      daysSinceLastScan: null,
      deliveredDate: null,
      events: [],
      live: false,
    };
  }
  const last = events[events.length - 1];
  const state = deriveState(last.status);
  const delivered = events.filter((e) => e.status.toLowerCase().startsWith('delivered')).pop() ?? null;
  return {
    trackingNumber: claim.trackingNumber,
    carrierCode: claim.carrierCode ?? '',
    state,
    lastScan: last.timestamp,
    lastLocation: last.location,
    daysSinceLastScan: daysBetween(last.timestamp, new Date()),
    deliveredDate: delivered ? delivered.timestamp : null,
    events,
    live: false,
  };
}

/** Was the delivery captured with a signature? (used by the decision engine) */
export function deliveredWithSignature(t: TrackingStatus): boolean {
  return t.events.some((e) => /signed|signature/i.test(e.status));
}
