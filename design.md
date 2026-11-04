# Courtly interface redesign

## Product intent

Courtly is a fast comparison surface for active badminton court listings. The user should always retain the listing context while inspecting one option, then act through Telegram or directions without losing their place.

## Visual thesis

“Quiet cartographic workspace”: a pale, low-noise map fills the canvas while compact white floating surfaces provide contrast. Borrow Google Maps’ layered controls and persistent results rail, plus the VIM reference’s restrained teal accents, density, state clarity, and rounded floating island.

## Desktop composition

- Use nearly the full viewport. Outer gutter: 16–20px. Avoid decorative whitespace and stacked page sections.
- Header is compact and utility-led.
- Filters form a floating toolbar above the working surface.
- Working surface is one bounded map canvas with three possible horizontal zones:
  1. Persistent listings rail, 360–400px wide.
  2. Scrollable detail drawer, 400–460px wide, present only while a listing is expanded.
  3. Map, always visible and consuming all remaining width.
- Rail and drawer sit over the map as a joined floating island. The map itself retains rounded outer corners and uninterrupted vertical space.
- Only the rail list and detail body scroll. No content may be clipped by a fixed panel height.

## Listing rail

- Header: “Matched listings”, visible result count, and earliest-first sort note.
- Default order: listing `playAt`, ascending. Filters reduce this same ordered list and its map pins.
- Each collapsed row shows venue/location, play date and time, price, estimated public-transport time from the persisted selected saved location, plus icon actions for exact message and owner contact.
- Row selection opens the detail drawer. Re-selecting the open row or using the drawer close/minimise button collapses it.
- Action icons must not also toggle the row. Give each an accessible label and tooltip/title.
- Selected state uses a soft teal tint and a narrow accent, not a heavy border.

## Detail drawer

- A single continuous, independently scrollable article—not stacked bordered cards or sections.
- Sticky compact header contains listing label, active state, and minimise button.
- Long venue names wrap naturally and never push travel content below an inaccessible clipped edge.
- Show all current listing details: venue, area/sport, date, day, time, duration, price, owner, exact message action, owner action.
- Full travel controls remain available: origin dropdown, edit locations, transit/drive/walk modes, ETA, leave/arrive timing, source, and directions.
- Saved origin remains device-local via `courtly-origin-id`; changing away from Home persists after reload.

## Map and controls

- Preserve Leaflet behavior, filtered pins, selected pin, zoom, and click-to-select.
- Use a cleaner low-saturation map tile treatment where licensing and reliability permit; retain clear attribution.
- Filter toolbar behaves like map controls: white floating surface, subtle shadow, compact chips/inputs.
- Map result badge remains floating and terse.

## Color, type, and surfaces

- Canvas: cool mist `#eef3f1`; surfaces: white; primary ink: deep blue-green `#172b2b`.
- Accent: clear teal around `#13a389`; warm coral only for map pins or exceptional emphasis.
- Borders: sparse, cool gray-green, 1px. Prefer spacing, tint, and shadow for hierarchy.
- Corners: 14–18px outer surfaces; 10–12px controls and rows.
- Typography: clean system sans. Body 14–16px; compact metadata 12–13px; never below 12px for user-facing information.
- Shadows: soft and shallow; no glossy or heavy card treatment.

## Responsive behavior

- Tablet: listings rail remains visible; detail becomes an overlay drawer above map.
- Mobile: map remains useful; listings occupy a bottom/stacked surface with the selected detail opening as a scrollable sheet. Filters wrap without horizontal overflow.
- Touch targets are at least 40px where practical. All controls remain keyboard reachable with visible focus.

## State and verification requirements

- Empty filters show a clear empty list while map contains no listing pins.
- Selection follows pin clicks and row clicks; collapse restores map width without losing selected identity.
- Location add/edit/delete and persisted origin behavior remain intact.
- Exact Telegram message links and owner fallback behavior remain intact.
- Verify long venue names, rail scrolling, detail scrolling, earliest-play-time order, direct actions, filtered pin count, persisted location after reload, directions URL, desktop, and narrow viewport.

