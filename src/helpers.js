import fs from "node:fs"
import path from "node:path"

import { STATE_FILE, QUIET_UNTIL_MIN, SITES } from "./constants.js"

export function capitalize(str) {
  if (typeof str !== "string" || !str) return ""
  return str[0].toUpperCase() + str.slice(1).toLowerCase()
}

export function loadTargets(json) {
  if (!json) throw Error("❌ Missing TARGETS secret.")
  let targets
  try {
    targets = JSON.parse(json)
  } catch (error) {
    throw Error(`❌ TARGETS is not valid JSON: ${error.message}`)
  }
  if (!Array.isArray(targets) || !targets.length) {
    throw Error("❌ TARGETS must be a non-empty array.")
  }
  for (const t of targets) {
    if (!SITES[t.site]) throw Error(`❌ Unknown site "${t.site}" (kem | krem).`)
    if (!t.street || !t.house) throw Error("❌ Each target needs street and house.")
    if (!Array.isArray(t.chats) || !t.chats.length) {
      throw Error(`❌ No chats for ${t.street} ${t.house}.`)
    }
  }
  return targets
}

export function targetKey(t) {
  return [t.site, t.city || "", t.street, t.house].join("|")
}

export function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8").trim() || "{}")
  } catch {
    return {}
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8")
}

export function isQuietHoursKyiv() {
  const [hh, mm] = new Date()
    .toLocaleTimeString("en-GB", { timeZone: "Europe/Kyiv", hour12: false })
    .split(":")
    .map(Number)
  return hh * 60 + mm < QUIET_UNTIL_MIN
}
