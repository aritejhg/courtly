import type { CourtListing } from './ingestion';
import generatedListings from '@/data/telegram-listings.json';

// The ingestion script owns this JSON feed. Keeping this adapter typed lets the
// map remain a normal client component while the hourly job refreshes records.
export const telegramListings = generatedListings as CourtListing[];
