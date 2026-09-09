# Trades Hall browser-tab icon — golden building

**Current selection, 9 September 2026:** Blake replaced his earlier crest choice
with the golden line drawing of the Trades Hall building. The crest override
has been removed from all ten content pages and from the landing generator.
The website now uses its original native template icons, including with
JavaScript disabled. Future pages inherit those native icons automatically.

The three native assets return HTTP200. Both the PNG and the transparent SVG's
embedded bitmap were visually confirmed as the detailed golden building:

| Native asset | Size | SHA-256 |
|---|---|---|
| `/favicon/favicon-96x96.png` | 96×96, 11,284 bytes | `5a7bf68c15cbed2940f32efaae9ffdb5f2b0d97cfe0aa1fb4f6fe46c9d7a5233` |
| `/favicon/favicon.svg` | 256×256, 40,998 bytes | `4c4ed90d1064ac4767abccfe6ea2abf893ac80abc7393b3dc077f27f78911f0c` |
| `/favicon/favicon.ico` | 48/32/16px, 15,086 bytes | `da60280b68220f63221061bad6df21a8aa400671c665aa06fc98b4887977644d` |

All ten CMS removals were saved and live browser navigation verified the native
PNG/SVG/ICO references with no crest script, injected icon or hidden hook.
Public text in the nine ordinary blocks matches the original exactly; the
landing retains its immutable v5 runtime. No browser warnings/errors. Evidence:
`building-live-verification.json` and `building-content-verification.json`.

The crest files and earlier receipts below are historical. Do not re-add file93
while the golden building remains the selected icon.

## Historical crest artwork and delivery

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
script was included in existing content blocks through the supported CMS source
editor. That earlier approach applied the crest when JavaScript ran. All those
references have now been removed.

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

The non-landing pages previously used this invisible hook, now removed:

```html
<div id="th-site-icon-hook" hidden="hidden">
  <script defer src="https://www.tradeshallglasgow.co.uk/file-download/93/trades-hall-site-icon-v1.js"></script>
</div>
```

The landing previously included the script inside its existing shadow host.
That reference has been removed from both the CMS and its generator. The
immutable v5 landing bundle is unchanged.

## Historical crest verification and backups

The earlier ten crest saves were confirmed by the CMS. Anonymous GET of file93 matched the
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
