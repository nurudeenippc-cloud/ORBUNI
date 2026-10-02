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
