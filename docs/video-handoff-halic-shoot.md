# Orbuni · Halic shoot · cinematic film + carousel (handoff brief)

Written 25 Oct 2026. Anyone (another AI model or an editor) can pick this up without asking questions.

## Status: NOT started. Why
- Shoot folder: https://drive.google.com/drive/folders/1pYeJql19qGBOYhEP7WlpfLA-zcpl5Ea5
  First 100 files seen: 26 videos (.MOV, 4.2 GB, one file is 2.0 GB, one is 0.66 GB) and 74 photos (.HEIC); more pages exist.
- The two reference videos ARE in that folder (my first search used the wrong words):
  - "I-just-became-SnapYT.App.mp4" (108 MB) = the "became co-owner of Whop" reference (id 1U8yQb0RXNEUIvMw3fOAcGqrexyaFN7Wl)
  - "Day-In-The-SnapYT.App.mp4" (97 MB) = the second reference, use its beginning (id 1jdgHROeCgp_xCbWK_DbLFqeLndiQgQYr)
- The AI workspace cannot reach drive.google.com, and the Drive connector returns files as text through the chat, which
  cannot carry video. So the footage cannot be loaded into the workspace, and a film cannot be cut from it there.
- Openverse (api.openverse.org) is blocked by the workspace network policy. earshot and real-sfx (GitHub) do download.

Needed to start: the footage on a machine with disk and normal internet (the editor's computer,
or a workspace that can reach Drive).

## The film (from the owner's brief)
1. Opening = the Whop-cofounder reference edit, rebuilt for Orbuni: where the reference shows New York (skyline, bridge,
   tall buildings, water, train), use Istanbul (Galata, bridges over the Golden Horn / Halic, tall buildings, waterway).
   Same structure, same music, same sound effects, same on-screen writing style, same timing.
2. The train shot: make the owner appear to walk in between the train carriages (compositing).
3. Our own photos replace the reference's photos: pick the best, cut them in beat; fix weak ones (Adobe Photoshop / Photoshop-style
   retouch: exposure, colour, crop, sky, noise); stock (Adobe / Pixabay) only where we have nothing.
4. Second reference: use only its beginning (place it in the middle of our film).
5. Vlog / talking parts about Orbuni: cut dead air, laughing, off-topic lines and weak information; keep the important points.
   Some clips are deliberately silent (no sound).
6. Audio (shot on iPhone): noise reduction + speech enhancement on every talking clip (Adobe "Enhance Speech" /
   `media_enhance_speech`; fallback ffmpeg `highpass=80, afftdn, loudnorm -16 LUFS`). Laptop / explaining-the-company scenes
   get the strongest cleanup.
7. Cat photo: use it as a moment (click / shutter sound).
8. Name titles ("Co-founder", names): CURSIVE handwriting that writes itself on screen, with a handwriting / pen sound.
9. Sound: real recorded sound effects, not synthesized. Tools: real-sfx (https://github.com/Clipwing/skills/tree/edbefcbc3474869e6cc1e8a7ca583b0efd0dab7e/skills/real-sfx),
   earshot (https://github.com/Leonxlnx/earshot, use `earshot critique` and `earshot timeline` to check sync),
   Openverse API (https://api.openverse.org/v1/, `/audio/?q=whoosh&license_type=commercial`) for extra effects.
   Cafe scene: ambience + the headset / laptop angles. Music: the reference track if we may use it; otherwise a licensed cinematic bed.
10. Look: highly cinematic (grade, letterbox optional, slow push-ins, speed ramps on beats). Length is open.

## Deliverables
- Master film 16:9 (YouTube) + 9:16 cut (Instagram / TikTok reels).
- Carousel: 8-10 of the best photos, retouched, 4:5 (1080x1350), consistent grade, with a short caption each.
- A shot list + cue sheet (what was used, where, which sound) and the list of anything not finished.
- Upload to the Drive folder (or hand over) when done.

## Order of work (so a partial result is still usable)
1. Pull the reference videos; log their beats, cuts, music, effects, text style (earshot `timeline`).
2. Select and retouch the photos (also gives the carousel).
3. Clean the audio of every talking clip; pick the best sentences (transcribe, cut the filler).
4. Build the opening (Istanbul version of the reference) with real SFX.
5. Add the vlog body, the reference-2 opening in the middle, the cursive titles, the closing.
6. Grade, mix (voice first, music ducked), export 16:9 and 9:16.
7. Carousel export + captions.
