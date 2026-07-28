#!/usr/bin/env node
// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

"use strict";

// Probe, validate, or generate the production signing key used by the
// specs-publish skill. Uses only Node.js built-ins and never prints key material.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const GENERATED_KEY_FILENAME = "specs_signing_key.pem";

function result(status, extra = {}) {
  process.stdout.write(`${JSON.stringify({ status, stage: "signing_key", ...extra })}\n`);
}

function fail(reason, message, extra = {}) {
  result("FAILED", { reason, message, ...extra });
}

function parseArgs(argv) {
  const parsed = { generate: false, keyPath: "", projectPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--generate") {
      parsed.generate = true;
    } else if (argument === "--path") {
      index += 1;
      if (index >= argv.length || !argv[index].trim()) throw new Error("--path requires a value");
      parsed.keyPath = argv[index];
    } else if (argument === "--project") {
      index += 1;
      if (index >= argv.length || !argv[index].trim()) throw new Error("--project requires a value");
      parsed.projectPath = argv[index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (Boolean(parsed.keyPath) === Boolean(parsed.projectPath)) {
    throw new Error("Specify exactly one of --project or --path");
  }
  if (parsed.generate && parsed.keyPath) {
    throw new Error("--generate requires --project so generated keys stay in the Lens Studio project root");
  }
  return parsed;
}

function octalMode(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function pathEntryExists(entryPath) {
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function inspectSigningKey(keyPath) {
  let descriptor;
  let canonicalKeyPath;
  let stat;
  let pem;
  try {
    const entryStat = fs.lstatSync(keyPath);
    if (entryStat.isSymbolicLink()) {
      return {
        ok: false,
        reason: "signing_key_symlink",
        message: "The signing key path must not be a symbolic link.",
      };
    }
    canonicalKeyPath = fs.realpathSync(keyPath);
    descriptor = fs.openSync(canonicalKeyPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      return {
        ok: false,
        reason: "signing_key_not_file",
        message: "The signing key path is not a file.",
      };
    }
    pem = fs.readFileSync(descriptor);
  } catch (error) {
    return {
      ok: false,
      reason: "signing_key_unreadable",
      message: "The signing key could not be read.",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  try {
    if (!pem.toString("utf8").trimStart().startsWith("-----BEGIN PRIVATE KEY-----")) {
      return {
        ok: false,
        reason: "unsupported_signing_key_encoding",
        message: "The signing key must use unencrypted PKCS#8 PEM encoding.",
      };
    }
    const privateKey = crypto.createPrivateKey({ key: pem, format: "pem" });
    if (privateKey.asymmetricKeyType !== "ed25519") {
      return {
        ok: false,
        reason: "unsupported_signing_key",
        message: "The signing key must be an Ed25519 PKCS#8 PEM private key.",
        keyType: privateKey.asymmetricKeyType || "unknown",
      };
    }

    // Exporting as PKCS#8 proves the private key is usable in the format Lens Studio generates.
    privateKey.export({ type: "pkcs8", format: "pem" });
    const publicDer = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
    const fingerprint = crypto.createHash("sha256").update(publicDer).digest("hex");
    const insecurePermissions = process.platform !== "win32" && (stat.mode & 0o077) !== 0;
    return {
      ok: true,
      path: canonicalKeyPath,
      fingerprint: `SHA256:${fingerprint}`,
      permissions: octalMode(stat),
      permissionsSecure: !insecurePermissions,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_signing_key",
      message: "The signing key is not a valid Ed25519 PKCS#8 PEM private key.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateSigningKey(keyPath, created) {
  const inspection = inspectSigningKey(keyPath);
  if (!inspection.ok) {
    const { reason, message, ...extra } = inspection;
    fail(reason, message, { path: keyPath, ...extra });
    return;
  }
  result("SIGNING_KEY_READY", {
    path: inspection.path,
    created,
    fingerprint: inspection.fingerprint,
    permissions: inspection.permissions,
    permissionsSecure: inspection.permissionsSecure,
  });
}

function validateProjectPathDirectories(projectRoot) {
  const directories = [];
  let directory = path.resolve(projectRoot);
  while (true) {
    directories.unshift(directory);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  for (const component of directories) {
    let stat;
    try {
      stat = fs.lstatSync(component);
    } catch (error) {
      fail("project_path_unreadable", "A Lens Studio project path directory could not be read.", {
        projectRoot,
        path: component,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("project_path_unsafe", "The Lens Studio project path must contain only regular directories.", {
        projectRoot,
        path: component,
      });
      return false;
    }
    if (process.platform !== "win32" && (stat.mode & 0o022) !== 0) {
      fail("project_path_permissions", "The Lens Studio project path contains a directory writable by other users.", {
        projectRoot,
        path: component,
        permissions: octalMode(stat),
      });
      return false;
    }
  }
  return true;
}

function projectSigningKeyPath(projectPath) {
  const resolvedProjectPath = path.resolve(projectPath);
  let projectStat;
  try {
    projectStat = fs.lstatSync(resolvedProjectPath);
  } catch (error) {
    fail("project_unreadable", "The Lens Studio project file could not be read.", {
      projectPath: resolvedProjectPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
  if (projectStat.isSymbolicLink() || !projectStat.isFile()) {
    fail("project_not_regular_file", "The Lens Studio project path must be a regular file, not a symbolic link.", {
      projectPath: resolvedProjectPath,
    });
    return "";
  }

  const canonicalProjectPath = fs.realpathSync(resolvedProjectPath);
  const projectRoot = path.dirname(canonicalProjectPath);
  if (!validateProjectPathDirectories(projectRoot)) return "";
  return path.join(projectRoot, GENERATED_KEY_FILENAME);
}

function generateSigningKey(keyPath) {
  const directory = path.dirname(keyPath);
  if (!validateProjectPathDirectories(directory)) return;

  // Never write through an existing path, including an invalid file or symlink.
  if (pathEntryExists(keyPath)) {
    validateSigningKey(keyPath, false);
    return;
  }

  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(keyPath)}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`,
  );
  let descriptor;
  let temporaryCreated = false;
  let installed = false;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    if (process.platform !== "win32") fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, pem);
    fs.fsyncSync(descriptor);
    const descriptorToClose = descriptor;
    descriptor = undefined;
    fs.closeSync(descriptorToClose);

    const temporaryInspection = inspectSigningKey(temporaryPath);
    if (!temporaryInspection.ok) {
      throw new Error(`Generated signing key validation failed: ${temporaryInspection.message}`);
    }

    if (!validateProjectPathDirectories(directory)) return;
    try {
      // A hard link publishes the complete key atomically and fails rather than
      // replacing a path created by another process after the initial probe.
      fs.linkSync(temporaryPath, keyPath);
      installed = true;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (temporaryCreated && pathEntryExists(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  validateSigningKey(keyPath, installed);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const keyPath = args.projectPath ? projectSigningKeyPath(args.projectPath) : path.resolve(args.keyPath);
  if (!keyPath) {
    // projectSigningKeyPath already emitted the structured failure.
  } else if (pathEntryExists(keyPath)) {
    validateSigningKey(keyPath, false);
  } else if (args.generate) {
    generateSigningKey(keyPath);
  } else {
    result("SIGNING_KEY_MISSING", {
      path: keyPath,
      message: "No Specs production signing key exists at the selected path.",
    });
  }
} catch (error) {
  fail("signing_key_setup_failed", error instanceof Error ? error.message : String(error));
}
