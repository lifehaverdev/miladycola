# Winners Marquee Design

## Overview

A glassmorphic winners marquee that floats beneath the hero section, showing recent prize winners as compact, hoverable pills that expand on hover and open a detailed modal on click.

## Structure & Layout

**Placement:**
The winners marquee sits directly beneath the hero section, floating seamlessly with no container, border, or background. It's visually part of the page flow rather than a boxed section.

**Layout states:**
- **Hidden** - Default state until NFT metadata is fetched and ready
- **Placeholder** - When 0 winners: centered text "Who will be the FIRST miladycola champion"
- **Static row** - 1-3 winners: Pills displayed in a centered horizontal row, no animation
- **Marquee** - 4+ winners: Continuous right-to-left scroll, slow pace, infinite loop

**Pill dimensions:**
- Compact (default): ~90px wide, showing small thumbnail + truncated address + entry cost stacked vertically
- Medium (hover): ~160px wide, thumbnail grows, text becomes more readable

**Spacing:**
Pills have consistent gaps between them (~12-16px). The marquee has subtle horizontal padding so pills don't touch screen edges.

## Pill Styling & Animation

**Glassmorphic pill style:**
- Semi-transparent background (`rgba(255,255,255,0.1)`)
- Backdrop blur effect (`backdrop-filter: blur(10px)`)
- Subtle light border (1px, semi-transparent white)
- Soft border-radius (~12px) for rounded edges
- No harsh shadows - just the glass effect provides depth

**Pill content (compact state):**
- Small NFT thumbnail (48x48px, rounded corners)
- Winner address truncated (`0x12...ab`)
- Entry cost in ETH (e.g., `0.4 ETH`)
- Stacked vertically, tight spacing

**Hover expansion:**
- Smooth CSS transition (~200-300ms ease-out)
- Thumbnail grows to ~80x80px
- Address and cost text slightly larger, more readable
- Pill width expands from ~90px to ~160px

**Marquee animation:**
- CSS animation using `translateX` for smooth performance
- Duration calculated based on number of pills (slow, ~30-40s for full loop)
- Pauses on hover via `animation-play-state: paused`
- Seamless loop by duplicating the pill set
- Direction: right-to-left

## Win Details Modal

**Trigger:** Click any pill to open the modal.

**Modal layout (top to bottom):**

1. **NFT Image** - Large, prominent display (~300px or responsive). Centered with rounded corners.

2. **NFT Title** - The metadata `name` field, displayed as a heading beneath the image.

3. **Contract Address** - Shortened address with link icon, clickable to open Etherscan token page in new tab.

4. **Challenge Lore** - The lore text from the original challenge, displayed as italicized or styled quote.

5. **Entry Details Row** - Horizontal layout:
   - Entry cost (e.g., "0.4 ETH")
   - Timestamp (e.g., "Jan 24, 2026" or relative like "2 days ago")

6. **Show More Button** - Text button/link style, toggles visibility of:
   - **Description** - Full NFT metadata description
   - **Traits** - Grid or list of trait name/value pairs from metadata attributes

**Modal behavior:**
- Standard close button (X) in corner
- Click outside to close
- Escape key to close

## Data Loading Strategy

**Priority order:**
1. Challenges (highest) - Load active challenges first
2. User bottles - Load connected user's tickets
3. Winners + NFT metadata (lowest) - Background fetch after above complete

**Loading flow:**
1. WinnersSection starts hidden (`display: none` or not rendered)
2. After challenges and bottles load, begin fetching winners from indexer
3. For each winner event, fetch NFT metadata from `tokenURI`:
   - Parse the tokenURI (may be IPFS, HTTP, or base64 data URI)
   - Extract: `name`, `image`, `description`, `attributes`
4. Once all visible winners have metadata resolved, reveal the marquee
5. Cache metadata in memory to avoid re-fetching on modal open

**Error handling:**
- If metadata fetch fails for a winner, skip that winner (don't show broken pill)
- If all metadata fetches fail, keep section hidden
- Log errors for debugging but don't surface to user

**Metadata service:**
Create a lightweight `NftMetadataService` that:
- Fetches and parses tokenURI
- Handles IPFS gateway conversion (`ipfs://` → `https://ipfs.io/ipfs/`)
- Caches results by contract+tokenId

## Components

| Component | Purpose |
|-----------|---------|
| `WinnersSection.js` | Refactored to render marquee layout instead of boxed section |
| `WinnerPill.js` | New component for glassmorphic pill with hover expansion |
| `WinDetailsModal.js` | New modal for full win information |
| `NftMetadataService.js` | New service for fetching/caching NFT metadata |

## Display Logic

| Winners Count | Display |
|---------------|---------|
| 0 | Placeholder text: "Who will be the FIRST miladycola champion" |
| 1-3 | Static centered row, no animation |
| 4+ | Auto-scrolling marquee, right-to-left |
