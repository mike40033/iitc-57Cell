# Battle Beacon Countdown

When a portal gets 7 Portal Scan uploads within a septicycle, Ingress schedules a Rare Battle Beacon for it,
deployed after the septicycle ends. Intel marks such portals with the ornament `bb_s`.

This plugin:

- rings each portal carrying `bb_s` (layer "Scheduled Battle Beacons"), with a countdown label at zoom 14+
- shows a box (bottom left) with the number of scheduled beacons in view and the time until the septicycle ends
- lists every scheduled beacon seen this septicycle (toolbox link "Battle Beacons", or click the box), even after you pan away

Limitations:

- Intel only shows the scan count once it reaches 7, so portals on 0–6 scans can't be shown.
- Load all portals (zoom 15+) to be sure of seeing every scheduled beacon in an area.
- The countdown is to the end of the septicycle; the beacon may take a little while after that to appear.
- If Niantic renames the ornament, nothing will be found. The dialog lists every ornament ID on loaded portals,
  so you can spot the new name and add it to `SCHEDULED_ORNAMENT_PREFIXES`.
