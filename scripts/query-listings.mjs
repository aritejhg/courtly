import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { matchesListingDateTime } from './lib/listing-filters.mjs';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const inputPath = resolve(argument('--input', 'data/telegram-listings.json'));
const date = argument('--date', '');
const startTime = argument('--from', '');
const endTime = argument('--to', '');
if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must use YYYY-MM-DD.');
for (const [name, value] of [['--from', startTime], ['--to', endTime]]) {
  if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${name} must use HH:MM.`);
}

const listings = JSON.parse(await readFile(inputPath, 'utf8'));
const now = new Date(process.env.INGEST_NOW || Date.now());
const result = listings.filter((listing) =>
  listing.status === 'active'
  && new Date(listing.playAt).getTime() > now.getTime()
  && matchesListingDateTime(listing, { date, startTime, endTime }),
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
