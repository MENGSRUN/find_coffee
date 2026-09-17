# Separate project plan: portable offline map hardware

Status: planning only for a **new, separate hardware/software project**. These notes
are kept here for reference; they do not propose converting the existing café app or
adding hardware support to it. The user has chosen ESP32-S3 for a budget-conscious
prototype and prefers C. The exact board and purchases are not yet confirmed.

Hardware recommendations below were checked against manufacturer documentation on
2026-09-16. They assume an initial desk/handheld prototype with an attached screen,
because the final form factor and exact spending limit are undecided. Cost is a priority. A wristwatch design would
need a different board, display, power budget and enclosure.

The new concept is a portable device showing stored maps, GPS position, compass
heading and progress along a previously saved route, with optional café/POI data.

## Current direction: ESP32-S3 with C

The initial prototype should use **ESP32-S3 + ESP-IDF + C**, with LVGL for controls
and a small custom offline-map renderer. ESP-IDF supports C directly; LVGL can be
used from C. Start with the board vendor's working display example and compatible
ESP-IDF/LVGL versions, then pin those versions. Do not assume the newest library
versions match an older board example. Application code can use `.c` files and
`app_main()`; check dependencies separately if an entirely C-only build is required.
See [ESP-IDF C support](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/c.html)
and the [LVGL introduction](https://lvgl.io/docs/open/9.0/intro/).

LVGL provides widgets and drawing support, not a complete Leaflet-style map engine.
The firmware must load map images, translate latitude/longitude to map pixels, manage
pan/zoom and draw location/route overlays. Python can optionally prepare map data on
the development computer; it does not need to run on the device.

### Buy in stages

| Stage | Parts | What can be tested |
| --- | --- | --- |
| 1: desk prototype | ESP32-S3 display board with PSRAM, microSD support, data cable and an existing microSD card | Display, offline map and simulated movement |
| 2: real position | UART GPS module with antenna and compatible logic levels | Outdoor position and saved-route progress |
| 3: stationary direction | Magnetometer, or a suitable 9-DoF sensor | North-referenced direction while standing still |
| 4: portability | Matched battery/power solution and enclosure | Runtime and handheld use |

The **Waveshare ESP32-S3-Touch-LCD-2.8 (SKU 27690)** remains a reference candidate
because it integrates the display, PSRAM and card slot. Obtain its delivered price
before choosing it; it is not claimed to be the cheapest board. Compare the total cost
against a separate ESP32-S3 board, screen, card reader, connectors and shipping.
Use the exact model's documentation: similarly named variants can have different
screens and pin assignments. See the [board specification](https://docs.waveshare.com/ESP32-S3-Touch-LCD-2.8).

Use USB power initially. Simulate GPS coordinates until the map works, then buy a
GPS module. The board's onboard accelerometer/gyro cannot provide magnetic north,
so a compass sensor can be deferred but cannot be replaced by that six-axis IMU.
Without a compass, show position only, or clearly label any movement-derived bearing.
Premium sensor boards listed later are reference examples, not mandatory purchases.

### Small first milestone

- One small, legally obtained map area at one fixed zoom level, stored on microSD.
- A moving position dot, initially driven by simulated coordinates.
- Touch or buttons for panning/recentering, followed by GPS integration.
- A saved route line and basic progress calculation after the map and GPS work.

Start with simple pre-rendered images and bounded buffers; add tiled loading, caching
and multiple zoom levels incrementally. As a memory-sizing example, a 240 × 320 RGB565
image buffer occupies 153,600 bytes (150 KiB), before other buffers and application
state. PSRAM helps, but the display driver's DMA/buffer requirements must also be met.
Do not load an entire city map into RAM. Offline road-route calculation is not part
of this budget prototype; prepare route files on a computer.

No ESP-IDF installation, firmware scaffold or hardware connection is performed yet.
The next planning input is the exact board listing and a maximum total budget including
shipping, so display drivers, free pins and sensor choices can be checked before purchase.

## Hardware options

| Capability | Raspberry Pi running Linux | Typical ESP32 microcontroller |
| --- | --- | --- |
| Current Leaflet UI | Reuse in a browser such as Chromium | Requires a different embedded display UI |
| FastAPI and PostGIS | Run locally, subject to board resources | Not a practical fit |
| Offline map display | Serve stored tiles to Leaflet | Draw pre-rendered tiles from SD storage |
| GPS position and compass | External sensors read through Python | External sensors read through firmware |
| Development effort | Adapt the existing project | Build a separate, simpler application |

A Linux-capable Raspberry Pi is the preferred starting point for keeping the current
interface. This does not refer to the Raspberry Pi Pico microcontroller family.
Chromium can display the app fullscreen using
[Raspberry Pi kiosk mode](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/).
ESP32 memory and display capabilities depend on the exact board and external RAM;
see the [Espressif specifications](https://documentation.espressif.com/esp32_datasheet_en.html).

## Proposed software for the separate Raspberry Pi prototype

1. Select a bounded map area, initially Phnom Penh, and a useful range of zoom levels.
2. Obtain tiles licensed for offline use, or generate tiles from OSM data. Store them
   on local storage and serve them through a local tile endpoint.
3. For a Python/web prototype, serve a new local Leaflet UI from FastAPI. Keep scripts,
   styles and assets local; use Chromium on the attached display. Reuse ideas from the
   café app only where useful, rather than depending on the running café service.
4. Store map tiles and optional POIs locally. A file/SQLite-based design is a reasonable
   starting point for this new project; PostGIS is optional if spatial SQL becomes a
   learning objective or requirement. Prepare data on a development computer, then
   transfer it to the device. Choose storage formats during software design.
5. Read an external GPS receiver and compass through Python and expose their readings
   to the new UI through a local API or stream;
   attaching sensors does not automatically make them available through browser APIs.
6. Use an attached display with Chromium, or serve the app to a phone on a local network.
   If the phone supplies its own browser GPS/compass, retain the trusted HTTPS setup.
7. Test with internet disconnected: map coverage, missing tiles, café searches, sensor
   updates and clear handling of unavailable online features.

Storage needs depend on the area, tile format and zoom range. Start with a small area
before estimating storage for Cambodia. A similar appearance is possible, but matching
the current background exactly depends on the offline tile source and map style.

## Offline maps versus offline routing

Local tiles support map display. Local café data supports nearby straight-line searches.
GPS and compass sensors can provide position and direction without internet connectivity.
These capabilities do not calculate new road routes by themselves.

Hosted openrouteservice still requires connectivity for road-distance ranking and new
walking/driving routes. The initial plan retains the preference to avoid a locally hosted routing
engine. Under that constraint, the initial offline version should:

- Support the local map, café search, GPS tracking and compass direction.
- Clearly mark road searches and new route requests as unavailable offline.
- Optionally support previously saved route geometry and local progress tracking later.
  Route persistence is additional work: current route previews are not saved for offline use.
- Keep external website links and Google Maps directions clearly separate from offline
  functionality; those destinations may require connectivity.

New offline road routes would require a local routing engine or another on-device routing
implementation, which is outside the proposed initial scope.

## Map source and attribution

Do not bulk-download the current `tile.openstreetmap.org` tiles for offline storage.
Its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) prohibits
offline use. OSM data availability does not grant unrestricted use of that tile service.
Choose an offline-permitted source or generate maps, and retain the required map/data
attribution and license information.

## Alternative for a larger budget: Raspberry Pi

**Earlier Python-first option: Raspberry Pi 5, 4 GB RAM, with a 5-inch Touch Display 2.**
This is not the current budget selection. It remains an
engineering recommendation for development headroom, not a tested performance guarantee
or a final wearable design. The Pi supports Linux, USB sensors and a local browser;
4 GB is a sensible starting allocation for this proposed Python/UI workload.
See the [Pi 5 specifications](https://www.raspberrypi.com/products/raspberry-pi-5/).

| Part | Suggested selection | Purpose and connection |
| --- | --- | --- |
| Computer | Raspberry Pi 5, 4 GB | Run the new Python service, local map renderer and sensor adapter |
| Display | Official Raspberry Pi Touch Display 2, 5-inch | 720 × 1280 touch display; DSI connection, power from GPIO |
| Storage | 64 GB microSD from a reputable supplier, preferably high-endurance | OS and initial local map region; capacity is a starting estimate, not a promise that all Cambodia zoom levels will fit |
| Position sensor | Adafruit Ultimate GPS GNSS with USB, product 4279, or a verified equivalent Linux USB-serial NMEA receiver | USB carries sensor data and power; the reference board includes a patch antenna |
| Direction sensor | Adafruit LSM6DSOX + LIS3MDL 9-DoF breakout, product 4517 | I2C accelerometer, gyro and magnetometer for heading with tilt compensation |
| Desk power | Official Raspberry Pi 27W USB-C power supply | Provides the Pi-compatible 5.1 V / 5 A output |
| Cooling | Official Pi 5 Active Cooler | Cooling for sustained development/display work |
| Cables/mounting | USB data cable for GPS, I2C leads or a compatible STEMMA QT adapter, display cables and standoffs | Check fit and GPIO access with the display/cooler before choosing an enclosure |
| Portable power | Select after measuring the complete prototype | Use a Pi-5-compatible supply/UPS with adequate output and controlled shutdown; no specific battery is selected yet |

The 5-inch Touch Display 2 is compatible with Pi 5 and includes the appropriate
22-to-15-pin display cable; it also needs its GPIO power lead. It does **not** support
the Pi Zero series. See the [display connection guide](https://www.raspberrypi.com/documentation/accessories/touch-display-2.html).
Check that the final enclosure leaves room for the cooler, display wiring and I2C leads.

The [USB GPS reference board](https://www.adafruit.com/product/4279) is designed for
USB hosts such as Linux computers and has an integrated antenna. Its manufacturer page
showed out of stock when checked; check a distributor or select an equivalent only
after verifying its Linux interface and antenna. Local Cambodia availability is not verified.
A USB data cable is required, not a charge-only cable.

The [9-DoF reference breakout](https://www.adafruit.com/product/4517) supplies the sensors;
it is not a ready-made compass-heading service. Software still needs axis alignment,
magnetic calibration and tilt compensation. Start with the device flat, then implement
and test tilted poses. Mount it away from the fan, speakers, magnets and high-current
wires. Plan a magnetic-declination correction if heading must align with true/map north.
Use the manufacturer's [sensor integration guide](https://learn.adafruit.com/st-9-dof-combo?view=all).

Use the [official power supply](https://www.raspberrypi.com/products/27w-power-supply/)
on the desk and the [Active Cooler](https://www.raspberrypi.com/products/active-cooler/)
for the proposed open development assembly. A battery bank labelled “27 W” or “65 W”
is not sufficient evidence of Pi compatibility: check its output at the required 5 V
profile, cable, and peripheral budget. Choose portable power after measuring the display,
GPS and Pi together. Runtime estimate: usable battery watt-hours divided by measured
average watts, including conversion losses. No runtime claim has been established.

## ESP32-S3 reference hardware details

For learning firmware or prioritizing a compact device over Python reuse, consider the
**Waveshare ESP32-S3-Touch-LCD-2.8 (SKU 27690)**. It combines a 240 × 320 touchscreen,
8 MB PSRAM, 16 MB flash, TF/microSD slot, exposed UART/I2C, and battery charging support.
Its onboard QMI8658 is a **six-axis accelerometer/gyro, not a magnetic compass**.
See the [manufacturer's board documentation](https://docs.waveshare.com/ESP32-S3-Touch-LCD-2.8).

Proposed additions are a UART GPS breakout (for example, the serial
[Adafruit Ultimate GPS product 746](https://learn.adafruit.com/adafruit-ultimate-gps)),
a magnetometer/9-DoF sensor, a microSD card for a small prepared map region, and a battery
matched to the board's documented voltage, connector polarity and charging requirements.
The Pi's USB GPS reference is not a drop-in UART module for the ESP32. Confirm free pins,
I2C addresses and 3.3 V logic compatibility before producing a wiring diagram.

This option needs a new embedded UI, such as C/C++ with LVGL, plus tile decoding and
map-position calculations. It would not run the existing Leaflet/FastAPI/PostGIS stack.
Prepare map tiles and route files on a computer and transfer them to the SD card. Start
with a GPS marker on a small map and a saved route; broad zoom coverage and smooth
scrolling need profiling. The screen and development board make a small handheld
prototype, not an established watch-sized product. Battery runtime and outdoor visibility
must be measured rather than assumed.

## Alternatives and decisions

- If a Raspberry Pi 4 with sufficient memory is already available, evaluate it before
  purchasing a Pi 5. Match the display cable, power supply and cooling to that model.
- Pi Zero 2 W is not the default choice for the browser/Python prototype: it has 512 MB
  RAM, which leaves less headroom, and the proposed DSI display is incompatible. This
  is a design judgment based on the [board specification](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/),
  not a claim that a lightweight offline-map program cannot run on it.
- For a true wristwatch, first set screen size, dimensions, weight and battery-runtime
  targets; then select a watch-oriented platform. Do not purchase the Pi assembly
  assuming it will later fit into a watch enclosure.

Before purchasing, decide the budget, final device style (handheld/bike/watch), desired
hours of operation, map area/zoom levels, and outdoor display requirements. Obtain local
prices including shipping and accessories; this document does not quote a procurement
budget or promise stock availability.

## Staged build plan

1. Proceed with the ESP32-S3/C path; confirm the exact display board and delivered cost
   before buying it. Keep the Pi option as a future alternative.
2. Validate display and local map rendering on desk power before adding sensors.
3. Add GPS and test outdoors with internet disconnected.
4. Add compass calibration and map-aligned heading, including stationary turns.
5. Add a saved route and test progress/off-route detection without online routing.
6. Measure CPU/memory, tile-storage size, power draw and screen visibility.
7. Select portable power and an enclosure around those measurements. Reassess the board
   if size or runtime misses the intended product target.

These are recommendations for a separate project. No hardware is ordered, firmware
written, or application behavior changed as part of this documentation update.
