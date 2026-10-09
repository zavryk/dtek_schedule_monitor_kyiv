import { SITES } from "./constants.js"

export function loadTargets(json) {
  if (!json) throw Error("❌ Missing TARGETS.")
  let targets
  try {
    targets = JSON.parse(json)
  } catch (error) {
    throw Error(`❌ TARGETS is not valid JSON: ${error.message}`)
  }
  if (!Array.isArray(targets) || !targets.length) {
    throw Error("❌ TARGETS must be a non-empty array.")
  }
  const ids = new Set()
  for (const t of targets) {
    if (!t.id || ids.has(t.id)) throw Error(`❌ Each target needs a unique id (${t.id}).`)
    ids.add(t.id)
    if (!SITES[t.site]) throw Error(`❌ Unknown site "${t.site}" (kem | krem).`)
    if (!t.street || !t.house) throw Error(`❌ ${t.id}: street and house required.`)
  }
  return targets
}
