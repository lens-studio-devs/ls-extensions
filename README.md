# Lens Studio Agent Extensions

AI agent extensions for Lens Studio development, packaged as plugins for multiple agentic coding platforms.

For more CLAD documentation, see [developers.specs.com/docs/clad](https://developers.specs.com/docs/clad).

## Supported Agentic Platforms

- `Claude Code` - install from the plugin marketplace or from a local clone
- `Codex` - add this repository as a plugin marketplace, then install the plugin you want from Codex
- `Cursor` - follow Cursor's local plugin testing flow with one of the plugin directories in `plugins/`

## Installation

### Claude Code

**Marketplace:**

```
/plugin marketplace add git@github.com:lens-studio-devs/ls-extensions.git
/plugin install ls-clad@lens-studio
```

You can also do this through the Claude Code terminal UI by opening the plugin flow, adding the marketplace there, and installing the plugin you want without typing the full commands manually.

**Local clone:**

```
git clone git@github.com:lens-studio-devs/ls-extensions.git
/plugin marketplace add /absolute/path/to/ls-extensions
/plugin install /absolute/path/to/ls-extensions/plugins/ls-clad
```

### Codex

Codex installs are marketplace-based. You can add this repository directly from git, or clone it locally and add the local path as a marketplace:

**Add from git:**

```sh
codex plugin marketplace add git@github.com:lens-studio-devs/ls-extensions.git
```

**Add from a local clone:**

```sh
git clone git@github.com:lens-studio-devs/ls-extensions.git
codex plugin marketplace add /absolute/path/to/ls-extensions
```

Then launch Codex, enter `/plugin` to open the plugin marketplace, and install `ls-clad`.

### Cursor

Follow Cursor's official docs for [testing plugins locally](https://cursor.com/docs/plugins#test-plugins-locally).

For example, after cloning the repo locally, you can copy a specific plugin directory into Cursor's global local plugin directory:

```sh
git clone git@github.com:lens-studio-devs/ls-extensions.git
mkdir -p ~/.cursor/plugins/local
cp -R /absolute/path/to/ls-extensions/plugins/ls-clad ~/.cursor/plugins/local/ls-clad
```
