# Installed app branding

SL-ERP keeps one installed app identity per website. Signing in or switching
organizations updates the app title, browser icon, Apple touch icon, theme color,
and the company branding supplied to the installed app.

The active membership takes priority over a previously remembered company.
Reopening the app uses the current signed-in account. When signed out, the last
selected organization can provide the login branding. **Sign in to another
organization** opens the main `/login` page and clears that remembered choice.

The manifest remains at `/api/platform/public/manifest/`, with `id`, `scope`,
and `start_url` set to `/`. A public branding preference cookie lets the
browser retrieve the current company manifest without exposing authentication
tokens. This cookie grants no access to private company data.

Uploaded raster logos are fitted into square PNG icons at 192 and 512 pixels.
Changing the uploaded logo or branding changes the icon URLs so browsers can
detect the update. SVG and remote logo URLs remain direct browser references;
the backend does not fetch remote branding URLs.

## Taskbar and installed icons

Browser tabs update immediately when the new company branding loads. Installed
app names and icons are controlled by the browser and operating system.

Chrome 144 and later may offer **Review app update** in the installed app's
three-dot menu. Accepting that update allows the installed name and icon to
change. SL-ERP cannot silently approve that browser prompt. Older browsers and
other platforms can require closing/reopening or reinstalling the app.

See [Chrome's app update documentation](https://developer.chrome.com/blog/improvements-to-web-app-updates).

## Local verification

1. Sign in to an organization with its own logo and check the app title and icon.
2. Switch organizations in your profile, or sign out and sign in to another.
3. Check that the new name and icon replace the previous company branding.
4. Close and reopen the app and verify it retains the current organization.
5. From an organization login, choose **Sign in to another organization** and
   verify that the main sign-in page uses the platform brand.
6. In the installed app, review any browser-managed name/icon update offered.

Backend regression coverage is in
`backend/Platform_API/modules/platform/test_app_branding.py`.
