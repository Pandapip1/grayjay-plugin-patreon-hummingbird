# Patreon (Hummingbird)

An **unofficial** fork of FUTO's Grayjay Patreon plugin
(https://gitlab.futo.org/videostreaming/plugins/patreon), maintained for the Hummingbird app. It is not made or endorsed by
FUTO, and has its own plugin id so it never replaces the official plugin.

Licensed under the GNU Affero General Public License v3 (see LICENSE), as
the original. The source is this repository; the `hummingbird` branch is
the upstream release plus the changes below, and is what GitHub Pages
serves at https://pandapip1.github.io/grayjay-plugin-patreon-hummingbird/PatreonConfig.json.

## Changes from the original (2026-11-17)

- Own plugin id and the name "Patreon (Hummingbird)"; published from this
  repository and signed with Hummingbird's plugin-signing key.
- Settings "Include NSFW results in search" and "Show NSFW creators and posts" (both off by default); NSFW creators and their posts are left out unless shown; items carry isNsfw.
