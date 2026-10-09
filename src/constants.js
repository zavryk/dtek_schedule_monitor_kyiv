import fs from "node:fs"
import path from "node:path"

// TARGETS_FILE - розшифрований workflow-ом файл; TARGETS - для локального запуску
const { TARGETS_FILE } = process.env
export const TARGETS = TARGETS_FILE ? fs.readFileSync(TARGETS_FILE, "utf8") : process.env.TARGETS

export const SITES = {
  kem: { page: "https://www.dtek-kem.com.ua/ua/shutdowns" },
  krem: { page: "https://www.dtek-krem.com.ua/ua/shutdowns" },
}

export const RESULT_FILE = path.resolve("artifacts", "result.json")
