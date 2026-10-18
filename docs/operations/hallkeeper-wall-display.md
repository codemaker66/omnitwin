# The hallkeeper wall display

How to put the Day Board on a screen in the hallkeeper's corridor and leave it there for a shift
(goal 19 S8, items 13 to 15). Written for whoever sets the tablet up on the day; nothing here needs
a developer.

## The wall URL

Open `https://venviewer.com/hallkeeper/today?register=wall` in the tablet's browser, signed in as
the house's wall account (any venue account with the hallkeeper or staff role). The wall register
wears the dark colours, shows room, title, state and time in large type, and nothing opens on it: a
tap does nothing, so a passer-by cannot change a request from the corridor. Requests, handovers and
alerts are worked from a phone or the office desk (`/hallkeeper/today` without the register).

The screen also tells the office it is on: the Diary's header reads "Wall display live" while the
wall has the board open, and "No hallkeeper screen is on; escalating in 2 min" when nothing is
watching. Closing the tab or losing the network takes the line down within a minute.

## Keeping it on

- **The board holds the screen awake.** While the wall page is visible the browser holds a Screen
  Wake Lock, so the tablet's own screen timeout does not apply. The lock is dropped by the system
  whenever the tab is hidden and asked for again when it comes back. A browser without the lock
  (Firefox, an old Android WebView) runs the board the same; set the device's screen timeout to never.
- **iPad: Guided Access.** Settings → Accessibility → Guided Access → on; set a passcode; open the
  wall URL in Safari; triple-click the side (or home) button → Options → turn Touch off → Start. The
  screen stays on the board and ignores touch until the passcode ends the session. Set Auto-Lock to
  Never under Display & Brightness as well.
- **Android: screen pinning.** Settings → Security → Pin app (names vary); open the wall URL in
  Chrome; from the recent-apps view choose the pin icon on Chrome. Set Display → Screen timeout to
  the longest value.
- **A PC or Chromebox under the screen.** Chrome in kiosk mode: `chrome --kiosk
  "https://venviewer.com/hallkeeper/today?register=wall"`; sign in once first in a normal window on
  the same profile.
- **Mains power.** A tablet on battery lowers brightness and may refuse the wake lock when the
  battery is low. Keep it plugged in.

## The day boundary

The board's day does not end at midnight. It ends at the venue's day boundary hour, 04:00 by
default (an administrator changes it under the venue's operating settings), so an event running to
02:00 stays on today's board and the wall rolls once, at 04:00 on the wall clock, with one redraw.
The wall needs no restart for a new day, a bank holiday or a clock change: the rollover follows the
wall clock across both daylight-saving Sundays.

## Burn-in

The board on the wall sits a few pixels off centre and moves to a new spot every ten minutes, so no
slab edge rests on the same row of pixels for a whole shift. The move is a position, not a motion;
nobody sees it. An OLED panel still wants a nightly off: a smart plug or the panel's own schedule,
off after the last event and on before the first, is enough. The board comes back on its own when
the panel does, through the saved sign-in.

## Signing in

The wall stays signed in while the tab is open: the sign-in refreshes itself and every reconnection
of the live feed asks for a fresh token. After a reboot or a browser update, open the URL and sign
in once. If the screen shows the sign-in page in the morning, the account's session was ended from
the dashboard; sign in again.

## When it dies

The stale band across the top of the board is the one thing that outranks every other state. It
says, in words, what the board no longer knows: "Offline since 14:32 · reconnecting. Showing the
day as last read; the words still stand." while the live feed is down, "Showing the day as read at
14:32." when the day may be stale. While the band shows, treat the wall as a poster, not a record.

If the screen, the tablet or the network is gone:

1. The phone is the second screen. Every hallkeeper's phone shows the same board at
   `/hallkeeper/today`, with alerts on this device switched on.
2. The office prints today. On the Day Board's paper register (the desk or a phone, not the wall)
   press **Print today**. The printed page lists every lane's bookings with room, title, time and
   state, black on white, dated and marked "Printed from the Day Board; the screen is the record."
   Pin it where the wall was.
3. Requests still land. A request raised while the wall is dark reaches the phones and, after the
   venue's window, the duty administrator by inbox and email (quiet hours 22:00 to 07:00 for email).

Nothing is lost while the wall is off: the board is a view of the Diary, not a store of its own.
