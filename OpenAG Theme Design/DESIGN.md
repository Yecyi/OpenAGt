# Design System Specification: The Modern Archive

## 1. Overview & Creative North Star
**Creative North Star: The Digital Broadsheet**
This design system is a digital translation of heritage journalism. It moves away from the "app-like" fatigue of rounded corners and playful colors, opting instead for the authority of a high-end editorial publication. We are building a "Digital Broadsheet"—a space where information is curated, not just displayed.

To break the "template" look, designers must embrace **intentional asymmetry**. Align large `display-lg` headlines to the left while pushing supporting metadata to far-right gutters. Use overlapping elements—such as a serif headline partially bleeding into a `surface-container` image area—to create a sense of depth and custom-crafted layout that feels bespoke rather than generated.

---

## 2. Colors & Tonal Architecture
The palette is a disciplined study in monochrome. It relies on the subtle shifts between light and shadow to guide the eye.

*   **Primary Roles:** Use `primary` (#000000) for high-impact text and functional CTAs. The `background` (#f9f9f9) is a warm, paper-like off-white that reduces eye strain compared to pure hex white.
*   **The "No-Line" Rule:** Prohibit the use of 1px solid borders for sectioning. Global boundaries must be defined through background color shifts. For example, a sidebar should be defined by `surface-container-low` (#f3f3f3) sitting against a `surface` (#f9f9f9) background.
*   **Surface Hierarchy & Nesting:** Treat the UI as stacked sheets of fine paper. 
    *   **Level 0:** `surface` (#f9f9f9) - The base canvas.
    *   **Level 1:** `surface-container-low` (#f3f3f3) - For secondary content areas.
    *   **Level 2:** `surface-container-lowest` (#ffffff) - For "elevated" content like cards or active input fields to create a natural lift.
*   **Signature Textures:** For primary buttons or hero accents, use a subtle linear gradient from `primary` (#000000) to `primary-container` (#3b3b3b) at a 155-degree angle. This adds a "lithographic" depth that flat black cannot achieve.

---

## 3. Typography
Typography is the cornerstone of this system. We pair the intellectual weight of a serif with the industrial precision of a sans-serif.

*   **Editorial Authority (Newsreader):** Use for all `display`, `headline`, and `body-lg` tokens. This serif typeface carries the "truth" of the content. Increase tracking slightly (0.02em) on headlines to enhance the premium, airy feel.
*   **Functional Engine (Public Sans):** Use for `title`, `label`, and `body-sm`. These are the UI’s working parts—navigation, captions, and buttons. They must remain legible, neutral, and secondary to the editorial voice.
*   **Hierarchy Tip:** A `display-lg` (3.5rem) headline should often be paired with a `label-md` (0.75rem) uppercase sub-head to create a dramatic typographic "crunch" that signals high-end design.

---

## 4. Elevation & Depth
In this system, we do not use "elevation" in the Material sense. We use **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by "stacking." Place a `surface-container-lowest` (#ffffff) card on a `surface-container-low` (#f3f3f3) section. This creates a soft, sharp-edged lift without the clutter of shadows.
*   **Ambient Shadows:** If an element must float (e.g., a dropdown menu), use a "Shadowless Shadow": a 48px blur with 4% opacity using the `on-surface` color. It should feel like a soft glow of light blocked by paper, not a digital drop shadow.
*   **The "Ghost Border" Fallback:** If accessibility requires a stroke, use a **Ghost Border**: `outline-variant` (#c6c6c6) at 20% opacity. Never use 100% opaque borders for containers.
*   **Glassmorphism:** For persistent navigation bars, use `surface` (#f9f9f9) at 80% opacity with a `20px` backdrop-blur. This allows the high-contrast typography of the content to scroll beneath it, maintaining a sense of layered physical space.

---

## 5. Components

*   **Buttons:** 
    *   **Primary:** Solid `primary` (#000000) with `on-primary` (#e2e2e2) text. 0px border-radius. 
    *   **Secondary:** Ghost style. `0px` radius, `outline` (#777777) at 20% opacity, with `primary` text.
*   **Input Fields:** Avoid the "box." Use a `surface-container-highest` (#e2e2e2) background with a 2px bottom-border of `primary` (#000000) on focus. Sharp corners only.
*   **Cards:** Forbid divider lines. Use vertical whitespace (32px or 48px) to separate card units. Content within cards should use `title-md` for headers to distinguish from the page's `headline` scales.
*   **Chips:** Rectangular, `surface-container-high` (#e8e8e8) background, `label-md` text. No rounded ends.
*   **Lists:** Remove all horizontal dividers. Use a subtle hover state change to `surface-container-low` (#f3f3f3) to indicate interactivity.
*   **The "Rule" Component:** While we avoid sectioning lines, a single, ultra-thin (0.5pt) horizontal line using `outline-variant` at 50% opacity can be used *within* an article to separate the "Lede" from the "Body," mimicking traditional newspaper layouts.

---

## 6. Do's and Don'ts

### Do
*   **Do** lean into extreme whitespace. If you think there is enough margin, add 16px more.
*   **Do** use "Optical Alignment." Because we use sharp corners (0px), alignment errors are magnified. Ensure text is baseline-aligned across columns.
*   **Do** treat images as "Editorial Assets." Use `0px` radius and consider a 1% black inner-stroke to "seat" the image into the paper background.

### Don't
*   **Don't** use border-radius. Ever. Every element must have a 0px radius to maintain the architectural, authoritative feel.
*   **Don't** use "Information Blue" for links. Use `primary` (#000000) with a thin underline (1px) or a weight shift.
*   **Don't** use center-alignment for long-form text. Editorial design is rooted in the "left-edge" anchor. Center-alignment is reserved only for specific, isolated pull-quotes.

### Accessibility Note
While we use subtle grays for layering, always ensure that text-to-background contrast ratios meet WCAG AA standards. Use `on-surface-variant` (#474747) for secondary text to maintain legibility against the `surface` background.