# Echo Tune

Echo Tune is a guitar tuner for iPhone, built to be as precise as a phone microphone allows. It hears the string you play, works out which string it is, and shows how far off it is in cents (hundredths of a semitone). It works offline, and nothing is recorded or sent anywhere.

## What it does

- **Auto**: play any string and Echo Tune finds which one it is, even while the strings you tuned before are still ringing. The string lights up on the headstock.
- **One string**: tap a peg to tune only that string. Useful when a string is very far off (Auto might take it for its neighbour) or when you change to a new tuning. Tap the peg again, or switch Auto on, to go back.
- **14 tunings**: Standard, half step and whole step down, Drop D, Double drop D, Drop C♯, Drop C, Drop B, DADGAD, Open D, E, G, A and C. Tap the tuning at the top to change it.
- **Chromatic**: any note, for other instruments or single frets. Choose sharps or flats in Settings.
- **The needle**: ±50 cents, stretched near the centre so a single cent is easy to see. The green zone is "in tune".
- **The striped band**: it drifts left when you are flat and right when you are sharp, slower the closer you get, and stands still when the string is spot on. It shows differences far smaller than the needle can, the way a strobe tuner does.
- **In tune**: the note turns green, the peg gets a tick, and on iPhones that support it you feel a light tap. When all six have ticks, it tells you.
- **Settings**: the reference pitch (A4 = 440 Hz, adjustable from 415 to 466 Hz) and how close counts as in tune (±1, ±2, ±3 or ±5 cents; ±2 is the default).

## How precise it is

Echo Tune measures the pitch about 50 times a second. It first finds the note roughly (the McLeod pitch method, standard for guitar), then measures it again on the string's fundamental and 2nd harmonic alone, filtered away from everything else, over as many whole vibrations as fit in 85 ms: 14 vibrations of a high E measured together are 14 times as precise as one.

Tested with synthetic plucked strings whose true pitch is known exactly:

| Situation | How close each reading is to the true pitch |
|---|---|
| A clean, steady note | within 0.02 cent |
| A real string's stiffness (its overtones run slightly sharp) | about 0.1 cent sharp of the fundamental |
| A phone microphone that barely hears the low E's fundamental | about 0.2 cent |
| Loud background noise, only 25 dB below the guitar | single readings vary by about ±0.25 cent; the screen steadies them |
| Another string still ringing, almost as loud | about 0.1 cent |

The screen settles about 0.3 seconds after you pluck, and follows a turning peg 0.1 to 0.2 seconds behind. In practice the limit is the string, not the tuner: a fresh pluck rings a few cents sharp for its first moments and drifts slightly as it fades. That is why the needle moves a little after each pluck.

## Put it online (GitHub Pages)

1. On GitHub, on the same account as your other Echo apps, create a new public repository, for example `echo-tune`. Upload every file in this folder and keep the file names as they are. **`pitch.js` and `mic-worklet.js` must sit next to `index.html`**: they are the pitch engine and the microphone listener.
2. In the repository, open **Settings → Pages** and choose **Deploy from a branch → main → / (root)**. Save.
3. After a minute, open `https://<your-username>.github.io/echo-tune/` in **Safari** on the iPhone.
4. Tap **Share → Add to Home Screen**, keep **Open as Web App** switched on, then tap **Add**. It appears as **Echo Tune**.
5. Open it from the Home Screen **once while online**. When the dot at the top turns green (**Offline ready**), it works in airplane mode.

## Use it

1. Tap the microphone and choose **Allow**.
2. Hold the iPhone 20 to 50 cm from the guitar, its bottom edge (where the microphone is) towards the strings.
3. Pluck one string firmly with your thumb and let it ring. Read the needle after the first half second.
4. **Tune up** means tighten the string, **Tune down** means loosen it. When the needle sits in the green zone and the band stops moving, the string is in tune.
5. Tune up to the note: if you overshoot, go below the note and come back up. The string holds its tuning better.
6. For the last fraction of a cent, touch the strings you aren't tuning so they stop ringing.

## Good to know

- **The microphone question.** The iPhone may ask for the microphone each time you open Echo Tune from the Home Screen. Tap **Allow**. If you chose **Don’t Allow** by mistake, close Echo Tune completely and open it again; if it still doesn't ask, open **Settings › Apps › Safari › Microphone** (on iOS 17: **Settings › Safari › Microphone**) and choose **Ask**.
- **The orange dot** at the top of the screen means the microphone is on. Echo Tune switches it off as soon as you leave the app, and on again when you come back.
- **Headphones.** With AirPods or other Bluetooth headphones connected, the iPhone may listen through their microphone, which sits in your ears instead of near the guitar. Disconnect them while tuning.
- **Screen on.** Echo Tune keeps the screen awake while it listens, where the iPhone allows it. If the screen locks, it stops listening; unlock and it carries on.
- **Calls and alarms** pause it. Tap the button to carry on.
- **Opened from a folder.** Double-clicking `index.html` doesn't work: the microphone only works from a web address.
- **Updating later.** If you change any file, also change `etune-v1` to `etune-v2` (and so on) at the top of `sw.js`. The app picks up the new version the next time it's opened online.

## What has been tested

The pitch engine was tested on synthetic plucked strings at 44.1, 48, 24 and 16 kHz: all six strings, notes from a bass's low E (41 Hz) to the 24th fret of the high E (1319 Hz), detuned strings, stiff strings, faint fundamentals, background noise, strings left ringing while the next one is tuned, two D strings an octave apart in Open D, and a pitch sliding the way it does while a peg turns. Readings with no guitar playing stay blank, even in a noisy room.

The whole app ran in Chromium at iPhone sizes, in light and dark mode and on its side, with a recorded tuning session fed in as the microphone: it named every string and read each one within 0.2 cent. Offline start, the older audio path for older browsers, and a refused microphone were tested too.

It has not yet run on a real iPhone, so tell me if anything behaves differently there; the **Details** button under an error gives the technical facts to send.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app: screen, headstock, settings, help |
| `pitch.js` | The pitch engine: measures the pitch and decides which string and how far off |
| `mic-worklet.js` | The microphone listener (runs on the iPhone's audio thread) |
| `sw.js` | Saves the app for offline use |
| `manifest.webmanifest` | Home Screen name, icon and colours |
| `icon-180.png`, `icon-192.png`, `icon-512.png` | App icons |
| `make_icons.py` | Script that draws the icons (only needed if you want to change them) |

Every file has plain-English comments explaining what each part does.
