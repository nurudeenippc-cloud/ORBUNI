# Orbuni website (myorbuni.com)

`site/` is the whole website, exactly as it is uploaded to Netlify (project
`effortless-churros-4b9097`). There is no build step: the files here are the files
visitors get.

## Publishing (unchanged: by hand on Netlify)

1. Download the zip for the round you want (each round is also attached to its
   pull request), or zip the `site/` folder yourself.
2. Netlify → effortless-churros-4b9097 → Deploys → drag the unzipped folder
   into the drop zone.

Netlify is deliberately **not** linked to this repository, so manual uploads keep
working exactly as before. GitHub is the record: every round is a commit, so any
change can be compared with the last one and undone.

## One file that is not in here

`site/videos/hafsat-aman.mp4` (the tester-review video) is not part of the
bundle. Copy it from your current live folder into `site/videos/` before you
upload, as in `site/HOW-TO-USE.txt`.

## History

- r20 (1 Oct 2026): the bundle uploaded to Netlify before this repo existed.
- r21 (3 Oct 2026): study-by-subject pages, menu and phone fixes, spelling
  fixes. See `site/HOW-TO-USE.txt`.
- r22 (3 Oct 2026): hero logo no longer cut off by the zoom; new still picture
  for the Programmes demo clip.
- r23 (3 Oct 2026): menu back to two links; campus videos on university pages;
  a different example-photo mix on each housing page (`tools/enrich_media.py`).
- r24 (3 Oct 2026): phone menu without sliding, Ankara Medipol photo, subject pages
  with photos and "Turkey" addresses, subjects on /universities/, student-room photos.
- r25 (3 Oct 2026): real Istanbul residence room photos lead every housing page.
- r26 (3 Oct 2026): subject photo tiles; slim number strip on subject pages.

## Subject pages

`python3 tools/build_study_pages.py` rebuilds `site/study/` from
`tools/data/bachelors.json` (a snapshot of the programme data; the SQL to refresh
it is at the top of the script) and updates `site/sitemap.xml`.
