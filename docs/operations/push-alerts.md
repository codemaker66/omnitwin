# Alerts on this device (web push)

Goal 19 S7, decision D8. A phone, a desk or the wall can be told three things
and nothing else: a request landed for you, a request escalated to you, a
reply to your request. The in-product ring, inbox and email are unchanged;
push is a fourth way the house is told when no screen is being watched.

## Turning it on

On the Day Board (`/hallkeeper/today`) or in the notification bell on the
dashboard, press **Turn on alerts on this device**. The browser asks once
whether this site may show notifications; say yes. The switch then reads
**Alerts on this device: on**, with **Turn off** beside it. Each device is
switched on separately; a phone and a desk are two switches.

## What the words mean

- **Alerts are not switched on for this venue yet.** The server has no push
  key. An operator sets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
  `VAPID_SUBJECT` (a real `mailto:` address) on the API and restarts it. The
  pair comes from `node -e "console.log(require('web-push').generateVAPIDKeys())"`
  run once in `packages/api`; the private key goes into the hosting
  variables and nowhere else.
- **Alerts are blocked for this site in the browser.** The person refused
  notifications once. Allow them for venviewer.com in the browser's site
  settings, then press the switch again.
- **This browser cannot show alerts.** No push here. On an iPhone or iPad,
  open venviewer.com in Safari, use Share → **Add to Home Screen**, and open
  Venviewer from that icon: the installed app can be told, the browser tab
  cannot. The wall display's browser is set up the same way, once.

## What is recorded

Every subscription is a row in `push_subscriptions` (who, which venue, which
kind of device). Every attempt to tell a device is a row in `push_sends` with
the push service's answer. A device whose push service answers 404 or 410 is
disabled, not deleted, and is never tried again until it subscribes afresh.
Nothing in a notice changes a request, a time, a layout or stock; a tap opens
the Day Board or the event page.
