# Trades Hall browser-tab crest

Published 9 September 2026 at Blake's request. The full-colour Trades House crest
replaces the building silhouette as the browser-tab icon on all ten current
Trades Hall content pages.

## Artwork and delivery

The official [header artwork](https://www.tradeshouse.org.uk/gfx/trades-house@2x.png)
is preserved in `trades-house-original.png`, SHA-256
`d51378e11d2986a76db7da5f4dab1598b7870dbae10b07c1bf0b4f9146c98005`.
The SVG frames the crest without its separate wordmark, retaining the original
bitmap and heraldry. A transparent 256×256 PNG was exported from that SVG in
Chromium. PNG SHA-256:
`c8d3bc26c91ee5ecbda7cf6678b596737b5cbf1ee6c66adf93cfc3219edde68c`.

CMS file **93** serves the immutable shared script:
[trades-hall-site-icon-v1.js](https://www.tradeshallglasgow.co.uk/file-download/93/trades-hall-site-icon-v1.js).
It is **127,082 bytes**, SHA-256
`b0cb7874c71da29003248a39befbc88e6394a36dbbf9b345aac4740f5054dfe6`.
The PNG is embedded so the icon has no external image dependency. The script
replaces competing browser-icon links with one PNG link and is idempotent.
Apple home-screen icons and the manifest retain their existing configuration.

The CMS account exposes content scripts but no favicon/template editor. The
existing hard-coded `/favicon/` files therefore remain intact. A shared deferred
script is included in existing content blocks through the supported CMS source
editor; this applies the crest when JavaScript runs. For new pages, include the
same hook or migrate the icon to the shared template with hosting access.

| Page | CMS page | Content block |
|---|---:|---:|
| `/` | 1 | 69 |
| `/weddings/` | 2 | 60 |
| `/corporate-hire/` | 3 | 52 |
| `/packages/` | 4 | 42 |
| `/rooms/` | 5 | 20 |
| `/accommodation/` | 6 | 10 |
| `/contact/` | 7 | 2 |
| `/terms-and-conditions/` | 8 | 6 |
| `/privacy-policy-2/` | 9 | 8 |
| `/landing` | 10 | 78 |

All non-landing pages use this invisible hook, appended to existing nonempty text:

```html
<div id="th-site-icon-hook" hidden="hidden">
  <script defer src="https://www.tradeshallglasgow.co.uk/file-download/93/trades-hall-site-icon-v1.js"></script>
</div>
```

The landing includes the script inside its existing shadow host. Its generator
now preserves that reference. The immutable v5 landing bundle is unchanged.

## Verification and recovery

All ten saves were confirmed by the CMS. Anonymous GET of file93 matches the
local bundle byte for byte, and JavaScript syntax passes. Actual in-app Chromium
navigation across all ten pages confirmed exactly one browser icon, `256x256`,
whose decoded PNG hash matches the crest export. All nine ordinary hooks compute
to `display:none`; public text matches the pre-change text exactly. Browser logs
contained no warnings or errors. See `live-verification.json` and
`content-verification.json`. Original artwork and rendered crest were visually
inspected. No forms were submitted. Other browser engines were not exercised.

`cms-before/` contains the exact source editor contents before each change.
Restore the relevant block from that backup to remove the override. To recover
the previous landing embed, use `cms-before/block-78.html`, retaining v5's Craft
layout and event hold. Restore the generator's external embed logic too if
intentionally withdrawing the icon. Keep the uploaded file immutable.
