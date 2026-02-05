# UI Extraction Design: app-colasseum → miladycolav4

**Date:** 2026-01-15
**Status:** Approved

## Overview

Incrementally extract UI from the bloated `app-colasseum/index.html` (~42k tokens) into clean microact components in `miladycolav4/`. No changes to root directory until full parity achieved.

## Decisions

| Aspect | Decision |
|--------|----------|
| Scope | Incremental extraction - write only to miladycolav4 |
| Order | UI first - visuals before wiring services |
| Granularity | Mixed - coarse layout containers, fine interactive pieces |
| Mock data | Static JSON fixtures |
| Validation | Script comparing computed styles + manual eyeballs |

## Directory Structure

```
miladycolav4/
├── src/
│   ├── main.js                    # Entry point
│   ├── style/
│   │   ├── main.css              # Global styles
│   │   ├── base.css              # Reset, typography, variables
│   │   ├── utilities.css         # Helper classes
│   │   └── components.css        # Component-specific styles
│   │
│   ├── fixtures/                  # Static mock data
│   │   ├── challenges.json       # Sample challenge/draw data
│   │   ├── bottles.json          # Sample user bottles
│   │   └── config.json           # Chain config, contract addresses
│   │
│   ├── components/
│   │   ├── App.js                # Root component
│   │   │
│   │   ├── layout/               # Coarse layout containers
│   │   │   ├── AppShell.js       # Header + main + footer wrapper
│   │   │   ├── Header.js         # Wallet bar + notification area
│   │   │   ├── Dashboard.js      # "Your Bottles" section
│   │   │   ├── ChallengeGrid.js  # "Prizes" section
│   │   │   └── ModalManager.js   # Modal open/close orchestration
│   │   │
│   │   └── ui/                   # Fine interactive pieces
│   │       ├── ChallengeCard.js  # Single prize card
│   │       ├── BottleCard.js     # Single bottle in dashboard
│   │       ├── OddsSlider.js     # Odds % slider + payment calc
│   │       ├── AppraisalInput.js # +/- stepper for ETH value
│   │       ├── NotificationBell.js
│   │       ├── ChallengeWizard.js
│   │       ├── EntryModal.js
│   │       ├── BottlePreviewModal.js
│   │       └── RevealModal.js
│   │
│   └── generated/                # Build artifacts (contract.json, etc.)
│
├── scripts/
│   ├── validate-styles.mjs      # Style comparison script
│   ├── style-targets.json       # Selectors to compare
│   ├── chain-start.mjs
│   ├── chain-stop.mjs
│   ├── deploy.mjs
│   └── setup.mjs
│
└── docs/
    └── plans/
        └── 2026-01-15-ui-extraction-design.md
```

## Component Hierarchy

```
App
 └── AppShell
      ├── Header
      │    ├── WalletButton (from micro-web3)
      │    └── NotificationBell
      │
      ├── HeroSection (static markup, CTA buttons)
      │
      ├── Dashboard
      │    └── BottleCard[] (mapped from fixtures/bottles.json)
      │
      ├── ChallengeGrid
      │    └── ChallengeCard[] (mapped from fixtures/challenges.json)
      │
      ├── Footer (static)
      │
      └── ModalManager
           ├── ChallengeWizard (create challenge)
           ├── EntryModal (buy bottle)
           ├── BottlePreviewModal (inspect bottle)
           └── RevealModal (pop animation)
```

## Data Flow

- Fixtures loaded once in `App.js` or `AppShell.js`
- Passed down as props to children
- `eventBus` (from microact) for cross-component events:
  - `modal:open` / `modal:close`
  - `challenge:select` (ChallengeCard → EntryModal)
  - `bottle:reveal` (BottleCard → RevealModal)

No global state store - props down, events up. Real services wired later by swapping fixture imports for service calls.

## Extraction Phases

### Phase 1: Foundation
- Port CSS from `app-colasseum/styles/` → `miladycolav4/src/style/`
- Create fixture files from real data samples
- Set up `AppShell` with static header/footer
- Create `validate-styles.mjs` script

### Phase 2: Read-Only Views
- `ChallengeGrid` + `ChallengeCard` (display challenges from fixture)
- `Dashboard` + `BottleCard` (display bottles from fixture)
- `HeroSection` (static markup)

### Phase 3: Modals (display only)
- `ModalManager` (open/close orchestration)
- `BottlePreviewModal` (view bottle details)
- `ChallengeWizard` (form UI, no submission)
- `EntryModal` (odds slider, price display, no purchase)

### Phase 4: Interactive Polish
- `OddsSlider` with live calculation display
- `AppraisalInput` stepper
- `NotificationBell` with dropdown
- Countdown timers on bottles

### Phase 5: Wire Real Services
- Replace fixture imports with contract calls
- Connect WalletService events
- Enable actual transactions

## Validation Strategy

**Automated style comparison:**

```
miladycolav4/scripts/
├── validate-styles.mjs      # Puppeteer script
└── style-targets.json       # Selectors to compare
```

Script workflow:
1. Run both apps (app-colasseum :3000, miladycolav4 :5173)
2. Navigate to each app via Puppeteer
3. Query target elements by selector
4. Extract `getComputedStyle()` values
5. Compare and report differences

Example output:
```
Comparing .challenge-card
  ✓ background-color: match (rgb(26, 26, 26))
  ✓ border-radius: match (12px)
  ✗ padding: mismatch
      app-colasseum: 16px
      miladycolav4:  12px

Summary: 47/50 properties match, 3 mismatches
```

**Manual validation:** Eyeball layout, spacing, overall feel after automated checks pass.

## Constraints

- **No changes to root directory** (app-colasseum, app/, etc.) until full parity
- All new code goes into `miladycolav4/` only
- Each phase produces a working `npm run dev` result
