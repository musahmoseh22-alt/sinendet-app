# Sinendet Mixed Day Senior School — Project Log

A shared project-upload site for all 12 subjects. Any device (phone, laptop,
lab computer) that opens the site sees the same data, because uploads are
stored on Netlify's servers (via Netlify Blobs) instead of in a single
browser.

## Default admin login

Works immediately, no setup required:

- **Username:** `admin`
- **Password:** `Sinendet@2026`

Change this soon after deploying — see "Changing the admin password" below.
The default is written in this file, so it isn't private until you change it.

## Important: why this needs GitHub, not plain drag-and-drop

This site needs small pieces of server code ("functions") to save data so
it's shared across devices. Netlify's plain drag-and-drop deploy **does not
run functions at all** — it's built only for very simple static pages. The
reliable way to get functions working, confirmed by Netlify's own support
team, is to connect the project to a GitHub repository and let Netlify build
it from there. You still get a drag-and-drop-style upload — just into
GitHub's website instead of Netlify's.

## Deploy steps (one-time)

1. **Create a free GitHub account** at github.com if you don't have one.
2. **Create a new repository** — click the "+" in the top right → "New
   repository". Name it something like `sinendet-project-log`. Leave it
   otherwise empty (no README, no .gitignore) and click "Create repository".
3. **Upload the project** — on the new repo's page, click "uploading an
   existing file" (or "Add file" → "Upload files"). Drag the *entire*
   unzipped project folder (the one containing `netlify.toml`, `public/`,
   and `netlify/`) onto the upload area — GitHub keeps the folder structure.
   Scroll down and click "Commit changes".
4. **Create a free Netlify account** at netlify.com if you don't have one.
5. **Connect the repo** — in the Netlify dashboard, click "Add new site" →
   "Import an existing project" → choose GitHub → authorize Netlify → select
   your `sinendet-project-log` repository.
6. Netlify reads `netlify.toml` automatically (publish folder, functions
   folder are already configured) — just click **Deploy**.
7. Wait about a minute for the first build to finish. Netlify gives you a
   live link like `https://random-name-123.netlify.app` — that's what you
   open on any phone or computer.
8. From **Site configuration → Change site name**, you can rename it to
   something like `sinendet-projects.netlify.app`.

## Changing the admin password

In the Netlify dashboard for this site, go to **Site configuration →
Environment variables** and add:

- `ADMIN_USERNAME` — your new username
- `ADMIN_PASSWORD` — your new password
- `JWT_SECRET` — any long random string (keeps admin sessions secure)

These always override the built-in defaults. After adding them, go to
**Deploys → Trigger deploy → Deploy site** so the change takes effect.

## Updating the site later

Go back to the GitHub repo, open the file you want to change, click the
pencil (edit) icon, make your change, and commit — or just drag a replacement
file onto the repo the same way you did the first upload. Netlify
automatically rebuilds and redeploys within a minute or two, no extra steps.

## Things to know

- **File size**: photos, video, and audio can each be up to **350MB per
  file**, which comfortably covers any realistic classroom video or
  recording. Uploads also rely on Netlify's Blobs storage, which has
  generous but not unlimited space on the free tier — if the school
  accumulates a very large video library over time, keep an eye on usage in
  the Netlify dashboard under **Data & storage → Blobs**.
- **Why big uploads used to fail, and how v15.1 fixes it**: the "could not
  fetch" errors on video uploads weren't random bad luck — Netlify cuts a
  single upload request off if it doesn't finish within about 40 seconds, and
  a large video sent in one piece can easily take longer than that on a weak
  school/mobile connection, no matter how the error was retried. As of
  v15.1, the site splits any file bigger than 2MB into small pieces, uploads
  each one separately (each with its own automatic retry if the connection
  drops), and reassembles them on the server once they've all safely
  arrived. This is the real fix for "could not fetch" on video — the earlier
  retry-only approach in v15.0 helped with ordinary network blips but
  couldn't fix a transfer that was simply too slow to finish in time.
- **Admin login is intentionally simple**: one shared username/password for
  whoever administers the site, not individual accounts. Fine for a small
  internal school tool — don't reuse a password you care about elsewhere.
- **Everyone can upload without logging in** — only editing and deleting
  require the admin login, as requested.
- **Student list (new in v13)**: once signed in as admin, click **Manage
  students** (next to "Sign out") to paste in a class list — one line per
  student, as `Name, Assessment No.` — or remove students one at a time.
  Two students can share the same name as long as their assessment numbers
  are different — the list tells them apart by assessment number, not name,
  so re-adding the same person (same assessment number) just updates their
  details instead of creating a duplicate. This list is shared across all
  12 subjects. Once added, anyone filling in
  the upload form (individual or group) can start typing a name and pick it
  from the dropdown that appears under the name field; the assessment number
  fills in automatically. Typing a name that isn't on the list still works
  fine — the list is just a shortcut, not a requirement.
- **Viewing vs. downloading media**: every photo, video, and audio clip can
  be opened/played right on the page (click a photo to view it full-size,
  or just press play on video/audio) — there's also a small download link
  under each one for saving it to a device.
- **No duplicate submissions (hardened in v15)**: if a student or group
  already has a submission in a subject, the form blocks a second one and
  offers a "Go to their entry" button instead — use "+ Add a task" or "+ Add
  photo/video/audio" on the existing entry to add more work to it (e.g.
  Task 2's marks) rather than filing a new, separate submission. This is now
  enforced on the server as well as in the page itself, so it holds even if
  two people submit for the same student at the same time or the page has
  gone stale — there is no way to end up with two entries for the same
  student/group in one subject.
- **Admin media library (new in v14)**: signed-in admins see a "🖼 Media
  library" button on each subject page — it lists every photo, video and
  audio clip uploaded for that subject, grouped by student/group, with
  checkboxes to select and delete any of them (individually or in bulk).
- **Bulk student removal (new in v14)**: in "Manage students", admins can
  now select multiple students (or "Select all") and remove them in one go,
  instead of one at a time.
- **Adding more to an existing submission (new in v14)**: anyone — not just
  admin — can add another task's marks, or another photo/video/audio, to a
  submission that's already on file via the "+ Add a task" / "+ Add
  photo/video/audio" links on each entry. A submission can only hold one
  video and one audio clip at a time; adding a second requires an admin to
  remove the existing one first (via Edit, or the media library).
- **App version**: shown in the footer of every page (e.g. "v17.0") so you
  can confirm which build is live after an update.
- **Subject completion badges (new in v17)**: signed-in admins get a "✅
  Mark subjects complete" button to tick off which subjects they consider
  done — this is entirely your own judgment call (it's never calculated
  automatically from submissions, since only a person knows whether, say,
  an exempt student or paper-based work should count). Subjects marked
  complete show a green "✓ Complete" badge on their tile on the main menu,
  visible to everyone.
- **Activity log (new in v17)**: signed-in admins get a "🕒 Activity log"
  button showing the most recent 300 actions across every subject — new
  submissions, edits, deletions, roster changes — newest first, so you can
  see who did what and when.
- **Find my work — student self-lookup (new in v17)**: anyone can click
  "🔎 Find my work" on the home page, enter their assessment number, and see
  every task and mark on file for them across all 12 subjects — no sign-in
  needed. Works whether they submitted individually or as part of a group.
- **Student photos on the roster (new in v17)**: in "Manage students",
  admins can click a student's circular photo placeholder to upload a photo
  for easy identification — shown as their initials until a photo is added.
- **Editing a student's name/assessment no. (new in v17)**: in "Manage
  students", click the ✏️ next to a student to fix a typo or change their
  assessment number. Saving automatically updates every existing submission
  that referenced their old name/number — individual entries and group
  member entries, across every subject — so past work stays linked to them.
- **Downloading the student list (new in v17)**: a "⬇ Download list (CSV)"
  link in "Manage students" exports every learner's name and assessment
  number as a spreadsheet-ready CSV file.
- **Reports list groups before individuals (changed in v17)**: Excel/Word/
  PDF exports for a subject are now ordered group submissions first, then
  individual submissions (alphabetically within each), instead of being
  interleaved.
- **Restyled "who hasn't submitted" tracker (changed in v17)**: the
  completion-tracker modal now shows a progress bar and each missing
  student's photo/initials for faster scanning.
- **"Who hasn't submitted" (new in v16)**: a "📋 Who hasn't submitted"
  button on each subject page compares that subject's submissions against
  the shared student roster and lists everyone with nothing on file yet —
  a student counts as covered if they appear individually or as a group
  member. Useful for a quick check before a deadline. This only works for
  students who are on the roster with an assessment number — add them via
  "Manage students" first if they're missing.
- **Compressed videos keep their sound (fixed in v15.2)**: larger video
  clips get automatically compressed before upload to save space — a bug in
  that compression step was stripping the audio entirely, so a compressed
  video played back silent. That's now fixed; if a browser genuinely can't
  carry the audio through compression, the site uploads the original,
  uncompressed clip instead rather than ever producing a silent video.
- **12 subjects (new in v15)**: Computer Studies has been added alongside
  the existing 11.
