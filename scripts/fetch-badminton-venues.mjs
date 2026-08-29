import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const SOURCE_URL = 'https://www.activesgcircle.gov.sg/facilities/badminton';
const OUTPUT = resolve('data/badminton-venues.json');
const PAGE_SIZE = 10;

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)));
}

function textBetween(block, start, end) {
  const match = block.match(new RegExp(`${start}([\\s\\S]*?)${end}`, 'i'));
  return decodeHtml((match?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function attribute(block, selector, name) {
  const match = block.match(new RegExp(`<[^>]*class=["'][^"']*${selector}[^"']*["'][^>]*\\b${name}=["']([^"']+)["']`, 'i'));
  return decodeHtml(match?.[1] ?? '');
}

function aliasesFor(name) {
  const aliases = new Set([name]);
  const add = (from, to) => { if (name.toLowerCase().includes(from.toLowerCase())) aliases.add(name.replace(new RegExp(from, 'ig'), to)); };
  if (/^Ang Mo Kio\b/i.test(name)) aliases.add(name.replace(/^Ang Mo Kio/i, 'AMK'));
  add('Sports Hall', 'Sport Hall'); add('Sport Hall', 'Sports Hall');
  add('Primary School Hall', 'Pri'); add('Secondary School Hall', 'Sec');
  add('Primary School', 'Pri'); add('Secondary School', 'Sec');
  add('Community Club', 'CC'); add('CC', 'Community Club');
  return [...aliases].map((alias) => alias.replace(/\s+/g, ' ').trim());
}

function parseBlock(block) {
  const canonicalName = textBetween(block, '<h2\\s*>', '</h2>');
  const address = textBetween(block, '<div class="cst-address">', '</div>');
  const zone = textBetween(block, '<div class="cst-direction">[\\s\\S]*?<span>', '</span>');
  const kind = textBetween(block, '<div class="cst-type-of-facility">', '</div>');
  const sourceUrl = attribute(block, 'view-page-link', 'href');
  const lat = Number(block.match(/<span class="cst-lat">\s*([\d.-]+)/i)?.[1]);
  const lng = Number(block.match(/<span class="cst-long">\s*([\d.-]+)/i)?.[1]);
  if (!canonicalName || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const id = `active-sg:${canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
  return { id, canonicalName, aliases: aliasesFor(canonicalName), source: 'ActiveSG', sourceUrl, kind: kind.toLowerCase().includes('school') ? 'school_sport_hall' : 'sport_hall', zone, address, lat, lng };
}

async function fetchPage(page) {
  const response = await fetch(`${SOURCE_URL}?page_num=${page}`, { headers: { 'user-agent': 'CourtlySG venue mapper/1.0' } });
  if (!response.ok) throw new Error(`ActiveSG page ${page}: HTTP ${response.status}`);
  return response.text();
}

const firstPage = await fetchPage(1);
const total = Number(firstPage.match(/of\s+(\d+)\s+results/i)?.[1] ?? 0);
if (!total) throw new Error('Could not read ActiveSG result count');
const pages = Math.ceil(total / PAGE_SIZE);
const pagesHtml = [firstPage];
for (let page = 2; page <= pages; page += 1) pagesHtml.push(await fetchPage(page));

const venues = pagesHtml.flatMap((html) => [...html.matchAll(/<div class="cst-list-item">([\s\S]*?)(?=<div class="cst-list-item">|<div class="paging-navigation"|<\/main>)/gi)].map((match) => parseBlock(match[1])).filter(Boolean));
const unique = [...new Map(venues.map((venue) => [venue.id, venue])).values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
if (unique.length < total * 0.9) throw new Error(`Parsed ${unique.length} venues from ${total} advertised results`);

await mkdir(dirname(OUTPUT), { recursive: true });
let previous = '';
try { previous = await readFile(OUTPUT, 'utf8'); } catch {}
const next = `${JSON.stringify(unique, null, 2)}\n`;
if (previous !== next) await writeFile(OUTPUT, next, 'utf8');
console.log(JSON.stringify({ source: SOURCE_URL, advertised: total, pages, venues: unique.length, output: OUTPUT, changed: previous !== next }));
